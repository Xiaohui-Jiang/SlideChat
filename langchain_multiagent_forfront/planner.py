"""Planning utilities for the bioanalysis agent."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Type

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import Runnable

from .biotools import (
    BioToolBase,
    BatchCorrectionTool,
    CellCommunicationTool,
    CellTypingTool,
    DEAnalysisTool,
    UMAPGenePlotTool,
    MetadataInspectorTool,
    PreprocessPipelineTool,
    SpatialGenePlotTool,
    SpatialDomainTool,
    PseudotimeTool,
)
from .prompts import LLM_PROMPTS, LLM_SYSTEM_MESSAGES, PARAMETER_PROMPTS

LOGGER = logging.getLogger(__name__)


@dataclass
class ParameterPrompt:
    """Specification of a parameter that must be confirmed before execution."""

    name: str
    prompt: str
    type: Type
    default: Optional[Any] = None
    choices: Optional[Sequence[Any]] = None
    optional: bool = False
    context_key: Optional[str] = None


@dataclass
class PlanStep:
    """A single step in the agent execution plan."""

    identifier: str
    title: str
    description: str
    tool_cls: Type[BioToolBase]
    param_prompts: List[ParameterPrompt] = field(default_factory=list)
    optional: bool = False
    bundle_id: Optional[str] = None


def _metadata_step() -> PlanStep:
    return PlanStep(
        identifier="metadata",
        title="Metadata overview",
        description="Inspect dataset scale and list available metadata columns.",
        tool_cls=MetadataInspectorTool,
        param_prompts=[
            ParameterPrompt(
                name="file_path",
                prompt=PARAMETER_PROMPTS["metadata"]["file_path"],
                type=str,
                context_key="adata_path",
            )
        ],
    )


def _preprocess_step() -> PlanStep:
    return PlanStep(
        identifier="preprocess",
        title="Quality control and embedding",
        description="Run the preprocessing pipeline to filter low-quality cells and compute embeddings.",
        tool_cls=PreprocessPipelineTool,
        param_prompts=[
            ParameterPrompt(
                name="adata_id",
                prompt=PARAMETER_PROMPTS["preprocess"]["adata_id"],
                type=str,
                context_key="adata_id",
            ),
            ParameterPrompt(
                name="min_cells",
                prompt=PARAMETER_PROMPTS["preprocess"]["min_cells"],
                type=int,
                default=3,
            ),
            ParameterPrompt(
                name="min_genes",
                prompt=PARAMETER_PROMPTS["preprocess"]["min_genes"],
                type=int,
                default=200,
            ),
            ParameterPrompt(
                name="max_pct_mito",
                prompt=PARAMETER_PROMPTS["preprocess"]["max_pct_mito"],
                type=float,
                default=20.0,
            ),
            ParameterPrompt(
                name="method",
                prompt=PARAMETER_PROMPTS["preprocess"]["method"],
                type=str,
                default="umap",
                choices=["umap", "tsne"],
            ),
            ParameterPrompt(
                name="color_by",
                prompt=PARAMETER_PROMPTS["preprocess"]["color_by"],
                type=str,
                default="leiden",
                optional=True,
            ),
        ],
    )


def _de_step() -> PlanStep:
    return PlanStep(
        identifier="de",
        title="Differential expression",
        description="Perform differential expression analysis across a grouping column.",
        tool_cls=DEAnalysisTool,
        param_prompts=[
            ParameterPrompt(
                name="adata_id",
                prompt=PARAMETER_PROMPTS["de"]["adata_id"],
                type=str,
                context_key="adata_id",
            ),
            ParameterPrompt(
                name="group_key",
                prompt=PARAMETER_PROMPTS["de"]["group_key"],
                type=str,
                default="leiden",
            ),
            ParameterPrompt(
                name="log2fc_threshold",
                prompt=PARAMETER_PROMPTS["de"]["log2fc_threshold"],
                type=float,
                default=0.25,
            ),
            ParameterPrompt(
                name="fdr_threshold",
                prompt=PARAMETER_PROMPTS["de"]["fdr_threshold"],
                type=float,
                default=0.05,
            ),
        ],
    )

def _batch_correction_step() -> PlanStep:
    return PlanStep(
        identifier="batch_correction",
        title="Batch correction",
        description="Correct batch effects across samples and (optionally) recompute embeddings.",
        tool_cls=BatchCorrectionTool,
        param_prompts=[
            ParameterPrompt(
                name="adata_id",
                prompt=PARAMETER_PROMPTS["batch_correction"]["adata_id"],
                type=str,
                context_key="adata_id",
            ),
            ParameterPrompt(
                name="batch_key",
                prompt=PARAMETER_PROMPTS["batch_correction"]["batch_key"],
                type=str,
                default="batch",
            ),
            ParameterPrompt(
                name="method",
                prompt=PARAMETER_PROMPTS["batch_correction"]["method"],
                type=str,
                default="combat",
                choices=["combat"],
            ),
            ParameterPrompt(
                name="compute_embedding",
                prompt=PARAMETER_PROMPTS["batch_correction"]["compute_embedding"],
                type=bool,
                default=True,
            ),
        ],
        optional=True,
    )

def _spatial_gene_plot_step() -> PlanStep:
    return PlanStep(
        identifier="spatial_gene_plot",
        title="Spatial gene expression",
        description="Visualise selected gene expression on spatial coordinates.",
        tool_cls=SpatialGenePlotTool,
        param_prompts=[
            ParameterPrompt(
                name="adata_id",
                prompt=PARAMETER_PROMPTS["spatial_gene_plot"]["adata_id"],
                type=str,
                context_key="adata_id",
            ),
            ParameterPrompt(
                name="genes",
                prompt=PARAMETER_PROMPTS["spatial_gene_plot"]["genes"],
                type=str,
            ),
            ParameterPrompt(
                name="obsm_key",
                prompt=PARAMETER_PROMPTS["spatial_gene_plot"]["obsm_key"],
                type=str,
                default="spatial",
                optional=True,
            ),
            ParameterPrompt(
                name="point_size",
                prompt=PARAMETER_PROMPTS["spatial_gene_plot"]["point_size"],
                type=float,
                default=5.0,
                optional=True,
            ),
        ],
        optional=True,
    )

def _umap_gene_plot_step() -> PlanStep:
    return PlanStep(
        identifier="umap_gene_plot",
        title="UMAP gene expression",
        description="Visualise selected gene expression on UMAP coordinates.",
        tool_cls=UMAPGenePlotTool,
        param_prompts=[
            ParameterPrompt(
                name="adata_id",
                prompt=PARAMETER_PROMPTS["umap_gene_plot"]["adata_id"],
                type=str,
                context_key="adata_id",
            ),
            ParameterPrompt(
                name="genes",
                prompt=PARAMETER_PROMPTS["umap_gene_plot"]["genes"],
                type=str,
            ),
            ParameterPrompt(
                name="obsm_key",
                prompt=PARAMETER_PROMPTS["umap_gene_plot"]["obsm_key"],
                type=str,
                default="X_umap",
                optional=True,
            ),
            ParameterPrompt(
                name="point_size",
                prompt=PARAMETER_PROMPTS["umap_gene_plot"]["point_size"],
                type=float,
                default=5.0,
                optional=True,
            ),
        ],
        optional=True,
    )

def _pseudotime_step() -> PlanStep:
    return PlanStep(
        identifier="pseudotime",
        title="Pseudotime (DPT)",
        description="Compute diffusion pseudotime and visualise on UMAP.",
        tool_cls=PseudotimeTool,
        param_prompts=[
            ParameterPrompt(
                name="adata_id",
                prompt=PARAMETER_PROMPTS["pseudotime"]["adata_id"],
                type=str,
                context_key="adata_id",
            ),
            ParameterPrompt(
                name="root_cell",
                prompt=PARAMETER_PROMPTS["pseudotime"]["root_cell"],
                type=str,
                optional=True,
            ),
            ParameterPrompt(
                name="root_label",
                prompt=PARAMETER_PROMPTS["pseudotime"]["root_label"],
                type=str,
                optional=True,
            ),
            ParameterPrompt(
                name="label_key",
                prompt=PARAMETER_PROMPTS["pseudotime"]["label_key"],
                type=str,
                default="leiden",
                optional=True,
            ),
            ParameterPrompt(
                name="neighbors_key",
                prompt=PARAMETER_PROMPTS["pseudotime"]["neighbors_key"],
                type=str,
                optional=True,
            ),
        ],
        optional=True,
    )

def _cell_communication_step() -> PlanStep:
    return PlanStep(
        identifier="cell_communication",
        title="Cell-cell communication",
        description="Infer ligand-receptor interactions across clusters.",
        tool_cls=CellCommunicationTool,
        param_prompts=[
            ParameterPrompt(
                name="adata_id",
                prompt=PARAMETER_PROMPTS["cell_communication"]["adata_id"],
                type=str,
                context_key="adata_id",
            ),
            ParameterPrompt(
                name="group_key",
                prompt=PARAMETER_PROMPTS["cell_communication"]["group_key"],
                type=str,
                default="leiden",
            ),
            ParameterPrompt(
                name="n_top_pairs",
                prompt=PARAMETER_PROMPTS["cell_communication"]["n_top_pairs"],
                type=int,
                default=20,
            ),
            ParameterPrompt(
                name="min_expr",
                prompt=PARAMETER_PROMPTS["cell_communication"]["min_expr"],
                type=float,
                default=0.05,
                optional=True,
            ),
        ],
        optional=True,
    )


def _spatial_domain_step() -> PlanStep:
    return PlanStep(
        identifier="spatial_domain",
        title="Spatial domain detection",
        description="Run spatial domain detection when spatial coordinates are available.",
        tool_cls=SpatialDomainTool,
        param_prompts=[
            ParameterPrompt(
                name="adata_id",
                prompt=PARAMETER_PROMPTS["spatial_domain"]["adata_id"],
                type=str,
                context_key="adata_id",
            ),
            ParameterPrompt(
                name="method",
                prompt=PARAMETER_PROMPTS["spatial_domain"]["method"],
                type=str,
                default="leiden",
                choices=["leiden", "louvain", "kmeans"],
            ),
            ParameterPrompt(
                name="resolution",
                prompt=PARAMETER_PROMPTS["spatial_domain"]["resolution"],
                type=float,
                default=0.8,
            ),
            ParameterPrompt(
                name="n_neighbors",
                prompt=PARAMETER_PROMPTS["spatial_domain"]["n_neighbors"],
                type=int,
                default=6,
                optional=True,
            ),
            ParameterPrompt(
                name="expression_weight",
                prompt=PARAMETER_PROMPTS["spatial_domain"]["expression_weight"],
                type=float,
                default=0.3,
            ),
        ],
        optional=True,
    )


def _cell_typing_step() -> PlanStep:
    return PlanStep(
        identifier="cell_typing",
        title="Cell type annotation",
        description="Assign cell types using provided marker panels.",
        tool_cls=CellTypingTool,
        param_prompts=[
            ParameterPrompt(
                name="adata_id",
                prompt=PARAMETER_PROMPTS["cell_typing"]["adata_id"],
                type=str,
                context_key="adata_id",
            ),
            ParameterPrompt(
                name="tissue_type",
                prompt=PARAMETER_PROMPTS["cell_typing"]["tissue_type"],
                type=str,
                optional=True,
                context_key="tissue_type",
            ),
            ParameterPrompt(
                name="question",
                prompt=PARAMETER_PROMPTS["cell_typing"]["question"],
                type=str,
                optional=True,
            ),
            ParameterPrompt(
                name="output_key",
                prompt=PARAMETER_PROMPTS["cell_typing"]["output_key"],
                type=str,
                default="predicted_type",
            ),
            ParameterPrompt(
                name="expected_types",
                prompt="List expected cell types (comma-separated) if known:",
                type=list,
                optional=True,
            ),
        ],
    optional=True,
    )


class PlanBuilder:
    """Generate an initial analysis plan based on the incoming command."""

    def __init__(self) -> None:
        self._core_steps = [_metadata_step(), _preprocess_step()]
        optional_candidates = [
            _batch_correction_step(),
            _de_step(),
            _spatial_domain_step(),
            _umap_gene_plot_step(),
            _spatial_gene_plot_step(),
            _pseudotime_step(),
            _cell_communication_step(),
            _cell_typing_step(),
        ]
        self._optional_steps = {step.identifier: step for step in optional_candidates}
        self._bundles: Dict[str, List[PlanStep]] = {}
        self._identifier_to_bundle: Dict[str, str] = {}
        for step in [*self._core_steps, *self._optional_steps.values()]:
            if step.bundle_id:
                self._bundles.setdefault(step.bundle_id, []).append(step)
                self._identifier_to_bundle[step.identifier] = step.bundle_id
        self._context: Dict[str, Any] = {}

    @property
    def optional_steps(self) -> Dict[str, PlanStep]:
        return self._optional_steps

    @property
    def bundle_groups(self) -> Dict[str, List[PlanStep]]:
        return self._bundles

    @property
    def identifier_to_bundle(self) -> Dict[str, str]:
        return self._identifier_to_bundle

    def get_step_by_id(self, identifier: str) -> Optional[PlanStep]:
        for step in [*self._core_steps, *self._optional_steps.values()]:
            if step.identifier == identifier:
                return step
        return None

    def set_context(self, context: Optional[Dict[str, Any]]) -> None:
        self._context = dict(context) if context else {}

    def get_context(self) -> Dict[str, Any]:
        return dict(self._context)

    def build(self, command: str) -> List[PlanStep]:
        del command
        return list(self._core_steps)


@dataclass
class PlannerContext:
    """Structured context passed to the planner prompt."""

    adata_path: str = "Unknown"
    n_cells: Optional[int] = None
    n_genes: Optional[int] = None
    metadata_columns: Optional[Iterable[str]] = None
    extra_context: str = "Unknown"
    required_steps: Optional[Sequence[str]] = None
    metadata_summary: Optional[str] = None

    def as_prompt_kwargs(self, available_steps_text: str, command: str) -> Dict[str, Any]:
        return {
            "available_steps": available_steps_text,
            "command": command,
            "adata_path": self.adata_path or "Unknown",
            "n_cells": self.n_cells if self.n_cells is not None else "Unknown",
            "n_genes": self.n_genes if self.n_genes is not None else "Unknown",
            "metadata_columns": ", ".join(self.metadata_columns) if self.metadata_columns else "Unknown",
            "extra_context": self.extra_context or "Unknown",
            "required_steps": ", ".join(self.required_steps) if self.required_steps else "None",
            "metadata_summary": self.metadata_summary or "None",
        }


class LLMPlanBuilder(PlanBuilder):
    """Plan builder that queries an LLM to choose analysis steps."""

    DEFAULT_MODEL_NAME = "gpt-4"

    def __init__(
        self,
        include_steps: Sequence[str] = (),
        llm: Optional[Runnable] = None,
        model_name: Optional[str] = None,
        llm_kwargs: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__()
        self._include_steps: List[str] = []
        self._register_include_steps(include_steps)
        self._llm = llm
        self._model_name = model_name or self.DEFAULT_MODEL_NAME
        self._llm_kwargs = llm_kwargs or {}

        self._step_lookup: Dict[str, PlanStep] = {
            step.identifier: step for step in [*self._core_steps, *self.optional_steps.values()]
        }

    def _register_include_steps(self, include_steps: Sequence[str]) -> None:
        ordered: List[str] = []
        seen = set()
        for ident in include_steps:
            if ident not in seen:
                ordered.append(ident)
                seen.add(ident)
        self._include_steps = ordered

    def _ensure_llm(self) -> Runnable:
        if self._llm is not None:
            return self._llm
        from langchain_openai import ChatOpenAI  # imported lazily to avoid hard dependency at import time

        self._llm = ChatOpenAI(model=self._model_name, temperature=0, **self._llm_kwargs)
        return self._llm

    def set_context(self, context: Optional[Dict[str, Any]]) -> None:
        super().set_context(context)

    def set_openai_api_key(self, api_key: Optional[str]) -> None:
        if not api_key:
            return
        self._llm_kwargs.setdefault("openai_api_key", api_key)

    def build(self, command: str) -> List[PlanStep]:  # type: ignore[override]
        fallback_plan = super().build(command)
        try:
            response_plan = self._plan_with_llm(command)
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning("Falling back to static plan builder due to planner error: %s", exc)
            return self._append_included_steps(fallback_plan)

        if not response_plan:
            LOGGER.warning("LLM planner returned an empty plan; using fallback steps.")
            return self._append_included_steps(fallback_plan)

        response_plan = self._append_missing_core_steps(response_plan)
        response_plan = self._append_included_steps(response_plan)
        return response_plan

    def _plan_with_llm(self, command: str) -> List[PlanStep]:
        raw_context = self.get_context()
        context = PlannerContext(
            adata_path=raw_context.get("adata_path", "Unknown"),
            n_cells=raw_context.get("n_cells"),
            n_genes=raw_context.get("n_genes"),
            metadata_columns=raw_context.get("metadata_columns"),
            extra_context=raw_context.get("extra_context", raw_context.get("notes", "Unknown")),
            required_steps=raw_context.get("required_steps"),
            metadata_summary=raw_context.get("metadata_summary"),
        )
        available_steps_text = self._format_available_steps()
        prompt_kwargs = context.as_prompt_kwargs(available_steps_text, command)

        system_prompt = LLM_SYSTEM_MESSAGES["planner"]
        user_prompt = LLM_PROMPTS["planner"].format(**prompt_kwargs)

        llm = self._ensure_llm()
        result = llm.invoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt),
            ]
        )
        content = getattr(result, "content", None) or str(result)

        try:
            payload = json.loads(content)
        except json.JSONDecodeError as exc:  # noqa: BLE001
            raise ValueError(f"Planner response is not valid JSON: {exc}\nResponse: {content}") from exc

        raw_steps = payload.get("steps", [])
        if not isinstance(raw_steps, list):
            raise ValueError("Planner response missing 'steps' array")

        plan: List[PlanStep] = []
        seen: set[str] = set()
        for entry in raw_steps:
            if not isinstance(entry, dict):
                continue
            ident = entry.get("identifier")
            if not isinstance(ident, str):
                continue
            ident = ident.strip()
            step = self._step_lookup.get(ident)
            if not step or ident in seen:
                if ident not in self._step_lookup:
                    LOGGER.warning("Planner suggested unknown step '%s'", ident)
                continue
            plan.append(step)
            seen.add(ident)

        return plan

    def _format_available_steps(self) -> str:
        lines = []
        for step in [*self._core_steps, *self.optional_steps.values()]:
            optional_tag = " (optional)" if step.optional else ""
            lines.append(f"- {step.identifier}{optional_tag}: {step.title}")
        return "\n".join(lines)

    def _append_missing_core_steps(self, plan: List[PlanStep]) -> List[PlanStep]:
        """Ensure core steps appear first and in canonical order."""
        final: List[PlanStep] = []
        seen: set[str] = set()
        plan_lookup = {step.identifier: step for step in plan}

        # Always prepend core steps in defined order, reusing instances from plan when present
        for core_step in self._core_steps:
            chosen = plan_lookup.get(core_step.identifier, core_step)
            if chosen.identifier not in seen:
                final.append(chosen)
                seen.add(chosen.identifier)

        # Append the rest preserving original order
        for step in plan:
            if step.identifier in seen:
                continue
            final.append(step)
            seen.add(step.identifier)

        return final

    def _append_included_steps(self, plan: List[PlanStep]) -> List[PlanStep]:
        existing = {step.identifier for step in plan}
        final_plan = list(plan)
        for ident in self._include_steps:
            if ident not in existing:
                step = self.optional_steps.get(ident)
                if step:
                    final_plan.append(step)
                    existing.add(ident)
        return self._deduplicate_preserving_order(final_plan)

    @staticmethod
    def _deduplicate_preserving_order(steps: List[PlanStep]) -> List[PlanStep]:
        ordered: List[PlanStep] = []
        seen: set[str] = set()
        for step in steps:
            if step.identifier in seen:
                continue
            ordered.append(step)
            seen.add(step.identifier)
        return ordered


__all__ = [
    "LLMPlanBuilder",
    "ParameterPrompt",
    "PlanBuilder",
    "PlanStep",
    "PlannerContext",
]
