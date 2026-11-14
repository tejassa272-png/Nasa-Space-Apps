"""
FastAPI routes for the Judge's Sandbox.

  GET  /api/sandbox/sliders   -> slider ranges + one-click scenario presets
  POST /api/sandbox/simulate  -> instant risk scores + colours (no LLM). Call on every slider move.
  POST /api/sandbox/triage    -> same + LangGraph triage protocol. Call when the slider is released.
"""
from typing import Any, Dict

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .engine import PRESETS, SLIDERS, assess
from .triage_graph import run_triage

router = APIRouter(prefix="/api/sandbox", tags=["judge-sandbox"])


def _slider_field(key: str):
    s = SLIDERS[key]
    return Field(default=s["default"], ge=s["min"], le=s["max"], description=f"{s['label']} ({s['unit']})")


class SandboxInput(BaseModel):
    cabin_co2_ppm: float = _slider_field("cabin_co2_ppm")
    radiation_flux: float = _slider_field("radiation_flux")
    days_in_space: float = _slider_field("days_in_space")
    sleep_hours: float = _slider_field("sleep_hours")


@router.get("/sliders")
def get_sliders() -> Dict[str, Any]:
    return {"sliders": SLIDERS, "presets": PRESETS}


@router.post("/simulate")
def simulate(payload: SandboxInput) -> Dict[str, Any]:
    return assess(payload.model_dump())


# Plain `def` (not async): FastAPI runs it in a worker thread, so the slow
# Ollama call does not block other requests.
@router.post("/triage")
def triage(payload: SandboxInput) -> Dict[str, Any]:
    return run_triage(payload.model_dump())
