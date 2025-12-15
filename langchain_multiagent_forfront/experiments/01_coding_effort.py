import matplotlib.pyplot as plt
import pandas as pd
import json
import os
import numpy as np

# Define the "Manual Code" as the actual implementation of the tools in biotools.py
# We extract the core logic from the _run methods we read.

manual_code_blocks = {
    "Preprocessing": """
# PreprocessPipelineTool._run_preprocess_pipeline logic
if not adata.var_names.is_unique:
    adata.var_names_make_unique()
if not adata.obs_names.is_unique:
    adata.obs_names_make_unique()
if adata.raw is not None:
    adata.raw = None
adata.var["gene_symbols"] = adata.var_names.astype(str)
initial_stats = {"n_cells": adata.n_obs, "n_genes": adata.n_vars}
qc_vars = None
if "mt" in adata.var.columns:
    qc_vars = {"mt": adata.var["mt"].astype(bool)}
else:
    mito_mask = adata.var_names.str.upper().str.startswith("MT-")
    if mito_mask is not None and mito_mask.any():
        adata.var["mt"] = mito_mask
        qc_vars = {"mt": adata.var["mt"]}
sc.pp.calculate_qc_metrics(adata, qc_vars=qc_vars, percent_top=None, log1p=False, inplace=True)
gene_counts = np.asarray((adata.X > 0).sum(axis=0)).ravel()
cell_counts = np.asarray((adata.X > 0).sum(axis=1)).ravel()
min_cells_mask = gene_counts >= params["min_cells"]
min_genes_mask = cell_counts >= params["min_genes"]
mito_columns = [col for col in adata.obs.columns if col.startswith("pct_counts_")]
mito_column = next((col for col in mito_columns if "mt" in col.lower()), None)
if mito_column:
    max_pct_mito_mask = adata.obs[mito_column] <= params["max_pct_mito"]
else:
    max_pct_mito_mask = np.ones(adata.n_obs, dtype=bool)
adata = adata[min_genes_mask & max_pct_mito_mask, min_cells_mask].copy()
adata.layers["raw_counts"] = adata.X.copy()
adata.raw = adata.copy()
sc.pp.normalize_total(adata)
sc.pp.log1p(adata)
adata.layers["log1p"] = adata.X.copy()
try:
    sc.pp.highly_variable_genes(adata)
except ValueError:
    pass
sc.pp.pca(adata)
sc.pp.neighbors(adata)
if method == "umap":
    sc.tl.umap(adata)
elif method == "tsne":
    sc.tl.tsne(adata)
try:
    sc.tl.leiden(adata, flavor="igraph", n_iterations=2, directed=False)
except Exception:
    sc.tl.leiden(adata, flavor="leidenalg")
if adata.obsm[embedding_key].shape[0] > 1 and len(cluster_sizes) > 1:
    silhouette = float(silhouette_score(adata.obsm[embedding_key], cluster_labels, metric="euclidean"))
""",
    "DE Analysis": """
# DEAnalysisTool._run_de_analysis logic
adata.obs[group_key] = adata.obs[group_key].astype(str).astype("category")
groups = list(adata.obs[group_key].cat.categories)
sc.tl.rank_genes_groups(adata, groupby=group_key, groups=groups, reference="rest", rankby_abs=True, method="t-test_overestim_var", use_raw=False)
all_results = []
significant_results = {}
summary = {}
volcano_payload = {}
top_gene_records = []
for group in groups:
    group_df = sc.get.rank_genes_groups_df(adata, group=group)
    group_df["group"] = group
    all_results.append(group_df)
    sig_mask = (group_df["logfoldchanges"].abs() >= log2fc_threshold) & (group_df["pvals_adj"] <= fdr_threshold)
    sig_df = group_df[sig_mask].copy()
    significant_results[group] = {}
    for _, row in sig_df.iterrows():
        significant_results[group][row["names"]] = {"log2fc": float(row["logfoldchanges"]), "padj": float(row["pvals_adj"])}
    if not sig_df.empty:
        top_local = sig_df.sort_values("pvals_adj", ascending=True).head(3)
        for _, row in top_local.iterrows():
            top_gene_records.append({"group": group, "gene": row["names"], "log2fc": float(row["logfoldchanges"]), "padj": float(row["pvals_adj"])})
    summary[group] = {"significant": int(len(sig_df)), "upregulated": int((sig_df["logfoldchanges"] > 0).sum()), "downregulated": int((sig_df["logfoldchanges"] < 0).sum())}
    volcano_payload[group] = [{"gene": row["names"], "log2fc": float(row["logfoldchanges"]), "padj": float(row["pvals_adj"])} for _, row in group_df.iterrows()]
combined_df = pd.concat(all_results, ignore_index=True)
""",
    "Spatial Plot": """
# SpatialGenePlotTool._run_spatial_gene_plot logic
obsm_key = (params.get("obsm_key") or "spatial").strip()
coords = adata.obsm[obsm_key]
raw_genes = params["genes"]
if isinstance(raw_genes, str):
    gene_list = [g.strip() for g in raw_genes.replace(";", ",").split(",") if g.strip()]
else:
    gene_list = [str(g).strip() for g in raw_genes if str(g).strip()]
available = set(map(str, adata.var_names))
valid_genes = [g for g in gene_list if g in available]
plots = {}
for gene in valid_genes:
    expr = adata[:, gene].X
    if sparse.issparse(expr):
        expr = expr.toarray()
    expr = np.asarray(expr).ravel()
    fig, ax = plt.subplots(figsize=(5.5, 5))
    sc_plt = ax.scatter(coords[:, 0], coords[:, 1], c=expr, cmap="viridis", s=point_size, edgecolors="none", alpha=0.9)
    ax.set_title(f"{gene} expression")
    ax.set_xlabel("x")
    ax.set_ylabel("y")
    cbar = fig.colorbar(sc_plt, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label("Expression")
    save_figure(fig, plot_path, tight_layout=False)
    plots[gene] = plot_path
""",
    "Cell Communication": """
# CellCommunicationTool._run_cell_communication logic
from squidpy.datasets import ligand_receptor as _lr_dataset
lr_db = _lr_dataset()
lr_pairs = lr_db[["ligand_complex", "receptor_complex"]].dropna()
lr_pairs = lr_pairs.rename(columns={"ligand_complex": "ligand", "receptor_complex": "receptor"})
clusters = adata.obs[group_key].astype(str)
X = adata.X
if sparse.issparse(X):
    X = X.toarray()
expr_df = pd.DataFrame(X, index=adata.obs_names, columns=adata.var_names)
group_means = expr_df.groupby(clusters).mean()
available = set(map(str, adata.var_names))
lr_pairs = lr_pairs[lr_pairs["ligand"].isin(available) & lr_pairs["receptor"].isin(available)]
records = []
for ligand, receptor in lr_pairs.itertuples(index=False):
    ligand_expr = group_means[ligand]
    receptor_expr = group_means[receptor]
    if min_expr is not None:
        ligand_expr = ligand_expr.where(ligand_expr >= float(min_expr), other=0.0)
        receptor_expr = receptor_expr.where(receptor_expr >= float(min_expr), other=0.0)
    for sender, lig_val in ligand_expr.items():
        if lig_val <= 0: continue
        for receiver, rec_val in receptor_expr.items():
            if rec_val <= 0: continue
            score = float(lig_val * rec_val)
            if score <= 0: continue
            records.append({"sender": sender, "receiver": receiver, "ligand": ligand, "receptor": receptor, "score": score})
interactions = pd.DataFrame(records)
interactions.sort_values("score", ascending=False, inplace=True)
top_interactions = interactions.head(n_top_pairs)
fig, ax = plt.subplots(figsize=(8, 5))
display = top_interactions.copy()
display["pair"] = display["ligand"] + "→" + display["receptor"]
ax.barh(display["pair"], display["score"], color="#4C72B0")
ax.invert_yaxis()
ax.set_xlabel("Interaction score")
ax.set_title(f"Top {len(display)} ligand-receptor pairs")
fig.tight_layout()
fig.savefig(plot_path, dpi=150)
""",
    "Batch Correction": """
# BatchCorrectionTool._run_batch_correction logic
if batch_key not in adata.obs.columns:
    raise ValueError(f"Column '{batch_key}' not found")
if not adata.var_names.is_unique:
    adata.var_names_make_unique()
sc.pp.combat(adata, key=batch_key)
if compute_embedding:
    n_pcs = int(params.get("n_pcs") or 30)
    sc.pp.pca(adata, n_comps=n_pcs)
    sc.pp.neighbors(adata)
    sc.tl.umap(adata)
    fig, ax = plt.subplots(figsize=(6, 5))
    batches = adata.obs[batch_key].astype(str)
    unique_batches = sorted(batches.unique())
    cmap = plt.colormaps.get_cmap("tab20")
    colors = cmap(np.linspace(0, 1, max(len(unique_batches), 1)))
    for idx, label in enumerate(unique_batches):
        mask = batches == label
        coords = adata.obsm["X_umap"]
        ax.scatter(coords[mask, 0], coords[mask, 1], s=4, color=colors[idx], label=str(label))
    ax.legend()
    save_figure(fig, embedding_plot)
""",
    "UMAP Gene Plot": """
# UMAPGenePlotTool._run_umap_gene_plot logic
obsm_key = (params.get("obsm_key") or "X_umap").strip()
coords = adata.obsm[obsm_key]
raw_genes = params["genes"]
gene_list = [g.strip() for g in raw_genes.split(",") if g.strip()]
available = set(map(str, adata.var_names))
valid_genes = [g for g in gene_list if g in available]
for gene in valid_genes:
    expr = adata[:, gene].X
    if sparse.issparse(expr): expr = expr.toarray()
    expr = np.asarray(expr).ravel()
    fig, ax = plt.subplots(figsize=(5.5, 5))
    sc_plt = ax.scatter(coords[:, 0], coords[:, 1], c=expr, cmap="viridis", s=point_size)
    ax.set_title(f"{gene} expression on UMAP")
    fig.colorbar(sc_plt, ax=ax)
    save_figure(fig, plot_path)
""",
    "Pseudotime": """
# PseudotimeTool._run_pseudotime logic
if neighbors_key:
    adata.uns["neighbors"] = {"connectivities": adata.obsp[f"{neighbors_key}_connectivities"], "distances": adata.obsp.get(f"{neighbors_key}_distances")}
if "neighbors" not in adata.uns:
    sc.pp.neighbors(adata)
if root_cell:
    root_index = int(np.where(adata.obs_names == root_cell)[0][0])
elif root_label:
    root_indices = np.where(adata.obs[label_key].astype(str) == str(root_label))[0]
    if root_indices.size > 0: root_index = int(root_indices[0])
sc.tl.dpt(adata, n_dcs=10, neighbors_key=neighbors_key, root=root_index)
if "X_umap" not in adata.obsm:
    sc.tl.umap(adata)
pseudotime_vals = adata.obs.get("dpt_pseudotime")
fig, ax = plt.subplots(figsize=(6, 5))
sc_plt = ax.scatter(umap_coords[:, 0], umap_coords[:, 1], c=pseudotime_vals, cmap="plasma", s=5)
ax.set_title("Diffusion pseudotime")
fig.colorbar(sc_plt, ax=ax)
save_figure(fig, plot_path)
""",
    "Cell Typing": """
# CellTypingTool._run_cell_typing logic
marker_sets = _normalise_marker_panels(params.get("marker_sets"))
if not marker_sets:
    recommendation = _recommend_marker_sets(tissue_type=params.get("tissue_type"), expected_types=params.get("expected_types"), question=params.get("question"))
    marker_sets = _normalise_marker_panels(recommendation["marker_sets"])
marker_sets, _ = _merge_marker_panels(marker_sets, params.get("custom_markers"))
score_cols = []
for cell_type, markers in marker_sets.items():
    pos_markers = markers.get("positive", [])
    neg_markers = markers.get("negative", [])
    score_name = f"score_{cell_type}"
    sc.tl.score_genes(adata, gene_list=pos_markers, score_name=score_name)
    if neg_markers:
        neg_score_name = f"score_{cell_type}_neg"
        sc.tl.score_genes(adata, gene_list=neg_markers, score_name=neg_score_name)
        adata.obs[score_name] = adata.obs[score_name] - adata.obs[neg_score_name]
    score_cols.append(score_name)
scores = adata.obs[score_cols].values
max_indices = np.argmax(scores, axis=1)
predicted_types = np.array(list(marker_sets.keys()))[max_indices]
adata.obs[params["output_key"]] = predicted_types
fig, ax = plt.subplots(figsize=(6, 5))
for idx, cell_type in enumerate(np.unique(predicted_types)):
    mask = predicted_types == cell_type
    ax.scatter(umap_coords[mask, 0], umap_coords[mask, 1], s=2, label=str(cell_type))
ax.legend()
save_figure(fig, umap_plot_file)
""",
    "Spatial Domain": """
# SpatialDomainTool._run_spatial_domain logic
if connectivity_key not in adata.obsp:
    sq.gr.spatial_neighbors(adata, coord_type=coord_type, delaunay=delaunay, n_neighs=n_neighbors)
connectivities = adata.obsp.get(connectivity_key)
if expression_weight > 0:
    sc.pp.pca(adata, n_comps=n_pcs)
    sc.pp.neighbors(adata, n_neighbors=expression_n_neighbors)
    expr_connectivities = adata.obsp.get(f"{expr_neighbors_key}_connectivities")
    combined = ((1.0 - expression_weight) * connectivities) + (expression_weight * expr_connectivities)
    adata.obsp["connectivities"] = combined
if method == "leiden":
    sc.tl.leiden(adata, resolution=resolution, key_added=domain_key)
elif method == "kmeans":
    kmeans = KMeans(n_clusters=n_clusters)
    labels = kmeans.fit_predict(coords)
    adata.obs[domain_key] = labels.astype(str)
fig, ax = plt.subplots(figsize=(5.5, 5))
for idx, label in enumerate(unique_domains):
    mask = adata.obs[domain_key] == label
    ax.scatter(coords[mask, 0], coords[mask, 1], s=35, color=colors[idx], label=str(label))
ax.legend()
save_figure(fig, plot_file)
""",
    "Metadata Inspector": """
# MetadataInspectorTool._run_metadata_inspector logic
metadata = {
    "data_scale": {"n_cells": int(adata.n_obs), "n_genes": int(adata.n_vars)},
    "layers": list(adata.layers.keys()),
    "observation_columns": list(adata.obs.columns),
    "variable_columns": list(adata.var.columns),
}
fig, ax = plt.subplots(figsize=(6, 4))
ax.bar(["Cells", "Genes"], [metadata["data_scale"]["n_cells"], metadata["data_scale"]["n_genes"]])
ax.set_yscale("log")
save_figure(fig, overview_plot)
"""
}

