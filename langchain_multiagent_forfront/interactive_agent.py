"""Run the BioAnalysisAgent with verbose console interaction."""
from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import List, Optional, Sequence

import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from langchain_multiagent.agent import (
    BioAnalysisAgent,
    ConsoleUserIO,
    create_plan_builder,
    resolve_dataset_path,
)


class VerboseConsoleUserIO(ConsoleUserIO):
    """Console interaction that prefixes exchanged messages for clarity."""

    def display(self, message: str) -> None:
        print(f"[AGENT] {message}")

    def prompt(self, message: str) -> str:
        print(f"[PROMPT] {message}")
        return input("> ")

    def confirm(self, message: str, default: bool = True) -> bool:
        suffix = "[Y/n]" if default else "[y/N]"
        while True:
            print(f"[CONFIRM] {message} {suffix}")
            response = input("> ").strip().lower()
            if not response:
                return default
            if response in {"y", "yes"}:
                return True
            if response in {"n", "no"}:
                return False
            print("[INFO] Please respond with 'y' or 'n'.")


class AutoConsoleUserIO(VerboseConsoleUserIO):
    """Non-interactive mode that accepts defaults without prompting."""

    def __init__(self, echo: bool = True) -> None:
        self._echo = echo

    def display(self, message: str) -> None:
        if self._echo:
            super().display(message)

    def prompt(self, message: str) -> str:
        if self._echo:
            print(f"[PROMPT] {message}")
            print("[AUTO] Using default/empty response.")
        return ""

    def confirm(self, message: str, default: bool = True) -> bool:
        if self._echo:
            decision = "accept" if default else "decline"
            suffix = "[Y/n]" if default else "[y/N]"
            print(f"[CONFIRM] {message} {suffix}")
            print(f"[AUTO] Auto-{decision} using default.")
        return default


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Interactive runner for BioAnalysisAgent.")
    parser.add_argument("--data", 
                        default="./langchain_multiagent_forfront/20k_NSCLC_DTC_3p_nextgem_intron_donor_1_count_sample_feature_bc_matrix.h5",
                        help="Path to the dataset. If omitted, you will be prompted interactively.")
    parser.add_argument(
        "--command",
        default="perform single-cell analysis on this lung nsclc sample",
        help="High-level command passed to the agent.",
    )
    parser.add_argument(
        "--planner",
        choices=["static", "llm"],
        default="llm",
        help="Choose the plan construction strategy (default: llm).",
    )
    parser.add_argument(
        "--include-step",
        action="append",
        dest="include_steps",
        default=None,
        help="Optional step identifier to ensure inclusion when using the LLM planner (can be repeated).",
    )
    parser.add_argument(
        "--auto",
        action="store_true",
        help="Run non-interactively by auto-accepting prompts and defaults.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress console chatter and downgrade logging to warnings (requires --auto).",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> None:
    args = parse_args(argv)
    if args.quiet and not args.auto:
        raise SystemExit("--quiet currently requires --auto mode to avoid missing prompts.")

    if args.quiet:
        logging.getLogger().setLevel(logging.WARNING)
        logging.getLogger("langchain_multiagent").setLevel(logging.WARNING)

    user_io = AutoConsoleUserIO(echo=not args.quiet) if args.auto else VerboseConsoleUserIO()

    dataset_path = resolve_dataset_path(args.data, user_io)
    include_steps: List[str] = args.include_steps or []

    planner_context = {
        "adata_path": dataset_path,
        "extra_context": args.command,
        "required_steps": include_steps,
    }

    plan_builder = create_plan_builder(args.planner, include_steps, planner_context)

    user_io.display("Launching BioAnalysisAgent. Follow the prompts below.")
    if args.planner == "llm":
        user_io.display("Planner mode: LLM-driven. Ensure your API credentials are configured.")
    else:
        user_io.display("Planner mode: static. You can add/remove optional steps during confirmation.")

    agent = BioAnalysisAgent(user_io=user_io, plan_builder=plan_builder)
    result = agent.run(args.command)

    user_io.display("Execution finished. Output locations:")
    user_io.display(f"- Report: {result.report_path}")
    user_io.display(f"- Figures PDF: {result.pdf_path}")
    user_io.display(f"- Log JSON: {result.log_path}")


if __name__ == "__main__":
    main()
