#!/usr/bin/env python
"""Exercise CellTypingTool with LLM-recommended markers.

This script builds a synthetic AnnData file containing canonical marker genes,
executes the preprocessing pipeline to generate embeddings, and then runs the
cell typing tool without supplying marker sets so that the LLM recommender is
used. The goal is to validate that API-backed marker recommendations complete
successfully end-to-end.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Dict, Iterable

import numpy as np
import scanpy as sc

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from langchain_multiagent.agent import _ensure_openai_api_key
from langchain_multiagent.biotools import (
    CellTypingTool,
    PreprocessPipelineTool,
    CURATED_MARKER_LIBRARY,
)
from langchain_multiagent.tests.mock_data import create_mock_adata


TARGET_CELL_TYPES = [
    "Leukemia blasts",
    "Hematopoietic stem cells",
    "Common myeloid progenitors",
    "Granulocytes / Neutrophils",
    "Classical monocytes",
    "Non-classical monocytes",
    "Dendritic cells",
    "Naive B cells",
    "Plasma cells",
    "CD4+ T cells",
    "CD8+ T cells",
    "Regulatory T cells",
    "Natural killer cells",
    "Megakaryocytes / Platelets",
    "Erythroid progenitors",
]

MARKER_GENES: Dict[str, Iterable[str]] = {
    cell_type: CURATED_MARKER_LIBRARY[cell_type]["positive"]
    for cell_type in TARGET_CELL_TYPES
    if cell_type in CURATED_MARKER_LIBRARY
}


def _build_marker_dataset(path: Path) -> Path:
    marker_list = sorted({gene for genes in MARKER_GENES.values() for gene in genes})
    adata = create_mock_adata(n_cells=120, n_genes=max(80, len(marker_list) + 20), rng_seed=42)

    additional = [gene for gene in adata.var_names.tolist() if gene not in marker_list]
    adata.var_names = marker_list + additional[len(marker_list) :]
    adata.var["gene_symbols"] = adata.var_names

    path.parent.mkdir(parents=True, exist_ok=True)
    adata.write_h5ad(path)
    return path


def main() -> None:
    work_dir = Path(__file__).resolve().parent.parent
    artifacts_dir = work_dir / "tmp_celltyping_api"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    raw_path = artifacts_dir / "synthetic_marker_data.h5ad"
    processed_dir = artifacts_dir

    print(f"[INFO] Building synthetic dataset at {raw_path}")
    dataset_path = _build_marker_dataset(raw_path)

    preprocess_tool = PreprocessPipelineTool()
    preprocess_params = {
        "adata_id": str(dataset_path),
        "min_cells": 1,
        "min_genes": 5,
        "max_pct_mito": 80.0,
        "method": "umap",
        "output_dir": str(processed_dir),
    }

    preprocess_result = preprocess_tool.invoke(preprocess_params)
    if preprocess_result.get("error"):
        raise RuntimeError(f"Preprocess failed: {json.dumps(preprocess_result, indent=2)}")

    processed_path = Path(preprocess_result["output_data"])
    print(f"[INFO] Preprocess complete -> {processed_path}")

    if not _ensure_openai_api_key():
        raise RuntimeError("OpenAI API key could not be resolved; configure OPENAI_API_KEY or OPENAI_API_KEY_FILE.")

    typing_tool = CellTypingTool()
    leukemia_question = (
        "This dataset comes from a leukemia bone marrow sample. "
        "Recommend comprehensive positive marker panels that capture malignant blasts "
        "and the full spectrum of immune and stromal cell types present in this context."
    )
    typing_params = {
        "adata_id": str(processed_path),
        "tissue_type": "bone marrow",
        "expected_types": list(MARKER_GENES.keys()),
        "question": leukemia_question,
        "method": "scanpy",
        "output_key": "llm_cell_type",
        "output_dir": str(processed_dir),
    }

    typing_result = typing_tool.invoke(typing_params)
    if typing_result.get("error"):
        raise RuntimeError(f"Cell typing failed: {json.dumps(typing_result, indent=2)}")

    print(f"[INFO] Marker recommendation question: {leukemia_question}")
    marker_sets = typing_result.get("marker_sets", {})
    print("[INFO] Marker sets returned by the recommender:")
    print(json.dumps(marker_sets, indent=2, sort_keys=True))

    summary = {
        "summary_text": typing_result.get("summary_text"),
        "output_data": typing_result.get("output_data"),
        "plots": typing_result.get("plots"),
    }
    print("[SUCCESS] Cell typing finished with summary:")
    print(json.dumps(summary, indent=2))

    annotated_path = typing_result["output_data"]
    adata = sc.read_h5ad(annotated_path)
    assignments = adata.obs[typing_params["output_key"]].value_counts().to_dict()
    print("[INFO] Cell type counts:")
    for cell_type, count in assignments.items():
        frac = (count / adata.n_obs) * 100 if adata.n_obs else 0.0
        print(f"  - {cell_type}: {count} cells ({frac:.1f}%)")


if __name__ == "__main__":
    main()
