from pathlib import Path

import numpy as np
import pytest

from biotools import SpatialNeighborhoodTool, SpatialDomainTool


def test_spatial_neighborhood_outputs(spatial_mock_data_path: Path, tmp_path):
    tool = SpatialNeighborhoodTool()
    params = {
        "adata_id": str(spatial_mock_data_path),
        "coord_type": "generic",
        "n_neighbors": 4,
        "key_added": "spatial",
    }

    results = tool.invoke(params)

    assert not results.get("error"), f"Spatial neighborhood tool failed: {results}"
    assert results["neighbors_key"] == "spatial"
    assert Path(results["connectivities"]).exists()
    assert Path(results["neighbor_counts"]).exists()
    assert "neighbor_stats" in results
    counts = np.loadtxt(results["neighbor_counts"], delimiter=",", skiprows=1, usecols=[1])
    assert counts.size > 0
    assert np.all(counts >= 0)


def test_spatial_domain_detection(spatial_mock_data_path: Path):
    domain_tool = SpatialDomainTool()
    artifact_dir = Path(__file__).parent / "artifacts" / "spatial_domain"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    params = {
        "adata_id": str(spatial_mock_data_path),
        "method": "leiden",
        "resolution": 0.5,
        "neighbors_key": "spatial",
        "coord_type": "generic",
        "n_neighbors": 4,
        "output_dir": str(artifact_dir),
    }

    results = domain_tool.invoke(params)

    assert not results.get("error"), f"Spatial domain tool failed: {results}"
    assert "domain_assignments" in results
    domain_path = Path(results["domain_assignments"])
    assert domain_path.exists()
    assert domain_path.is_relative_to(artifact_dir)
    assert results["domains"]["n_domains"] >= 1
    assert "summary_text" in results and results["summary_text"]
    assert pytest.approx(results["domains"].get("expression_weight", -1.0), rel=1e-5) == 0.3
    assert "0.30" in results["summary_text"]
    plot_path = Path(results["plots"]["spatial_domains"])
    assert plot_path.exists()
    dist_plot_path = Path(results["plots"]["domain_distribution"])
    assert dist_plot_path.exists()
    assert plot_path.is_relative_to(artifact_dir)
    assert dist_plot_path.is_relative_to(artifact_dir)
    output_data_path = Path(results["output_data"])
    assert output_data_path.exists()
    assert output_data_path.is_relative_to(artifact_dir)


def test_spatial_domain_detection_with_expression(spatial_mock_data_path: Path):
    domain_tool = SpatialDomainTool()
    artifact_dir = Path(__file__).parent / "artifacts" / "spatial_domain_expression"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    target_weight = 0.35
    params = {
        "adata_id": str(spatial_mock_data_path),
        "method": "leiden",
        "resolution": 0.5,
        "neighbors_key": "spatial",
        "coord_type": "generic",
        "n_neighbors": 4,
        "output_dir": str(artifact_dir),
        "expression_weight": target_weight,
        "n_comps": 10,
        "expression_n_neighbors": 8,
    }

    results = domain_tool.invoke(params)

    assert not results.get("error"), f"Spatial domain tool failed: {results}"
    assert pytest.approx(results["domains"].get("expression_weight", -1.0), rel=1e-5) == target_weight
    summary_text = results.get("summary_text", "")
    assert f"{target_weight:.2f}" in summary_text

    for key in ("domain_assignments", "output_data"):
        path = Path(results[key])
        assert path.exists()
        assert path.is_relative_to(artifact_dir)

    for plot_key in ("spatial_domains", "domain_distribution"):
        plot_path = Path(results["plots"][plot_key])
        assert plot_path.exists()
        assert plot_path.is_relative_to(artifact_dir)
