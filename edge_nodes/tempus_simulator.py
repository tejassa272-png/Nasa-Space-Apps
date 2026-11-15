
"""
Tempus Pro simulator for AstroTwin.
 
Examples
  python3 tempus_simulator.py                          # original demo loop (3 normal, 1 critical, repeat)
  python3 tempus_simulator.py --list                   # show all scenarios
  python3 tempus_simulator.py --scenario edema --watch # send once, print the LLM explanation
  python3 tempus_simulator.py --tour --watch           # run every anomaly scenario one by one
  python3 tempus_simulator.py --hr 125 --spo2 89 --edema --watch   # custom values
  python3 tempus_simulator.py --scenario full --reset --watch      # clear cached explanations first
  python3 tempus_simulator.py --scenario bone --watch              # recommends Alendronate from inventory
  python3 tempus_simulator.py --scenario bone --stock Alendronate=0 --watch     # out-of-stock check
  python3 tempus_simulator.py --scenario bone --potency Alendronate=60 --watch  # degraded-drug check
"""
import argparse
import json
import random
import sys
import time
 
import requests
 
BASE_URL = "http://localhost:8000"
HUB_URL = f"{BASE_URL}/api/tempus/vitals"
STATE_URL = f"{BASE_URL}/api/state"
RESET_URL = f"{BASE_URL}/api/debug/reset"
INVENTORY_URL = f"{BASE_URL}/api/debug/inventory"
 
DEVICE = "Tempus Pro - Lunar Base"
 
# name -> (description, generator)
def _r(a, b):
    return random.randint(a, b)
 
SCENARIOS = {
    "nominal": (
        "All vitals normal",
        lambda: dict(heart_rate=_r(60, 80), spo2=_r(97, 100), bp_sys=_r(110, 120), bp_dia=_r(70, 80), us="Clear"),
    ),
    "mild": (
        "Borderline: HR just over 100, SpO2 just under 95 (WARNING)",
        lambda: dict(heart_rate=_r(101, 106), spo2=_r(93, 94), bp_sys=_r(118, 128), bp_dia=_r(76, 84), us="Clear"),
    ),
    "hypoxia": (
        "Low blood oxygen only",
        lambda: dict(heart_rate=_r(70, 85), spo2=_r(86, 92), bp_sys=_r(112, 122), bp_dia=_r(72, 80), us="Clear"),
    ),
    "tachycardia": (
        "Fast heart rate only",
        lambda: dict(heart_rate=_r(112, 130), spo2=_r(97, 100), bp_sys=_r(115, 125), bp_dia=_r(74, 82), us="Clear"),
    ),
    "hypertension": (
        "High blood pressure only",
        lambda: dict(heart_rate=_r(70, 85), spo2=_r(97, 100), bp_sys=_r(145, 165), bp_dia=_r(92, 102), us="Clear"),
    ),
    "edema": (
        "Optic disc edema on ultrasound, vitals normal (SANS)",
        lambda: dict(heart_rate=_r(68, 82), spo2=_r(97, 100), bp_sys=_r(112, 122), bp_dia=_r(72, 80), us="Optic Disc Edema Detected"),
    ),
    "hypoxia_edema": (
        "Low oxygen + optic disc edema",
        lambda: dict(heart_rate=_r(72, 90), spo2=_r(88, 93), bp_sys=_r(115, 125), bp_dia=_r(74, 82), us="Optic Disc Edema Detected"),
    ),
    "bone": (
        "Bone density loss flagged, vitals normal (recommends Alendronate from inventory)",
        lambda: dict(heart_rate=_r(62, 78), spo2=_r(97, 100), bp_sys=_r(110, 120), bp_dia=_r(70, 80), us="Clear", bone="Bone Density Loss Detected"),
    ),
    "full": (
        "Original demo anomaly: tachycardia + hypoxia + high BP + edema",
        lambda: dict(heart_rate=_r(110, 130), spo2=_r(88, 93), bp_sys=_r(140, 160), bp_dia=_r(90, 100), us="Optic Disc Edema Detected"),
    ),
    "severe": (
        "Severe: SpO2 in the low 80s, HR 125+ (CRITICAL)",
        lambda: dict(heart_rate=_r(125, 140), spo2=_r(82, 86), bp_sys=_r(150, 170), bp_dia=_r(95, 105), us="Optic Disc Edema Detected"),
    ),
}
TOUR_ORDER = ["mild", "hypoxia", "tachycardia", "hypertension", "edema", "bone", "hypoxia_edema", "full", "severe"]
 
 
def to_payload(v):
    return {
        "heart_rate": v["heart_rate"],
        "spo2": v["spo2"],
        "bp_sys": v["bp_sys"],
        "bp_dia": v["bp_dia"],
        "ultrasound_status": v["us"],
        "bone_status": v.get("bone", "Normal"),
        "device": DEVICE,
    }
 
 
def send(v, label):
    payload = to_payload(v)
    res = requests.post(HUB_URL, json=payload, timeout=30)
    res.raise_for_status()
    state = res.json()
    print(
        f"[{label}] Sent: HR {payload['heart_rate']} | SpO2 {payload['spo2']}% | "
        f"BP {payload['bp_sys']}/{payload['bp_dia']} | US: {payload['ultrasound_status']} "
        f"-> {state['tier']}"
    )
    return state
 
 
