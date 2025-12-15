import sys
import os
import scanpy as sc
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
from sklearn.metrics import adjusted_rand_score
from langchain_multiagent.agent import BioAnalysisAgent, UserIO, create_plan_builder
from langchain_multiagent.agent import _ensure_openai_api_key as agent_ensure_key

# Mock UserIO to automate interaction
class MockUserIO(UserIO):
    def __init__(self, expected_types: list = None):
        self.expected_types = expected_types or []

    def prompt(self, message: str, default: str = None) -> str:
        print(f"[MockPrompt] {message} (default: {default})")
        msg_lower = message.lower()
        if "gene symbols" in msg_lower:
            return "GAPDH"
        if "tissue" in msg_lower:
            return "breast"
        if "expected cell types" in msg_lower and self.expected_types:
            return ", ".join(self.expected_types)
        return default if default is not None else ""

    def confirm(self, message: str, default: str = "yes") -> bool:
        print(f"[MockConfirm] {message} (default: {default})")
        return True

    def show_error(self, message: str):
        print(f"[MockError] {message}")

    def show_status(self, message: str):
        print(f"[MockStatus] {message}")

    def display(self, message: str):
        print(f"[MockDisplay] {message}")

def _ensure_openai_api_key():
    return agent_ensure_key()

def run_agent_task(dataset_path: str, query: str, include_steps: list = None, expected_types: list = None):
    plan_builder = create_plan_builder("llm", include_steps=include_steps)
    agent = BioAnalysisAgent(user_io=MockUserIO(expected_types=expected_types), plan_builder=plan_builder)
    full_query = f"Load {dataset_path}. {query}"
    
    try:
        result = agent.run(full_query)
        output_dir = Path(os.getcwd())
        dirs = sorted([d for d in output_dir.iterdir() if d.is_dir() and d.name.startswith("analysis_agent_")])
        
        found_h5ad = None
        if dirs:
            latest_dir = dirs[-1]
            h5ads = list(latest_dir.glob("*_agent.h5ad"))
            if h5ads:
                found_h5ad = h5ads[0]
        
        # Fallback: Check data directory for {dataset}_agent.h5ad
        if not found_h5ad:
            data_dir = Path("/Users/xiaohui/LocalFiles/Codes/slidechat/data")
            # Construct expected filename
            dataset_name = Path(dataset_path).stem # e.g. PM-A
            fallback_path = data_dir / f"{dataset_name}_agent.h5ad"
            if fallback_path.exists():
                found_h5ad = fallback_path
            
        if found_h5ad:
            print(f"[System] Found agent output: {found_h5ad}")
            return sc.read_h5ad(found_h5ad)
        
        print("[System] Could not find agent output .h5ad file.")
        return None
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Agent failed: {e}")
        return None

def run_manual_task(dataset_path: str, task_type: str):
    adata = sc.read_h5ad(dataset_path)
    
    if task_type == "clustering":
        # Standard Clustering
        # Preprocess
        sc.pp.filter_cells(adata, min_genes=200)
        sc.pp.filter_genes(adata, min_cells=3)
        adata.var['mt'] = adata.var_names.str.startswith('MT-')
        sc.pp.calculate_qc_metrics(adata, qc_vars=['mt'], percent_top=None, log1p=False, inplace=True)
        adata = adata[adata.obs.pct_counts_mt < 20, :]
        sc.pp.normalize_total(adata)
        sc.pp.log1p(adata)
        try:
            sc.pp.highly_variable_genes(adata)
        except ValueError:
            pass
        # biotools does NOT scale
        # sc.pp.scale(adata, max_value=10)
        sc.pp.pca(adata)
        sc.pp.neighbors(adata) # defaults: n_neighbors=15
        sc.tl.umap(adata)
        try:
            sc.tl.leiden(adata, flavor="igraph", n_iterations=2, directed=False)
        except:
            sc.tl.leiden(adata, flavor="leidenalg")
        return adata

    return None

