from pathlib import Path

import numpy as np

from langchain_multiagent.biotools import CellTypingTool, PreprocessPipelineTool
from .artifact_utils import persist_artifact


class DummyLLM:
    """Stub LLM to keep tests offline."""

    def invoke(self, messages, config=None):  # pragma: no cover - should never be called here
        raise AssertionError("LLM invocation should not occur in cell typing tests")


def test_cell_typing(marker_mock_data_path):
    """Test cell type annotation functionality"""
    typing_tool = CellTypingTool(llm=DummyLLM())
    preprocess_tool = PreprocessPipelineTool()
    data_path = str(marker_mock_data_path)
    print(f"\nTesting cell typing...")

    preprocess_results = preprocess_tool.invoke(
        {
            "adata_id": data_path,
            "min_cells": 1,
            "min_genes": 50,
            "max_pct_mito": 50,
        }
    )

    assert not preprocess_results.get("error"), f"Preprocessing failed: {preprocess_results}"
    processed_path = preprocess_results["output_data"]
    
    marker_sets = {
        "T cells": {
            "positive": ["CD3D", "CD3E", "CD4"],
            "negative": ["CD19"],
            "rationale": "Canonical T cell markers"
        },
        "B cells": {
            "positive": ["CD19", "CD79A", "MS4A1"],
            "negative": ["CD3D"],
            "rationale": "Canonical B cell markers"
        },
        "NK cells": {
            "positive": ["NCAM1", "KLRD1", "FCGR3A"],
            "negative": ["CD3D", "CD19"],
            "rationale": "Canonical NK cell markers"
        },
    }
    
    # Test invalid parameters
    def test_invalid_typing_params():
        invalid_cases = [
            # Invalid method
            {
                "adata_id": processed_path,
                "marker_sets": marker_sets,
                "method": "invalid_method"
            }
        ]
        
        for params in invalid_cases:
            results = typing_tool.invoke(params)
            assert results.get("error") == "validation_error" or "error" in results, \
                f"Expected validation error for params: {params}"
    
    # Test valid parameters
    def test_valid_typing_params():
        valid_params = {
            "adata_id": processed_path,
            "marker_sets": marker_sets,
            "method": "scanpy",
            "output_key": "cell_type"
        }
        results = typing_tool.invoke(valid_params)
        
        # Check for errors
        assert not results.get("error"), \
            f"Error in cell typing: {results.get('message', 'Unknown error')}"
        
        # Validate results structure
        assert "predicted_types" in results, "Missing cell type predictions"
        assert "confidence_scores" in results, "Missing confidence scores"
        assert "plots" in results, "Missing visualization plots"
        assert "summary_text" in results and results["summary_text"], "Missing cell typing summary"
        assert "output_data" in results and "after_cell_typing" in results["output_data"], \
            "Annotated data filename missing after_cell_typing"
        
        # Validate predictions
        assert len(results["predicted_types"]) > 0, "No cell type predictions"
        assert all(score >= 0 and score <= 1 for score in results["confidence_scores"]), \
            "Invalid confidence scores"
        
        # Validate visualization output structure (optional for mock data)
        assert isinstance(results["plots"], dict), "Plots should be provided as a dictionary"
        assert "umap" in results["plots"], "UMAP plot path missing"
        assert "celltype_distribution" in results["plots"], "Distribution plot path missing"

        umap_path = Path(results["plots"]["umap"])
        dist_path = Path(results["plots"]["celltype_distribution"])
        assert umap_path.exists(), "UMAP plot file not created"
        assert dist_path.exists(), "Distribution plot file not created"
        assert "after_cell_typing" in umap_path.name, "UMAP plot filename missing after_cell_typing"
        assert "after_cell_typing" in dist_path.name, "Distribution plot filename missing after_cell_typing"

        persist_artifact(umap_path, "celltyping")
        persist_artifact(dist_path, "celltyping")
        
        print("\nCell typing results:")
        print(f"Number of cells typed: {len(results['predicted_types'])}")
        print("Unique cell types:", len(set(results["predicted_types"])))
        print("Mean confidence score: {:.3f}".format(np.mean(results["confidence_scores"])))
    
    # Run tests
    print("Testing invalid parameters...")
    test_invalid_typing_params()
    
    print("Testing valid parameters...")
    test_valid_typing_params()


def test_cell_typing_with_default_output(marker_mock_data_path):
    typing_tool = CellTypingTool(llm=DummyLLM())
    preprocess_tool = PreprocessPipelineTool()
    data_path = str(marker_mock_data_path)

    preprocess_results = preprocess_tool.invoke(
        {
            "adata_id": data_path,
            "min_cells": 1,
            "min_genes": 50,
            "max_pct_mito": 50,
        }
    )

    assert not preprocess_results.get("error"), f"Preprocessing failed: {preprocess_results}"
    processed_path = preprocess_results["output_data"]

    simplified_markers = {
        "Custom": {
            "positive": ["CD3D", "CD3E"],
            "rationale": "Simplified marker set",
        }
    }

    results = typing_tool.invoke(
        {
            "adata_id": processed_path,
            "marker_sets": simplified_markers,
            "method": "scanpy",
        }
    )

    assert not results.get("error"), f"Cell typing failed with default output key: {results}"
    assert len(results["predicted_types"]) > 0
    assert all(0 <= score <= 1 for score in results["confidence_scores"])
    assert "summary_text" in results and results["summary_text"], "Missing summary text for default output"
    assert "output_data" in results and "after_cell_typing" in results["output_data"], \
        "Annotated filename missing after_cell_typing for default output"
    assert "umap" in results["plots"], "UMAP plot missing for default output"
    umap_path = Path(results["plots"]["umap"])
    assert "celltype_distribution" in results["plots"], "Distribution plot missing for default output"
    dist_path = Path(results["plots"]["celltype_distribution"])
    assert umap_path.exists(), "UMAP plot file missing for default output"
    assert dist_path.exists(), "Distribution plot file missing for default output"
    assert "after_cell_typing" in umap_path.name
    assert "after_cell_typing" in dist_path.name

    persist_artifact(umap_path, "celltyping", rename=f"default_{umap_path.name}")
    persist_artifact(dist_path, "celltyping", rename=f"default_{dist_path.name}")

    processed_path_obj = Path(processed_path)
    expected_output = processed_path_obj.with_name(
        f"{processed_path_obj.stem}_after_cell_typing{processed_path_obj.suffix}"
    )
    assert expected_output.exists(), "Annotated file missing with default output key"


if __name__ == "__main__":
    test_cell_typing()