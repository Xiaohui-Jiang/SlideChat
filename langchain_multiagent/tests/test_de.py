from pathlib import Path

import pytest

from biotools import DEAnalysisTool, PreprocessPipelineTool
from .artifact_utils import persist_artifact


def test_de_analysis(grouped_mock_data_path):
    """Test differential expression analysis functionality"""
    de_tool = DEAnalysisTool()
    preprocess_tool = PreprocessPipelineTool()
    data_path = str(grouped_mock_data_path)
    print(f"\nRunning DE analysis on mock file: {data_path}")

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
    
    # Test invalid parameters
    def test_invalid_de_params():
        invalid_cases = [
            {
                "adata_id": processed_path,
                "log2fc_threshold": 1.0,
                "fdr_threshold": 0.05,
            },
            {
                "adata_id": processed_path,
                "group_key": "nonexistent",
                "log2fc_threshold": 1.0,
                "fdr_threshold": 0.05,
            }
        ]

        for params in invalid_cases:
            results = de_tool.invoke(params)
            assert results.get("error"), f"Expected error for params: {params}"
                
    # Test valid parameters
    def test_valid_de_params():
        valid_params = {
            "adata_id": processed_path,
            "group_key": "group",
            "log2fc_threshold": 1.0,
            "fdr_threshold": 0.05,
        }

        results = de_tool.invoke(valid_params)
        
        # Check for errors
        assert not results.get("error"), \
            f"Error in DE results: {results.get('message', 'Unknown error')}"
        
        # Validate results structure
        assert "de_table" in results, "Missing DE results table path"
        assert "volcano_plot" in results, "Missing volcano plot path"
        assert "results" in results, "Missing differential expression results"
        assert isinstance(results["results"], dict), "DE results should be a dictionary"
        assert set(results["results"].keys()) == {"group1", "group2"}, "Unexpected groups in results"
        assert "summary_text" in results and results["summary_text"], "Missing DE summary text"
        assert "top_genes" in results, "Missing top_genes in DE results"
        top_genes = results["top_genes"]
        assert isinstance(top_genes, list), "top_genes should be a list"
        if results["significant_genes"] > 0:
            assert top_genes, "Expected highlighted genes when significant hits exist"
        for entry in top_genes:
            assert {"gene", "group", "log2fc", "padj"}.issubset(entry.keys())
        assert "Top genes:" in results["summary_text"], "Summary text missing top gene highlight"
        assert "after_de_analysis" in results["de_table"], "DE table filename missing after_de_analysis"
        assert "after_de_analysis" in results["volcano_plot"], "Volcano filename missing after_de_analysis"

        summary = results["summary"]
        assert set(summary.keys()) == {"group1", "group2"}, "Unexpected summary groups"
        for metrics in summary.values():
            assert {"significant", "upregulated", "downregulated"}.issubset(metrics.keys())

        volcano_path = Path(results["volcano_plot"])
        assert volcano_path.exists(), "Volcano plot artifact not created"
        persist_artifact(volcano_path, "de")
        
        print("\nDE analysis results:")
        print(f"Total significant genes: {results['significant_genes']:,}")
        for group, metrics in summary.items():
            print(
                f"Group {group}: {metrics['significant']} significant "
                f"({metrics['upregulated']} up, {metrics['downregulated']} down)"
            )
        
    # Run tests
    print("Testing invalid parameters...")
    test_invalid_de_params()
    
    print("Testing valid parameters...")
    test_valid_de_params()

if __name__ == "__main__":
    test_de_analysis()


def test_de_analysis_with_strict_threshold(grouped_mock_data_path):
    """High thresholds should yield zero significant genes but still return structured output."""
    de_tool = DEAnalysisTool()
    preprocess_tool = PreprocessPipelineTool()

    preprocess_results = preprocess_tool.invoke(
        {
            "adata_id": str(grouped_mock_data_path),
            "min_cells": 1,
            "min_genes": 50,
            "max_pct_mito": 50,
        }
    )

    assert not preprocess_results.get("error"), f"Preprocessing failed: {preprocess_results}"
    processed_path = preprocess_results["output_data"]

    results = de_tool.invoke(
        {
            "adata_id": processed_path,
            "group_key": "group",
            "log2fc_threshold": 5.0,
            "fdr_threshold": 1e-4,
        }
    )

    assert not results.get("error"), f"DE analysis errored under strict thresholds: {results}"
    assert results["significant_genes"] == 0
    assert isinstance(results["results"], dict)
    assert all(len(genes) == 0 for genes in results["results"].values())
    assert all(
        metrics == {"significant": 0, "upregulated": 0, "downregulated": 0}
        for metrics in results["summary"].values()
    )
    assert "summary_text" in results and results["summary_text"], "Missing summary text for strict threshold"
    assert results["top_genes"] == [], "Expected no top genes under strict threshold"
    assert "after_de_analysis" in results["de_table"], "DE table filename missing after_de_analysis"
    assert "after_de_analysis" in results["volcano_plot"], "Volcano filename missing after_de_analysis"

    volcano_path = Path(results["volcano_plot"])
    if volcano_path.exists():
        persist_artifact(volcano_path, "de", rename=f"strict_{volcano_path.name}")