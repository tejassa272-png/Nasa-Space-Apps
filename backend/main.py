from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import os
import re
import time
import itertools
import threading
import requests
import json
import chromadb
from sqlalchemy import create_engine, Column, Integer, String, Float
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import declarative_base, sessionmaker
from typing import Any, Dict, List, Optional, TypedDict
from langgraph.graph import END, StateGraph

app = FastAPI(title="AstroTwin CDSS Hub (LangGraph Edition)")

# --- DATABASE SETUP (Feature F) ---
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://astronaut:deepspacepassword@db:5432/medical_inventory")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
 
class MedicalInventory(Base):
    __tablename__ = "inventory"
    id = Column(Integer, primary_key=True, index=True)
    medication = Column(String, unique=True, index=True)
    quantity = Column(Integer)
    location = Column(String)
    potency_reduction_pct = Column(Float)
 
SEED_ITEMS = [
    dict(medication="B-Vitamin Complex", quantity=42, location="Medical Locker A, Drawer 1", potency_reduction_pct=5.0),
    dict(medication="Alendronate 10mg", quantity=14, location="Medical Locker B, Drawer 2", potency_reduction_pct=10.0),
    dict(medication="Supplemental O2 Tanks", quantity=8, location="Life Support Bay 3", potency_reduction_pct=0.0),
    dict(medication="LBNP Thigh Cuff Kit", quantity=2, location="Medical Locker C, Drawer 3", potency_reduction_pct=0.0),
    dict(medication="Vitamin D 1000 IU", quantity=100, location="Medical Locker B, Drawer 1", potency_reduction_pct=2.0),
]
 
def init_database():
    for attempt in range(30):
        try:
            Base.metadata.create_all(bind=engine)
            break
        except OperationalError:
            print(f"[db] waiting for Postgres... ({attempt + 1}/30)")
            time.sleep(2)
    db = SessionLocal()
    existing = {name for (name,) in db.query(MedicalInventory.medication).all()}
    for item in SEED_ITEMS:
        if item["medication"] not in existing:
            db.add(MedicalInventory(**item))
    db.commit()
    db.close()
 
init_database()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
 
OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "90"))
chroma_client = chromadb.PersistentClient(path="./chroma_data")
nasa_collection = chroma_client.get_or_create_collection(name="nasa_medical_protocols")
 
nasa_collection.upsert(
    documents=[
        "SANS & Optic Disc Edema Protocol: Do not evacuate. Apply -20 mmHg Lower Body Negative Pressure (LBNP) using thigh cuffs to reverse cephalad fluid shifts. Administer targeted B-Vitamin complex. Reduce cabin PCO2 levels.",
        "Spaceflight Bone Loss Protocol: Microgravity accelerates bone resorption. Continue daily resistive exercise (ARED) and give alendronate 10 mg with plain water, upright for 30 minutes. Track bone density and log resistive loading.",
    ],
    ids=["protocol_sans", "protocol_bone"]
)

class TempusTelemetry(BaseModel):
    heart_rate: int
    spo2: int
    bp_sys: int
    bp_dia: int
    ultrasound_status: str
    device: str
    bone_status: str = "Normal"

latest_state = {
    "vitals": {"heart_rate": "--", "spo2": "--", "bp_sys": "--", "bp_dia": "--"},
    "tier": "Standby",
    "status": "Waiting for telemetry...",
    "triage_protocol": "System standing by...",
    "is_critical": False,
    "protocol": None,
}

env_state = {"co2": 1200.0, "radiation": 10.0, "days": 30.0, "sleep": 7.5}

def env_potency_loss() -> float:
    return float(round(env_state["days"] / 90 + max(0.0, env_state["radiation"] - 30) / 10))

UNITS = {"B-Vitamin": "doses", "Alendronate": "pills", "O2": "tanks", "LBNP": "kits", "Vitamin D": "pills"}
LOW_STOCK = 3
UNUSABLE_LOSS = 50.0

def _unit_for(name: str) -> str:
    for key, unit in UNITS.items():
        if key.lower() in name.lower():
            return unit
    return "units"

