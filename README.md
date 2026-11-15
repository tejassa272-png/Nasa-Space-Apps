# AstroTwin Crew Health Monitoring

Built by Team DevOperations to explore health monitoring during deep-space missions, where communication delays can limit real-time support from Earth.

AstroTwin accepts Tempus and wearable telemetry, tracks environmental alerts, records medical-kit stock changes, and serves the crew dashboard. PostgreSQL stores the current mission state, telemetry history, alert history, inventory, and audit events.

The interactive 3D crew twin lets you inspect modeled risks across six body systems. Use the Simulation Lab presets to preview a radiation storm or cabin scrubber failure, and apply the environment to see the backend assessment in demo mode. NASA lookups provide optional historical context. Telemetry and alert evaluation run locally.

## Run locally with Docker

For a fresh checkout, start Docker and run the commands below. If you work from a fork, clone your fork's URL instead.

```sh
git clone https://github.com/shsumukha381-ui/Nasa-Space-Apps.git
cd Nasa-Space-Apps
docker compose up --build --wait
```

Open [the dashboard](http://127.0.0.1:5173/) or [the demo API docs](http://127.0.0.1:8000/docs). Docker publishes the web and API ports on loopback and keeps PostgreSQL on a private network.

Demo mode runs a built-in **AstroTwin Simulator**. It sends a sample about every five seconds, even with the browser closed. Heart rate, oxygen saturation, and both blood pressure values are saved in PostgreSQL and plotted by sample time. The dashboard recalculates its modeled risk and readiness from fresh readings and the current environment. Risk and readiness are estimates for the demo and have no clinical validation.

A scenario or another telemetry source takes priority while it is sending readings. The automatic demo stream waits at least 30 seconds after the last submitted sample that updated the dashboard. To use your own stream in demo mode and see missing or stale readings if it stops, set `ASTROTWIN_DEMO_TELEMETRY=false` in `.env` and run `docker compose up -d --build --wait` again. Protected mode never generates readings.

To make changes, create a branch locally with `git switch -c my-changes`. After editing, run `docker compose up --build --wait` again to build and serve your changes. Push your branch with `git push -u origin my-changes` if you have write access to the repository. If you use a fork, push to your fork instead.

### Update an existing checkout

From the repository root on `main`, pull the current code and recreate the application containers with rebuilt images. This fixes startup errors when an older backend image lacks the readiness check, and replaces older Vite containers with the current dashboard. The PostgreSQL volume stays attached to the same Compose project.

```sh
git pull --ff-only origin main
docker compose up -d --build --force-recreate --wait backend frontend
docker compose ps
```

Run these commands on the computer where you want to open the dashboard. If a service is unhealthy, use `docker compose logs --tail=100 backend frontend` to see the startup error.

If another stack already owns either port, use a different Compose project and set alternate ports in the same shell.

```powershell
$env:ASTROTWIN_HTTP_PORT = "15173"
$env:ASTROTWIN_API_PORT = "18080"
docker compose -p astrotwin-local up --build --wait
```

The optional edge simulators require Python with `requests` installed. Run `python edge_nodes/tempus_simulator.py` for a continuous demo stream or add `--scenario hypoxia` to send a single scenario. Run `python edge_nodes/smart_watch_edge_node_.py` for a wearable simulation. Use one external source at a time and set `ASTROTWIN_API_URL` to the backend URL if it differs from `http://localhost:8000`. The dashboard also has a Simulation lab.

If you run the frontend through Vite instead of Docker, its proxy defaults to `http://127.0.0.1:8000`. Set `ASTROTWIN_DEV_API_URL` in the shell before starting Vite when the backend uses another address. If Docker already serves the dashboard on port 5173, run `npm --prefix frontend run dev -- --port 5174`.

## Configure a protected deployment

Store three distinct role keys and a PostgreSQL password in four private, single-value secret files outside the repository. Generate each value independently with `python -c "import secrets; print(secrets.token_urlsafe(32))"` or your secret manager. Set the environment variables to each file's absolute path. The production overlay mounts the files into the containers. A fresh Compose project gets a separate database volume. An existing PostgreSQL volume retains its existing credentials and stock records.

```powershell
$env:ASTROTWIN_OPERATOR_KEY_HOST_FILE = "C:\path\to\private\operator.key"
$env:ASTROTWIN_VIEWER_KEY_HOST_FILE = "C:\path\to\private\viewer.key"
$env:ASTROTWIN_TELEMETRY_KEY_HOST_FILE = "C:\path\to\private\telemetry.key"
$env:POSTGRES_PASSWORD_HOST_FILE = "C:\path\to\private\postgres.key"
docker compose -p astrotwin-production -f docker-compose.yml -f docker-compose.production.yml up --build --wait
```

Keep the published ports private and terminate TLS at your ingress before giving remote clients access. Route the browser through the frontend gateway so it can reach the API on the same origin. Use `DATABASE_URL` for managed PostgreSQL, or configure `DATABASE_URL_FILE` to point to a secret mounted in the backend container. See [.env.example](.env.example) for Compose settings.

Operators and viewers enter their respective keys in the dashboard. The browser keeps the key in memory for the open page. Give telemetry keys to ingest clients. Production starts with an empty kit by default and omits the debug routes. Provision inventory through the operator API.

| Endpoint | Production access | Behavior |
| --- | --- | --- |
| `GET /health/live`, `GET /health/ready` | Health probes | Process liveness and database readiness |
| `GET /api/state` | Viewer or operator | Current readings, staleness, active alerts, and kit status |
| `GET /api/telemetry`, `GET /api/protocols` | Viewer or operator | Newest-first history with `limit` and `before_id` |
| `POST /api/tempus/vitals` | Telemetry | Records readings and returns a receipt with `applied`. Send a stable `Idempotency-Key` when retrying the same reading |
| `POST /api/environment` | Telemetry or operator | Records a complete set of `co2`, `radiation`, `days`, and `sleep` values for the latest observation |
| `GET /api/inventory` | Viewer or operator | Inventory and recorded potency |
| `PUT /api/inventory` | Operator | Creates or replaces stock fields `medication`, `quantity`, `location`, and `potency_reduction_pct` |
| `POST /api/inventory/dispense` | Operator | Records one unit from an exact item name. Send the same `Idempotency-Key` when retrying the same action |
| `GET /api/audit` | Operator | Paginated alert and inventory audit events |
| `POST /api/nasa/sync` | Operator | Looks up a historical NASA reference window |

Send a header of the form `Authorization: Bearer <key>` on protected requests. Telemetry accepts integer `heart_rate`, `spo2`, `bp_sys`, and `bp_dia` values, plus a `device` name. Use `Clear`, `Optic Disc Edema Detected`, or `Not measured` for `ultrasound_status`, and `Normal`, `Bone Density Loss Detected`, or `Not measured` for `bone_status`. A missing scan does not clear a prior scan finding. Environment and telemetry alerts resolve independently as readings change.

Production telemetry and environment requests require `observed_at` as UTC Unix seconds, preferably with fractional seconds. Synchronize device and server clocks. A reading more than five seconds ahead of the server is rejected. Late telemetry is stored in history. Only newer observations update current readings and alerts.

Connect a device or an edge adapter that can submit measured values to keep protected telemetry current. Update frequency depends on the upstream device, including how often it actually measures blood pressure.

## Verify and maintain

```powershell
docker compose exec backend python -m pip check
docker compose exec backend python -m unittest discover -s tests -v
npm --prefix frontend run lint
npm --prefix frontend run build
```

To exercise the PostgreSQL concurrency test, set `ASTROTWIN_TEST_POSTGRES_URL` to a disposable PostgreSQL database whose test role can create schemas. It uses a temporary schema. Startup creates the new tables and preserves the existing `inventory` schema and rows. Schedule backups and verify restoration on a separate database. Set retention, monitoring, credential rotation, and network access according to your deployment.

AstroTwin currently tracks one mission telemetry stream, and API audit events identify the authenticated role. Deployments that need individual operator attribution require individual identity and audit integration. Telemetry alert rules run locally and deterministically. The project requirements remain installed, and optional NASA lookups run separately from alert evaluation.

Before using AstroTwin for real patient or crew care, validate the rules and device data against the intended use, review the pinned dependencies, and assess applicable regulatory and privacy requirements. [FDA guidance on clinical decision support software](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software)
