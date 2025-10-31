"""Centralised repository for user-facing prompt strings and templates."""
from __future__ import annotations

from typing import Dict

# ---------------------------------------------------------------------------
# Parameter collection prompts per plan step
# ---------------------------------------------------------------------------

PARAMETER_PROMPTS: Dict[str, Dict[str, str]] = {
    "metadata": {
        "file_path": "Enter the AnnData file path",
    },
    "preprocess": {
        "adata_id": "Select the AnnData file for preprocessing",
        "min_cells": "Minimum cells per gene",
        "min_genes": "Minimum genes per cell",
        "max_pct_mito": "Maximum mitochondrial percentage",
        "method": "Embedding method (umap/tsne)",
        "color_by": "Observation column used for embedding colouring",
    },
    "de": {
        "adata_id": "Select the AnnData file for differential expression",
        "group_key": "Observation column used for grouping",
        "log2fc_threshold": "Log2 fold change threshold",
        "fdr_threshold": "FDR threshold",
    },
    "spatial_domain": {
        "adata_id": "Select the AnnData file for spatial domain analysis",
        "method": "Spatial domain method (leiden/louvain/kmeans)",
        "resolution": "Resolution for Leiden/Louvain",
        "n_neighbors": "Number of spatial neighbours",
        "expression_weight": "Expression-spatial blend weight (0-1)",
    },
    "cell_typing": {
        "adata_id": "Select the AnnData file for cell typing",
        "marker_sets": "Marker sets JSON file (leave blank to auto-recommend)",
        "tissue_type": "Tissue type driving marker recommendation (optional)",
        "expected_types": "Expected cell types (comma-separated, optional)",
        "question": "Additional biological context for auto markers (optional)",
        "method": "Cell typing method (scanpy only)",
        "output_key": "Observation column name for predicted labels",
    },
}

# ---------------------------------------------------------------------------
# Confirmation prompts (yes/no questions)
# ---------------------------------------------------------------------------

CONFIRM_MESSAGES: Dict[str, str] = {
    "about_to_run": "About to run '{step_title}' with the parameters above. Continue?",
    "failure_continue": "A failure occurred. Continue with the remaining steps?",
    "approve_plan": "Do you approve this plan?",
}

# ---------------------------------------------------------------------------
# Direct input prompts (text entry)
# ---------------------------------------------------------------------------

INPUT_PROMPTS: Dict[str, str] = {
    "remove_steps": "To remove steps, enter their numbers (comma separated). Press Enter to skip this action:",
    "add_steps": "To add steps, enter their identifiers (comma separated). Press Enter to leave unchanged:",
}

# ---------------------------------------------------------------------------
# Informational display messages shown alongside prompts
# ---------------------------------------------------------------------------

INFO_MESSAGES: Dict[str, str] = {
    "plan_edit_intro": "You may remove steps or add optional ones. Enter 0 to cancel and exit.",
    "all_steps_removed": "All steps were removed. Rebuilding the plan from defaults.",
    "optional_steps_available": "Optional steps available:",
    "bundle_reminder": "Reminder: cell typing can auto-suggest markers when marker_sets are left blank.",
    "no_optional_steps": "No optional steps remain to add.",
    "bundle_enforced": "Removed incomplete bundle.",
}

# ---------------------------------------------------------------------------
# Validation and error feedback strings shown during parameter collection
# ---------------------------------------------------------------------------

ERROR_MESSAGES: Dict[str, str] = {
    "parameter_required": "This parameter is required; please provide a value.",
    "value_not_in_choices": "Value not in the allowed choices; please try again.",
}

# Template-based error strings
TEMPLATE_ERROR_MESSAGES: Dict[str, str] = {
    "parameter_preparation_failed": "Parameter preparation failed: {error}",
    "parse_failure": "Could not parse input: {error}",
}

# ---------------------------------------------------------------------------
# LLM-oriented prompts used by bio tools
# ---------------------------------------------------------------------------

LLM_SYSTEM_MESSAGES: Dict[str, str] = {
    "json_only": "You are a helpful assistant that only replies with valid JSON.",
    "planner": "You are a senior computational biologist who specializes in designing insightful single-cell analysis workflows. Always respond in valid JSON without additional commentary.",
}

LLM_PROMPTS: Dict[str, str] = {
    "marker_recommendation": """You are an expert in single-cell biology and marker gene selection.
Given a tissue type and biological question, suggest marker genes for cell type identification, you need to be as comprehensive as possible.

Context:
Tissue: {tissue_type}
Target cell types: {target_cell_types}
Question: {question}

Please suggest marker genes following this format:
{{
    "cell_type_1": {{
        "positive": ["GENE1", "GENE2", "GENE3", "GENE4"],
        "rationale": "Brief explanation of why these markers are appropriate"
    }},
    "cell_type_2": {{
        "positive": ["GENE5", "GENE6", "GENE7", "GENE8"],
        "rationale": "Brief explanation"
    }}
}}

Requirements:
1. Provide only positive markers; do not include negative marker lists or empty arrays.
2. Cover all major cell populations relevant to the described tissue or disease context, adding additional biologically plausible types when helpful.
3. Prioritize well-established, literature-supported gene symbols for each cell type (uppercase official symbols).
4. Include brief rationale for each cell type that explains the biological relevance of the markers.
5. If target cell types are provided, ensure each appears in the JSON response (add additional relevant types if appropriate).
6. Provide at least four distinctive marker genes per cell type when possible and never return an empty JSON object.
""",
    "planner": """You are preparing an analysis plan for a single-cell dataset using the available toolkit.

Available steps:
{available_steps}

User request: {command}
Dataset summary:
- File path: {adata_path}
- Cells: {n_cells}
- Genes: {n_genes}
- Metadata columns: {metadata_columns}
- Additional context: {extra_context}
- Required steps (must appear in the plan): {required_steps}

Output a JSON object with the following structure:
{{
  "steps": [
    {{
      "identifier": "metadata",
      "title": "Short descriptive title",
      "why": "Reason for including this step",
      "dependencies": ["identifiers of prerequisite steps"]
    }}
  ],
  "notes": "Optional free-form guidance for the operator"
}}

Guidelines:
1. Choose steps that maximize biological insight given the dataset and request.
2. Always include core data review and quality control unless there is a strong reason to skip; explain any omissions in the notes.
3. Respect the required steps list and maintain logical ordering.
4. Only use identifiers from the provided step list.
5. Keep responses concise but informative.
""",
}
