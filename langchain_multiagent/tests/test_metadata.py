from biotools import MetadataInspectorTool


def test_metadata_inspector(mock_data_path):
    """Test metadata inspection functionality"""
    inspector = MetadataInspectorTool()
    data_path = str(mock_data_path)

    print(f"\nTesting metadata inspection with file: {data_path}")

    results = inspector.invoke({"file_path": data_path})

    # Check for errors
    assert not results.get("error"), f"Error in results: {results.get('message', 'Unknown error')}"
    assert "results" in results, "No results found in response"
    assert "summary_text" in results and results["summary_text"], "Missing metadata summary text"

    metadata = results["results"]

    # Validate metadata structure
    assert "data_scale" in metadata, "Missing data scale information"
    assert "n_cells" in metadata["data_scale"], "Missing cell count"
    assert "n_genes" in metadata["data_scale"], "Missing gene count"

    # Print basic info
    print("Metadata inspection passed")
    print(f"Cells: {metadata['data_scale']['n_cells']:,}")
    print(f"Genes: {metadata['data_scale']['n_genes']:,}")

if __name__ == "__main__":
    test_metadata_inspector()


def test_metadata_inspector_invalid_path():
    inspector = MetadataInspectorTool()
    results = inspector.invoke({"file_path": "nonexistent_file.h5ad"})
    assert results.get("error"), "Expected an error for nonexistent input file"