"""Unit test configuration and shared fixtures."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
import warnings

import dask.array as da
import numpy as np
import pytest


if not hasattr(da, "nanmedian"):
    def _nanmedian(array, axis=None, keepdims: bool = False):
        np_array = np.asarray(array)
        return np.nanmedian(np_array, axis=axis, keepdims=keepdims)

    da.nanmedian = _nanmedian

# Ensure project root is importable when tests run from a subdirectory
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Ensure top-level module alias for test imports
sys_modules = importlib.import_module
sys.modules.setdefault("biotools", sys_modules("langchain_multiagent.biotools"))

from .mock_data import create_mock_adata, write_mock_adata


warnings.filterwarnings(
    "ignore",
    message="The legacy Dask DataFrame implementation is deprecated",
    category=FutureWarning,
)
warnings.filterwarnings(
    "ignore",
    message="pkg_resources is deprecated as an API",
    category=UserWarning,
)
warnings.filterwarnings(
    "ignore",
    message="Importing read_text from `anndata` is deprecated",
    category=FutureWarning,
)


@pytest.fixture
def mock_data_path(tmp_path: Path) -> Path:
    """Path to a basic mock AnnData file for tests that operate on file inputs."""
    path = tmp_path / "mock_data.h5ad"
    write_mock_adata(path)
    return path


@pytest.fixture
def grouped_mock_data_path(tmp_path: Path) -> Path:
    """Path to a mock AnnData file with group annotations for DE tests."""
    n_cells = 40
    rng = np.random.default_rng(42)
    groups = {
        "group": rng.choice(["group1", "group2"], size=n_cells)
    }
    path = tmp_path / "mock_groups.h5ad"
    write_mock_adata(path, n_cells=n_cells, group_assignments=groups)
    return path


@pytest.fixture
def mock_data():
    """In-memory AnnData object for tests that don't require file IO."""
    return create_mock_adata()


@pytest.fixture
def marker_mock_data_path(tmp_path: Path) -> Path:
    """Path to mock AnnData containing common marker gene symbols."""
    marker_genes = [
        "CD3D", "CD3E", "CD3G", "CD4", "CD8A", "CD8B",
        "CD19", "CD79A", "CD79B", "MS4A1", "CD27",
        "NCAM1", "KLRD1", "KLRB1", "FCGR3A", "KLRF1"
    ]

    n_genes = max(60, len(marker_genes) + 10)
    adata = create_mock_adata(n_genes=n_genes)
    additional_genes = [
        gene for gene in adata.var_names.tolist() if gene not in marker_genes
    ]
    adata.var_names = marker_genes + additional_genes[len(marker_genes):]
    adata.var["gene_symbols"] = adata.var_names

    path = tmp_path / "mock_marker_data.h5ad"
    adata.write_h5ad(path)
    return path


@pytest.fixture
def spatial_mock_data_path(tmp_path: Path) -> Path:
    """Path to mock AnnData with spatial coordinates for spatial tool tests."""
    adata = create_mock_adata(n_cells=60, n_genes=80, rng_seed=123)

    grid_size = int(np.ceil(np.sqrt(adata.n_obs)))
    xs, ys = np.meshgrid(np.arange(grid_size), np.arange(grid_size), indexing="xy")
    coords = np.column_stack((xs.ravel()[: adata.n_obs], ys.ravel()[: adata.n_obs]))
    adata.obsm["spatial"] = coords.astype(float)

    path = tmp_path / "mock_spatial.h5ad"
    adata.write_h5ad(path)
    return path