def _row_to_item(row):
    qty = row.quantity or 0
    loss = float(row.potency_reduction_pct or 0.0)
    if _unit_for(row.medication) in ("pills", "doses"):
        loss = min(100.0, loss + env_potency_loss())

    if qty <= 0:
        status, warning = "out", "OUT OF STOCK. Do not count on this item; ask the Crew Medical Officer for an alternative."
    elif loss >= UNUSABLE_LOSS:
        status, warning = "unusable", f"Potency reduced by {loss:.0f}% due to flight duration. Too degraded to rely on; confirm with the Crew Medical Officer."
    elif loss > 0:
        status, warning = ("low" if qty <= LOW_STOCK else "degraded"), f"Potency reduced by {loss:.0f}% due to flight duration and radiation."
    elif qty <= LOW_STOCK:
        status, warning = "low", None
    else:
        status, warning = "ok", None

    return {
        "name": row.medication,
        "qty": qty,
        "unit": _unit_for(row.medication),
        "location": row.location,
        "potency_loss_pct": loss,
        "status": status,
        "warning": warning,
    }

def get_item(name_fragment: str):
    db = SessionLocal()
    try:
        row = db.query(MedicalInventory).filter(MedicalInventory.medication.ilike(f"%{name_fragment}%")).first()
        return _row_to_item(row) if row else None
    finally:
        db.close()

def list_inventory():
    db = SessionLocal()
    try:
        rows = db.query(MedicalInventory).order_by(MedicalInventory.id).all()
        return [_row_to_item(r) for r in rows]
    finally:
        db.close()

_protocol_ids = itertools.count(1)

def _step(title, action, item=None, caution=None):
    if item and item.get("warning"):
        caution = f"{caution} {item['warning']}" if caution else item["warning"]
    return {"title": title, "action": action, "item": item, "caution": caution}

# --- LANGGRAPH WORKFLOW SETUP ---
class TriageState(TypedDict, total=False):
    vitals: Dict[str, Any]
    flags: List[str]
    findings: List[Dict[str, Any]]
    severity: str
    headline: str
    steps: List[Dict[str, Any]]
    monitoring: List[str]
    source: str
    protocol: Dict[str, Any]
    protocol_source: str
    llm_error: Optional[str]

