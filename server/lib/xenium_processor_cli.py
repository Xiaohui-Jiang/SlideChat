#!/usr/bin/env python3
"""Command-line bridge for XeniumProcessor actions.

This lightweight CLI is invoked from the Node.js backend (see xeniumService.js)
with a JSON-encoded command describing the operation to perform.
"""

import argparse
import json
import sys
from typing import Any, Dict

from xenium_processor import XeniumProcessor


def _error(message: str, **extra: Any) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"success": False, "error": message}
    payload.update(extra)
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Invoke XeniumProcessor actions")
    parser.add_argument("--upload-dir", required=True, help="Directory containing uploaded assets")
    parser.add_argument("--output-dir", required=True, help="Directory for processed artifacts")
    parser.add_argument(
        "--command",
        required=True,
        help="JSON payload containing an 'action' field and associated parameters",
    )

    args = parser.parse_args()

    try:
        command = json.loads(args.command)
    except json.JSONDecodeError as exc:
        print(json.dumps(_error(f"Invalid command JSON: {exc}")))
        return 0

    action = command.get("action")
    if not action:
        print(json.dumps(_error("Missing 'action' in command")))
        return 0

    processor = XeniumProcessor(args.upload_dir, args.output_dir)

    try:
        if action == "preprocess":
            result = processor.preprocess_dataset(
                slide_id=command.get("slide_id"),
                matrix_path=command.get("matrix_path"),
                cells_path=command.get("cells_path"),
                alignment_path=command.get("alignment_path"),
                image_path=command.get("image_path"),
            )
        elif action == "add_roi":
            result = processor.add_roi(
                slide_id=command.get("slide_id"),
                roi_name=command.get("roi_name"),
                roi_vertices_pixels=command.get("roi_vertices"),
            )
        elif action == "delete_roi":
            result = processor.delete_roi(
                slide_id=command.get("slide_id"),
                roi_name=command.get("roi_name"),
            )
        elif action == "get_roi_list":
            result = processor.get_roi_list(slide_id=command.get("slide_id"))
        elif action == "get_overlay":
            result = processor.get_cell_overlay_data(
                slide_id=command.get("slide_id"),
                downsample=int(command.get("downsample", 1) or 1),
            )
        elif action == "get_h5ad_path":
            h5ad_path = processor.get_h5ad_path(slide_id=command.get("slide_id"))
            if h5ad_path:
                result = {"success": True, "slide_id": command.get("slide_id"), "h5ad_path": h5ad_path}
            else:
                result = _error("Dataset not found", slide_id=command.get("slide_id"))
        else:
            result = _error(f"Unknown action: {action}")
    except Exception as exc:  # pylint: disable=broad-except
        result = _error(str(exc), action=action, slide_id=command.get("slide_id"))

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
