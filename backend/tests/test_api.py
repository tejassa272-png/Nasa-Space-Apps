import http.client
import json
import socket
import threading
import unittest
from contextlib import contextmanager
from dataclasses import replace
from secrets import token_urlsafe
from time import monotonic, sleep, time
from unittest.mock import patch

import uvicorn
from sqlalchemy.engine import make_url

from demo_telemetry import DEMO_STREAM_SOURCE
from main import create_app
from nasa import NasaReferenceError
from settings import Settings

DEMO = Settings("demo", make_url("sqlite:///:memory:"), True, (), {}, None, 30)
VITALS = {
    "heart_rate": 73, "spo2": 98, "bp_sys": 118, "bp_dia": 76, "device": "Integration test",
    "ultrasound_status": "Clear", "bone_status": "Normal",
}
BASELINE = {"co2": 1_200, "radiation": 10, "days": 30, "sleep": 7.5}
STOCK = {"medication": "Integration / Kit", "quantity": 2, "location": "Test locker", "potency_reduction_pct": 0}


@contextmanager
def live_app(settings=DEMO):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        server = uvicorn.Server(uvicorn.Config(create_app(settings), log_level="error", access_log=False))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        try:
            deadline = monotonic() + 5
            while not server.started:
                if not thread.is_alive() or monotonic() >= deadline:
                    raise RuntimeError("The API test server could not start.")
                sleep(0.02)
            port = listener.getsockname()[1]

            def send(method, path, payload=None, *, key=None, token=None):
                headers = {"Content-Type": "application/json"} if payload is not None else {}
                if key:
                    headers["Idempotency-Key"] = key
                if token:
                    headers["Authorization"] = f"Bearer {token}"
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=4)
                try:
                    body = json.dumps(payload) if payload is not None else None
                    connection.request(method, path, body=body, headers=headers)
                    response = connection.getresponse()
                    return response.status, response.headers, json.loads(response.read())
                finally:
                    connection.close()

            yield send
        finally:
            server.should_exit = True
            thread.join(timeout=5)