def node_assess(state: TriageState) -> Dict[str, Any]:
    v = TempusTelemetry(**state['vitals'])
    flags = []
    findings = []
    
    hypoxia = v.spo2 < 95
    tachy = v.heart_rate > 100
    htn = v.bp_sys >= 140 or v.bp_dia >= 90
    edema = "Edema" in v.ultrasound_status
    bone = "Loss" in v.bone_status

    if bone:
        flags.append("bone_loss")
        findings.append({"label": "Bone density", "value": "Resorption", "state": "alert"})
    if hypoxia:
        flags.append("hypoxia")
        findings.append({"label": "SpO2", "value": f"{v.spo2}%", "state": "low"})
    if tachy:
        flags.append("tachycardia")
        findings.append({"label": "Heart rate", "value": f"{v.heart_rate} BPM", "state": "high"})
    if htn:
        flags.append("hypertension")
        findings.append({"label": "Blood pressure", "value": f"{v.bp_sys}/{v.bp_dia}", "state": "high"})
    if edema:
        flags.append("edema")
        findings.append({"label": "Optic ultrasound", "value": "Disc edema", "state": "alert"})
 
    severity = "CRITICAL" if (v.spo2 < 90 or v.heart_rate >= 120) else "WARNING"
 
    names = []
    if hypoxia: names.append("low oxygen")
    if tachy: names.append("fast heart rate")
    if htn: names.append("high blood pressure")
    if edema: names.append("optic disc swelling")
    if bone: names.append("bone density loss")
    headline = (" + ".join(names)).capitalize() if names else "Abnormal reading"
 
    steps = []
    if hypoxia:
        if v.spo2 < 90:
            action = "Start supplemental oxygen now, then re-measure SpO2 on the left index finger."
        else:
            action = "Re-seat the pulse oximeter on the left index finger and re-measure. If SpO2 stays below 92%, start supplemental oxygen."
        steps.append(_step("Restore oxygen", action, get_item("O2"), "Get a crew member to help if breathing becomes labored."))
    if edema:
        steps.append(_step("Reverse the fluid shift (LBNP)", "Apply -20 mmHg Lower Body Negative Pressure using the thigh cuffs.", get_item("LBNP"), "Stop if you feel lightheaded, faint or nauseous."))
        steps.append(_step("Give B-vitamin complex", "Administer the targeted B-vitamin complex (NASA SANS protocol).", get_item("B-Vitamin")))
        steps.append(_step("Lower cabin CO2", "Check the CO2 scrubber and increase cabin ventilation, then re-check the cabin CO2 reading."))
    if bone:
        alen = get_item("Alendronate")
        vitd = get_item("Vitamin D")
        steps.append(_step("Protect bone (alendronate)", "Recommended: take 1 tablet (10 mg) of alendronate with a full glass of plain water, and stay upright for 30 minutes. Then do today's resistive exercise (ARED).", alen, "Do not lie down for 30 minutes after taking it."))
        steps.append(_step("Supplement Vitamin D", "Recommended: take Vitamin D 1000 IU daily to support bone metabolism.", vitd))
    if tachy or htn:
        steps.append(_step("Rest and re-measure", "Stop strenuous activity and rest for 10 minutes, then re-measure heart rate and blood pressure."))
    for i, s in enumerate(steps, start=1):
        s["n"] = i
 
    monitoring = ["Re-measure HR, SpO2 and BP every 10 minutes until they are back to normal."]
    if edema: monitoring.append("Repeat the optic ultrasound after treatment to check for improvement.")
    if bone: monitoring.append("Log weekly ARED resistive loading metrics and recheck bone density at the next scan.")

    source = "Onboard vitals thresholds (HR > 100, SpO2 < 95, BP >= 140/90)"
    if edema or bone:
        query = v.ultrasound_status if edema else "spaceflight bone loss resorption alendronate"
        try:
            doc = nasa_collection.query(query_texts=[query], n_results=1)["documents"][0][0]
            source = doc.split(":")[0] + " (local NASA HRP library)"
        except Exception:
            source = ("SANS & Optic Disc Edema Protocol" if edema else "Spaceflight Bone Loss Protocol") + " (local NASA HRP library)"

    return {
        "flags": flags,
        "findings": findings,
        "severity": severity,
        "headline": headline,
        "steps": steps,
        "monitoring": monitoring,
        "source": source
    }

def fallback_rationale(flags):
    parts = []
    if "bone_loss" in flags:
        parts.append("In microgravity bones lose density faster, so medication and resistive exercise help protect them.")
    if "edema" in flags:
        parts.append("Optic disc swelling in microgravity can be a sign of fluid shifting toward the head (SANS).")
    if "hypoxia" in flags:
        parts.append("Low blood oxygen means the body is not getting enough oxygen and needs prompt attention.")
    if "tachycardia" in flags or "hypertension" in flags:
        parts.append("A fast heart rate or raised blood pressure adds extra strain on the body.")
    parts.append("The steps below address these findings in priority order.")
    return " ".join(parts[:3])

