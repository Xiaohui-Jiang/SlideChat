"""Utilities for creating mock AnnData objects for unit tests."""
from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable, Optional

import anndata as ad
import numpy as np
import pandas as pd


def create_mock_adata(
    *,
    n_cells: int = 50,
    n_genes: int = 100,
    rng_seed: int = 0,
    group_assignments: Optional[Dict[str, Iterable[str]]] = None,
) -> ad.AnnData:
    """Create a reproducible mock AnnData object.

    Args:
        n_cells: Number of cells to simulate.
        n_genes: Number of genes to simulate.
        rng_seed: Seed for the random number generator to ensure reproducibility.
        group_assignments: Optional mapping of observation column name to iterable of labels
            (length must equal ``n_cells``). Useful for DE or clustering tests.

    Returns:
        AnnData with synthetic count matrix and basic metadata suitable for unit tests.
    """
    rng = np.random.default_rng(rng_seed)

    # Generate a simple count matrix using a Poisson distribution.
    x_matrix = rng.poisson(lam=2.0, size=(n_cells, n_genes)).astype(np.float32)

    obs_index = [f"Cell{i}" for i in range(n_cells)]
    var_index = [f"Gene{i}" for i in range(n_genes)]

    # Ensure a handful of mitochondrial genes for QC-related calculations.
    mito_gene_count = min(5, n_genes)
    for i in range(mito_gene_count):
        var_index[i] = f"MT-Gene{i}"

    obs_df = pd.DataFrame(index=obs_index)
    if group_assignments:
        for column, labels in group_assignments.items():
            labels_list = list(labels)
            if len(labels_list) != n_cells:
                raise ValueError(
                    f"Group assignment for '{column}' must have {n_cells} entries,\n"
                    f"received {len(labels_list)}."
                )
            obs_df[column] = labels_list

    var_df = pd.DataFrame(index=var_index)
    var_df["gene_symbols"] = var_index
    var_df["mt"] = [name.startswith("MT-") for name in var_index]

    adata = ad.AnnData(X=x_matrix, obs=obs_df, var=var_df)
    return adata


def write_mock_adata(path: Path, **kwargs) -> Path:
    """Create a mock AnnData object and write it to ``path``.

    Returns the path to the written file for convenience.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    adata = create_mock_adata(**kwargs)
    adata.write_h5ad(path)
    return path