def main():
    if not _ensure_openai_api_key():
        print("Error: OpenAI API key not found.")
        sys.exit(1)

    data_dir = Path("/Users/xiaohui/LocalFiles/Codes/slidechat/data")
    datasets = ["PM-A.h5ad", "PM-B.h5ad", "RM-A.h5ad", "RM-B.h5ad"]
    
    # Results storage
    clustering_results = []
    annotation_results = []

    for ds_name in datasets:
        dataset_path = data_dir / ds_name
        if not dataset_path.exists():
            print(f"Dataset {ds_name} not found, skipping.")
            continue

        print(f"\n==================================================")
        print(f"Processing {ds_name}")
        print(f"==================================================")

        # --- Task 1: Clustering ---
        print(f"\n--- Task 1: Clustering on {ds_name} ---")
        adata_agent_clus = run_agent_task(str(dataset_path), "Preprocess this dataset and identify cell clusters.")
        adata_manual_clus = run_manual_task(str(dataset_path), "clustering")
        
        if adata_agent_clus and adata_manual_clus:
            common_cells = adata_agent_clus.obs_names.intersection(adata_manual_clus.obs_names)
            if len(common_cells) > 0:
                agent_labels = adata_agent_clus.obs.loc[common_cells, "leiden"]
                manual_labels = adata_manual_clus.obs.loc[common_cells, "leiden"]
                ari = adjusted_rand_score(manual_labels, agent_labels)
                print(f"  Clustering ARI: {ari:.4f}")
                clustering_results.append({"Dataset": ds_name.replace(".h5ad", ""), "ARI": ari})
            else:
                print("  No common cells found for clustering.")
        else:
            print("  Clustering failed (Agent or Manual).")

        # --- Task 2: Annotation ---
        print(f"\n--- Task 2: Annotation on {ds_name} ---")
        # Get cell types from GT to prompt the agent
        adata_orig = sc.read_h5ad(dataset_path)
        if "Major.subtype" in adata_orig.obs:
            cell_types = list(adata_orig.obs["Major.subtype"].unique())
            # Clean up nan if any
            cell_types = [str(ct) for ct in cell_types if pd.notna(ct)]
            query = f"Annotate cell types. The possible cell types are: {', '.join(cell_types)}."
            
            adata_agent_anno = run_agent_task(str(dataset_path), query, include_steps=["cell_typing"], expected_types=cell_types)
            
            if adata_agent_anno:
                common_cells = adata_agent_anno.obs_names.intersection(adata_orig.obs_names)
                # Find annotation column
                agent_col = None
                for col in ["predicted_type", "cell_type", "major_cell_type", "annotation", "leiden"]:
                    if col in adata_agent_anno.obs:
                        agent_col = col
                        break
                
                if agent_col:
                    agent_labels = adata_agent_anno.obs.loc[common_cells, agent_col]
                    true_labels = adata_orig.obs.loc[common_cells, "Major.subtype"]
                    ari = adjusted_rand_score(true_labels, agent_labels)
                    print(f"  Annotation ARI: {ari:.4f}")
                    annotation_results.append({"Dataset": ds_name.replace(".h5ad", ""), "ARI": ari})
                else:
                    print("  Agent did not produce annotation column.")
            else:
                print("  Agent annotation task failed.")
        else:
            print("  Ground truth 'Major.subtype' missing, skipping Annotation.")

    # Save and Plot
    output_dir = os.path.join(os.path.dirname(__file__), 'results')
    os.makedirs(output_dir, exist_ok=True)

    # Clustering Plot
    if clustering_results:
        df_clus = pd.DataFrame(clustering_results)
        df_clus.to_json(os.path.join(output_dir, 'system_validation_clustering.json'), orient='records')
        
        plt.figure(figsize=(8, 6))
        bars = plt.bar(df_clus["Dataset"], df_clus["ARI"], color="#4C72B0")
        plt.ylim(0, 1.0)
        plt.title("System Validation: Clustering Consistency (ARI)")
        plt.ylabel("Adjusted Rand Index")
        for bar in bars:
            height = bar.get_height()
            plt.text(bar.get_x() + bar.get_width()/2., height, f'{height:.2f}', ha='center', va='bottom')
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'system_validation_clustering.png'), dpi=150)
        print(f"\nClustering results saved.")

    # Annotation Plot
    if annotation_results:
        df_anno = pd.DataFrame(annotation_results)
        df_anno.to_json(os.path.join(output_dir, 'system_validation_annotation.json'), orient='records')
        
        plt.figure(figsize=(8, 6))
        bars = plt.bar(df_anno["Dataset"], df_anno["ARI"], color="#55A868")
        plt.ylim(0, 1.0)
        plt.title("System Validation: Annotation Accuracy (ARI)")
        plt.ylabel("Adjusted Rand Index (vs Ground Truth)")
        for bar in bars:
            height = bar.get_height()
            plt.text(bar.get_x() + bar.get_width()/2., height, f'{height:.2f}', ha='center', va='bottom')
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'system_validation_annotation.png'), dpi=150)
        print(f"\nAnnotation results saved.")

if __name__ == "__main__":
    main()
