from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Location = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
UltrasoundStatus = Literal["Clear", "Optic Disc Edema Detected", "Not measured"]
BoneStatus = Literal["Normal", "Bone Density Loss Detected", "Not measured"]


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class TempusTelemetry(Payload):
    heart_rate: int = Field(gt=0, le=350)
    spo2: int = Field(ge=0, le=100)
    bp_sys: int = Field(gt=0, le=350)
    bp_dia: int = Field(gt=0, le=350)
    ultrasound_status: UltrasoundStatus
    device: Name
    bone_status: BoneStatus = "Not measured"
    observed_at: float | None = Field(default=None, ge=0, le=32_503_680_000)

    @model_validator(mode="after")
    def verify_pressure_order(self) -> "TempusTelemetry":
        if self.bp_dia > self.bp_sys:
            raise ValueError("Diastolic pressure cannot exceed systolic pressure.")
        return self


class EnvInputs(Payload):
    co2: float = Field(default=1200, ge=0, le=100_000)
    radiation: float = Field(default=10, ge=0, le=100)
    days: float = Field(default=30, ge=0, le=36_525)
    sleep: float = Field(default=7.5, ge=0, le=24)
    observed_at: float | None = Field(default=None, ge=0, le=32_503_680_000)


class Dispense(Payload):
    medication: Name


class InventoryRecord(Payload):
    medication: Name
    quantity: int = Field(ge=0, le=1_000_000)
    location: Location
    potency_reduction_pct: float = Field(ge=0, le=100)


class InventoryUpdate(Payload):
    medication: Name
    quantity: int | None = Field(default=None, ge=0, le=1_000_000)
    potency_reduction_pct: float | None = Field(default=None, ge=0, le=100)


class NasaSyncToggle(Payload):
    active: bool


class Access(BaseModel):
    demo: bool
    role: Literal["viewer", "operator", "telemetry", "demo"]
    can_dispense: bool


class DemoStreamState(BaseModel):
    enabled: bool
    interval_seconds: float
    resumes_at: float | None


class DashboardState(BaseModel):
    vitals: dict[str, Any]
    # Older cached idempotency responses may predate these fields.
    environment: EnvInputs | None = None
    status: str
    tier: str
    triage_protocol: str
    is_critical: bool
    protocol: dict[str, Any] | None
    active_protocols: list[dict[str, Any]]
    inventory: list[dict[str, Any]]
    telemetry_received_at: float | None
    telemetry_observed_at: float | None
    telemetry_revision: int | None
    telemetry_stale: bool
    demo_stream: DemoStreamState | None = None
    access: Access


class TelemetryReceipt(BaseModel):
    ok: Literal[True]
    telemetry_id: int
    received_at: float
    applied: bool