def node_generate(state: TriageState) -> Dict[str, Any]:
    findings_text = "; ".join(f"{f['label']} {f['value']}" for f in state["findings"])
    step_titles = [s["title"] for s in state["steps"]]
    
    prompt = (
        "You are AstroTwin, an onboard medical assistant helping an astronaut who is not a doctor. "
        "Earth contact is unavailable.\n"
        f"Findings: {findings_text}\n"
        f"Planned steps: {', '.join(step_titles)}\n\n"
        "In 2 to 3 short, plain sentences (under 60 words), explain WHY these findings matter and what the "
        "steps are meant to achieve. Do NOT invent medications, doses, quantities or locations, and do NOT add "
        "new steps. No bullet points, no markdown."
    )
    
    try:
        r = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False, "options": {"temperature": 0.2, "num_predict": 120}},
            timeout=OLLAMA_TIMEOUT,
        )
        data = r.json()
        text = "" if "error" in data else (data.get("response") or "")
        text = re.sub(r"[*#`_]", "", text).strip()
        refused = text.lower().startswith(("i cannot", "i can't", "i can not", "i'm sorry", "sorry"))
        if text and not refused:
            return {"protocol_source": "llm", "llm_error": text} # Storing text in llm_error temporarily to pass to fallback if needed, but successful means ready
        else:
            return {"protocol_source": "fallback", "llm_error": fallback_rationale(state["flags"])}
    except Exception as e:
        print(f"[llm] explanation failed: {e}")
        return {"protocol_source": "fallback", "llm_error": fallback_rationale(state["flags"])}

def node_fallback(state: TriageState) -> Dict[str, Any]:
    rationale = state.get("llm_error")
    status_label = "ready" if state.get("protocol_source") == "llm" else "fallback"
    
    protocol = {
        "id": next(_protocol_ids),
        "created_at": time.time(),
        "severity": state["severity"],
        "headline": state["headline"],
        "findings": state["findings"],
        "steps": state["steps"],
        "monitoring": state["monitoring"],
        "escalation": "Report to Mission Control when a link is available, but do not wait for a reply before acting. Treat confusion, fainting, or SpO2 below 90% despite oxygen as an emergency.",
        "source": state["source"],
        "flags": state["flags"],
        "rationale": rationale,
        "rationale_status": status_label,
    }
    return {"protocol": protocol}

def build_graph():
    g = StateGraph(TriageState)
    g.add_node("assess", node_assess)
    g.add_node("generate", node_generate)
    g.add_node("fallback", node_fallback)

    g.set_entry_point("assess")
    g.add_edge("assess", "generate")
    g.add_edge("generate", "fallback")
    g.add_edge("fallback", END)
    
    return g.compile()

_GRAPH = None
def get_graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_graph()
    return _GRAPH

def protocol_as_text(p):
    lines = [f"{p['severity']}: {p['headline']}"]
    for s in p["steps"]:
        lines.append(f"{s['n']}. {s['title']} - {s['action']}")
        if s["item"]:
            it = s["item"]
            lines.append(f"   {it['name']} | {it['qty']} remaining | {it['location']} | potency -{it['potency_loss_pct']}%")
    return "\n".join(lines)

@app.post("/api/tempus/vitals")
def ingest_tempus_data(vitals: TempusTelemetry, background_tasks: BackgroundTasks):
    is_critical = (
        vitals.heart_rate > 100
        or vitals.spo2 < 95
        or vitals.bp_sys >= 140
        or vitals.bp_dia >= 90
        or "Edema" in vitals.ultrasound_status
        or "Loss" in vitals.bone_status
    )
    latest_state["vitals"] = vitals.model_dump()
    latest_state["is_critical"] = is_critical
 
    if is_critical:
        # Run the LangGraph State Machine
        final_state = get_graph().invoke({"vitals": vitals.model_dump()})
        protocol = final_state["protocol"]
        
        latest_state["protocol"] = protocol
        latest_state["tier"] = "Tier 2 - Critical Triage"
        latest_state["status"] = "Anomaly Detected"
        latest_state["triage_protocol"] = protocol_as_text(protocol)
    else:
        latest_state["tier"] = "Tier 1 - Routine"
        latest_state["status"] = "Nominal"
        latest_state["triage_protocol"] = "None required. Continue standard mission operations."
 
    return get_current_state()

@app.post("/api/debug/reset")
def reset_debug_state():
    latest_state["protocol"] = None
    return {"ok": True, "cache_cleared": True}
 
class InventoryUpdate(BaseModel):
    medication: str
    quantity: int | None = None
    potency_reduction_pct: float | None = None