# Detailed interaction counts based on planner.py ParameterPrompts
# Formula: 1 (Initial) + 1 (Plan) + 1 (Step) + N (Parameters)
agent_interactions = {
    "Preprocessing": 1 + 1 + 1 + 6,      # 9
    "DE Analysis": 1 + 1 + 1 + 4,        # 7
    "Spatial Plot": 1 + 1 + 1 + 4,       # 7
    "Cell Communication": 1 + 1 + 1 + 4, # 7
    "Batch Correction": 1 + 1 + 1 + 4,   # 7
    "UMAP Gene Plot": 1 + 1 + 1 + 4,     # 7
    "Pseudotime": 1 + 1 + 1 + 5,         # 8
    "Cell Typing": 1 + 1 + 1 + 4,        # 7
    "Spatial Domain": 1 + 1 + 1 + 5,     # 8
    "Metadata Inspector": 1 + 1 + 1 + 1  # 4
}

def count_lines(text):
    """Count non-empty, non-comment lines."""
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    # Filter out pure comments
    code_lines = [line for line in lines if not line.startswith('#')]
    return len(code_lines)

def main():
    results = []
    
    for task_name, code in manual_code_blocks.items():
        manual_loc = count_lines(code)
        agent_loc = agent_interactions[task_name]
        
        reduction = (1 - agent_loc / manual_loc) * 100
        
        results.append({
            "Task": task_name,
            "Manual_LOC": manual_loc,
            "Agent_Interactions": agent_loc,
            "Reduction_Pct": reduction
        })
        
    df = pd.DataFrame(results)
    
    # Save JSON
    output_dir = os.path.join(os.path.dirname(__file__), 'results')
    os.makedirs(output_dir, exist_ok=True)
    df.to_json(os.path.join(output_dir, 'coding_effort_results.json'), orient='records', indent=2)
    
    # Plot
    plt.figure(figsize=(14, 8))
    x = range(len(df))
    width = 0.35
    
    plt.bar([i - width/2 for i in x], df['Manual_LOC'], width, label='Manual Code (LOC)', color='#4a90e2')
    plt.bar([i + width/2 for i in x], df['Agent_Interactions'], width, label='SlideChat Interactions', color='#e74c3c')
    
    plt.xlabel('Task', fontsize=12)
    plt.ylabel('User Inputs (LOC or Interactions)', fontsize=12)
    plt.title('Coding Effort Reduction: SlideChat vs Manual Workflow', fontsize=14)
    plt.xticks(x, df['Task'], rotation=45, ha='right')
    plt.legend()
    
    # Add reduction labels
    for i, row in df.iterrows():
        plt.text(i, row['Manual_LOC'] + 1, f"-{row['Reduction_Pct']:.0f}%", ha='center', fontweight='bold', fontsize=9)
        
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'coding_effort_plot.png'), dpi=300)
    print(f"Results saved to {output_dir}")
    print(df)

if __name__ == "__main__":
    main()
