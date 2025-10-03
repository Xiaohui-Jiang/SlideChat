import scanpy as sc
import matplotlib.pyplot as plt
import os

def basic_st_pipeline(file_path, output_dir, hvg_cutoff=500, n_top_genes=2000):
    """
    Basic spatial transcriptomics preprocessing pipeline.
    Steps: QC -> Normalize -> HVG (if genes > hvg_cutoff) -> PCA -> UMAP

    Parameters
    ----------
    file_path : str
        Path to input .h5ad file
    output_dir : str
        Directory to save figures
    hvg_cutoff : int
        Threshold for deciding whether to perform HVG selection
    n_top_genes : int
        Number of HVGs to select if applicable

    Returns
    -------
    AnnData
        Processed AnnData object
    """

    # --- Load data ---
    adata = sc.read_h5ad(file_path)

    # --- QC: mitochondrial filter ---
    adata.var["mt"] = adata.var_names.str.upper().str.startswith("MT-")
    sc.pp.calculate_qc_metrics(adata, qc_vars=["mt"], inplace=True)
    adata = adata[adata.obs["n_genes_by_counts"] > 200, :]
    adata = adata[adata.obs["pct_counts_mt"] < 5, :]

    # --- Normalize ---
    sc.pp.normalize_total(adata, target_sum=1e4)
    sc.pp.log1p(adata)

    # --- HVG (only if panel large enough) ---
    if adata.shape[1] > hvg_cutoff:
        sc.pp.highly_variable_genes(adata, n_top_genes=n_top_genes, subset=True)

    # --- PCA ---
    sc.pp.scale(adata, max_value=10)
    sc.tl.pca(adata, svd_solver="arpack")

    # --- UMAP ---
    sc.pp.neighbors(adata, n_neighbors=10, n_pcs=30)
    sc.tl.umap(adata)

    # --- Save plots ---
    os.makedirs(output_dir, exist_ok=True)

    sc.pl.pca(adata, show=False)
    plt.savefig(os.path.join(output_dir, "pca.png"), dpi=150)
    plt.close()

    sc.pl.umap(adata, show=False)
    plt.savefig(os.path.join(output_dir, "umap.png"), dpi=150)
    plt.close()

    return adata