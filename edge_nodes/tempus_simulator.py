"""Send synthetic Tempus-style readings to an AstroTwin demo server."""

import argparse
from math import isfinite
from random import randint
import sys
from time import monotonic, sleep

import requests

if __package__:
    from .edge_telemetry import TelemetryClient, TelemetryDeliveryError, receipt_label
else:
    from edge_telemetry import TelemetryClient, TelemetryDeliveryError, receipt_label


DEVICE = "Tempus Pro · simulation"
SCANS_CLEAR = ("Clear", "Normal")
EDEMA = "Optic Disc Edema Detected"
BONE_LOSS = "Bone Density Loss Detected"

# Each scenario lists inclusive ranges for heart rate, SpO2, and blood pressure.
SCENARIOS = {
    "nominal": ("Nominal vitals", (60, 80), (97, 100), (110, 120), (70, 80), SCANS_CLEAR),
    "mild": ("Elevated heart rate and reduced SpO2", (101, 106), (93, 94), (118, 128), (76, 84), SCANS_CLEAR),
    "hypoxia": ("Low blood oxygen", (70, 85), (86, 92), (112, 122), (72, 80), SCANS_CLEAR),
    "tachycardia": ("Fast heart rate", (112, 130), (97, 100), (115, 125), (74, 82), SCANS_CLEAR),
    "hypertension": ("High blood pressure", (70, 85), (97, 100), (145, 165), (92, 102), SCANS_CLEAR),
    "edema": ("Optic disc edema on ultrasound", (68, 82), (97, 100), (112, 122), (72, 80), (EDEMA, "Normal")),
    "hypoxia_edema": ("Low oxygen and optic disc edema", (72, 90), (88, 93), (115, 125), (74, 84), (EDEMA, "Normal")),
    "bone": ("Bone density loss flagged", (62, 78), (97, 100), (110, 120), (70, 80), ("Clear", BONE_LOSS)),
    "full": ("Multiple elevated vitals and optic disc edema", (110, 130), (88, 93), (140, 160), (90, 100), (EDEMA, "Normal")),
    "severe": ("Low SpO2 and elevated heart rate and pressure", (125, 140), (82, 86), (150, 170), (95, 105), (EDEMA, "Normal")),
}


def generate_reading(scenario: str) -> dict:
    _, heart_rate, spo2, bp_sys, bp_dia, scans = SCENARIOS[scenario]
    return {
        "heart_rate": randint(*heart_rate),
        "spo2": randint(*spo2),
        "bp_sys": randint(*bp_sys),
        "bp_dia": randint(*bp_dia),
        "ultrasound_status": scans[0],
        "bone_status": scans[1],
        "device": DEVICE,
    }


def send(client: TelemetryClient, reading: dict, label: str, *, watch: bool = False) -> None:
    state = client.send(reading)
    print(
        f"[{label}] HR {reading['heart_rate']} | SpO2 {reading['spo2']}% | "
        f"BP {reading['bp_sys']}/{reading['bp_dia']} | US {reading['ultrasound_status']} "
        f"-> {receipt_label(state)}",
        flush=True,
    )
    if watch:
        alert = next((item for item in state.get("active_protocols", ()) if item.get("kind") == "telemetry"), None)
        if alert:
            print(f"   {alert['severity']}: {alert['headline']}\n   {alert['rationale']}", flush=True)
        else:
            print("   No active telemetry alert.", flush=True)


def run_demo_loop(client: TelemetryClient, scenario: str, interval: float, watch: bool) -> None:
    print("Sending synthetic telemetry (Ctrl+C to stop).", flush=True)
    while True:
        started = monotonic()
        try:
            send(client, generate_reading(scenario), scenario, watch=watch)
        except TelemetryDeliveryError as error:
            if not error.retryable:
                raise
            print(f"{error} Reading not confirmed after retries. The stream will continue.", file=sys.stderr)
        sleep(max(0, interval - (monotonic() - started)))


def update_inventory(client: TelemetryClient, specs: list[str], field: str, cast) -> None:
    for spec in specs:
        name, _, value = spec.partition("=")
        result = client.request("POST", "/api/debug/inventory", body={"medication": name, field: cast(value)})
        if result.get("ok") is not True:
            raise TelemetryDeliveryError("The requested demo inventory item was not updated.")
        print(f"Inventory: {result['item']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="AstroTwin Tempus Pro telemetry simulator (demo only)")
    parser.add_argument("--list", action="store_true", help="list scenarios and exit")
    parser.add_argument("--scenario", choices=SCENARIOS, help="send one reading for the selected scenario")
    parser.add_argument("--tour", action="store_true", help="run every anomaly scenario with a recovery reading between them")
    parser.add_argument("--interval", type=float, default=3, help="seconds between continuous samples (default: 3)")
    parser.add_argument("--continuous", action="store_true", help="repeat the specified scenario (nominal by default)")
    parser.add_argument("--watch", action="store_true", help="print the telemetry assessment returned by the API")
    parser.add_argument("--reset", action="store_true", help="reset demo alerts before sending readings")
    parser.add_argument("--hr", type=int, dest="heart_rate", help="custom heart rate")
    parser.add_argument("--spo2", type=int, help="custom SpO2")
    parser.add_argument("--sys", type=int, dest="bp_sys", help="custom systolic BP")
    parser.add_argument("--dia", type=int, dest="bp_dia", help="custom diastolic BP")
    parser.add_argument("--edema", action="store_true", help="custom scan includes optic disc edema")
    parser.add_argument("--bone", action="store_true", help="custom scan includes bone density loss")
    parser.add_argument("--stock", action="append", default=[], metavar="NAME=QTY", help="set demo inventory quantity first")
    parser.add_argument("--potency", action="append", default=[], metavar="NAME=PCT", help="set demo inventory potency loss first")
    args = parser.parse_args()

    if args.list:
        for scenario, (description, *_) in SCENARIOS.items():
            print(f"  {scenario:<14} {description}")
        return 0
    if not isfinite(args.interval) or args.interval <= 0:
        parser.error("--interval must be a positive number")

    custom = {name: getattr(args, name) for name in ("heart_rate", "spo2", "bp_sys", "bp_dia") if getattr(args, name) is not None}
    if args.edema:
        custom["ultrasound_status"] = EDEMA
    if args.bone:
        custom["bone_status"] = BONE_LOSS
    if args.continuous and (custom or args.tour):
        parser.error("--continuous cannot be combined with custom vitals or --tour")

    try:
        with requests.Session() as session:
            session.trust_env = False  # Demo simulation never uses credentials from netrc.
            client = TelemetryClient(session)
            client.require_demo()
            if args.reset:
                client.request("POST", "/api/debug/reset")
            update_inventory(client, args.stock, "quantity", int)
            update_inventory(client, args.potency, "potency_reduction_pct", float)

            if custom:
                send(client, {**generate_reading("nominal"), **custom}, "custom", watch=args.watch)
            elif args.scenario and not args.continuous:
                send(client, generate_reading(args.scenario), args.scenario, watch=args.watch)
            elif args.tour:
                for scenario in SCENARIOS:
                    if scenario == "nominal":
                        continue
                    send(client, generate_reading(scenario), scenario, watch=args.watch)
                    sleep(6)
                    send(client, generate_reading("nominal"), "recovery")
                    sleep(args.interval)
            else:
                run_demo_loop(client, args.scenario or "nominal", args.interval, args.watch)
    except (TelemetryDeliveryError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nTempus simulator stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
