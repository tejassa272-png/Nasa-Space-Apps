"""
AstroTwin Hub-and-Spoke Edge Node Simulator
Represents a low-power, GPU-less wearable biomonitor running quantized TinyML.
"""
import time
import random
import requests

HUB_URL = "http://localhost:8000/api/tempus/vitals"
DEVICE = "Astro-Watch Series 1 (Edge Node)"

def generate_vitals(anomaly=False):
    if anomaly:
        return {
            "heart_rate": random.randint(105, 120),  # HR > 100
            "spo2": random.randint(88, 94),          # SpO2 < 95
            "bp_sys": random.randint(120, 135),
            "bp_dia": random.randint(80, 90),
            "ultrasound_status": "Clear",            # Wearables lack ultrasound
            "bone_status": "Normal",                 # Wearables lack DEXA scans
            "device": DEVICE
        }
    else:
        return {
            "heart_rate": random.randint(60, 80),
            "spo2": random.randint(97, 100),
            "bp_sys": random.randint(110, 120),
            "bp_dia": random.randint(70, 80),
            "ultrasound_status": "Clear",
            "bone_status": "Normal",
            "device": DEVICE
        }

def main():
    print(f"[{DEVICE}] Booting...")
    print("[EDGE NODE] Running local quantized anomaly detection.")
    print("[EDGE NODE] Network radio is SLEEPING to conserve battery.")
    print("Press Ctrl+C to stop.\n")
    
    tick = 0
    try:
        while True:
            # For the hackathon pitch, automatically trigger the anomaly on the 5th tick
            is_anomaly = (tick == 4)
            vitals = generate_vitals(anomaly=is_anomaly)
            
            # --- Feature G: The Edge Logic Gate ---
            # Completely independent of the heavy LLM backend until this threshold is breached.
            if vitals["heart_rate"] > 100 and vitals["spo2"] < 95:
                print(f"\n[EDGE AI ALERT] Critical threshold breached! (HR: {vitals['heart_rate']}, SpO2: {vitals['spo2']}%)")
                print("--> Waking up network radio...")
                print(f"--> Transmitting JSON payload to heavy CDSS Hub...")
                
                try:
                    res = requests.post(HUB_URL, json=vitals, timeout=5)
                    res.raise_for_status()
                    print("--> Transmission successful. Hub is generating LangGraph protocol.")
                except requests.exceptions.ConnectionError:
                    print("--> ERROR: Spacecraft Hub server is unreachable.")
            else:
                # Nominal state: Processed locally, bandwidth and power saved.
                print(f"[Local Log] HR: {vitals['heart_rate']} | SpO2: {vitals['spo2']}% | Status: Nominal (Radio OFF)")
            
            tick = (tick + 1) % 10
            time.sleep(2.5)
            
    except KeyboardInterrupt:
        print(f"\n[{DEVICE}] Shutting down.")

if __name__ == "__main__":
    main()