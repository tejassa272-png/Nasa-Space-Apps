"""HTTP delivery for AstroTwin edge telemetry."""

import os
from time import sleep, time
from uuid import uuid4

import requests


BASE_URL = os.getenv("ASTROTWIN_API_URL", "http://localhost:8000").rstrip("/")
RETRY_STATUS_CODES = {408, 429, 500, 502, 503, 504}


class TelemetryDeliveryError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool = False, status_code: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status_code = status_code


class TelemetryClient:
    def __init__(self, session: requests.Session, *, base_url: str = BASE_URL):
        self.session = session
        self.base_url = base_url

    def request(self, method: str, path: str, *, body: dict | None = None, sample_key: str | None = None) -> dict:
        headers = {"Idempotency-Key": sample_key} if sample_key else {}
        try:
            response = self.session.request(
                method, self.base_url + path, json=body, headers=headers, timeout=(3, 5), allow_redirects=False,
            )
        except (requests.ConnectionError, requests.Timeout) as error:
            raise TelemetryDeliveryError("Could not reach the telemetry API.", retryable=True) from error
        except requests.RequestException as error:
            raise TelemetryDeliveryError("Could not send a request to the telemetry API.") from error

        if not 200 <= response.status_code < 300:
            raise TelemetryDeliveryError(
                f"Telemetry API returned HTTP {response.status_code} for {path}.",
                retryable=response.status_code in RETRY_STATUS_CODES,
                status_code=response.status_code,
            )
        try:
            data = response.json()
        except ValueError as error:
            raise TelemetryDeliveryError(f"Expected a JSON response for {path}.") from error
        if not isinstance(data, dict):
            raise TelemetryDeliveryError(f"Unexpected JSON response for {path}.")
        return data

    def require_demo(self) -> None:
        """Verify the public dashboard advertises demo mode before sending synthetic values."""
        try:
            state = self.request("GET", "/api/state")
        except TelemetryDeliveryError as error:
            if error.status_code in {401, 403}:
                raise TelemetryDeliveryError("Synthetic readings require an AstroTwin demo server.") from error
            raise
        access = state.get("access")
        if not isinstance(access, dict) or access.get("demo") is not True:
            raise TelemetryDeliveryError("Synthetic readings require an AstroTwin demo server.")

    def send(self, reading: dict) -> dict:
        payload = dict(reading)
        payload.setdefault("observed_at", time())
        sample_key = uuid4().hex
        delays = iter((1, 2))
        while True:
            try:
                result = self.request("POST", "/api/tempus/vitals", body=payload, sample_key=sample_key)
                break
            except TelemetryDeliveryError as error:
                delay = next(delays, None)
                if not error.retryable or delay is None:
                    raise
                sleep(delay)

        if result.get("ok") is True and type(result.get("telemetry_id")) is int and type(result.get("applied")) is bool:
            return result
        if isinstance(result.get("vitals"), dict) and isinstance(result.get("tier"), str):
            return result
        raise TelemetryDeliveryError("Unexpected acknowledgement from the telemetry API.")


def receipt_label(receipt: dict) -> str:
    if "telemetry_id" in receipt:
        status = "applied" if receipt["applied"] else "stored in history"
        return f"reading {receipt['telemetry_id']} {status}"
    return receipt["tier"]
