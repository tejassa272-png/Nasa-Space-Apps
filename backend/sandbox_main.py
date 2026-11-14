from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from judge_sandbox.router import router as sandbox_router

app = FastAPI(title="AstroTwin Hub")

# Lets the React frontend (Vite, port 5173) call this API from the browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sandbox_router)


@app.get("/")
def read_root():
    return {"status": "AstroTwin Server Offline-First Hub is Active", "system": "Nominal"}
