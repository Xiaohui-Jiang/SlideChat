import json

from langchain_core.messages import AIMessage

from langchain_multiagent.biotools import CellTypingTool, _recommend_marker_sets


class DummyLLM:
    """Deterministic stand-in for ChatOpenAI used in unit tests."""

    def invoke(self, messages, config=None):
        payload = {
            "T cells": {
                "positive": ["CD3D", "CD3E", "CD4"],
                "negative": ["CD19"],
                "rationale": "Classic T cell receptor components",
            },
            "B cells": {
                "positive": ["CD19", "MS4A1"],
                "negative": ["CD3D"],
                "rationale": "Canonical B cell surface markers",
            },
            "NK cells": {
                "positive": ["NCAM1", "FCGR3A"],
                "negative": ["CD3D", "CD19"],
                "rationale": "Natural killer cell receptors",
            },
        }
        return AIMessage(content=json.dumps(payload))


def test_auto_marker_recommendation_generates_marker_sets():
    tool = CellTypingTool(llm=DummyLLM())

    recommendation = _recommend_marker_sets(
        tool,
        tissue_type="lung",
        expected_types=["T cells", "B cells"],
    )

    marker_sets = recommendation["marker_sets"]
    assert set(marker_sets.keys()) == {"T cells", "B cells"}
    assert all(markers["positive"] for markers in marker_sets.values())
    assert recommendation["summary_text"].startswith("Recommended marker panels")


def test_custom_markers_are_merged():
    tool = CellTypingTool(llm=DummyLLM())
    custom_markers = {"T cells": {"positive": ["CD2"], "negative": []}}

    recommendation = _recommend_marker_sets(
        tool,
        tissue_type="lung",
        expected_types=["T cells"],
        custom_markers=custom_markers,
    )

    merged = recommendation["marker_sets"]["T cells"]
    assert "CD2" in merged["positive"]