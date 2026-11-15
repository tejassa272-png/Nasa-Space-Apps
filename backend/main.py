import hashlib
import logging
from asyncio import Event, create_task
from collections.abc import Callable
from contextlib import asynccontextmanager
from time import time
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from starlette.types import ASGIApp, Receive, Scope, Send

from auth import Principal, allow, digest
from demo_telemetry import run_demo_stream
from monitoring import dashboard, extra_potency_loss, present_inventory, present_item, record_vitals, update_alert
from nasa import NasaReferenceError, fetch_nasa_reference
from schemas import (
    DashboardState, Dispense, EnvInputs, InventoryRecord, InventoryUpdate, NasaSyncToggle,
    TelemetryReceipt, TempusTelemetry,
)
from settings import Settings
from storage import IdempotencyConflict, InventoryMatchConflict, InventoryOutOfStock, Storage
from triage import assess_environment

logger = logging.getLogger("uvicorn.error")
Reader = Annotated[Principal, Depends(allow("operator", "viewer"))]
Operator = Annotated[Principal, Depends(allow("operator"))]
Telemetry = Annotated[Principal, Depends(allow("telemetry"))]
EnvironmentWriter = Annotated[Principal, Depends(allow("operator", "telemetry"))]
IdempotencyKey = Annotated[str | None, Header(alias="Idempotency-Key", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._~-]+$")]
PageSize = Annotated[int, Query(ge=1, le=100)]
Cursor = Annotated[int | None, Query(ge=1)]


class BodySizeLimit:
    """Bound the actual body length, including chunked requests."""

    def __init__(self, app: ASGIApp, max_bytes: int = 16_384):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            await self.app(scope, receive, send)
            return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > self.max_bytes:
                await JSONResponse({"detail": "Request body is too large."}, status_code=413)(scope, receive, send)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        sent_body = False

        async def replay():
            nonlocal sent_body
            if sent_body:
                return await receive()
            sent_body = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)


def page_for(read: Callable[[int, int | None], list[dict]], limit: int, before_id: int | None) -> dict:
    results = read(limit + 1, before_id)
    return {"items": results[:limit], "next_before_id": results[limit - 1]["id"] if len(results) > limit else None}


def payload_hash(payload: TempusTelemetry | Dispense) -> str:
    return hashlib.sha256(payload.model_dump_json().encode("utf-8")).hexdigest()


