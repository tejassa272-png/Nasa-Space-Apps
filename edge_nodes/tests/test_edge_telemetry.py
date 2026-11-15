import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import MagicMock, Mock, call, patch

import requests

from edge_nodes import smart_watch_edge_node_, tempus_simulator
from edge_nodes.edge_telemetry import TelemetryClient, TelemetryDeliveryError, receipt_label


def response(status, data):
    return Mock(status_code=status, json=Mock(return_value=data))


class EdgeTelemetryTests(unittest.TestCase):
    def test_retry_reuses_the_observation_and_its_idempotency_key(self):
        session = Mock()
        session.request.side_effect = [
            requests.Timeout(),
            response(503, {}),
            response(200, {"ok": True, "telemetry_id": 42, "applied": False}),
            response(200, {"ok": True, "telemetry_id": 43, "applied": True}),
        ]
        client = TelemetryClient(session, base_url="http://test.local")
        sample = tempus_simulator.generate_reading("nominal")
        with patch("edge_nodes.edge_telemetry.sleep") as delay, patch("edge_nodes.edge_telemetry.time", return_value=123.5):
            first = client.send(sample)
            second = client.send(sample)

        attempts = session.request.call_args_list
        self.assertEqual(attempts[:3], [attempts[0]] * 3)
        self.assertEqual(attempts[0].kwargs["json"]["observed_at"], 123.5)
        self.assertNotEqual(attempts[0].kwargs["headers"], attempts[3].kwargs["headers"])
        self.assertNotIn("observed_at", sample)
        self.assertEqual(delay.call_args_list, [call(1), call(2)])
        self.assertEqual(receipt_label(first), "reading 42 stored in history")
        self.assertEqual(receipt_label(second), "reading 43 applied")

    def test_demo_gate_rejects_protected_or_non_demo_state(self):
        for result in [response(401, {}), response(200, {"access": {"demo": False}})]:
            with self.subTest(status=result.status_code):
                session = Mock()
                session.request.return_value = result
                with self.assertRaisesRegex(TelemetryDeliveryError, "require an AstroTwin demo server"):
                    TelemetryClient(session).require_demo()
                self.assertEqual(session.request.call_args.args[0], "GET")

    def test_wearable_sends_nominal_anomaly_and_recovery(self):
        session = MagicMock()
        session.__enter__.return_value = session
        session.request.side_effect = [
            response(200, {"access": {"demo": True}}),
            *[response(200, {"vitals": {}, "tier": "test"}) for _ in range(6)],
        ]
        with (
            patch.object(smart_watch_edge_node_.requests, "Session", return_value=session),
            patch.object(smart_watch_edge_node_, "sleep", side_effect=[None] * 5 + [KeyboardInterrupt]),
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(smart_watch_edge_node_.main(), 0)

        sent = [item.kwargs["json"] for item in session.request.call_args_list if item.args[0] == "POST"]
        self.assertEqual(len(sent), 6)
        self.assertLess(sent[0]["heart_rate"], 100)
        self.assertGreater(sent[4]["heart_rate"], 100)
        self.assertLess(sent[5]["heart_rate"], 100)
        self.assertTrue(all(reading["device"].endswith("· simulation") for reading in sent))
        self.assertTrue(all("observed_at" in reading for reading in sent))

    def test_tempus_scenario_preserves_one_shot_cli_and_displays_assessment(self):
        session = MagicMock()
        session.__enter__.return_value = session
        session.request.side_effect = [
            response(200, {"access": {"demo": True}}),
            response(200, {"vitals": {}, "tier": "Tier 2 - Triage", "active_protocols": [{
                "kind": "telemetry", "severity": "WARNING", "headline": "Sample alert", "rationale": "Demo explanation",
            }]}),
        ]
        with (
            patch.object(tempus_simulator.requests, "Session", return_value=session),
            patch.object(tempus_simulator.sys, "argv", ["tempus_simulator.py", "--scenario", "hypoxia", "--watch"]),
            redirect_stdout(io.StringIO()) as output,
        ):
            self.assertEqual(tempus_simulator.main(), 0)

        self.assertEqual([item.args[0] for item in session.request.call_args_list], ["GET", "POST"])
        self.assertLessEqual(session.request.call_args.kwargs["json"]["spo2"], 92)
        self.assertIn("WARNING: Sample alert", output.getvalue())