def watch_explanation(timeout_s=150):
    """Poll /api/state until the local LLM has finished (or failed) its explanation."""
    start = time.time()
    last_print = 0
    p = None
    while time.time() - start < timeout_s:
        p = requests.get(STATE_URL, timeout=10).json().get("protocol")
        if p and p["rationale_status"] != "pending":
            break
        if time.time() - last_print > 5:
            print(f"   ...waiting for local LLM ({int(time.time() - start)}s)")
            last_print = time.time()
        time.sleep(2)
 
    if not p:
        print("   (no protocol was generated for this reading)")
        return
    took = time.time() - start
    print(f"\n   Severity : {p['severity']}")
    print(f"   Headline : {p['headline']}")
    for s in p["steps"]:
        item = f"  [{s['item']['name']}: {s['item']['qty']} left @ {s['item']['location']}]" if s["item"] else ""
        print(f"   Step {s['n']}   : {s['title']}{item}")
        if s["item"] and s["item"].get("warning"):
            print(f"             ! {s['item']['warning']}")
    status = p["rationale_status"]
    tag = {"ready": "LOCAL LLM", "fallback": "FALLBACK TEXT (LLM unusable)", "pending": "STILL PENDING (timed out)"}[status]
    print(f"   Why ({tag}, {took:.1f}s):")
    print(f"   {p['rationale']}\n")
    if status != "ready":
        print("   Tip: run `docker logs astrotwin_backend --tail 30` to see the raw LLM output / error,")
        print("        and `docker exec -it astrotwin_ollama ollama list` to confirm the model is pulled.\n")
 
 
def run_demo_loop():
    """Original behaviour: 3 normal readings, then 1 full anomaly, forever."""
    print("Tempus Pro Simulator: demo loop (Ctrl+C to stop)")
    try:
        while True:
            for _ in range(3):
                send(SCENARIOS["nominal"][1](), "Tier 1 Routine")
                time.sleep(3)
            print("\nSIMULATING SUDDEN MEDICAL ANOMALY")
            send(SCENARIOS["full"][1](), "Tier 2 Triage")
            time.sleep(5)
    except KeyboardInterrupt:
        print("\nTempus Pro Simulator shutting down.")
 
 
def main():
    ap = argparse.ArgumentParser(description="AstroTwin Tempus Pro simulator")
    ap.add_argument("--list", action="store_true", help="list scenarios and exit")
    ap.add_argument("--scenario", choices=SCENARIOS.keys(), help="send one reading for this scenario")
    ap.add_argument("--tour", action="store_true", help="run every anomaly scenario one after another")
    ap.add_argument("--watch", action="store_true", help="wait for and print the local LLM explanation")
    ap.add_argument("--reset", action="store_true", help="clear cached LLM explanations on the backend first")
    ap.add_argument("--hr", type=int, help="custom heart rate")
    ap.add_argument("--spo2", type=int, help="custom SpO2")
    ap.add_argument("--sys", type=int, dest="bp_sys", help="custom systolic BP")
    ap.add_argument("--dia", type=int, dest="bp_dia", help="custom diastolic BP")
    ap.add_argument("--edema", action="store_true", help="custom reading includes optic disc edema")
    ap.add_argument("--bone", action="store_true", help="custom reading includes bone density loss")
    ap.add_argument("--stock", action="append", metavar="NAME=QTY", help="set inventory quantity first, e.g. --stock Alendronate=0")
    ap.add_argument("--potency", action="append", metavar="NAME=PCT", help="set potency loss %% first, e.g. --potency Alendronate=60")
    args = ap.parse_args()
 
    if args.list:
        for name, (desc, _) in SCENARIOS.items():
            print(f"  {name:<14} {desc}")
        return
 
    custom = any(x is not None for x in (args.hr, args.spo2, args.bp_sys, args.bp_dia)) or args.edema or args.bone
 
    if not (args.scenario or args.tour or custom):
        run_demo_loop()
        return
 
    try:
        if args.reset:
            requests.post(RESET_URL, timeout=10)
            print("Backend cache cleared.\n")
 
        for spec, field, cast in [(x, "quantity", int) for x in (args.stock or [])] + \
                                 [(x, "potency_reduction_pct", float) for x in (args.potency or [])]:
            name, _, val = spec.partition("=")
            r = requests.post(INVENTORY_URL, json={"medication": name, field: cast(val)}, timeout=10).json()
            print(f"Inventory: {r.get('item', r)}")

        if custom:
            v = SCENARIOS["nominal"][1]()
            if args.hr is not None: v["heart_rate"] = args.hr
            if args.spo2 is not None: v["spo2"] = args.spo2
            if args.bp_sys is not None: v["bp_sys"] = args.bp_sys
            if args.bp_dia is not None: v["bp_dia"] = args.bp_dia
            if args.edema: v["us"] = "Optic Disc Edema Detected"
            if args.bone: v["bone"] = "Bone Density Loss Detected"
            send(v, "Custom")
            if args.watch:
                watch_explanation()
 
        elif args.scenario:
            print(f"Scenario '{args.scenario}': {SCENARIOS[args.scenario][0]}")
            send(SCENARIOS[args.scenario][1](), args.scenario)
            if args.watch:
                watch_explanation()
 
        elif args.tour:
            for name in TOUR_ORDER:
                print(f"\n=== {name}: {SCENARIOS[name][0]} ===")
                send(SCENARIOS[name][1](), name)
                if args.watch:
                    watch_explanation()
                else:
                    time.sleep(6)
                send(SCENARIOS["nominal"][1](), "recovery")  # let the dashboard show the recovery state
                time.sleep(3)
            print("Tour finished.")
    except requests.exceptions.ConnectionError:
        print(f"Could not reach the backend at {BASE_URL}. Is `docker compose up` running?")
        sys.exit(1)
 
 
if __name__ == "__main__":
    main()
 