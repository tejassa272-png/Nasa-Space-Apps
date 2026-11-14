"""
AstroTwin - Multi-Stressor Synergy Engine (Judge's Sandbox)

Pure Python, NO external dependencies, runs in Google Colab and Docker alike.
Fast (microseconds), so the frontend can call it on every slider move.

IMPORTANT: all thresholds, sensitivities and synergy weights below are DEMO
values for a hackathon simulator. They are not real medical guidance. Replace
them with numbers from the NASA HRP documents in your repo before presenting
them as scientific fact.

How it works
  1. Each slider value is turned into a stress level from 0.0 (fine) to 1.0 (worst).
  2. Each body system has a sensitivity (0..1) to each stressor.
  3. Baseline risk = "at least one stressor hurts" (noisy-OR) of the contributions.
  4. Synergy: when TWO stressors are high together, extra risk is added to the
     systems that both of them hit. This is the "Multi-Stressor Synergy Engine".
  5. Score 0..100 -> status (nominal / advisory / warning / critical) -> colour.
"""
from typing import Any, Dict, List

# --------------------------------------------------------------------------
# Slider definitions (the frontend builds its sliders from these via the API)
# --------------------------------------------------------------------------
SLIDERS: Dict[str, Dict[str, Any]] = {
    "cabin_co2_ppm": {
        "label": "Cabin CO2 Levels", "unit": "ppm",
        "min": 400, "max": 10000, "step": 100, "default": 1000,
    },
    "radiation_flux": {
        "label": "Solar Radiation Flux", "unit": "mSv/day",
        "min": 0.0, "max": 10.0, "step": 0.1, "default": 0.5,
    },
    "days_in_space": {
        "label": "Days in Space", "unit": "days",
        "min": 0, "max": 1000, "step": 5, "default": 30,
    },
    "sleep_hours": {
        "label": "Hours of Sleep", "unit": "h/night",
        "min": 0.0, "max": 12.0, "step": 0.5, "default": 7.5,
    },
}
STRESSORS: List[str] = list(SLIDERS.keys())

# One-click scenarios for the judges' panel
PRESETS: Dict[str, Dict[str, float]] = {
    "Nominal (ISS-like)": {"cabin_co2_ppm": 1000, "radiation_flux": 0.5, "days_in_space": 30, "sleep_hours": 7.5},
    "Scrubber failure": {"cabin_co2_ppm": 6500, "radiation_flux": 0.5, "days_in_space": 120, "sleep_hours": 6.5},
    "Solar flare": {"cabin_co2_ppm": 1500, "radiation_flux": 7.0, "days_in_space": 200, "sleep_hours": 6.0},
    "Mars transit": {"cabin_co2_ppm": 3000, "radiation_flux": 2.5, "days_in_space": 600, "sleep_hours": 6.0},
    "Perfect storm": {"cabin_co2_ppm": 8000, "radiation_flux": 8.0, "days_in_space": 800, "sleep_hours": 3.5},
}

# --------------------------------------------------------------------------
# Body systems = the regions of the 3D Bio-Twin.
# "sens" = how much this system suffers when that stressor is at its worst (0..1)
# --------------------------------------------------------------------------
SYSTEMS: Dict[str, Dict[str, Any]] = {
    "brain": {"label": "Brain / Cognition",
              "sens": {"cabin_co2_ppm": 0.60, "radiation_flux": 0.35, "days_in_space": 0.25, "sleep_hours": 0.65}},
    "eyes": {"label": "Eyes (vision)",
             "sens": {"cabin_co2_ppm": 0.45, "radiation_flux": 0.20, "days_in_space": 0.55, "sleep_hours": 0.20}},
    "heart": {"label": "Heart / Cardiovascular",
              "sens": {"cabin_co2_ppm": 0.25, "radiation_flux": 0.45, "days_in_space": 0.45, "sleep_hours": 0.50}},
    "lungs": {"label": "Lungs / Respiratory",
              "sens": {"cabin_co2_ppm": 0.70, "radiation_flux": 0.25, "days_in_space": 0.20, "sleep_hours": 0.15}},
    "musculoskeletal": {"label": "Bones & Muscles",
                        "sens": {"cabin_co2_ppm": 0.10, "radiation_flux": 0.30, "days_in_space": 0.70, "sleep_hours": 0.30}},
    "immune": {"label": "Immune System",
               "sens": {"cabin_co2_ppm": 0.15, "radiation_flux": 0.55, "days_in_space": 0.40, "sleep_hours": 0.50}},
}

