import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from langchain_multiagent.agent import BioAnalysisAgent, UserIO, create_plan_builder
from langchain_multiagent.agent import _ensure_openai_api_key as agent_ensure_key

class MockUserIO(UserIO):
    def prompt(self, message: str, default: str = None) -> str:
        msg_lower = message.lower()
        
        if "embedding method" in msg_lower or "umap/tsne" in msg_lower:
            return "umap"
        elif "group_key" in msg_lower or ("group" in msg_lower and "column" in msg_lower):
            return "roi"
        elif "log2fc" in msg_lower:
            return "1.0"
        elif "fdr" in msg_lower:
            return "0.05"
        elif "min_cells" in msg_lower:
            return "3"
        elif "min_genes" in msg_lower:
            return "50"
        elif "mitochondrial" in msg_lower:
            return "100"
        
        return default if default else ""

    def confirm(self, message: str, default: bool = True) -> bool:
        if "retry" in message.lower():
            return False
        return default

    def display(self, message: str):
        if any(kw in message for kw in ["Summary", "failed", "completed"]):
            print(f"[Agent] {message}")

    def show_error(self, message: str):
        print(f"[Error] {message}")

    def show_status(self, message: str):
        pass

def main():
    if not agent_ensure_key():
        print("Error: OpenAI API key not found.")
        sys.exit(1)

    data_path = "/Users/xiaohui/Downloads/spatial/Lung5_Rep1_with_roi.h5ad"
    
    if not Path(data_path).exists():
        print(f"Error: {data_path} not found. Run 05_spatial_roi_analysis.py first.")
        sys.exit(1)
    
    query = f"""
Perform differential expression analysis on {data_path}.

The dataset has ROI_1 and ROI_2 in the 'roi' column.

Compare ROI_1 vs ROI_2 using log2fc > 1.0 and FDR < 0.05.
"""
    
    plan_builder = create_plan_builder("llm", include_steps=["de"])
    plan_builder.set_context({"adata_path": data_path, "adata_id": data_path})
    
    agent = BioAnalysisAgent(user_io=MockUserIO(), plan_builder=plan_builder, greet_on_start=False)
    result = agent.run(query)
    
    print("\n" + "="*80)
    print("ANALYSIS COMPLETE")
    print("="*80)
    print(f"Report: {result.report_path}")
    print(f"Figures: {result.pdf_path}")
    
    for i, log in enumerate(result.logs, 1):
        icon = "✅" if log.status == "success" else "❌"
        print(f"{icon} {i}. {log.step_title}")

if __name__ == "__main__":
    main()
