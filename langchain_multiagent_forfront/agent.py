"""Interactive analysis agent orchestrating bioinformatics tools.

This module provides a conversational agent that receives a high-level
analysis request, generates a step-by-step plan, collects user-approved
hyperparameters for each step, runs the underlying tools defined in
``biotools.py``, and finally assembles a textual report together with
all generated visualisations combined into a single PDF document.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Type
import re

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from planner import LLMPlanBuilder, ParameterPrompt, PlanBuilder, PlanStep
from prompts import (
    CONFIRM_MESSAGES,
    ERROR_MESSAGES,
    INFO_MESSAGES,
    INPUT_PROMPTS,
    LLM_PROMPTS,
    LLM_SYSTEM_MESSAGES,
    TEMPLATE_ERROR_MESSAGES,
)
from report_utils import (
    collect_figure_paths,
    figures_to_pdf,
    render_text_report,
    serialise_logs,
)

logger = logging.getLogger(__name__)


@dataclass
class ExecutionLogEntry:
    """Record describing the execution status of a single plan step."""

    step_id: str
    step_title: str
    status: str
    parameters: Dict[str, Any]
    summary: Optional[str]
    figures: List[str]
    error: Optional[str] = None


@dataclass
class AnalysisResult:
    """Outputs returned by :class:`BioAnalysisAgent`."""

    report_path: Path
    pdf_path: Path
    log_path: Path
    plan: List[PlanStep]
    logs: List[ExecutionLogEntry]


DEFAULT_OPENAI_KEY_PATH = Path("~/.openai/api_key")
OPENAI_KEY_ENV_VAR = "OPENAI_API_KEY"
OPENAI_KEY_PATH_ENV_VAR = "OPENAI_API_KEY_FILE"
DIRECT_OPENAI_KEY = os.getenv("OPENAI_API_KEY", "")


def _read_openai_key_file(path: Path) -> Optional[str]:
    candidate = path.expanduser()
    try:
        key = candidate.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        logger.debug("OpenAI API key file not found at %s", candidate)
        return None
    except OSError as exc:
        logger.warning("Failed to read OpenAI API key file %s: %s", candidate, exc)
        return None
    return key or None


def _ensure_openai_api_key() -> Optional[str]:
    # First, check if there's a hardcoded key
    if DIRECT_OPENAI_KEY and DIRECT_OPENAI_KEY.startswith("sk-"):
        os.environ[OPENAI_KEY_ENV_VAR] = DIRECT_OPENAI_KEY
        logger.info("✅ Using hardcoded OpenAI API key from agent.py")
        return DIRECT_OPENAI_KEY
    
    # Next, check environment variable
    existing = os.environ.get(OPENAI_KEY_ENV_VAR, "").strip()
    if existing:
        logger.info("✅ Using OpenAI API key from environment variable")
        return existing

    # Finally, try to read from file
    override = os.environ.get(OPENAI_KEY_PATH_ENV_VAR)
    candidate = Path(override).expanduser() if override else DEFAULT_OPENAI_KEY_PATH
    key = _read_openai_key_file(candidate)
    if key:
        os.environ[OPENAI_KEY_ENV_VAR] = key
        logger.info("✅ Loaded OpenAI API key from %s", candidate)
        return key

    logger.warning("⚠️  OpenAI API key could not be determined; planner may require manual configuration.")
    return None


# ---------------------------------------------------------------------------
# User interaction helpers
# ---------------------------------------------------------------------------


class UserIO:
    """Abstract interaction layer used by the agent.

    Tests can provide a deterministic ``UserIO`` implementation to supply
    canned answers, while production usage may rely on console input/output
    or GUI dialogs.
    """

    def display(self, message: str) -> None:
        raise NotImplementedError

    def prompt(self, message: str) -> str:
        raise NotImplementedError

    def confirm(self, message: str, default: bool = True) -> bool:
        raise NotImplementedError


class ConsoleUserIO(UserIO):
    """Default console-based interaction backend."""

    def display(self, message: str) -> None:
        print(message)

    def prompt(self, message: str) -> str:
        return input(message + "\n> ")

    def confirm(self, message: str, default: bool = True) -> bool:
        suffix = "[Y/n]" if default else "[y/N]"
        while True:
            response = input(f"{message} {suffix}\n> ").strip().lower()
            if not response:
                return default
            if response in {"y", "yes"}:
                return True
            if response in {"n", "no"}:
                return False
            print("Please enter 'y' or 'n'.")


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def _format_plan(plan: Sequence[PlanStep]) -> str:
    lines = ["Planned steps:"]
    for idx, step in enumerate(plan, start=1):
        optional_tag = " (optional)" if step.optional else ""
        lines.append(f"  {idx}. {step.title}{optional_tag}: {step.description}")
    return "\n".join(lines)


def _normalise_bool(value: str) -> Optional[bool]:
    lowered = value.strip().lower()
    if lowered in {"y", "yes", "ok", "true"}:
        return True
    if lowered in {"n", "no", "cancel", "false"}:
        return False
    return None


def _string_to_type(value: str, target_type: Type) -> Any:
    if target_type is str:
        return value
    if target_type is int:
        return int(value)
    if target_type is float:
        return float(value)
    if target_type is bool:
        normalised = _normalise_bool(value)
        if normalised is None:
            raise ValueError("Failed to parse boolean, please enter y/n or true/false.")
        return normalised
    if target_type is Path:
        return Path(value)
    raise TypeError(f"Unsupported parameter type: {target_type}")


def _has_meaningful_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


TISSUE_KEYWORDS: Dict[str, Sequence[str]] = {
    "lung": ("lung", "pulmonary", "nsclc", "non-small cell lung", "respiratory"),
    "blood": ("blood", "pbmc", "hematopoietic", "leukemia"),
    "brain": ("brain", "cortex", "neural", "glioma"),
    "liver": ("liver", "hepatic", "hepatocellular"),
    "kidney": ("kidney", "renal"),
    "skin": ("skin", "dermal", "melanoma"),
    "breast": ("breast", "mammary"),
}


def _extract_dataset_path(text: str) -> Optional[str]:
    pattern = r"(/[\w./\-~]+?\.(?:h5ad|h5|loom|csv|xlsx))"
    matches = re.findall(pattern, text, flags=re.IGNORECASE)
    return matches[-1] if matches else None


def _extract_tissue_type(text: str) -> Optional[str]:
    lowered = text.lower()
    for tissue, keywords in TISSUE_KEYWORDS.items():
        for keyword in keywords:
            if keyword in lowered:
                return tissue
    return None


def resolve_dataset_path(initial: Optional[str], user_io: UserIO) -> str:
    """Return a resolved dataset path, prompting the user when necessary."""

    if initial:
        path = Path(initial).expanduser().resolve()
    else:
        response = user_io.prompt(
            "Enter the dataset path (AnnData .h5ad or 10x .h5):"
        ).strip()
        path = Path(response).expanduser().resolve()

    if not path.exists():
        user_io.display(f"Warning: dataset path does not exist: {path}")

    return str(path)


def create_plan_builder(
    planner: str,
    include_steps: Optional[Sequence[str]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> PlanBuilder:
    """Factory helper that returns a configured plan builder."""

    include_steps = list(include_steps or [])

    if planner == "llm":
        builder: PlanBuilder = LLMPlanBuilder(include_steps=include_steps)
    else:
        builder = PlanBuilder()

    if context:
        builder.set_context(dict(context))

    return builder


# ---------------------------------------------------------------------------
# Agent implementation
# ---------------------------------------------------------------------------


class BioAnalysisAgent:
    """Conversational orchestrator for the biological analysis tools."""

    def __init__(
        self,
        user_io: Optional[UserIO] = None,
        plan_builder: Optional[PlanBuilder] = None,
    ) -> None:
        self.user_io = user_io or ConsoleUserIO()
        self._openai_api_key = _ensure_openai_api_key()
        self.plan_builder = plan_builder or PlanBuilder()
        self._apply_plan_builder_credentials(self.plan_builder)
        self._logs: List[ExecutionLogEntry] = []
        self._context: Dict[str, Any] = {}
        self._figures: List[str] = []
        self._initial_command: str = ""
        self._marker_context_llm: Optional[ChatOpenAI] = None
        self._marker_context_model = "gpt-4"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, command: str) -> AnalysisResult:
        self.user_io.display(f"Received command: {command}")
        self._initial_command = command
        self._logs.clear()
        self._figures = []
        self._context.clear()
        initial_context = self.plan_builder.get_context()
        if initial_context:
            self._context.update(initial_context)
            if "adata_path" in self._context and "adata_id" not in self._context:
                self._context["adata_id"] = self._context["adata_path"]

        self._sync_builder_context()

        skip_identifiers: set[str] = set()
        aborted = False

        metadata_step: Optional[PlanStep] = None
        if hasattr(self.plan_builder, "get_step_by_id"):
            metadata_step = self.plan_builder.get_step_by_id("metadata")  # type: ignore[attr-defined]

        if metadata_step is not None:
            _status, aborted_step = self._execute_step_with_retry(metadata_step)
            skip_identifiers.add(metadata_step.identifier)
            if aborted_step:
                aborted = True

        plan: List[PlanStep] = []
        if not aborted:
            plan = self._obtain_confirmed_plan(command, skip_identifiers=skip_identifiers)

        if not aborted:
            for step in plan:
                _status, aborted_step = self._execute_step_with_retry(step)
                if aborted_step:
                    aborted = True
                    break

        output_root = self._determine_output_root()
        output_root.mkdir(parents=True, exist_ok=True)

        report_path = output_root / "analysis_report.txt"
        pdf_path = output_root / "analysis_figures.pdf"
        log_path = output_root / "analysis_log.json"

        full_plan: List[PlanStep] = []
        if metadata_step is not None:
            full_plan.append(metadata_step)
        full_plan.extend(plan)

        render_text_report(command, full_plan, self._logs, report_path, figures=self._figures)
        serialise_logs(self._logs, log_path)
        unique_figures = list(dict.fromkeys(self._figures))
        figures_to_pdf(unique_figures, pdf_path)

        return AnalysisResult(
            report_path=report_path,
            pdf_path=pdf_path,
            log_path=log_path,
            plan=full_plan,
            logs=list(self._logs),
        )

    def _update_context_after_success(
        self,
        step: PlanStep,
        params: Dict[str, Any],
        result: Dict[str, Any],
    ) -> None:
        new_data_path: Optional[str] = None
        if isinstance(result, dict):
            output_path = result.get("output_data")
            if isinstance(output_path, (str, Path)):
                new_data_path = str(output_path)

        if step.identifier == "metadata":
            source_path = params.get("file_path") or params.get("adata_id")
            if isinstance(source_path, (str, Path)):
                source_path_str = str(source_path).strip()
                if source_path_str:
                    self._context["adata_id"] = source_path_str
                    self._context["adata_path"] = source_path_str

            metadata = result.get("results", {}) if isinstance(result, dict) else {}
            if isinstance(metadata, dict):
                data_scale = metadata.get("data_scale", {})
                if isinstance(data_scale, dict):
                    if "n_cells" in data_scale:
                        self._context["n_cells"] = data_scale["n_cells"]
                    if "n_genes" in data_scale:
                        self._context["n_genes"] = data_scale["n_genes"]
                obs_cols = metadata.get("observation_columns")
                if isinstance(obs_cols, list):
                    self._context["metadata_columns"] = obs_cols
                var_cols = metadata.get("variable_columns")
                if isinstance(var_cols, list):
                    self._context["variable_columns"] = var_cols
                layers = metadata.get("layers")
                if isinstance(layers, list):
                    self._context["available_layers"] = layers
            summary_text = result.get("summary_text") if isinstance(result, dict) else None
            if summary_text:
                existing_summary = self._context.get("metadata_summary")
                combined_summary = (
                    f"{existing_summary}\n{summary_text}" if existing_summary else summary_text
                )
                self._context["metadata_summary"] = combined_summary
        elif step.identifier == "cell_typing":
            if result.get("marker_sets"):
                self._context["marker_sets"] = result["marker_sets"]
            elif params.get("marker_sets"):
                self._context["marker_sets"] = params["marker_sets"]
            if params.get("tissue_type"):
                self._context["tissue_type"] = params["tissue_type"]
            if params.get("question"):
                self._context["metadata_summary"] = params["question"]
        else:
            if not new_data_path and params.get("adata_id"):
                adata_path = params["adata_id"]
                if isinstance(adata_path, (str, Path)):
                    candidate = str(adata_path).strip()
                    if candidate:
                        new_data_path = candidate

        if new_data_path:
            self._context["adata_id"] = new_data_path
            self._context["adata_path"] = new_data_path

    def _obtain_confirmed_plan(self, command: str, skip_identifiers: Optional[set[str]] = None) -> List[PlanStep]:
        skip_identifiers = skip_identifiers or set()
        self._sync_builder_context()
        plan = [
            step for step in self.plan_builder.build(command) if step.identifier not in skip_identifiers
        ]
        while True:
            plan = [
                step
                for step in self._ensure_bundle_integrity(plan)
                if step.identifier not in skip_identifiers
            ]
            self.user_io.display(_format_plan(plan))
            if self.user_io.confirm(CONFIRM_MESSAGES["approve_plan"], default=True):
                return plan

            self.user_io.display(INFO_MESSAGES["plan_edit_intro"])
            removal = self.user_io.prompt(
                INPUT_PROMPTS["remove_steps"]
            ).strip()
            if removal == "0":
                raise RuntimeError("Plan confirmation cancelled by user.")
            if removal:
                indices = {
                    int(idx.strip())
                    for idx in removal.split(",")
                    if idx.strip().isdigit()
                }
                plan = [step for i, step in enumerate(plan, start=1) if i not in indices]
                plan = [
                    step
                    for step in self._ensure_bundle_integrity(plan)
                    if step.identifier not in skip_identifiers
                ]
                if not plan:
                    self.user_io.display(INFO_MESSAGES["all_steps_removed"])
                    self._sync_builder_context()
                    plan = [
                        step
                        for step in self.plan_builder.build(command)
                        if step.identifier not in skip_identifiers
                    ]

            available = {
                ident: step
                for ident, step in self.plan_builder.optional_steps.items()
                if ident not in skip_identifiers
                and all(existing.identifier != ident for existing in plan)
            }
            if available:
                self.user_io.display(INFO_MESSAGES["optional_steps_available"])
                for ident, step in available.items():
                    self.user_io.display(f"  - {ident}: {step.title}")
                if any(
                    ident in self.plan_builder.identifier_to_bundle
                    for ident in available
                ):
                    self.user_io.display(INFO_MESSAGES["bundle_reminder"])
                addition = self.user_io.prompt(
                    INPUT_PROMPTS["add_steps"]
                ).strip()
                if addition:
                    selected: List[str] = []
                    for raw_ident in addition.split(","):
                        ident = raw_ident.strip()
                        if ident and ident in available and ident not in selected:
                            selected.append(ident)
                    for ident in selected:
                        plan = self._add_step_with_bundle(plan, available[ident])
                    plan = [
                        step
                        for step in self._ensure_bundle_integrity(plan)
                        if step.identifier not in skip_identifiers
                    ]
            else:
                self.user_io.display(INFO_MESSAGES["no_optional_steps"])

    def _sync_builder_context(self) -> None:
        combined: Dict[str, Any] = {}
        combined.update(self.plan_builder.get_context())
        combined.update(self._context)
        self.plan_builder.set_context(combined)

    def _apply_plan_builder_credentials(self, builder: PlanBuilder) -> None:
        if not self._openai_api_key:
            return

        if hasattr(builder, "set_openai_api_key"):
            try:
                builder.set_openai_api_key(self._openai_api_key)
                return
            except Exception as exc:  # noqa: BLE001
                logger.debug("Failed to configure plan builder via setter: %s", exc)

        llm_kwargs = getattr(builder, "_llm_kwargs", None)
        if isinstance(llm_kwargs, dict) and "openai_api_key" not in llm_kwargs:
            llm_kwargs["openai_api_key"] = self._openai_api_key

    def _add_step_with_bundle(self, plan: List[PlanStep], step: PlanStep) -> List[PlanStep]:
        updated_plan = list(plan)
        existing_ids = {existing.identifier for existing in updated_plan}
        if step.bundle_id:
            bundle_members = self.plan_builder.bundle_groups.get(step.bundle_id, [])
            for member in bundle_members:
                if member.identifier not in existing_ids:
                    updated_plan.append(member)
                    existing_ids.add(member.identifier)
        else:
            if step.identifier not in existing_ids:
                updated_plan.append(step)
        return updated_plan

    def _ensure_bundle_integrity(self, plan: List[PlanStep]) -> List[PlanStep]:
        if not self.plan_builder.bundle_groups:
            return list(plan)
        cleaned_plan = list(plan)
        changed = False
        for bundle_id, members in self.plan_builder.bundle_groups.items():
            member_ids = {member.identifier for member in members}
            present = {step.identifier for step in cleaned_plan if step.identifier in member_ids}
            if present and present != member_ids:
                self.user_io.display(INFO_MESSAGES["bundle_enforced"])
                cleaned_plan = [
                    step for step in cleaned_plan if step.identifier not in member_ids
                ]
                changed = True
        return cleaned_plan if changed else list(cleaned_plan)

    def _execute_step_with_retry(self, step: PlanStep) -> Tuple[str, bool]:
        show_intro = True
        force_reprompt = False
        while True:
            status, error = self._run_plan_step(
                step,
                show_intro=show_intro,
                force_reprompt=force_reprompt,
            )
            show_intro = False
            force_reprompt = False
            if status in {"success", "skipped"}:
                return status, False
            decision = self._handle_step_failure(step, error)
            if decision == "retry":
                self.user_io.display(f"Retrying {step.title}...")
                force_reprompt = True
                continue
            if decision == "abort":
                return status, True
            return status, False

    def _handle_step_failure(self, step: PlanStep, error: Optional[str]) -> str:
        if error:
            self.user_io.display(f"Step '{step.title}' failed: {error}")
        if self.user_io.confirm(
            CONFIRM_MESSAGES["retry_step"].format(step_title=step.title), default=True
        ):
            return "retry"
        if self.user_io.confirm(CONFIRM_MESSAGES["failure_continue"], default=False):
            return "skip"
        return "abort"

    def _display_step_intro(self, step: PlanStep) -> None:
        self.user_io.display("")
        self.user_io.display(f"== {step.title} ==")
        if step.description:
            self.user_io.display(step.description)

    def _run_plan_step(
        self,
        step: PlanStep,
        show_intro: bool = True,
        force_reprompt: bool = False,
    ) -> Tuple[str, Optional[str]]:
        if show_intro:
            self._display_step_intro(step)
        params = self._gather_step_parameters(step, force_reprompt=force_reprompt)
        if not self.user_io.confirm(
            CONFIRM_MESSAGES["about_to_run"].format(step_title=step.title), default=True
        ):
            self.user_io.display(f"Skipping step: {step.title}")
            self._logs.append(
                ExecutionLogEntry(
                    step_id=step.identifier,
                    step_title=step.title,
                    status="skipped",
                    parameters=params,
                    summary=None,
                    figures=[],
                )
            )
            return "skipped", None

        result, status, error = self._execute_step(step, params)
        figures = collect_figure_paths(result)
        self._figures.extend(figures)
        summary = result.get("summary_text") if isinstance(result, dict) else None

        self._logs.append(
            ExecutionLogEntry(
                step_id=step.identifier,
                step_title=step.title,
                status=status,
                parameters=params,
                summary=summary,
                figures=figures,
                error=error,
            )
        )

        if status == "success":
            self._update_context_after_success(step, params, result)
        self._sync_builder_context()
        if summary:
            self.user_io.display(f"Summary ({step.title}): {summary}")
        elif result:
            preview = {}
            if isinstance(result, dict):
                for key in ("data_scale", "observation_columns", "variable_columns", "layers"):
                    if key in result:
                        preview[key] = result[key]
                    elif isinstance(result.get("results"), dict) and key in result["results"]:
                        preview[key] = result["results"][key]
                if preview:
                    self.user_io.display(f"Summary ({step.title}): {json.dumps(preview, ensure_ascii=False)}")

        return status, error

    def _prepopulate_context_for_step(self, step: PlanStep) -> None:
        if step.identifier != "cell_typing":
            return
        if _has_meaningful_value(self._context.get("question")):
            return
        suggestion = self._summarise_marker_context()
        if suggestion:
            self._context["marker_question_suggestion"] = suggestion
            self.user_io.display(
                "Auto-generated biological context suggestion:\n"
                f"{suggestion}\n\nLeave empty to accept, or provide your own description:"
            )

    def _gather_step_parameters(
        self,
        step: PlanStep,
        force_reprompt: bool = False,
    ) -> Dict[str, Any]:
        self._prepopulate_context_for_step(step)
        allow_cached = not force_reprompt
        while True:
            params = self._collect_parameters(step, allow_cached=allow_cached)
            allow_cached = True
            try:
                prepared_params, display_meta = self._prepare_parameters(step, params)
            except ValueError as exc:
                self.user_io.display(
                    TEMPLATE_ERROR_MESSAGES["parameter_preparation_failed"].format(error=exc)
                )
            summary_payload = dict(prepared_params)
            summary_payload.update(display_meta)
            self._display_parameter_summary(step, summary_payload)
            return prepared_params

    def _display_parameter_summary(self, step: PlanStep, params: Dict[str, Any]) -> None:
        serialisable: Dict[str, Any] = {}
        for key, value in params.items():
            if key == "marker_sets" and isinstance(value, dict):
                serialisable[key] = {
                    "cell_type_count": len(value),
                    "panels": value,
                }
            elif isinstance(value, Path):
                serialisable[key] = str(value)
            else:
                serialisable[key] = value
        pretty = json.dumps(serialisable, ensure_ascii=False, indent=2)
        self.user_io.display(f"Parameter overview ({step.title}):\n{pretty}")

    def _prepare_parameters(
        self, step: PlanStep, params: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        display_meta: Dict[str, Any] = {}

        if step.identifier == "cell_typing":
            marker_value = params.get("marker_sets")
            marker_source = None
            if isinstance(marker_value, str) and marker_value.strip():
                marker_path = Path(marker_value.strip()).expanduser()
                if not marker_path.exists():
                    raise ValueError(f"Marker set file not found: {marker_path}")
                try:
                    loaded_markers = json.loads(marker_path.read_text(encoding="utf-8"))
                except Exception as exc:  # noqa: BLE001
                    raise ValueError(
                        f"Failed to load marker sets from {marker_path}: {exc}"
                    ) from exc
                params["marker_sets"] = loaded_markers
                marker_source = str(marker_path)
            elif isinstance(marker_value, dict) and marker_value:
                marker_source = "provided inline"
            else:
                markers = self._context.get("marker_sets")
                if markers:
                    params["marker_sets"] = markers
                    marker_source = "cached markers"
                else:
                    tool_instance = step.tool_cls()
                    if not hasattr(tool_instance, "select_marker_sets"):
                        raise ValueError("Cell typing tool cannot recommend marker sets.")
                    marker_sets, summary_text, source_label, refined = tool_instance.select_marker_sets(
                        dict(params),
                        self.user_io,
                        self._context,
                    )
                    params["marker_sets"] = marker_sets
                    if summary_text:
                        display_meta["marker_sets_summary"] = summary_text
                    marker_source = source_label
                    self._context["marker_sets"] = marker_sets
                    if refined.get("question"):
                        params["question"] = refined["question"]
                        self._context["metadata_summary"] = refined["question"]
            question = params.get("question")
            if question is not None and not str(question).strip():
                params.pop("question", None)
            tissue_type = params.get("tissue_type")
            if tissue_type is not None and not str(tissue_type).strip():
                params.pop("tissue_type", None)

            if params.get("marker_sets") is not None and not isinstance(params["marker_sets"], dict):
                raise ValueError("Marker sets must be provided as a JSON object.")

            display_meta["marker_sets_source"] = marker_source
            if params.get("marker_sets"):
                display_meta["marker_sets"] = params["marker_sets"]
            if params.get("expected_types"):
                display_meta["expected_types"] = params["expected_types"]
            if params.get("tissue_type"):
                display_meta["tissue_type"] = params["tissue_type"]
            if marker_source:
                display_meta["marker_sets_source"] = marker_source

        return params, display_meta


    def _collect_parameters(self, step: PlanStep, allow_cached: bool = True) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        skip_names = {"marker_sets"}

        ordered_prompts: List[ParameterPrompt] = []
        question_prompt: Optional[ParameterPrompt] = None
        output_prompt: Optional[ParameterPrompt] = None
        for prompt in step.param_prompts:
            if prompt.name == "question":
                question_prompt = prompt
            elif prompt.name == "output_key":
                output_prompt = prompt
            else:
                ordered_prompts.append(prompt)
        if question_prompt:
            ordered_prompts.insert(0, question_prompt)
        if output_prompt and output_prompt not in ordered_prompts:
            ordered_prompts.append(output_prompt)

        for prompt in ordered_prompts:
            if prompt.name in skip_names:
                continue

            cached = False
            cached_value = None
            if allow_cached:
                cached, cached_value = self._resolve_cached_parameter(prompt)
            if cached:
                params[prompt.name] = cached_value
                self._store_parameter_in_context(prompt, cached_value)
                continue

            default = self._context.get(prompt.context_key or prompt.name, prompt.default)
            if prompt.name == "question" and not _has_meaningful_value(default):
                suggestion = self._context.get("marker_question_suggestion")
                if suggestion:
                    default = suggestion
            if isinstance(default, str):
                default = default.strip()

            if prompt.name == "question" and default:
                self.user_io.display("Default biological context:")
                self.user_io.display(default)
                addition = self.user_io.prompt(
                    "Add any extra details (cell types, markers, notes), or leave empty to accept:"
                ).strip()
                if addition:
                    default = f"{default} {addition}".strip()
                params[prompt.name] = default
                self._store_parameter_in_context(prompt, default)
                self._context.pop("marker_question_suggestion", None)
                guidance = self.user_io.prompt(
                    "Add guidance for marker recommendation (e.g., emphasise certain cell types), or leave empty to continue:"
                ).strip()
                if guidance:
                    self._context["marker_guidance"] = guidance
                else:
                    self._context.pop("marker_guidance", None)
                if output_prompt and output_prompt.name not in params:
                    current_name = self._context.get(
                        output_prompt.context_key or output_prompt.name,
                        output_prompt.default,
                    )
                    name_message = output_prompt.prompt
                    if current_name is not None:
                        name_message += f" (default: {current_name})"
                    new_name = self.user_io.prompt(name_message).strip()
                    value = (new_name or current_name)
                    if isinstance(value, str):
                        value = value.strip()
                    if value:
                        params[output_prompt.name] = value
                        self._store_parameter_in_context(output_prompt, value)
                continue

            prompt_message = prompt.prompt
            if default is not None:
                prompt_message += f" (default: {default})"
            if prompt.choices:
                choices_text = ", ".join(map(str, prompt.choices))
                prompt_message += f"; choices: {choices_text}"

            while True:
                response = self.user_io.prompt(prompt_message).strip()
                if not response:
                    if default is not None:
                        value = default
                        break
                    if prompt.optional:
                        value = None
                        break
                    self.user_io.display(ERROR_MESSAGES["parameter_required"])
                    continue
                try:
                    value = _string_to_type(response, prompt.type)
                except Exception as exc:  # noqa: BLE001
                    self.user_io.display(
                        TEMPLATE_ERROR_MESSAGES["parse_failure"].format(error=exc)
                    )
                    continue
                if prompt.choices and value not in prompt.choices:
                    self.user_io.display(ERROR_MESSAGES["value_not_in_choices"])
                    continue
                break

            if value is not None:
                if isinstance(value, str) and prompt.type is str:
                    value = value.strip()
                params[prompt.name] = value
                if isinstance(value, Path):
                    params[prompt.name] = str(value)
                self._store_parameter_in_context(prompt, params[prompt.name])

        return params

    def _resolve_cached_parameter(self, prompt: ParameterPrompt) -> Tuple[bool, Any]:
        key = prompt.context_key or prompt.name
        candidate_sources: List[Any] = []
        if key and _has_meaningful_value(self._context.get(key)):
            candidate_sources.append(self._context[key])
        for entry in reversed(self._logs):
            for lookup_key in {prompt.name, key} if key else {prompt.name}:
                if lookup_key and lookup_key in entry.parameters:
                    value = entry.parameters[lookup_key]
                    if _has_meaningful_value(value):
                        candidate_sources.append(value)
            if candidate_sources:
                break
        for value in candidate_sources:
            coerced = self._coerce_cached_value(value, prompt.type)
            if _has_meaningful_value(coerced):
                return True, coerced

        inferred, inferred_value = self._infer_parameter_from_text(prompt)
        if inferred:
            return True, inferred_value
        return False, None

    def _coerce_cached_value(self, value: Any, target_type: Type) -> Any:
        if value is None:
            return None
        if target_type is bool and isinstance(value, str):
            try:
                normalised = _normalise_bool(value)
                if normalised is not None:
                    return normalised
            except Exception:
                return value
        if target_type is Path:
            if isinstance(value, Path):
                return str(value)
            if isinstance(value, str):
                return value
        if isinstance(value, target_type):
            return value
        if isinstance(value, str):
            try:
                return _string_to_type(value, target_type)
            except Exception:
                return value
        return value

    def _store_parameter_in_context(self, prompt: ParameterPrompt, value: Any) -> None:
        key = prompt.context_key or prompt.name
        if not key or value is None:
            return
        stored = str(value) if isinstance(value, Path) else value
        self._context[key] = stored

    def _infer_parameter_from_text(self, prompt: ParameterPrompt) -> Tuple[bool, Any]:
        targets = {prompt.name.lower()}
        if prompt.context_key:
            targets.add(prompt.context_key.lower())

        texts: List[str] = []
        if self._initial_command:
            texts.append(self._initial_command)
        for key in ("metadata_summary", "marker_guidance"):
            value = self._context.get(key)
            if isinstance(value, str) and value.strip():
                texts.append(value)

        for text in texts:
            lowered = text.lower()
            if any("adata" in target or "file_path" in target for target in targets):
                path = _extract_dataset_path(text)
                if path:
                    return True, path
            if any("tissue" in target for target in targets):
                tissue = _extract_tissue_type(text)
                if tissue:
                    return True, tissue
        return False, None

    def _summarise_marker_context(self) -> Optional[str]:
        entries: List[str] = []
        if self._initial_command:
            entries.append(f"Initial command: {self._initial_command}")
        for log in self._logs:
            parts = [f"{log.step_title} ({log.status})"]
            if log.summary:
                parts.append(f"Summary: {log.summary}")
            if log.error:
                parts.append(f"Error: {log.error}")
            entries.append(" | ".join(parts))

        if not entries:
            return None

        log_text = "\n".join(entries[-12:])
        if len(log_text) > 4000:
            log_text = log_text[-4000:]

        llm = self._get_marker_context_llm()
        if not llm:
            return entries[-1]

        system_prompt = LLM_SYSTEM_MESSAGES.get("marker_context_summary")
        human_prompt = LLM_PROMPTS.get("marker_context_summary")
        if not system_prompt or not human_prompt:
            return entries[-1]

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_prompt.format(log_text=log_text)),
        ]

        try:
            response = llm.invoke(messages)
        except Exception as exc:  # noqa: BLE001
            logger.debug("Marker context summary request failed: %s", exc)
            return entries[-1]

        content = getattr(response, "content", None)
        if isinstance(content, list):
            content = " ".join(chunk.get("text", "") for chunk in content if isinstance(chunk, dict))
        text = str(content or "").strip()
        return text or entries[-1]

    def _get_marker_context_llm(self) -> Optional[ChatOpenAI]:
        if self._marker_context_llm is not None:
            return self._marker_context_llm
        if not self._openai_api_key:
            return None
        try:
            self._marker_context_llm = ChatOpenAI(
                model=self._marker_context_model,
                temperature=0,
                openai_api_key=self._openai_api_key,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("Failed to initialise marker context LLM: %s", exc)
            self._marker_context_llm = None
        return self._marker_context_llm

    def _determine_output_root(self) -> Path:
        dataset_path = self._context.get("adata_id") or self._context.get("adata_path")
        if dataset_path:
            base_dir = Path(dataset_path).resolve().parent
        else:
            base_dir = Path.cwd()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return base_dir / f"analysis_agent_{timestamp}"

    def _execute_step(
        self, step: PlanStep, params: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], str, Optional[str]]:
        tool = step.tool_cls()
        try:
            result = tool.invoke(params)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to execute step %s", step.identifier)
            return {}, "failed", str(exc)

        if isinstance(result, dict) and result.get("error"):
            error_message = str(result.get("message") or result.get("error"))
            return result, "failed", error_message

        return result, "success", None

    
