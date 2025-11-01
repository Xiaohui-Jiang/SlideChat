from __future__ import annotations

from pathlib import Path
from typing import Optional, Union
import shutil


_ARTIFACT_ROOT = Path(__file__).resolve().parent / "artifacts"


def persist_artifact(source: Union[str, Path], category: str, rename: Optional[str] = None) -> Optional[Path]:
    """Copy a generated artifact into a persistent test artifacts directory.

    Args:
        source: File path to copy. If the file does not exist, the function is a no-op.
        category: Subdirectory name under the artifacts folder to help group related outputs.
        rename: Optional new file name. If omitted, the original file name is preserved.

    Returns:
        Path to the copied artifact relative to the repository, or ``None`` if the source did
        not exist at the time of copying.
    """
    src_path = Path(source)
    if not src_path.exists():
        return None

    target_dir = _ARTIFACT_ROOT / category
    target_dir.mkdir(parents=True, exist_ok=True)

    target_name = rename or src_path.name
    target_path = target_dir / target_name

    shutil.copy2(src_path, target_path)
    return target_path
