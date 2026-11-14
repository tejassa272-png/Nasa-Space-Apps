"""
AstroTwin - LangGraph triage workflow (Judge's Sandbox)

Graph:
                        +--> nominal ---------------------------> END
  assess -> retrieve ---+
                        +--> generate (Ollama) --ok--------------> END
                                       |
                                       +--fail--> fallback -----> END

- assess    : runs the Multi-Stressor Synergy Engine
- retrieve  : picks guideline snippets for the systems at risk
              (placeholder dictionary now, swap for ChromaDB search later)
- generate  : asks the local Ollama model for a JSON triage protocol
- fallback  : rule-based protocol, used when Ollama is offline or returns bad JSON
              (so the demo NEVER breaks in front of the judges)

Settings come from environment variables (read at call time):
  OLLAMA_BASE_URL  default http://localhost:11434   (docker compose sets http://ollama:11434)
  OLLAMA_MODEL     default llama3.2:3b
  OLLAMA_TIMEOUT   default 90 (seconds)
"""
import json
import os
import time
from typing import Any, Dict, List, Optional, TypedDict

import requests
from langgraph.graph import END, StateGraph

from .engine import assess


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
def _cfg():
    return (
        os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/"),
        os.getenv("OLLAMA_MODEL", "llama3.2:3b"),
        float(os.getenv("OLLAMA_TIMEOUT", "90")),
    )


# --------------------------------------------------------------------------
# Graph state
# --------------------------------------------------------------------------
class TriageState(TypedDict, total=False):
    inputs: Dict[str, float]
    assessment: Dict[str, Any]
    guidelines: List[str]
    protocol: Dict[str, Any]
    protocol_source: str          # "llm" | "rule_based" | "nominal"
    llm_error: Optional[str]


# --------------------------------------------------------------------------
# Guideline snippets (PLACEHOLDER - replace with a ChromaDB query over the
# NASA HRP documents later). Generic on purpose: demo only, not medical advice.
# Order matters: the FIRST line of each list is a "monitor" step (used by the
# rule-based fallback), the second is an "action" step.
# --------------------------------------------------------------------------
GUIDELINES: Dict[str, List[str]] = {
    "brain": [
        "Run a quick cognitive check (reaction time / attention test) at the start of each work shift.",
        "Postpone high-stakes tasks or use two-person verification while cognitive risk is elevated.",
    ],
    "eyes": [
        "Do a vision check and log headaches or blurred vision every day.",
        "Schedule an eye-pressure / optic-disc exam with the flight surgeon.",
    ],
    "heart": [
        "Track resting heart rate and blood pressure trends twice a day.",
        "Limit strenuous work until the readings are stable.",
    ],
    "lungs": [
        "Monitor breathing rate and record headaches or shortness of breath.",
        "Check the CO2 scrubber and raise cabin ventilation.",
    ],
    "musculoskeletal": [
        "Keep the daily resistance and cardio exercise protocol and log missed sessions.",
        "Review bone and muscle loss countermeasures with the flight surgeon.",
    ],
    "immune": [
        "Watch for signs of infection and protect the sleep schedule.",
        "Use the shielded area during radiation peaks and limit EVA time.",
    ],
}


# --------------------------------------------------------------------------
# Nodes
# --------------------------------------------------------------------------
def node_assess(state: TriageState) -> Dict[str, Any]:
    return {"assessment": assess(state["inputs"])}


def node_retrieve(state: TriageState) -> Dict[str, Any]:
    snippets: List[str] = []
    for key in state["assessment"]["at_risk"][:4]:
        snippets.extend(GUIDELINES.get(key, [])[:2])
    return {"guidelines": snippets}


def route_after_retrieve(state: TriageState) -> str:
    return "generate" if state["assessment"]["at_risk"] else "nominal"


def node_nominal(state: TriageState) -> Dict[str, Any]:
    return {
        "protocol": {
            "summary": "All monitored body systems are in the nominal range. No corrective action is needed.",
            "immediate_actions": ["Continue the routine daily schedule.", "Keep the normal exercise and sleep protocol."],
            "monitoring": ["Routine daily health check-in."],
            "escalate_if": ["Any body system turns yellow (advisory) or worse."],
        },
        "protocol_source": "nominal",
        "llm_error": None,
    }


def _build_prompt(state: TriageState) -> str:
    a = state["assessment"]
    inp = a["inputs"]
    lines = [
        "You are AstroTwin, an onboard decision-support assistant for a SIMULATED deep-space mission "
        "(hackathon demo, not real medical advice).",
        "Write a short triage protocol for the crew. Reply with ONLY a JSON object with these keys:",
        '  "summary": string, max 2 sentences',
        '  "immediate_actions": list of 3 to 5 short strings',
        '  "monitoring": list of 2 to 4 short strings',
        '  "escalate_if": list of 2 to 3 short strings',
        "",
        "Current conditions:",
        f"- Cabin CO2: {inp['cabin_co2_ppm']:.0f} ppm",
        f"- Solar radiation: {inp['radiation_flux']:.1f} mSv/day",
        f"- Days in space: {inp['days_in_space']:.0f}",
        f"- Sleep: {inp['sleep_hours']:.1f} h/night",
        f"- Overall status: {a['overall']['status'].upper()} (score {a['overall']['score']}/100)",
        "",
        "Body systems at risk (score out of 100):",
    ]
    for key in a["at_risk"]:
        s = a["systems"][key]
        lines.append(f"- {s['label']}: {s['score']} ({s['status']}), main drivers: {', '.join(s['drivers']) or 'none'}")
    if a["active_synergies"]:
        lines.append("")
        lines.append("Stressors that make each other worse (synergy):")
        for syn in a["active_synergies"][:3]:
            lines.append(f"- {syn['name']}: {' + '.join(syn['stressors'])}")
    if state.get("guidelines"):
        lines.append("")
        lines.append("Reference guidelines you may use:")
        lines.extend(f"- {g}" for g in state["guidelines"])
    return "\n".join(lines)