class DemoApiTests(unittest.TestCase):
    def test_demo_stream_runs_without_a_browsing_session_and_pauses_for_manual_readings(self):
        with live_app(replace(DEMO, demo_telemetry=True, stale_seconds=1)) as send:
            deadline = monotonic() + 4
            history = []
            while monotonic() < deadline:
                history = send("GET", "/api/telemetry")[2]["items"]
                if len(history) >= 3:
                    break
                sleep(0.1)
            self.assertGreaterEqual(len(history), 3)
            self.assertTrue(all(row["vitals"]["source"] == DEMO_STREAM_SOURCE for row in history))
            self.assertTrue(all(row["observed_at"] == row["received_at"] for row in history))
            self.assertTrue(all(new["observed_at"] - old["observed_at"] >= 0.5 for new, old in zip(history, history[1:])))

            sample = send("POST", "/api/tempus/vitals", VITALS)[2]
            self.assertEqual(sample["demo_stream"], {
                "enabled": True, "interval_seconds": 0.5, "resumes_at": sample["telemetry_received_at"] + 30,
            })
            sleep(0.7)
            latest = send("GET", "/api/state")[2]
            self.assertEqual(latest["vitals"], VITALS)
            self.assertEqual(latest["telemetry_revision"], sample["telemetry_revision"])

    def test_ready_and_validate_payload_without_echoing_input(self):
        with live_app() as send:
            self.assertEqual(send("GET", "/health/live")[2], {"status": "live"})
            status, headers, ready = send("GET", "/health/ready")
            self.assertEqual((status, ready), (200, {"status": "ready"}))
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertTrue(headers["X-Request-ID"])
            wrong = VITALS | {"heart_rate": "private-test-value"}
            status, _, response = send("POST", "/api/tempus/vitals", wrong)
            self.assertEqual(status, 422)
            self.assertNotIn("private-test-value", json.dumps(response))
            self.assertEqual(send("POST", "/api/tempus/vitals", VITALS | {"spo2": 105})[0], 422)
            self.assertEqual(send("POST", "/api/tempus/vitals", VITALS | {"heart_rate": 0})[0], 422)
            self.assertEqual(send("POST", "/api/tempus/vitals", VITALS | {"ultrasound_status": "No Edema Detected"})[0], 422)
            self.assertEqual(send("POST", "/api/tempus/vitals", VITALS | {"device": "x" * 17000})[0], 413)

    def test_telemetry_environment_alerts_and_history_are_independent(self):
        with live_app() as send:
            self.assertEqual(send("GET", "/api/state")[2]["status"], "Waiting for telemetry...")
            storm = BASELINE | {"radiation": 85}
            self.assertEqual(send("POST", "/api/environment", storm)[0], 200)
            nominal = send("POST", "/api/tempus/vitals", VITALS)[2]
            self.assertEqual(nominal["protocol"]["kind"], "environment")
            self.assertTrue(nominal["is_critical"])

            sample = VITALS | {"spo2": 89, "ultrasound_status": "Optic Disc Edema Detected"}
            hypoxia = send("POST", "/api/tempus/vitals", sample, key="sample-1")[2]
            self.assertEqual(hypoxia["protocol"]["kind"], "telemetry")
            self.assertEqual(len(hypoxia["active_protocols"]), 2)
            self.assertEqual(send("POST", "/api/tempus/vitals", sample, key="sample-1")[2], hypoxia)
            self.assertEqual(send("POST", "/api/tempus/vitals", VITALS, key="sample-1")[0], 409)

            same_alert = send("POST", "/api/tempus/vitals", sample | {"spo2": 88})[2]
            self.assertEqual(same_alert["protocol"]["id"], hypoxia["protocol"]["id"])
            self.assertEqual(send("POST", "/api/environment", BASELINE)[0], 200)
            self.assertEqual(len(send("GET", "/api/state")[2]["active_protocols"]), 1)
            incomplete = send("POST", "/api/tempus/vitals", VITALS | {"ultrasound_status": "Not measured"})[2]
            self.assertIn("edema", incomplete["protocol"]["retained_flags"])
            self.assertEqual(incomplete["vitals"]["ultrasound_status"], "Not measured")
            recovered = send("POST", "/api/tempus/vitals", VITALS)[2]
            self.assertFalse(recovered["is_critical"])
            self.assertIsNotNone(recovered["protocol"])
            audit = send("GET", "/api/audit")[2]["items"]
            superseded = next(entry for entry in audit if entry["action"] == "alert.superseded")
            self.assertEqual(superseded["details"]["protocol_id"], hypoxia["protocol"]["id"])
            self.assertEqual(superseded["details"]["replacement_id"], incomplete["protocol"]["id"])

            page = send("GET", "/api/telemetry?limit=2")[2]
            older = send("GET", f"/api/telemetry?before_id={page['next_before_id']}")[2]
            self.assertEqual(len(page["items"]) + len(older["items"]), 5)
            self.assertLess(older["items"][0]["id"], page["items"][-1]["id"])
            with patch("monitoring.time", return_value=recovered["telemetry_received_at"] + 31):
                stale = send("GET", "/api/state")[2]
                self.assertTrue(stale["telemetry_stale"])
                self.assertEqual(stale["status"], "Telemetry stale")

    def test_dispense_is_exactly_once_when_retried(self):
        with live_app() as send:
            self.assertEqual(send("PUT", "/api/inventory", STOCK)[0], 200)
            self.assertEqual(send("POST", "/api/inventory/dispense", {"medication": "Integration"})[0], 404)
            request = {"medication": STOCK["medication"].lower()}
            first = send("POST", "/api/inventory/dispense", request, key="record-1")[2]
            self.assertEqual(first["item"]["qty"], 1)
            self.assertEqual(send("POST", "/api/inventory/dispense", request, key="record-1")[2], first)
            self.assertEqual(send("POST", "/api/inventory/dispense", request, key="record-2")[2]["item"]["qty"], 0)
            self.assertEqual(send("POST", "/api/inventory/dispense", request)[0], 409)
            audit = send("GET", "/api/audit")[2]["items"]
            self.assertEqual(sum(event["action"] == "inventory.dispensed" for event in audit), 2)

    def test_nasa_is_read_only_even_when_donki_returns_an_event(self):
        with live_app() as send:
            before = send("GET", "/api/state")[2]
            reference = {"status": "Historical NASA records", "historical": True, "cme_count": 1}
            with patch("main.fetch_nasa_reference", return_value=reference):
                self.assertEqual(send("POST", "/api/nasa/sync", {"active": True})[2], reference)
            self.assertEqual(send("GET", "/api/state")[2], before)
            with patch("main.fetch_nasa_reference", side_effect=NasaReferenceError("test error")):
                self.assertEqual(send("POST", "/api/nasa/sync", {"active": True})[0], 502)


