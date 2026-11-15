from time import time

from auth import Principal
from settings import Settings
from storage import MedicalInventory, Transaction
from triage import assess_telemetry, protocol_as_text

DEMO_STREAM_SOURCE = "demo_stream"

UNITS = {
    "b-vitamin": "doses", "alendronate": "pills", "o2": "tanks",
    "lbnp": "kits", "vitamin d": "pills",
}


def extra_potency_loss(environment: dict) -> float:
    return min(100.0, float(round(environment["days"] / 90 + max(0.0, environment["radiation"] - 30) / 10)))


def present_item(row: MedicalInventory, environment: dict) -> dict:
    name = row.medication
    unit = next((unit for prefix, unit in UNITS.items() if prefix in name.lower()), "units")
    quantity = max(0, row.quantity or 0)
    loss = max(0.0, row.potency_reduction_pct or 0.0)
    if unit in {"pills", "doses"}:
        loss += extra_potency_loss(environment)
    loss = min(100.0, loss)

    warning = None
    if quantity == 0:
        status = "out"
        warning = "Out of stock. Check with the Crew Medical Officer for an alternative."
    elif loss >= 50:
        status = "unusable"
        warning = f"Recorded potency reduction is {loss:.0f}%. Contact the Crew Medical Officer."
    else:
        status = "low" if quantity <= 3 else "degraded" if loss > 0 else "ok"
        if loss > 0:
            warning = f"Recorded potency reduction is {loss:.0f}%."
    return {
        "name": name, "qty": quantity, "unit": unit, "location": row.location or "Location unrecorded",
        "potency_loss_pct": loss, "status": status, "warning": warning,
    }


def present_inventory(tx: Transaction) -> list[dict]:
    return [present_item(item, tx.state.environment) for item in tx.list_inventory()]


def assessment_evidence(reading: dict, previous: dict | None) -> tuple[dict, list[str]]:
    """A sample without a scan cannot resolve a previously flagged scan."""
    evidence = reading.copy()
    retained = []
    previous_flags = previous["flags"] if previous else []
    for field, flag, finding in (
        ("ultrasound_status", "edema", "Optic Disc Edema Detected"),
        ("bone_status", "bone_loss", "Bone Density Loss Detected"),
    ):
        if reading[field] == "Not measured" and flag in previous_flags:
            evidence[field] = finding
            retained.append(flag)
    return evidence, retained


def update_alert(tx: Transaction, source: str, candidate: dict | None, actor: str) -> None:
    field = f"{source}_protocol"
    previous = getattr(tx.state, field)
    if candidate is None:
        if previous:
            setattr(tx.state, field, None)
            tx.audit("alert.cleared", actor, {"source": source, "protocol_id": previous["id"]})
        return

    candidate = {**candidate, "kind": source}
    if previous and (previous["severity"], previous["flags"]) == (candidate["severity"], candidate["flags"]):
        updated = {**candidate, "id": previous["id"], "created_at": previous["created_at"]}
        if tx.state.last_protocol and tx.state.last_protocol["id"] == previous["id"]:
            tx.state.last_protocol = updated
    else:
        updated = tx.new_protocol(candidate)
        if previous:
            tx.audit("alert.superseded", actor, {"source": source, "protocol_id": previous["id"], "replacement_id": updated["id"]})
        tx.audit("alert.raised", actor, {"source": source, "protocol_id": updated["id"], "severity": updated["severity"]})
    setattr(tx.state, field, updated)


def record_vitals(tx: Transaction, reading: dict, actor: str, *, received_at: float, observed_at: float) -> tuple[int, bool]:
    previous_time = tx.state.vitals.get("observed_at", tx.state.last_telemetry_at)
    applied = previous_time is None or observed_at > previous_time
    reading_id = tx.record_telemetry(reading, actor, received_at=received_at, apply=applied)
    if applied:
        evidence, retained = assessment_evidence(reading, tx.state.telemetry_protocol)
        candidate = assess_telemetry(evidence, present_inventory(tx))
        if retained and candidate:
            candidate["retained_flags"] = retained
            candidate["rationale"] += " A prior scan finding is still active because this sample did not include that scan."
        update_alert(tx, "telemetry", candidate, actor)
    return reading_id, applied


def demo_stream_resume_at(tx: Transaction, settings: Settings) -> float | None:
    last_received = tx.state.last_telemetry_at
    if not settings.demo_stream_enabled or last_received is None or tx.state.vitals.get("source") == DEMO_STREAM_SOURCE:
        return None
    return last_received + max(30, settings.stale_seconds)


def dashboard(tx: Transaction, settings: Settings, principal: Principal) -> dict:
    state = tx.state
    now = time()
    active = sorted(
        (alert for alert in (state.telemetry_protocol, state.environment_protocol) if alert),
        key=lambda alert: (alert["severity"] == "CRITICAL", alert["id"]),
        reverse=True,
    )
    alerts = [{**alert, "age_s": max(0, int(now - alert["created_at"]))} for alert in active]
    last = state.last_protocol
    protocol = alerts[0] if alerts else ({**last, "age_s": max(0, int(now - last["created_at"]))} if last else None)
    received_at = state.last_telemetry_at
    observed_at = state.vitals.get("observed_at", received_at)
    stale = observed_at is not None and now - observed_at > settings.stale_seconds
    resumes_at = demo_stream_resume_at(tx, settings)

    if alerts:
        status = "Environmental Hazard Detected" if alerts[0]["kind"] == "environment" else "Anomaly Detected"
        tier, summary = "Tier 2 - Triage", protocol_as_text(alerts[0])
    elif stale:
        status, tier, summary = "Telemetry stale", "Standby", "Waiting for a fresh telemetry sample."
    elif received_at is not None:
        status, tier = "Nominal", "Tier 1 - Routine"
        summary = "None required. Continue standard mission operations."
    else:
        status, tier, summary = "Waiting for telemetry...", "Standby", "System standing by..."

    return {
        "vitals": state.vitals, "environment": state.environment, "status": status, "tier": tier, "triage_protocol": summary,
        "is_critical": bool(alerts), "protocol": protocol, "active_protocols": alerts,
        "inventory": present_inventory(tx), "telemetry_received_at": received_at,
        "telemetry_observed_at": observed_at, "telemetry_revision": tx.latest_telemetry_id(),
        "telemetry_stale": stale,
        "demo_stream": {
            "enabled": settings.demo_stream_enabled,
            "interval_seconds": settings.demo_sample_seconds,
            "resumes_at": resumes_at if resumes_at is not None and resumes_at > now else None,
        },
        "access": {"demo": settings.demo, "role": principal.role, "can_dispense": principal.can_dispense},
    }
