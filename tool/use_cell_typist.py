import scanpy as sc
import celltypist
from celltypist import models

def annotate_and_update_adata(
    adata,
    model_name: str,
    majority_voting: bool = True,
    mode: str = "best match",
    p_thres: float = 0.5
):
    """
    Annotate an AnnData object using CellTypist and update it in-place.

    Parameters
    ----------
    adata : AnnData
        Preprocessed AnnData (normalized + log-transformed recommended).
    model_name : str
        Name of the CellTypist model (e.g., "Immune_All_Low.pkl").
    majority_voting : bool
        Apply majority voting across clusters for more stable labels.
    mode : str
        "best match" (single-label) or "prob match" (multi-label).
    p_thres : float
        Probability threshold for "prob match" mode.

    Returns
    -------
    AnnData
        The same AnnData object with new fields:
          - obs["celltypist_labels"]
          - obsm["celltypist_probabilities"]
    """

    # Ensure model is downloaded
    models.download_models(model=model_name, force_update=False)
    model = models.Model.load(model=model_name)

    # Ensure dense matrix if sparse
    if hasattr(adata.X, "toarray"):
        adata.X = adata.X.toarray()

    # Run annotation
    result = celltypist.annotate(
        adata,
        model=model,
        majority_voting=majority_voting,
        mode=mode,
        p_thres=p_thres
    )

    # Add predicted labels into obs
    adata.obs["celltypist_labels"] = result.predicted_labels.values

    # Add probability matrix into obsm
    adata.obsm["celltypist_probabilities"] = result.probability_matrix.values
    adata.uns["celltypist_classes"] = result.probability_matrix.columns.tolist()

    return adata