class ProductionApiTests(unittest.TestCase):
    def test_roles_debug_isolation_and_telemetry_acknowledgement(self):
        keys = {role: token_urlsafe(32) for role in ("viewer", "operator", "telemetry")}
        settings = replace(DEMO, mode="production", keys=keys, seed_inventory=False, demo_telemetry=True)
        viewer, operator, telemetry = [keys[role] for role in ("viewer", "operator", "telemetry")]
        with live_app(settings) as send:
            status, headers, _ = send("GET", "/api/state")
            self.assertEqual((status, headers["WWW-Authenticate"]), (401, "Bearer"))
            self.assertEqual(send("GET", "/api/state", token=telemetry)[0], 403)
            state = send("GET", "/api/state", token=viewer)[2]
            self.assertEqual(state["access"], {"demo": False, "role": "viewer", "can_dispense": False})
            self.assertEqual(state["inventory"], [])
            self.assertFalse(state["demo_stream"]["enabled"])
            self.assertIsNone(state["telemetry_revision"])
            self.assertEqual(send("GET", "/api/audit", token=viewer)[0], 403)
            self.assertEqual(send("PUT", "/api/inventory", STOCK, token=viewer)[0], 403)
            self.assertEqual(send("POST", "/api/tempus/vitals", VITALS, token=operator)[0], 403)
            self.assertEqual(send("POST", "/api/environment", {"co2": 4000}, token=telemetry)[0], 422)
            self.assertEqual(send("POST", "/api/tempus/vitals", VITALS, token=telemetry)[0], 422)
            sample = VITALS | {"observed_at": time()}
            receipt = send("POST", "/api/tempus/vitals", sample, token=telemetry, key="source-reading-1")[2]
            self.assertEqual(set(receipt), {"ok", "received_at", "telemetry_id", "applied"})
            self.assertTrue(receipt["applied"])
            self.assertEqual(send("POST", "/api/tempus/vitals", sample, token=telemetry, key="source-reading-1")[2], receipt)
            self.assertEqual(send("GET", "/api/state", token=viewer)[2]["vitals"], sample)
            self.assertEqual(send("PUT", "/api/inventory", STOCK, token=operator)[0], 200)
            self.assertEqual(send("POST", "/api/inventory/dispense", {"medication": STOCK["medication"]}, token=operator)[0], 400)
            self.assertEqual(send("POST", "/api/inventory/dispense", {"medication": STOCK["medication"]}, token=operator, key="release-1")[0], 200)
            self.assertEqual(send("GET", "/docs", token=operator)[0], 404)
            self.assertEqual(send("POST", "/api/debug/reset", token=operator)[0], 404)

    def test_late_packets_cannot_clear_current_alerts_or_reset_staleness(self):
        keys = {role: token_urlsafe(32) for role in ("viewer", "operator", "telemetry")}
        settings = replace(DEMO, mode="production", keys=keys)
        now = time()
        telemetry, viewer = keys["telemetry"], keys["viewer"]
        with live_app(settings) as send:
            abnormal = VITALS | {"observed_at": now - 40, "spo2": 89}
            self.assertTrue(send("POST", "/api/tempus/vitals", abnormal, token=telemetry)[2]["applied"])
            late_nominal = VITALS | {"observed_at": now - 50}
            self.assertFalse(send("POST", "/api/tempus/vitals", late_nominal, token=telemetry)[2]["applied"])
            state = send("GET", "/api/state", token=viewer)[2]
            self.assertEqual(state["vitals"], abnormal)
            self.assertTrue(state["is_critical"])
            self.assertTrue(state["telemetry_stale"])
            self.assertEqual(state["telemetry_observed_at"], abnormal["observed_at"])
            history = send("GET", "/api/telemetry", token=viewer)[2]["items"]
            self.assertEqual([record["vitals"] for record in history], [late_nominal, abnormal])
            self.assertEqual(history[0]["id"], state["telemetry_revision"])

            storm = BASELINE | {"observed_at": now - 2, "radiation": 85}
            self.assertTrue(send("POST", "/api/environment", storm, token=telemetry)[2]["applied"])
            late_baseline = BASELINE | {"observed_at": now - 3}
            self.assertFalse(send("POST", "/api/environment", late_baseline, token=telemetry)[2]["applied"])
            self.assertEqual(len(send("GET", "/api/state", token=viewer)[2]["active_protocols"]), 2)
            future_sample = VITALS | {"observed_at": now + 60}
            self.assertEqual(send("POST", "/api/tempus/vitals", future_sample, token=telemetry)[0], 422)


if __name__ == "__main__":
    unittest.main()