def _extract_json(text: str) -> Dict[str, Any]:
    """Parse JSON; if the model added extra text, cut from the first { to the last }."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(text[start:end + 1])


def _clean_list(value: Any, limit: int) -> List[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [str(v).strip() for v in value if str(v).strip()][:limit]


def _normalize_protocol(data: Dict[str, Any]) -> Dict[str, Any]:
    protocol = {
        "summary": str(data.get("summary", "")).strip(),
        "immediate_actions": _clean_list(data.get("immediate_actions"), 5),
        "monitoring": _clean_list(data.get("monitoring"), 4),
        "escalate_if": _clean_list(data.get("escalate_if"), 3),
    }
    if not protocol["summary"] or not protocol["immediate_actions"]:
        raise ValueError("LLM JSON is missing summary or immediate_actions")
    return protocol


def _call_ollama(prompt: str) -> Dict[str, Any]:
    base, model, timeout = _cfg()
    resp = requests.post(
        f"{base}/api/generate",
        json={
            "model": model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.2, "num_predict": 450},
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    return _extract_json(resp.json().get("response", ""))


def node_generate(state: TriageState) -> Dict[str, Any]:
    try:
        protocol = _normalize_protocol(_call_ollama(_build_prompt(state)))
        return {"protocol": protocol, "protocol_source": "llm", "llm_error": None}
    except Exception as exc:  # network, timeout, bad JSON ... anything -> go to fallback
        return {"llm_error": f"{type(exc).__name__}: {exc}"}


def route_after_generate(state: TriageState) -> str:
    return "ok" if state.get("protocol") else "fallback"


def node_fallback(state: TriageState) -> Dict[str, Any]:
    a = state["assessment"]
    lv = a["stressor_levels"]
    actions: List[str] = []
    if lv["cabin_co2_ppm"] >= 0.3:
        actions.append("Check the CO2 scrubber and increase cabin ventilation.")
    if lv["radiation_flux"] >= 0.3:
        actions.append("Move the crew to the shielded area and pause EVA until radiation drops.")
    if lv["sleep_hours"] >= 0.3:
        actions.append("Protect an uninterrupted sleep period and postpone non-critical tasks.")
    if lv["days_in_space"] >= 0.5:
        actions.append("Keep the daily exercise protocol to slow bone and muscle loss.")
    actions.append("Notify the flight surgeon with the current readings.")

    top = [a["systems"][k]["label"] for k in a["at_risk"][:3]]
    synergy = a["active_synergies"][0]["name"] if a["active_synergies"] else None
    summary = f"{a['overall']['status'].upper()}: {', '.join(top)} under stress."
    if synergy:
        summary += f" Stressors are compounding ({synergy})."

    monitoring = [GUIDELINES[k][0] for k in a["at_risk"][:3] if k in GUIDELINES] or ["Routine daily health check-in."]
    return {
        "protocol": {
            "summary": summary,
            "immediate_actions": actions[:5],
            "monitoring": monitoring[:4],
            "escalate_if": [
                "Any body system reaches critical (red).",
                "Severe headache, confusion, chest pain or vision changes appear.",
                "No improvement after 24 hours of corrective actions.",
            ],
        },
        "protocol_source": "rule_based",
    }


# --------------------------------------------------------------------------
# Build + run
# --------------------------------------------------------------------------
def build_graph():
    g = StateGraph(TriageState)
    g.add_node("assess", node_assess)
    g.add_node("retrieve", node_retrieve)
    g.add_node("nominal", node_nominal)
    g.add_node("generate", node_generate)
    g.add_node("fallback", node_fallback)

    g.set_entry_point("assess")
    g.add_edge("assess", "retrieve")
    g.add_conditional_edges("retrieve", route_after_retrieve, {"nominal": "nominal", "generate": "generate"})
    g.add_conditional_edges("generate", route_after_generate, {"ok": END, "fallback": "fallback"})
    g.add_edge("nominal", END)
    g.add_edge("fallback", END)
    return g.compile()


_GRAPH = None


def get_graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_graph()
    return _GRAPH


def run_triage(inputs: Dict[str, Any]) -> Dict[str, Any]:
    started = time.perf_counter()
    final = get_graph().invoke({"inputs": inputs})
    source = final["protocol_source"]
    return {
        "assessment": final["assessment"],
        "guidelines": final.get("guidelines", []),
        "protocol": final["protocol"],
        "protocol_source": source,
        "model": _cfg()[1] if source == "llm" else None,
        "llm_error": final.get("llm_error"),
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
    }
