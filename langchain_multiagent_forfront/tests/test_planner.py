"""Tests for the planner module."""
from __future__ import annotations

import json

import pytest

from langchain_multiagent.planner import LLMPlanBuilder


class DummyLLM:
    """A minimal runnable stub returning predetermined JSON payloads."""

    def __init__(self, payloads: list[str]) -> None:
        self._payloads = list(payloads)

    def invoke(self, _messages):  # type: ignore[override]
        if not self._payloads:
            raise RuntimeError("No payloads left to return")
        content = self._payloads.pop(0)
        return type("LLMResult", (), {"content": content})()


def _plan_identifiers(plan):
    return [step.identifier for step in plan]


def test_llm_plan_builder_uses_llm_plan(monkeypatch):
    payload = json.dumps(
        {
            "steps": [
                {"identifier": "metadata"},
                {"identifier": "preprocess"},
                {"identifier": "cell_typing"},
            ]
        }
    )
    builder = LLMPlanBuilder(llm=DummyLLM([payload]))
    builder.set_context({"adata_path": "dummy.h5ad"})

    plan = builder.build("Analyse the lung sample")

    assert _plan_identifiers(plan) == [
        "metadata",
        "preprocess",
        "cell_typing",
    ]


def test_llm_plan_builder_falls_back_on_invalid_json(monkeypatch):
    builder = LLMPlanBuilder(llm=DummyLLM(["not-json"]))
    builder.set_context({})

    plan = builder.build("Analyse sample")

    assert _plan_identifiers(plan) == ["metadata", "preprocess"]
