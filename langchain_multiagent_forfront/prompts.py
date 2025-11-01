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
        "tissue_type": "Tissue type driving marker recommendation (optional)",
        "question": "Additional biological context for auto markers (optional)",
        "output_key": "Observation column name for predicted labels",
    },
}

# ---------------------------------------------------------------------------
# Confirmation prompts (yes/no questions)
# ---------------------------------------------------------------------------

CONFIRM_MESSAGES: Dict[str, str] = {
    "about_to_run": "About to run '{step_title}' with the parameters above. Continue?",
    "failure_continue": "A failure occurred. Continue with the remaining steps?",
    "retry_step": "The step '{step_title}' failed. Do you want to retry it now?",
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
    "json_only": """You are an assistant that must reply ONLY with a single valid JSON value (object, array, string, number, true/false or null). Do not include any explanatory text, Markdown, or comments. Do not wrap the JSON in code fences. Ensure the JSON is UTF-8 encoded, syntactically valid, and parseable by standard JSON parsers. If you cannot produce the requested structured output, return a JSON object with keys "error" (string) and "message" (string) explaining the reason.""",

    "planner": """You are a senior computational biologist with deep expertise in single-cell multi-omics, wet-lab protocols, and downstream translational analysis. Given a dataset description and research goal, you deliberately reason about which analytic steps reveal the most biologically meaningful insight, justify each decision in plain language, note any assumptions or caveats, and keep operational guidance succinct. Your output MUST be a valid JSON object matching the following structure:
{
  "steps": [
    {
      "identifier": "<step_id>",
      "title": "<short title>",
      "why": "<one-sentence justification>",
      "params": { "<param_name>": "<recommended value or null>" },
      "dependencies": ["<step_id>", ...],
      "estimated_time_minutes": <integer>
    }
  ],
  "notes": "<brief operational guidance, 1-3 sentences>"
}
Only use identifiers drawn from the provided available_steps list. Prioritize core QC and metadata review. For each chosen step provide a concise justification, any required parameters with sensible defaults (or null if unknown), explicit dependency list, and a realistic estimated time in minutes. Keep the plan concise and actionable; avoid narrative. If the user's request or dataset imposes required_steps, ensure they appear and explain any omissions in the "notes" field. Always respond in English and produce only the JSON object (adhere to the "json_only" policy).""",

    "marker_context_summary": """You are a scientific writer supporting computational biologists. Produce a concise 2-4 sentence paragraph in English that summarizes analysis findings relevant to marker gene selection. Focus on:
- Tissue and disease context (if present),
- Practical implications for marker selection (e.g., need for more specific markers, cluster splitting, or cross-validation).
Do not use bullet lists or JSON; write only plain English sentences and avoid hedging. Keep the tone factual and directly actionable for choosing marker genes.""",
}

LLM_PROMPTS: Dict[str, str] = {
    "marker_recommendation": """You are a senior single-cell biologist with extensive experience curating marker panels across diverse tissues, disease states, and sequencing platforms. When provided with a tissue context and research question, you reason cell type by cell type, proposing only clearly defined, literature-backed identities (never umbrella categories or heterogeneous catch-all groupings). For each population you consider canonical lineage markers, critical subtype discriminators, and exclusion markers for nearby lineages. Be as comprehensive as possible while keeping each panel biologically coherent.

Context:
Tissue: {tissue_type}
Target cell types: {target_cell_types}
Question: {question}

Please suggest marker genes following this format:
{{
    "cell_type_1": {{
        "positive": ["GENE1", "GENE2", "GENE3", "GENE4", "GENE7", "GENE8", "GENE9", "GENE10", ......],
        "negative": ["GENE5", "GENE6"],
        "rationale": "Brief explanation of why these markers are appropriate"
    }},
    "cell_type_2": {{
        "positive": ["GENE7", "GENE8", "GENE9", "GENE10"],
        "negative": ["GENE11", "GENE5", "GENE6", ],
        "rationale": "Brief explanation"
    }}
}}

Requirements:
1. Provide both positive and negative marker genes for every cell type (at least four positives and, when biologically justified, two or more negatives) so that the panel can distinguish the target population from closely related neighbors; expand the positive list beyond four genes whenever canonical literature supports additional markers.
2. Enumerate all major cell populations that could plausibly occur in the described tissue or disease context; if target cell types are supplied, ensure they appear and supplement with additional relevant lineages to avoid omissions, reasoning through each candidate population individually.
3. Only include cell types that represent well-defined, biologically coherent identities (e.g., "Alveolar type II pneumocytes", "CD8+ cytotoxic T cells"); never output umbrella terms such as "heterogeneous malignant cells", "mixed immune cells", or other catch-all categories.
4. Prioritize well-established, literature-supported gene symbols for each cell type (uppercase official symbols) and avoid deprecated aliases.
5. Include brief rationale for each cell type that explains the biological relevance of the markers and highlights how the panel separates it from phenotypically similar neighbors.
6. When malignant populations are expected, distinguish them with biologically meaningful descriptors and pair them with markers that differentiate them from stromal or immune cells.
7. Never return an empty JSON object; if information is uncertain, provide your best supported panel and explain the rationale.
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
- Metadata summary: {metadata_summary}
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
    "marker_context_summary": """Review the analysis context below and summarise the key biological characteristics relevant to marker gene selection for cell typing.

Context:
{log_text}

Produce a concise paragraph (2-4 sentences) highlighting:
- The tissue or disease background, if any.
- Important preprocessing outcomes or quality observations.
- Any hinted or observed cell populations that should guide marker choices.

Keep the tone factual and avoid bullet lists. Respond in English.""",
}