def observation_time(settings: Settings, observed_at: float | None, received_at: float) -> float:
    if observed_at is None:
        if not settings.demo:
            raise HTTPException(422, "Production readings require observed_at in UTC epoch seconds.")
        return received_at
    if observed_at > received_at + 5:
        raise HTTPException(422, "observed_at cannot be more than five seconds ahead of the server clock.")
    return observed_at


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = Storage(settings.database)
        app.state.store = store
        try:
            await run_in_threadpool(store.initialize, settings.seed_inventory)
            stopped = Event()
            demo_stream = create_task(run_demo_stream(store, settings, stopped)) if settings.demo_stream_enabled else None
            try:
                yield
            finally:
                if demo_stream is not None:
                    stopped.set()
                    await demo_stream
        finally:
            await run_in_threadpool(store.dispose)

    app = FastAPI(
        title="AstroTwin Crew Health API",
        version="2.0.0",
        docs_url="/docs" if settings.demo else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.demo else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.key_digests = {role: digest(key) for role, key in settings.keys.items()}
    app.add_middleware(BodySizeLimit)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["GET", "POST", "PUT"],
            allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
        )

    def get_store(request: Request) -> Storage:
        return request.app.state.store

    @app.middleware("http")
    async def request_metadata(request: Request, call_next):
        request.state.request_id = uuid4().hex
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        errors = [{"location": error["loc"], "message": error["msg"]} for error in exc.errors()]
        return JSONResponse({"detail": "Invalid request.", "errors": errors}, status_code=422)

    @app.exception_handler(IdempotencyConflict)
    @app.exception_handler(InventoryMatchConflict)
    @app.exception_handler(InventoryOutOfStock)
    async def conflict(_request: Request, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError):
        logger.error("astro_database_unavailable request_id=%s error_type=%s", request.state.request_id, type(exc).__name__)
        return JSONResponse({"detail": "Database temporarily unavailable."}, status_code=503, headers={"Retry-After": "3"})

    @app.get("/health/live")
    def live():
        return {"status": "live"}

    @app.get("/health/ready")
    def ready(store: Storage = Depends(get_store)):
        store.ping()
        return {"status": "ready"}

    @app.get("/api/state", response_model=DashboardState)
    def state(principal: Reader, store: Storage = Depends(get_store)):
        with store.read() as tx:
            return dashboard(tx, settings, principal)

    @app.get("/api/telemetry")
    def telemetry_history(principal: Reader, limit: PageSize = 40, before_id: Cursor = None, store: Storage = Depends(get_store)):
        with store.read() as tx:
            return page_for(tx.telemetry_history, limit, before_id)

    @app.get("/api/protocols")
    def protocol_history(principal: Reader, limit: PageSize = 40, before_id: Cursor = None, store: Storage = Depends(get_store)):
        with store.read() as tx:
            return page_for(tx.protocol_history, limit, before_id)

    @app.get("/api/audit")
    def audit_history(principal: Operator, limit: PageSize = 40, before_id: Cursor = None, store: Storage = Depends(get_store)):
        with store.read() as tx:
            return page_for(tx.audit_history, limit, before_id)

    @app.post("/api/tempus/vitals", response_model=DashboardState | TelemetryReceipt, response_model_exclude_unset=True)
    def ingest_vitals(vitals: TempusTelemetry, principal: Telemetry, key: IdempotencyKey = None, store: Storage = Depends(get_store)):
        received_at = time()
        observed_at = observation_time(settings, vitals.observed_at, received_at)
        reading = vitals.model_dump(exclude_none=True)
        fingerprint = payload_hash(vitals) if key else ""
        with store.write() as tx:
            cached = tx.get_idempotent_result("telemetry", principal.role, key, fingerprint) if key else None
            if cached is not None:
                return cached
            reading_id, applied = record_vitals(tx, reading, principal.role, received_at=received_at, observed_at=observed_at)
            result = dashboard(tx, settings, principal) if settings.demo else {
                "ok": True, "telemetry_id": reading_id, "received_at": received_at, "applied": applied,
            }
            if key:
                tx.save_idempotent_result("telemetry", principal.role, key, fingerprint, result)
            return result

    @app.post("/api/environment")
    def set_environment(inputs: EnvInputs, principal: EnvironmentWriter, store: Storage = Depends(get_store)):
        if not settings.demo and not {"co2", "radiation", "days", "sleep"}.issubset(inputs.model_fields_set):
            raise HTTPException(422, "All four environment measurements are required for a production update.")
        observed_at = observation_time(settings, inputs.observed_at, time())
        environment = {**inputs.model_dump(), "observed_at": observed_at}
        with store.write() as tx:
            previous_time = tx.state.environment.get("observed_at")
            if previous_time is not None and observed_at <= previous_time:
                return {"ok": True, "applied": False, "extra_potency_loss_pct": extra_potency_loss(tx.state.environment)}
            tx.set_environment(environment)
            update_alert(tx, "environment", assess_environment(environment), principal.role)
            loss = extra_potency_loss(environment)
            tx.audit("environment.updated", principal.role, {"extra_potency_loss_pct": loss})
            return {"ok": True, "applied": True, "extra_potency_loss_pct": loss}

    @app.get("/api/inventory")
    def inventory(principal: Reader, store: Storage = Depends(get_store)):
        with store.read() as tx:
            return present_inventory(tx)

    @app.put("/api/inventory")
    def set_inventory(record: InventoryRecord, principal: Operator, store: Storage = Depends(get_store)):
        fields = record.model_dump(exclude={"medication"})
        with store.write() as tx:
            item = tx.find_inventory(record.medication)
            if item is None:
                item = tx.create_inventory(record.medication, **fields)
            else:
                tx.update_inventory(item, **fields)
            tx.audit("inventory.updated", principal.role, {"medication": item.medication, "quantity": item.quantity})
            return {"ok": True, "item": present_item(item, tx.state.environment)}

    @app.post("/api/inventory/dispense")
    def dispense(payload: Dispense, principal: Operator, key: IdempotencyKey = None, store: Storage = Depends(get_store)):
        if not settings.demo and not key:
            raise HTTPException(400, "An Idempotency-Key header is required to record a dispense.")
        fingerprint = payload_hash(payload) if key else ""
        with store.write() as tx:
            cached = tx.get_idempotent_result("dispense", principal.role, key, fingerprint) if key else None
            if cached is not None:
                return cached
            item = tx.find_inventory(payload.medication)
            if item is None:
                raise HTTPException(404, "Inventory item not found.")
            before = present_item(item, tx.state.environment)
            if before["status"] in {"out", "unusable"}:
                raise HTTPException(409, before["warning"])
            tx.decrement_inventory(item)
            tx.audit("inventory.dispensed", principal.role, {"medication": item.medication, "quantity": item.quantity})
            result = {"ok": True, "item": present_item(item, tx.state.environment)}
            if key:
                tx.save_idempotent_result("dispense", principal.role, key, fingerprint, result)
            return result

    @app.post("/api/nasa/sync")
    def nasa_reference(toggle: NasaSyncToggle, principal: Operator):
        if not toggle.active:
            return {"status": "NASA reference request inactive.", "historical": True}
        try:
            return fetch_nasa_reference(settings.nasa_api_key)
        except NasaReferenceError as exc:
            raise HTTPException(502, "The backend could not reach the NASA records service.") from exc

    if settings.demo:
        @app.post("/api/debug/reset")
        def debug_reset(store: Storage = Depends(get_store)):
            with store.write() as tx:
                update_alert(tx, "telemetry", None, "demo")
                update_alert(tx, "environment", None, "demo")
                tx.state.last_protocol = None
                tx.audit("demo.alerts.reset", "demo")
                return {"ok": True, "cache_cleared": True}

        @app.post("/api/debug/inventory")
        def debug_inventory(payload: InventoryUpdate, store: Storage = Depends(get_store)):
            with store.write() as tx:
                item = tx.find_inventory_fragment(payload.medication)
                if item is None:
                    return {"ok": False, "error": "No inventory item matches that name."}
                tx.update_inventory(item, quantity=payload.quantity, potency_reduction_pct=payload.potency_reduction_pct)
                tx.audit("demo.inventory.updated", "demo", {"medication": item.medication, "quantity": item.quantity})
                return {"ok": True, "item": present_item(item, tx.state.environment)}

    return app


app = create_app()
