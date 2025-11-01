"""Utilities for managing analysis reports and figure outputs."""
from __future__ import annotations

from typing import Any, Iterable, List, Optional, Sequence, TYPE_CHECKING, Union

from pathlib import Path
import json
import logging
import tempfile

from matplotlib.figure import Figure
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter, Transformation

try:
    RESAMPLE_LANCZOS = Image.Resampling.LANCZOS  # type: ignore[attr-defined]
except AttributeError:  # Pillow < 10
    RESAMPLE_LANCZOS = Image.LANCZOS  # type: ignore[attr-defined]

TARGET_PAGE_WIDTH_PT = 595
TARGET_PAGE_HEIGHT_PT = 842
TARGET_IMAGE_WIDTH = 1400
TARGET_IMAGE_HEIGHT = int(round(TARGET_IMAGE_WIDTH * TARGET_PAGE_HEIGHT_PT / TARGET_PAGE_WIDTH_PT))

if TYPE_CHECKING:  # pragma: no cover - import cycles avoided at runtime
    from .agent import ExecutionLogEntry
    from .planner import PlanStep

LOGGER = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Figure helpers
# ---------------------------------------------------------------------------


def ensure_directory(path: Union[str, Path]) -> Path:
    """Return the path with parents created."""

    resolved = Path(path)
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def _append_scaled_page(writer: PdfWriter, page: "PageObject") -> None:  # pragma: no cover - PDF layout helper
    try:
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
    except Exception:
        writer.add_page(page)
        return

    if width <= 0 or height <= 0:
        writer.add_page(page)
        return

    scale = min(TARGET_PAGE_WIDTH_PT / width, TARGET_PAGE_HEIGHT_PT / height)
    new_width = width * scale
    new_height = height * scale
    translate_x = (TARGET_PAGE_WIDTH_PT - new_width) / 2.0
    translate_y = (TARGET_PAGE_HEIGHT_PT - new_height) / 2.0

    blank_page = writer.add_blank_page(width=TARGET_PAGE_WIDTH_PT, height=TARGET_PAGE_HEIGHT_PT)
    transformation = Transformation().scale(scale, scale).translate(translate_x, translate_y)
    try:
        blank_page.merge_transformed_page(page, transformation)
    except Exception:
        # Fallback: if transformation merge fails, add the original page instead
        writer.pages.pop()  # remove blank page we just added
        writer.add_page(page)


def save_figure(figure: Figure, output_path: Union[str, Path], close: bool = True, tight_layout: bool = True) -> Path:
    """Persist a Matplotlib figure using consistent defaults.

    Parameters
    ----------
    figure:
        Matplotlib figure to persist.
    output_path:
        Destination path for the saved figure.
    close:
        When ``True`` (default) the figure is closed after saving to release resources.
    tight_layout:
        Apply ``tight_layout`` prior to saving to reduce clipping.
    """

    destination = ensure_directory(output_path)
    if tight_layout:
        try:
            figure.tight_layout()
        except Exception as exc:  # noqa: BLE001
            LOGGER.debug("tight_layout failed for %s: %s", destination, exc)
    figure.savefig(destination, dpi=150)
    if close:
        import matplotlib.pyplot as plt  # local import to avoid unused dependency

        plt.close(figure)
    return destination


# ---------------------------------------------------------------------------
# Figure aggregation
# ---------------------------------------------------------------------------


def collect_figure_paths(
    payload: Any,
    accumulator: Optional[List[str]] = None,
    seen: Optional[set[str]] = None,
) -> List[str]:
    """Walk an arbitrary payload and return figure paths in discovery order."""

    if accumulator is None:
        accumulator = []
    if seen is None:
        seen = set()

    if isinstance(payload, dict):
        for value in payload.values():
            collect_figure_paths(value, accumulator, seen)
    elif isinstance(payload, (list, tuple, set)):
        for value in payload:
            collect_figure_paths(value, accumulator, seen)
    elif isinstance(payload, str):
        suffix = Path(payload).suffix.lower()
        if suffix in {".png", ".jpg", ".jpeg", ".pdf"} and Path(payload).exists():
            if payload not in seen:
                seen.add(payload)
                accumulator.append(payload)

    return accumulator


