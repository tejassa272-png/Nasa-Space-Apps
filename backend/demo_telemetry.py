"""Publish clearly identified synthetic samples through the normal telemetry path."""

import logging
from asyncio import Event, wait_for
from math import sin, tau
from time import time

from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool

from monitoring import DEMO_STREAM_SOURCE, demo_stream_resume_at, record_vitals
from schemas import TempusTelemetry
from settings import Settings
from storage import Storage

logger = logging.getLogger("uvicorn.error")


def simulated_vitals(observed_at: float) -> TempusTelemetry:
    activity = (1 + sin(tau * (observed_at % 75) / 75)) / 2
    breathing = sin(tau * (observed_at % 23) / 23)
    return TempusTelemetry(
        heart_rate=round(69 + 27 * activity + 2 * breathing),
        spo2=round(99 - 3 * activity + breathing),
        bp_sys=round(110 + 20 * activity + 2 * breathing),
        bp_dia=round(70 + 13 * activity + breathing),
        ultrasound_status="Not measured",
        bone_status="Not measured",
        device="AstroTwin Simulator",
        observed_at=observed_at,
    )


def publish_demo_sample(store: Storage, settings: Settings) -> float:
    interval = settings.demo_sample_seconds
    if not settings.demo_stream_enabled:
        return interval

    # The locked mission row coordinates timing with other workers and incoming devices.
    with store.write() as tx:
        now = time()
        last_received = tx.state.last_telemetry_at
        if last_received is not None:
            due_at = demo_stream_resume_at(tx, settings) or last_received + interval
            if due_at > now:
                return due_at - now

        reading = simulated_vitals(now).model_dump()
        reading["source"] = DEMO_STREAM_SOURCE
        record_vitals(tx, reading, DEMO_STREAM_SOURCE, received_at=now, observed_at=now)
    return interval


async def run_demo_stream(store: Storage, settings: Settings, stopped: Event) -> None:
    while not stopped.is_set():
        try:
            delay = await run_in_threadpool(publish_demo_sample, store, settings)
        except SQLAlchemyError as error:
            logger.warning("astro_demo_stream_database_unavailable error_type=%s", type(error).__name__)
            delay = settings.demo_sample_seconds

        try:
            await wait_for(stopped.wait(), timeout=delay)
        except TimeoutError:
            pass
