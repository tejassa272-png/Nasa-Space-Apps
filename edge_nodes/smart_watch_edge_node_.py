"""Send a continuous synthetic wearable stream to an AstroTwin demo server."""

import sys
from random import randint
from time import monotonic, sleep

import requests

if __package__:
    from .edge_telemetry import TelemetryClient, TelemetryDeliveryError, receipt_label
else:
    from edge_telemetry import TelemetryClient, TelemetryDeliveryError, receipt_label


DEVICE = "Astro-Watch · simulation"
INTERVAL_SECONDS = 2.5


def generate_vitals(anomaly: bool = False) -> dict:
    return {
        "heart_rate": randint(105, 119) if anomaly else randint(60, 80),
        "spo2": randint(90, 94) if anomaly else randint(97, 100),
        "bp_sys": randint(120, 135) if anomaly else randint(110, 120),
        "bp_dia": randint(80, 89) if anomaly else randint(70, 80),
        "ultrasound_status": "Not measured",
        "bone_status": "Not measured",
        "device": DEVICE,
    }


def main() -> int:
    print(f"[{DEVICE}] Sending synthetic readings every {INTERVAL_SECONDS:g}s (Ctrl+C to stop).", flush=True)
    try:
        with requests.Session() as session:
            session.trust_env = False  # Demo simulation never uses credentials from netrc.
            client = TelemetryClient(session)
            client.require_demo()
            tick = 0
            while True:
                started = monotonic()
                reading = generate_vitals(anomaly=tick == 4)
                try:
                    state = client.send(reading)
                    print(
                        f"HR {reading['heart_rate']} | SpO2 {reading['spo2']}% | "
                        f"BP {reading['bp_sys']}/{reading['bp_dia']} -> {receipt_label(state)}",
                        flush=True,
                    )
                except TelemetryDeliveryError as error:
                    if not error.retryable:
                        raise
                    print(f"{error} Reading not confirmed after retries. The stream will continue.", file=sys.stderr)
                tick = (tick + 1) % 10
                sleep(max(0, INTERVAL_SECONDS - (monotonic() - started)))
    except TelemetryDeliveryError as error:
        print(error, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print(f"\n[{DEVICE}] Stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