# --------------------------------------------------------------------------
# Synergies: extra risk when BOTH stressors are high at the same time.
# extra risk for a system = coeff * level_a * level_b
# --------------------------------------------------------------------------
SYNERGIES: List[Dict[str, Any]] = [
    {"name": "Oxidative stress amplification",
     "stressors": ("cabin_co2_ppm", "radiation_flux"),
     "description": "High CO2 and radiation together stress cells more than either alone.",
     "targets": {"brain": 0.22, "lungs": 0.18, "eyes": 0.08}},
    {"name": "Cognitive degradation loop",
     "stressors": ("cabin_co2_ppm", "sleep_hours"),
     "description": "Poor sleep makes the brain more sensitive to high CO2, and CO2 worsens sleep quality.",
     "targets": {"brain": 0.25, "heart": 0.08}},
    {"name": "Impaired repair after radiation",
     "stressors": ("radiation_flux", "sleep_hours"),
     "description": "Sleep loss slows the body's repair after radiation exposure.",
     "targets": {"immune": 0.22, "brain": 0.10, "heart": 0.10}},
    {"name": "Cumulative dose burden",
     "stressors": ("radiation_flux", "days_in_space"),
     "description": "Radiation adds up over mission time, so a long mission raises the danger of every exposure.",
     "targets": {"heart": 0.18, "immune": 0.22, "musculoskeletal": 0.10}},
    {"name": "Chronic fatigue accumulation",
     "stressors": ("days_in_space", "sleep_hours"),
     "description": "Months in space with short sleep builds up fatigue that sleep cannot fully clear.",
     "targets": {"brain": 0.12, "heart": 0.12, "musculoskeletal": 0.08}},
    {"name": "Fluid shift + hypercapnia",
     "stressors": ("cabin_co2_ppm", "days_in_space"),
     "description": "Long-term fluid shift plus raised CO2 may add pressure on the eyes and lungs.",
     "targets": {"eyes": 0.22, "lungs": 0.10}},
]

ACTIVE_SYNERGY_LEVEL = 0.35   # both stressors must be at least this high to be shown as "active"

# --------------------------------------------------------------------------
# Status + colour
# --------------------------------------------------------------------------
_STATUS_COLOR_NAME = {"nominal": "green", "advisory": "yellow", "warning": "orange", "critical": "red"}
_COLOR_STOPS = [(0, (34, 197, 94)), (50, (234, 179, 8)), (100, (239, 68, 68))]  # green -> yellow -> red


def status_for(score: float) -> str:
    if score < 25:
        return "nominal"
    if score < 50:
        return "advisory"
    if score < 75:
        return "warning"
    return "critical"


def color_for(score: float) -> str:
    """Smooth green -> yellow -> red hex colour for a 0..100 score."""
    score = max(0.0, min(100.0, score))
    for (s0, c0), (s1, c1) in zip(_COLOR_STOPS, _COLOR_STOPS[1:]):
        if score <= s1:
            t = (score - s0) / (s1 - s0)
            r, g, b = (round(a + (b_ - a) * t) for a, b_ in zip(c0, c1))
            return f"#{r:02x}{g:02x}{b:02x}"
    return "#ef4444"


# --------------------------------------------------------------------------
# Core maths
# --------------------------------------------------------------------------
def _ramp(value: float, low: float, high: float) -> float:
    """0 at or below `low`, 1 at or above `high`, straight line in between."""
    if high <= low:
        return 0.0
    return max(0.0, min(1.0, (value - low) / (high - low)))


