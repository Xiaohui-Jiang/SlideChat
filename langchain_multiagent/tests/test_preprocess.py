from pathlib import Path

import pytest
import scanpy as sc

from biotools import PreprocessPipelineTool
from .artifact_utils import persist_artifact
from .mock_data import create_mock_adata


@pytest.fixture
def pipeline_tool():
    return PreprocessPipelineTool()


def test_preprocess_validation(pipeline_tool, mock_data_path):
    data_path = str(mock_data_path)
    invalid_schema_cases = [
        {
            "adata_id": data_path,
            "min_cells": -1,
            "min_genes": 200,
            "max_pct_mito": 20,
        },
        {
            "adata_id": data_path,
            "min_cells": 3,
            "min_genes": -1,
            "max_pct_mito": 20,
        },
        {
            "adata_id": data_path,
            "min_cells": 3,
            "min_genes": 200,
            "max_pct_mito": 101,
        },
    ]

    over_filter_params = {
        "adata_id": data_path,
        "min_cells": 3,
        "min_genes": 300,
        "max_pct_mito": 10,
    }

    for params in invalid_schema_cases:
        results = pipeline_tool.invoke(params)
        assert results.get("error") == "validation_error", (
            f"Expected validation error for params: {params}"
        )

    over_filter_result = pipeline_tool.invoke(over_filter_params)
    assert over_filter_result.get("error"), "Overly strict filtering should fail gracefully"
    combined_text = " ".join(
        [
            str(over_filter_result.get("message", "")),
            str(over_filter_result.get("error", "")),
        ]
    ).lower()
    assert "removed all cells" in combined_text

    invalid_method_params = {
        "adata_id": data_path,
        "method": "invalid_method",
        "min_cells": 3,
        "min_genes": 200,
        "max_pct_mito": 20,
    }

    method_error = pipeline_tool.invoke(invalid_method_params)
    assert method_error.get("error"), "Invalid embedding method should return an error"


def test_preprocess_pipeline_umap(pipeline_tool, mock_data_path):
    params = {
        "adata_id": str(mock_data_path),
        "min_cells": 2,
        "min_genes": 5,
        "max_pct_mito": 50,
        "method": "umap",
    }

    results = pipeline_tool.invoke(params)

    assert not results.get("error"), f"Pipeline failed: {results}"
    assert "initial_stats" in results
    assert "final_stats" in results
    assert "qc_plots" in results
    assert "embedding_coords" in results
    assert "cluster_plot" in results
    assert "clusters" in results
    assert "summary_text" in results and results["summary_text"]

    assert results["final_stats"]["n_cells"] > 0
    assert results["initial_stats"]["n_cells"] >= results["final_stats"]["n_cells"]
    assert results["initial_stats"]["n_genes"] >= results["final_stats"]["n_genes"]

    output_path = Path(results["output_data"])
    embed_path = Path(results["embedding_coords"])
    cluster_path = Path(results["cluster_plot"])

    assert output_path.exists()
    assert embed_path.exists()
    assert cluster_path.exists()
    assert "after_preprocess_pipeline" in output_path.name
    assert "after_preprocess_pipeline" in embed_path.name
    assert "after_preprocess_pipeline" in cluster_path.name

    for plot_path in results["qc_plots"].values():
        assert "after_preprocess_pipeline" in plot_path


def test_preprocess_without_mito_genes(pipeline_tool, tmp_path):
    adata = create_mock_adata()
    adata.var["mt"] = False
    adata.var_names = [f"Gene{i}" for i in range(adata.n_vars)]

    adata_path = tmp_path / "no_mito.h5ad"
    adata.write_h5ad(adata_path)

    params = {
        "adata_id": str(adata_path),
        "min_cells": 1,
        "min_genes": 5,
        "max_pct_mito": 50,
    }

    results = pipeline_tool.invoke(params)

    assert not results.get("error"), f"Pipeline failed without mito genes: {results}"
    assert results["final_stats"]["n_cells"] > 0
    assert "summary_text" in results and results["summary_text"]


def test_preprocess_tsne_embedding(pipeline_tool, mock_data_path):
    params = {
        "adata_id": str(mock_data_path),
        "color_by": "leiden",
        "method": "tsne",
        "min_cells": 1,
        "min_genes": 50,
        "max_pct_mito": 50,
    }

    results = pipeline_tool.invoke(params)

    assert not results.get("error"), f"t-SNE embedding failed: {results}"
    assert "embedding_coords" in results
    assert "clusters" in results
    assert "summary_text" in results and results["summary_text"]

    cluster_path = Path(results["cluster_plot"])
    embed_path = Path(results["embedding_coords"])
    assert "after_preprocess_pipeline" in cluster_path.name
    assert "after_preprocess_pipeline" in embed_path.name

    if cluster_path.exists():
        persist_artifact(cluster_path, "preprocess", rename=f"tsne_{cluster_path.name}")
    if embed_path.exists():
        persist_artifact(embed_path, "preprocess", rename=f"tsne_{embed_path.name}")


def test_preprocess_makes_names_unique(pipeline_tool, tmp_path):
    adata = create_mock_adata()
    adata.obs_names = [f"Cell{i // 3}" for i in range(adata.n_obs)]
    adata.var_names = [f"Gene{i // 5}" for i in range(adata.n_vars)]

    input_path = tmp_path / "dupe_names.h5ad"
    adata.write_h5ad(input_path)

    params = {
        "adata_id": str(input_path),
        "min_cells": 1,
        "min_genes": 5,
        "max_pct_mito": 75,
        "method": "umap",
    }

    results = pipeline_tool.invoke(params)
    assert not results.get("error"), f"Pipeline failed with duplicate names: {results}"

    output_path = results["output_data"]
    processed = sc.read_h5ad(output_path)
    assert processed.obs_names.is_unique
    assert processed.var_names.is_unique
    assert "gene_symbols" in processed.var.columns
    assert processed.var["gene_symbols"].is_unique
    if processed.raw is not None:
        assert processed.raw.var_names.is_unique
        assert "gene_symbols" in processed.raw.var.columns
        assert processed.raw.var["gene_symbols"].is_unique
