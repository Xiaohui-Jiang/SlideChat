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

from .planner import LLMPlanBuilder, ParameterPrompt, PlanBuilder, PlanStep
from .prompts import (
    CONFIRM_MESSAGES,
    ERROR_MESSAGES,
    INFO_MESSAGES,
    INPUT_PROMPTS,
    TEMPLATE_ERROR_MESSAGES,
)
from .report_utils import (
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


DEFAULT_OPENAI_KEY_PATH = Path("/Users/xiaohui/Desktop/keys/openai_xielab.txt")
OPENAI_KEY_ENV_VAR = "OPENAI_API_KEY"
OPENAI_KEY_PATH_ENV_VAR = "OPENAI_API_KEY_FILE"


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
    existing = os.environ.get(OPENAI_KEY_ENV_VAR, "").strip()
    if existing:
        return existing

    override = os.environ.get(OPENAI_KEY_PATH_ENV_VAR)
    candidate = Path(override).expanduser() if override else DEFAULT_OPENAI_KEY_PATH
    key = _read_openai_key_file(candidate)
    if key:
        os.environ[OPENAI_KEY_ENV_VAR] = key
        logger.debug("Loaded OpenAI API key from %s", candidate)
        return key

    logger.debug("OpenAI API key could not be determined; planner may require manual configuration.")
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


def _collect_visual_paths(obj: Any, accumulator: Optional[set] = None) -> List[str]:
    if accumulator is None:
        accumulator = set()
    if isinstance(obj, dict):
        for value in obj.values():
            _collect_visual_paths(value, accumulator)
    elif isinstance(obj, (list, tuple, set)):
        for value in obj:
            _collect_visual_paths(value, accumulator)
    elif isinstance(obj, str):
        suffix = Path(obj).suffix.lower()
        if suffix in {".png", ".jpg", ".jpeg", ".pdf"} and Path(obj).exists():
            accumulator.add(obj)
    return sorted(accumulator)


def _create_placeholder_pdf(output_path: Path, message: str) -> None:
    image = Image.new("RGB", (595, 842), color="white")  # A4 portrait roughly
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    wrapped = textwrap.fill(message, width=40)
    draw.multiline_text((40, 200), wrapped, fill="black", font=font, spacing=4)
    image.save(output_path, format="PDF")


def _combine_visuals_into_pdf(visual_paths: Sequence[str], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = PdfWriter()
    temp_files: List[Path] = []

    try:
        for visual in visual_paths:
            path = Path(visual)
            suffix = path.suffix.lower()
            if suffix == ".pdf":
                try:
                    reader = PdfReader(str(path))
                    for page in reader.pages:
                        writer.add_page(page)
                except Exception as pdf_err:
                    logger.warning("Failed to merge PDF %s: %s", path, pdf_err)
            elif suffix in {".png", ".jpg", ".jpeg"}:
                try:
                    img = Image.open(path)
                    if img.mode in {"RGBA", "LA"}:
                        img = img.convert("RGB")
                    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                        temp_path = Path(tmp.name)
                    img.save(temp_path, format="PDF")
                    temp_files.append(temp_path)
                    reader = PdfReader(str(temp_path))
                    for page in reader.pages:
                        writer.add_page(page)
                except Exception as img_err:
                    logger.warning("Failed to process image %s: %s", path, img_err)
            else:
                logger.debug("Ignoring unsupported visual file: %s", path)

        if writer.get_num_pages() == 0:
            _create_placeholder_pdf(output_path, "No visualisations were generated during this analysis.")
        else:
            with output_path.open("wb") as handle:
                writer.write(handle)
    finally:
        for temp_path in temp_files:
            temp_path.unlink(missing_ok=True)


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
        self._visuals: List[str] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, command: str) -> AnalysisResult:
        self.user_io.display(f"Received command: {command}")
        self._sync_builder_context()
        plan = self._obtain_confirmed_plan(command)

        self._logs.clear()
    self._figures: List[str] = []
        self._context.clear()
        initial_context = self.plan_builder.get_context()
        if initial_context:
            self._context.update(initial_context)
            if "adata_path" in self._context and "adata_id" not in self._context:
                self._context["adata_id"] = self._context["adata_path"]

        for step in plan:
            params = self._gather_step_parameters(step)
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
                        artifacts=[],
                    )
                )
                continue

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

            if status != "success":
                if not self.user_io.confirm(CONFIRM_MESSAGES["failure_continue"], default=False):
                    break
            else:
                self._update_context_after_success(step, params, result)
                self._sync_builder_context()

        output_root = self._determine_output_root()
        output_root.mkdir(parents=True, exist_ok=True)

        report_path = output_root / "analysis_report.txt"
        pdf_path = output_root / "analysis_figures.pdf"
        log_path = output_root / "analysis_log.json"

    render_text_report(command, plan, self._logs, report_path, figures=self._figures)
    serialise_logs(self._logs, log_path)
    unique_figures = sorted(dict.fromkeys(self._figures))
    figures_to_pdf(unique_figures, pdf_path)

        return AnalysisResult(
            report_path=report_path,
            pdf_path=pdf_path,
            log_path=log_path,
            plan=plan,
            logs=list(self._logs),
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _obtain_confirmed_plan(self, command: str) -> List[PlanStep]:
        self._sync_builder_context()
        plan = self.plan_builder.build(command)
        while True:
            plan = self._ensure_bundle_integrity(plan)
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
                plan = self._ensure_bundle_integrity(plan)
                if not plan:
                    self.user_io.display(INFO_MESSAGES["all_steps_removed"])
                    self._sync_builder_context()
                    plan = self.plan_builder.build(command)
                    continue

            available = {
                ident: step
                for ident, step in self.plan_builder.optional_steps.items()
                if all(existing.identifier != ident for existing in plan)
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
                    plan = self._ensure_bundle_integrity(plan)
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

    def _gather_step_parameters(self, step: PlanStep) -> Dict[str, Any]:
        while True:
            params = self._collect_parameters(step)
            try:
                prepared_params, display_meta = self._prepare_parameters(step, params)
            except ValueError as exc:
                self.user_io.display(
                    TEMPLATE_ERROR_MESSAGES["parameter_preparation_failed"].format(error=exc)
                )
                continue
            summary_payload = dict(prepared_params)
            summary_payload.update(display_meta)
            self._display_parameter_summary(step, summary_payload)
            return prepared_params

    def _display_parameter_summary(self, step: PlanStep, params: Dict[str, Any]) -> None:
        serialisable: Dict[str, Any] = {}
        for key, value in params.items():
            if key == "marker_sets" and isinstance(value, dict):
                cell_types = list(value.keys())
                serialisable[key] = {
                    "cell_type_count": len(cell_types),
                    "preview": cell_types[:5],
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
                    params["marker_sets"] = None
                    marker_source = "auto-recommend"
            expected = params.get("expected_types")
            if isinstance(expected, str):
                choices = [item.strip() for item in expected.split(",") if item.strip()]
                params["expected_types"] = choices if choices else None
            elif expected is not None and not isinstance(expected, list):
                params["expected_types"] = list(expected)
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

        return params, display_meta

    def _collect_parameters(self, step: PlanStep) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        for prompt in step.param_prompts:
            default = self._context.get(prompt.context_key or prompt.name, prompt.default)
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
                params[prompt.name] = value
                if isinstance(value, Path):
                    params[prompt.name] = str(value)

        return params

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

    def _update_context_after_success(
        self,
        step: PlanStep,
        params: Dict[str, Any],
        result: Dict[str, Any],
    ) -> None:
        if "adata_id" in params:
            self._context["adata_id"] = params["adata_id"]
            self._context.setdefault("adata_path", params["adata_id"])
        if "file_path" in params:
            self._context["adata_id"] = params["file_path"]
            self._context["adata_path"] = params["file_path"]
        if result.get("output_data"):
            self._context["adata_id"] = result["output_data"]
        if result.get("domain_assignments"):
            self._context["last_domain_assignments"] = result["domain_assignments"]
        if step.identifier == "cell_typing":
            if result.get("marker_sets"):
                self._context["marker_sets"] = result["marker_sets"]
            elif params.get("marker_sets"):
                self._context["marker_sets"] = params["marker_sets"]
            if params.get("tissue_type"):
                self._context["tissue_type"] = params["tissue_type"]
            if params.get("expected_types"):
                self._context["expected_cell_types"] = params["expected_types"]

    def _determine_output_root(self) -> Path:
        dataset_path = self._context.get("adata_id") or self._context.get("adata_path")
        if dataset_path:
            base_dir = Path(dataset_path).resolve().parent
        else:
            base_dir = Path.cwd()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return base_dir / f"analysis_agent_{timestamp}"

__all__ = [
    "BioAnalysisAgent",
    "ConsoleUserIO",
    "ExecutionLogEntry",
    "UserIO",
    "PlanBuilder",
    "PlanStep",
    "ParameterPrompt",
    "AnalysisResult",
    "create_plan_builder",
    "resolve_dataset_path",
]