def clamp_inputs(raw: Dict[str, Any]) -> Dict[str, float]:
    """Fill missing values with defaults and keep everything inside the slider range."""
    out: Dict[str, float] = {}
    for key, spec in SLIDERS.items():
        value = float(raw.get(key, spec["default"]))
        out[key] = max(spec["min"], min(spec["max"], value))
    return out


def stressor_levels(inputs: Dict[str, float]) -> Dict[str, float]:
    """Slider values -> stress level 0..1 (0 = harmless, 1 = worst)."""
    return {
        "cabin_co2_ppm": _ramp(inputs["cabin_co2_ppm"], 1000, 8000),
        "radiation_flux": _ramp(inputs["radiation_flux"], 0.5, 6.0),
        "days_in_space": _ramp(inputs["days_in_space"], 30, 900),
        # only sleep BELOW 7 hours counts as stress (7h -> 0, 3h or less -> 1)
        "sleep_hours": _ramp(7.0 - inputs["sleep_hours"], 0, 4),
    }


def assess(raw_inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Main entry point. Returns everything the frontend / LangGraph needs."""
    inputs = clamp_inputs(raw_inputs)
    levels = stressor_levels(inputs)

    # 1) synergy extra-risk per system + list of active synergies
    synergy_extra = {key: 0.0 for key in SYSTEMS}
    active: List[Dict[str, Any]] = []
    for syn in SYNERGIES:
        a, b = syn["stressors"]
        strength = levels[a] * levels[b]
        for system_key, coeff in syn["targets"].items():
            synergy_extra[system_key] += coeff * strength
        if levels[a] >= ACTIVE_SYNERGY_LEVEL and levels[b] >= ACTIVE_SYNERGY_LEVEL:
            active.append({
                "name": syn["name"],
                "description": syn["description"],
                "stressors": [SLIDERS[a]["label"], SLIDERS[b]["label"]],
                "affects": [SYSTEMS[k]["label"] for k in syn["targets"]],
                "strength": round(strength, 2),
            })
    active.sort(key=lambda s: s["strength"], reverse=True)

    # 2) per-system score
    systems: Dict[str, Dict[str, Any]] = {}
    for key, spec in SYSTEMS.items():
        contributions = {s: spec["sens"][s] * levels[s] for s in STRESSORS}
        all_fine = 1.0
        for c in contributions.values():
            all_fine *= (1.0 - c)
        baseline = 1.0 - all_fine                      # no-synergy risk
        final = min(1.0, baseline + synergy_extra[key])
        score = round(final * 100, 1)
        base_score = round(baseline * 100, 1)
        drivers = [SLIDERS[s]["label"]
                   for s, c in sorted(contributions.items(), key=lambda kv: -kv[1]) if c >= 0.08][:2]
        status = status_for(score)
        systems[key] = {
            "label": spec["label"],
            "score": score,
            "baseline_score": base_score,
            "synergy_uplift": round(score - base_score, 1),
            "status": status,
            "color_name": _STATUS_COLOR_NAME[status],
            "color": color_for(score),
            "drivers": drivers,
        }

    # 3) overall
    scores = [s["score"] for s in systems.values()]
    overall_score = round(0.6 * max(scores) + 0.4 * (sum(scores) / len(scores)), 1)
    overall_status = status_for(overall_score)
    at_risk = [k for k, _ in sorted(systems.items(), key=lambda kv: -kv[1]["score"])
               if systems[k]["score"] >= 25]

    return {
        "inputs": inputs,
        "stressor_levels": {k: round(v, 3) for k, v in levels.items()},
        "systems": systems,
        "active_synergies": active,
        "overall": {
            "score": overall_score,
            "status": overall_status,
            "color_name": _STATUS_COLOR_NAME[overall_status],
            "color": color_for(overall_score),
        },
        "at_risk": at_risk,
    }