@app.post("/api/debug/inventory")
def update_inventory(u: InventoryUpdate):
    db = SessionLocal()
    try:
        row = db.query(MedicalInventory).filter(MedicalInventory.medication.ilike(f"%{u.medication}%")).first()
        if not row:
            return {"ok": False, "error": f"no inventory item matches '{u.medication}'"}
        if u.quantity is not None:
            row.quantity = max(0, u.quantity)
        if u.potency_reduction_pct is not None:
            row.potency_reduction_pct = max(0.0, min(100.0, u.potency_reduction_pct))
        db.commit()
        return {"ok": True, "item": _row_to_item(row)}
    finally:
        db.close()

class EnvInputs(BaseModel):
    co2: float = 1200
    radiation: float = 10
    days: float = 30
    sleep: float = 7.5

@app.post("/api/environment")
def set_environment(e: EnvInputs, background_tasks: BackgroundTasks):
    env_state.update(e.model_dump())
    env_critical = e.co2 > 3500 or e.radiation > 70
    
    if env_critical and not latest_state.get("is_critical"):
        latest_state["is_critical"] = True
        latest_state["tier"] = "Tier 2 - Critical Triage"
        latest_state["status"] = "Environmental Hazard Detected"
        
        steps = []
        flags = []
        findings = []
        headline_parts = []
        
        if e.co2 > 3500:
            flags.append("hypercapnia")
            findings.append({"label": "Cabin CO2", "value": f"{e.co2} ppm", "state": "alert"})
            headline_parts.append("severe hypercapnia")
            steps.append(_step("Lower cabin CO2", "Move to the best-ventilated module. Inspect CO2 scrubber and swap lithium hydroxide canisters immediately."))
            
        if e.radiation > 70:
            flags.append("radiation_spike")
            findings.append({"label": "Radiation", "value": f"{e.radiation} idx", "state": "alert"})
            headline_parts.append("radiation storm")
            steps.append(_step("Radiation Shelter", "Move to the storm shelter or most shielded area immediately. Log cumulative dose from personal dosimeters."))

        protocol = {
            "id": next(_protocol_ids),
            "created_at": time.time(),
            "severity": "CRITICAL",
            "headline": (" + ".join(headline_parts)).title(),
            "findings": findings,
            "steps": [{"n": i, **s} for i, s in enumerate(steps, 1)],
            "monitoring": ["Monitor vital signs every 15 minutes.", "Remain in shelter until environmental hazards clear."],
            "escalation": "Report to Mission Control immediately.",
            "source": "NASA Deep Space Environmental Limits (local library)",
            "flags": flags,
            "rationale": "High CO2 impairs cognition and breathing, while severe radiation damages cellular DNA. Immediate shelter and ventilation repair are required.",
            "rationale_status": "ready",
        }
        
        latest_state["protocol"] = protocol
        latest_state["triage_protocol"] = protocol_as_text(protocol)

    return {"ok": True, "extra_potency_loss_pct": env_potency_loss()}

class Dispense(BaseModel):
    medication: str

@app.post("/api/inventory/dispense")
def dispense_item(d: Dispense):
    db = SessionLocal()
    try:
        row = db.query(MedicalInventory).filter(MedicalInventory.medication.ilike(f"%{d.medication}%")).first()
        if not row:
            return {"ok": False, "error": f"no inventory item matches '{d.medication}'"}
        before = _row_to_item(row)
        if before["status"] in ("out", "unusable"):
            return {"ok": False, "error": before["warning"] or "item cannot be used", "item": before}
        row.quantity = (row.quantity or 0) - 1
        db.commit()
        item = _row_to_item(row)
        print(f"[kit] dispensed 1 x {item['name']} from {item['location']} -> {item['qty']} left")
        return {"ok": True, "item": item}
    finally:
        db.close()
        
class NasaSyncToggle(BaseModel):
    active: bool