def _create_placeholder_pdf(output_path: Path, message: str) -> None:
    image = Image.new("RGB", (595, 842), color="white")  # A4 portrait roughly
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    draw.multiline_text((40, 200), message, fill="black", font=font, spacing=4)
    image.save(output_path, format="PDF")


def figures_to_pdf(figure_paths: Iterable[str], output_path: Union[str, Path], placeholder_message: str = "No figures were generated during this analysis.") -> Path:
    """Combine one or more raster/PDF figures into a single multipage PDF."""

    destination = ensure_directory(output_path)
    writer = PdfWriter()
    temp_files: List[Path] = []

    try:
        for figure in figure_paths:
            path = Path(figure)
            suffix = path.suffix.lower()
            if suffix == ".pdf":
                try:
                    reader = PdfReader(str(path))
                    for page in reader.pages:
                        _append_scaled_page(writer, page)
                except Exception as exc:  # noqa: BLE001
                    LOGGER.warning("Failed to merge PDF %s: %s", path, exc)
            elif suffix in {".png", ".jpg", ".jpeg"}:
                try:
                    image = Image.open(path)
                    if image.mode in {"RGBA", "LA"}:
                        image = image.convert("RGB")
                    orig_width, orig_height = image.size
                    if orig_width > 0 and orig_height > 0:
                        scale = TARGET_IMAGE_WIDTH / float(orig_width)
                        new_width = TARGET_IMAGE_WIDTH
                        new_height = max(1, int(round(orig_height * scale)))
                        image = image.resize((new_width, new_height), RESAMPLE_LANCZOS)
                    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                        temp_path = Path(tmp.name)
                    image.save(temp_path, format="PDF")
                    temp_files.append(temp_path)
                    reader = PdfReader(str(temp_path))
                    for page in reader.pages:
                        _append_scaled_page(writer, page)
                except Exception as exc:  # noqa: BLE001
                    LOGGER.warning("Failed to convert image %s to PDF: %s", path, exc)
            else:
                LOGGER.debug("Ignoring unsupported figure file: %s", path)

        if writer.get_num_pages() == 0:
            _create_placeholder_pdf(destination, placeholder_message)
        else:
            with destination.open("wb") as handle:
                writer.write(handle)
    finally:
        for temp_path in temp_files:
            temp_path.unlink(missing_ok=True)

    return destination


# ---------------------------------------------------------------------------
# Report composition
# ---------------------------------------------------------------------------


def render_text_report(
    command: str,
    plan: Sequence["PlanStep"],
    logs: Sequence["ExecutionLogEntry"],
    report_path: Union[str, Path],
    figures: Optional[Sequence[str]] = None,
) -> Path:
    """Write the human-readable analysis report."""

    destination = ensure_directory(report_path)
    lines = [f"Analysis command: {command}", ""]
    lines.append("Execution plan:")
    for idx, step in enumerate(plan, start=1):
        lines.append(f"  {idx}. {step.title}")
    lines.append("")
    lines.append("Execution log:")
    for entry in logs:
        lines.append(f"- {entry.step_title}: {entry.status}")
        if entry.summary:
            lines.append(f"  Summary: {entry.summary}")
        if entry.error:
            lines.append(f"  Error: {entry.error}")
    if not figures:
        lines.append("")
        lines.append("No figures were generated during this analysis.")

    destination.write_text("\n".join(lines), encoding="utf-8")
    return destination


def serialise_logs(logs: Sequence["ExecutionLogEntry"], output_path: Union[str, Path]) -> Path:
    """Persist execution details to JSON."""

    payload = [
        {
            "step_id": entry.step_id,
            "step_title": entry.step_title,
            "status": entry.status,
            "parameters": entry.parameters,
            "summary": entry.summary,
            "figures": entry.figures,
            "error": entry.error,
        }
        for entry in logs
    ]
    destination = ensure_directory(output_path)
    destination.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return destination
