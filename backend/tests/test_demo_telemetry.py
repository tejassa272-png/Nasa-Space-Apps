import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from sqlalchemy.engine import URL

from demo_telemetry import DEMO_STREAM_SOURCE, publish_demo_sample, simulated_vitals
from monitoring import record_vitals
from settings import Settings
from storage import Storage
from triage import assess_telemetry


class DemoTelemetryTests(unittest.TestCase):
    def test_workers_share_one_stream_and_retain_a_submitted_scan(self):
        with TemporaryDirectory() as directory:
            database = URL.create("sqlite", database=str(Path(directory, "demo.db")))
            settings = Settings("demo", database, True, (), {}, None, 30, demo_telemetry=True)
            first, second = Storage(database), Storage(database)
            try:
                first.initialize()
                with patch("demo_telemetry.time", return_value=1000), ThreadPoolExecutor(2) as executor:
                    tasks = [executor.submit(publish_demo_sample, worker, settings) for worker in (first, second)]
                    self.assertEqual([task.result() for task in tasks], [5, 5])
                with first.read() as tx:
                    self.assertEqual(len(tx.telemetry_history(10)), 1)
                    self.assertEqual(tx.state.vitals["source"], DEMO_STREAM_SOURCE)

                incoming = simulated_vitals(1002.0).model_dump()
                incoming.update({"device": "Submitted sample", "ultrasound_status": "Optic Disc Edema Detected"})
                with second.write() as tx:
                    record_vitals(tx, incoming, "demo", received_at=1003, observed_at=1002)
                with patch("demo_telemetry.time", return_value=1032):
                    self.assertEqual(publish_demo_sample(first, settings), 1)
                with first.read() as tx:
                    self.assertEqual(tx.state.vitals, incoming)
                with patch("demo_telemetry.time", return_value=1033):
                    self.assertEqual(publish_demo_sample(second, settings), 5)
                with first.read() as tx:
                    self.assertEqual(len(tx.telemetry_history(10)), 3)
                    self.assertEqual(tx.state.vitals["source"], DEMO_STREAM_SOURCE)
                    self.assertEqual(tx.state.telemetry_protocol["retained_flags"], ["edema"])
            finally:
                first.dispose()
                second.dispose()

    def test_default_signal_varies_all_four_metrics_without_raising_alerts(self):
        readings = [simulated_vitals(float(moment)).model_dump() for moment in range(0, 150, 5)]
        for field in ("heart_rate", "spo2", "bp_sys", "bp_dia"):
            self.assertGreater(len({reading[field] for reading in readings}), 1)
        self.assertTrue(all(assess_telemetry(reading, []) is None for reading in readings))