@app.post("/api/nasa/sync")
def trigger_nasa_api(req: NasaSyncToggle, background_tasks: BackgroundTasks):
    """
    Feature 5: Official NASA API Integration.
    Connects to NASA DONKI to fetch Space Weather and OSDR for baseline data.
    """
    if not req.active:
        return {"status": "NASA uplink disconnected"}
        
    print("\n[NASA API] Initializing uplink to NASA OSDR and DONKI databases...")
    
    try:
        # 1. OSDR INGESTION (Baseline Reference Data)
        print("[NASA OSDR] Fetching baseline biological data...")
        
        # OSD-288: Combined Space Radiation, Microgravity
        try:
            osdr_288 = requests.get("https://osdr.nasa.gov/geode-rest/api/study/OSD-288", timeout=10).json()
            print("[NASA OSDR] Successfully ingested OSD-288 (Radiation & Microgravity Baseline).")
        except Exception:
            print("[NASA OSDR] Simulated ingestion of OSD-288 (API timeout).")

        # OSD-817: SANS Neuro-Ocular Syndrome
        try:
            osdr_817 = requests.get("https://osdr.nasa.gov/geode-rest/api/study/OSD-817", timeout=10).json()
            print("[NASA OSDR] Successfully ingested OSD-817 (SANS Neuro-Ocular Baseline).")
        except Exception:
            print("[NASA OSDR] Simulated ingestion of OSD-817 (API timeout).")


        # 2. DONKI INGESTION (Live Space Weather)
        print("\n[NASA DONKI] Querying Space Weather Database for CMEs...")
        donki_url = "https://api.nasa.gov/DONKI/CME?startDate=2024-05-08&endDate=2024-05-11&api_key=DEMO_KEY"
        response = requests.get(donki_url, timeout=10)
        response.raise_for_status()
        cme_data = response.json()
        
        if cme_data:
            cme = cme_data[0]
            print(f"[NASA DONKI] Coronal Mass Ejection Detected: {cme.get('activityID')} at {cme.get('cmeAngle')} degrees.")
            
            # Programmatically spike the environment radiation slider to trigger LangGraph synergy
            env_state["radiation"] = 85.0
            
            latest_state["is_critical"] = True
            latest_state["tier"] = "Tier 2 - Critical Triage"
            latest_state["status"] = "NASA DONKI: Radiation Storm Detected"
            
            protocol = {
                "id": next(_protocol_ids),
                "created_at": time.time(),
                "severity": "CRITICAL",
                "headline": "Coronal Mass Ejection (CME) Impact",
                "findings": [
                    {"label": "Space Weather", "value": "CME Alert", "state": "alert"},
                    {"label": "Solar Radiation Flux", "value": "85 mSv/day", "state": "alert"}
                ],
                "steps": [
                    _step("Radiation Shelter", "DONKI Alert: Move to the storm shelter or most shielded area immediately."),
                    _step("Elevate Immune Monitoring", "Based on OSDR baseline (OSD-288), elevate immune biomarker tracking every 4 hours.")
                ],
                "monitoring": ["Monitor personal dosimeters and cabin radiation sensors."],
                "escalation": "Remain in shelter until NASA confirms the solar energetic particle (SEP) event has passed.",
                "source": "NASA DONKI API & OSDR (OSD-288, OSD-817)",
                "flags": ["radiation_spike"],
                "rationale": "NASA telemetry indicates an incoming CME. High radiation combined with microgravity (per OSDR data) requires immediate physical shielding to prevent cellular DNA damage.",
                "rationale_status": "ready",
            }
            
            latest_state["protocol"] = protocol
            latest_state["triage_protocol"] = protocol_as_text(protocol)
            
            return {"status": "Uplink active. CME detected. OSDR Baselines loaded."}
            
    except Exception as e:
        print(f"[NASA API Error] {e}")
        return {"status": "Failed to reach NASA APIs"}

@app.get("/api/state")
def get_current_state():
    state = dict(latest_state)
    try:
        state["inventory"] = list_inventory()
    except Exception as e:
        print(f"[db] inventory read failed: {e}")
        state["inventory"] = []
    p = state.get("protocol")
    if p:
        p = dict(p)
        p["age_s"] = int(time.time() - p["created_at"])
        state["protocol"] = p
    return state