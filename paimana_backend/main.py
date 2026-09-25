"""
main.py -- FastAPI backend for Construction Bid Cost-Overrun Dashboard
Loads the dataset + trained models on startup, serves project data and predictions.
"""

import re
import os
import time
import json
import uuid
from typing import Optional, Literal
from datetime import datetime, timedelta, timezone
import numpy as np
import pandas as pd
import joblib
from fastapi import FastAPI, HTTPException, Query, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sklearn.linear_model import LinearRegression, LogisticRegression
from dotenv import load_dotenv
from google import genai

from auth import (
    authenticate_user,
    create_access_token,
    get_current_user,
    get_user,
    load_users,
    save_users,
    pwd_context,
    require_role,
    require_verified_user,
    VALID_ROLES,
)

load_dotenv()
_api_key = os.getenv("GEMINI_API_KEY")
gemini_client = genai.Client(api_key=_api_key) if _api_key else None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _resolve_file(*paths):
    candidates = [
        os.path.join(".", *paths),
        os.path.join(BASE_DIR, *paths),
        os.path.join(BASE_DIR, "..", *paths),
        os.path.join("..", *paths),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return os.path.join(BASE_DIR, *paths)


# ── App setup ──────────────────────────────────────────────────────────
app = FastAPI(title="Construction Bid Risk API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Feature config (must match train_model.py) ───────────────────────
FEATURES = ["log_engineers_estimate", "bid_days", "item_count", "estimate_per_item",
            "start_month", "is_monsoon_season", "materials_ppi", "ppi_deviation"]
BID_ITEM_RE = re.compile(r"^\d+-\d+$")

# ── Global state populated at startup ──────────────────────────────────
projects_df: pd.DataFrame = pd.DataFrame()
cost_model = None
risk_model = None
feature_influence: dict = {}
india_projects_df: pd.DataFrame = pd.DataFrame()


def load_india_projects():
    global india_projects_df
    candidates = [
        os.path.join(".", "data", "india", "real_projects.json"),
        os.path.join("data", "india", "real_projects.json"),
        os.path.join(BASE_DIR, "data", "india", "real_projects.json"),
        os.path.join(BASE_DIR, "..", "data", "india", "real_projects.json"),
    ]
    file_path = None
    for c in candidates:
        if os.path.exists(c):
            file_path = c
            break

    if file_path and os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8-sig") as f:
                data = json.load(f)
            projects_list = data.get("projects", []) if isinstance(data, dict) else data
            df = pd.json_normalize(projects_list)
            if "project_id" not in df.columns:
                if "id" in df.columns:
                    df["project_id"] = df["id"]
                elif not df.empty:
                    df["project_id"] = df.index
            india_projects_df = df
            print(f"Loaded {len(india_projects_df)} India projects from {file_path}.")
        except Exception as e:
            print(f"Error loading India projects from {file_path}: {e}")
            india_projects_df = pd.DataFrame()
    else:
        india_projects_df = pd.DataFrame()
        print("India projects file (./data/india/real_projects.json) not found yet, initialized empty DataFrame.")


@app.on_event("startup")
def load_data_and_models():
    global projects_df, cost_model, risk_model, feature_influence, india_projects_df

    # --- Load CSV ---
    csv_path = _resolve_file("data", "ConstructionData.csv")
    df = pd.read_csv(csv_path)

    # --- Identify bid-item columns ---
    bid_item_cols = [c for c in df.columns if BID_ITEM_RE.match(c)]
    bid_items = df[bid_item_cols]

    # --- Feature engineering (same as train_model.py) ---
    df["item_count"] = (bid_items.fillna(0) != 0).sum(axis=1)
    df["total_quantity"] = bid_items.fillna(0).sum(axis=1)
    df["log_engineers_estimate"] = np.log1p(df["engineers_estimate"])
    df["estimate_per_item"] = df["engineers_estimate"] / (df["item_count"] + 1)

    # --- Parse start_date and derive date features ---
    df = df.dropna(subset=["start_date"])
    df["start_date_parsed"] = pd.to_datetime(
        df["start_date"].astype(int).astype(str), format="%Y%m%d", errors="coerce"
    )
    df = df.dropna(subset=["start_date_parsed"])
    df["start_month"] = df["start_date_parsed"].dt.month
    df["is_monsoon_season"] = df["start_month"].isin([6, 7, 8, 9]).astype(int)
    df["year_month"] = df["start_date_parsed"].dt.to_period("M")

    # --- Load & merge FRED Construction PPI ---
    ppi_path = _resolve_file("data", "construction_ppi.csv")
    ppi = pd.read_csv(ppi_path)
    ppi["observation_date"] = pd.to_datetime(ppi["observation_date"])
    ppi["year_month"] = ppi["observation_date"].dt.to_period("M")
    ppi = ppi[["year_month", "WPUSOP3000"]].rename(columns={"WPUSOP3000": "materials_ppi"})
    df = df.merge(ppi, on="year_month", how="left")
    LAST_PPI = 190.1  # Dec 2015, last available value
    df["materials_ppi"] = df["materials_ppi"].fillna(LAST_PPI)
    df["ppi_deviation"] = df["materials_ppi"] - df["materials_ppi"].mean()

    # Drop rows with missing bid_days (same as training)
    df = df.dropna(subset=["bid_days"])

    # Actual cost overrun
    df["actual_cost_overrun_pct"] = (
        (df["bid_total"] - df["engineers_estimate"]) / df["engineers_estimate"] * 100
    )

    # Clip to same 1st-99th percentile range used in training
    lo = df["actual_cost_overrun_pct"].quantile(0.01)
    hi = df["actual_cost_overrun_pct"].quantile(0.99)
    df["actual_cost_overrun_pct"] = df["actual_cost_overrun_pct"].clip(lo, hi)

    # --- Load models ---
    cost_model_path = _resolve_file("models", "cost_model.joblib")
    risk_model_path = _resolve_file("models", "risk_model.joblib")
    cost_model = joblib.load(cost_model_path)
    risk_model = joblib.load(risk_model_path)

    # --- Predictions ---
    X = df[FEATURES]
    df["predicted_overrun_pct"] = cost_model.predict(X)
    df["predicted_risk_tier"] = risk_model.predict(X)

    # --- Assign project_id from index ---
    df = df.reset_index(drop=True)
    df["project_id"] = df.index

    # --- Compute feature influence (works for both model types) ---
    if isinstance(cost_model, LinearRegression):
        # Use absolute coefficients, normalized to sum to 1
        raw = np.abs(cost_model.coef_)
        normed = raw / raw.sum() if raw.sum() > 0 else raw
        feature_influence = {
            feat: round(float(val), 4) for feat, val in zip(FEATURES, normed)
        }
    else:
        # RandomForest or similar with feature_importances_
        feature_influence = {
            feat: round(float(val), 4)
            for feat, val in zip(FEATURES, cost_model.feature_importances_)
        }

    # --- Keep only columns we need (drop the 8747 bid-item columns) ---
    keep_cols = [
        "project_id", "engineers_estimate", "bid_total", "bid_days",
        "item_count", "actual_cost_overrun_pct", "predicted_overrun_pct",
        "predicted_risk_tier",
        # feature values for detail endpoint
        "log_engineers_estimate", "estimate_per_item",
        "start_month", "is_monsoon_season", "materials_ppi", "ppi_deviation",
    ]
    projects_df = df[keep_cols].copy()

    print(f"Loaded {len(projects_df)} projects, models ready.")
    load_india_projects()


# ── Endpoints ──────────────────────────────────────────────────────────

@app.get("/projects")
def list_projects(current_user: dict = Depends(require_verified_user)):
    """All projects with key fields (no raw bid-item columns)."""
    cols = [
        "project_id", "engineers_estimate", "bid_total", "bid_days",
        "item_count", "actual_cost_overrun_pct", "predicted_overrun_pct",
        "predicted_risk_tier", "materials_ppi",
    ]
    return projects_df[cols].to_dict(orient="records")


@app.get("/projects/{project_id}/risk")
def project_risk_detail(project_id: int, current_user: dict = Depends(require_verified_user)):
    """Single project with feature values and feature influence."""
    if project_id < 0 or project_id >= len(projects_df):
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    row = projects_df[projects_df["project_id"] == project_id]
    if row.empty:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    rec = row.iloc[0].to_dict()

    # Add per-feature breakdown
    rec["feature_values"] = {
        feat: round(float(rec.get(feat, 0)), 4) for feat in FEATURES
    }
    influence_label = (
        "relative_influence (abs coef, normalized)"
        if isinstance(cost_model, LinearRegression)
        else "feature_importances"
    )
    rec["feature_influence"] = feature_influence
    rec["influence_method"] = influence_label

    return rec


@app.get("/alerts")
def high_risk_alerts(current_user: dict = Depends(require_verified_user)):
    """Projects predicted as High risk, sorted by predicted overrun descending."""
    high = projects_df[projects_df["predicted_risk_tier"] == "High"].copy()
    high = high.sort_values("predicted_overrun_pct", ascending=False)
    cols = [
        "project_id", "engineers_estimate", "bid_total", "bid_days",
        "item_count", "actual_cost_overrun_pct", "predicted_overrun_pct",
        "predicted_risk_tier",
    ]
    return high[cols].to_dict(orient="records")


@app.get("/dashboard/summary")
def dashboard_summary(current_user: dict = Depends(require_verified_user)):
    """Aggregate stats + hardcoded model performance from our training run."""
    tier_counts = projects_df["predicted_risk_tier"].value_counts().to_dict()
    return {
        "total_projects": len(projects_df),
        "avg_predicted_overrun_pct": round(
            float(projects_df["predicted_overrun_pct"].mean()), 2
        ),
        "risk_tier_counts": {
            "Low": tier_counts.get("Low", 0),
            "Medium": tier_counts.get("Medium", 0),
            "High": tier_counts.get("High", 0),
        },
        # Hardcoded from actual training output -- model transparency
        "model_performance": {
            "baseline_test_r2": 0.1875,
            "rf_test_r2": 0.2343,
            "high_risk_recall": 0.70,
            "high_risk_precision": 0.34,
            "overall_accuracy": 0.5876,
            "majority_baseline_accuracy": 0.7491,
            "high_risk_base_rate": 0.25,
        },
    }


# ── Pydantic request model for assistant ───────────────────────────────
class AskRequest(BaseModel):
    question: str


@app.post("/assistant/ask")
def assistant_ask(request: AskRequest, current_user: dict = Depends(require_verified_user)):
    """Answer user questions about the project data using Gemini."""
    if not gemini_client:
        return {
            "answer": "I'm having trouble connecting right now. "
                      "Try again in a moment."
        }
    # --- Build data context from projects_df ---
    total = len(projects_df)
    tier_counts = projects_df["predicted_risk_tier"].value_counts().to_dict()
    avg_overrun = round(float(projects_df["predicted_overrun_pct"].mean()), 2)

    top5 = (
        projects_df
        .sort_values("predicted_overrun_pct", ascending=False)
        .head(5)[["project_id", "predicted_overrun_pct", "materials_ppi"]]
    )
    top5_lines = "\n".join(
        f"  - Project #{int(r.project_id)}: "
        f"predicted overrun {r.predicted_overrun_pct:.2f}%, "
        f"materials PPI {r.materials_ppi:.1f}"
        for _, r in top5.iterrows()
    )

    context = (
        f"Total projects: {total}\n"
        f"Risk tier counts: Low={tier_counts.get('Low', 0)}, "
        f"Medium={tier_counts.get('Medium', 0)}, "
        f"High={tier_counts.get('High', 0)}\n"
        f"Average predicted cost overrun: {avg_overrun}%\n"
        f"Correlation between materials_ppi and cost_overrun_pct: 0.38\n"
        f"Top 5 highest-risk projects:\n{top5_lines}\n"
        f"Key finding: The Materials Price Index (PPI) is a statistically "
        f"significant predictor of construction bid cost overruns "
        f"(correlation = 0.38)."
    )

    prompt = (
        "You are an assistant for the PAIMANA infrastructure project "
        "monitoring system. Answer the user's question using ONLY the "
        "following data context. Be concise (2-4 sentences), cite specific "
        "numbers where relevant, and if the question can't be answered "
        "from this context, say so honestly instead of guessing.\n\n"
        f"Context:\n{context}\n\n"
        f"Question: {request.question}"
    )

    for n in range(1, 3):
        try:
            response = gemini_client.models.generate_content(
                model="gemini-3.6-flash",
                contents=prompt,
            )
            return {"answer": response.text}
        except Exception as e:
            print(f"Gemini attempt {n} failed: {e}")
            if n < 2:
                time.sleep(1)

    return {
        "answer": "I'm having trouble connecting right now. "
                  "Try again in a moment."
    }


# ── India Project Reports Helpers ─────────────────────────────────────

class ProjectReportRequest(BaseModel):
    expenditure_update_cr: Optional[float] = None
    progress_pct: Optional[float] = None
    delay_reason: Optional[str] = None
    notes: Optional[str] = ""


def _get_reports_file_path() -> str:
    candidates = [
        os.path.join(".", "data", "india", "reports.json"),
        os.path.join("data", "india", "reports.json"),
        os.path.join(BASE_DIR, "data", "india", "reports.json"),
        os.path.join(BASE_DIR, "paimana_backend", "data", "india", "reports.json"),
        os.path.join(BASE_DIR, "..", "data", "india", "reports.json"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    target = os.path.join(".", "data", "india", "reports.json")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    return os.path.abspath(target)


def load_reports() -> list:
    path = _get_reports_file_path()
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            elif isinstance(data, dict):
                return data.get("reports", [])
            return []
    except Exception as e:
        print(f"Error reading reports from {path}: {e}")
        return []


def save_reports(reports: list):
    path = _get_reports_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(reports, f, indent=2)


# ── India Risk Computation ─────────────────────────────────────────────

def compute_india_risk(project: dict, reports: Optional[list] = None) -> dict:
    """Compute risk flags and reasons for an Indian infrastructure project."""
    if reports is None:
        reports = load_reports()

    risk_reasons = []

    # 1. Cost escalation: revised_cost_cr > original_cost_cr * 1.15
    orig = project.get("original_cost_cr")
    rev = project.get("revised_cost_cr")
    if orig is not None and rev is not None:
        try:
            orig_val = float(orig)
            rev_val = float(rev)
            if orig_val > 0 and rev_val > orig_val * 1.15:
                pct = round(((rev_val - orig_val) / orig_val) * 100, 1)
                pct_str = f"{int(pct)}" if pct == int(pct) else f"{pct}"
                risk_reasons.append(f"Cost escalated {pct_str}% above original estimate")
        except (ValueError, TypeError):
            pass

    # 2. Ongoing with physical progress < 20%
    status = str(project.get("status") or "").strip()
    prog = project.get("physical_progress_pct")
    if status == "Ongoing" and prog is not None:
        try:
            prog_val = float(prog)
            if prog_val < 20:
                risk_reasons.append("Physical progress under 20%")
        except (ValueError, TypeError):
            pass

    # 3. Completed with delay_note
    delay_note = project.get("delay_note")
    if status == "Completed" and delay_note and str(delay_note).strip():
        risk_reasons.append(str(delay_note).strip())

    # 4. Field officer report with non-empty delay_reason
    proj_id_str = str(project.get("project_id"))
    matching_reports = [
        r for r in reports
        if str(r.get("project_id")) == proj_id_str
        and r.get("delay_reason")
        and str(r.get("delay_reason")).strip()
        and r.get("status") != "rejected"
    ]
    if matching_reports:
        matching_reports.sort(key=lambda x: str(x.get("timestamp") or ""), reverse=True)
        recent_reason = str(matching_reports[0]["delay_reason"]).strip()
        risk_reasons.append(f"Field-reported delay: {recent_reason}")

    return {
        "is_flagged": len(risk_reasons) > 0,
        "risk_reasons": risk_reasons,
    }


# ── India Projects Endpoints ───────────────────────────────────────────

@app.get("/india/projects")
def list_india_projects(
    status: Optional[str] = Query(None, description="Filter by exact status match"),
    search: Optional[str] = Query(None, description="Case-insensitive substring match on project name"),
):
    """Return list of India infrastructure projects with optional status and search filters."""
    global india_projects_df
    load_india_projects()

    if india_projects_df.empty:
        return []

    df = india_projects_df.copy()

    # Filter by exact status match
    if status:
        if "status" in df.columns:
            df = df[df["status"] == status]

    # Filter by case-insensitive substring match on project name
    if search:
        if "name" in df.columns:
            df = df[df["name"].astype(str).str.contains(search, case=False, na=False)]

    target_cols = [
        "project_id",
        "name",
        "sector",
        "ministry",
        "state",
        "original_cost_cr",
        "revised_cost_cr",
        "expenditure_cr",
        "status",
        "physical_progress_pct",
        "delay_note",
        "approval_date",
        "start_date",
        "target_doc",
        "original_doc",
        "revised_doc",
        "actual_completion",
        "assigned_officer",
        "assigned_contractor",
    ]
    cols = [c for c in target_cols if c in df.columns]

    records = df[cols].to_dict(orient="records")
    results = []
    reports = load_reports()
    for r in records:
        cleaned = {}
        for k, v in r.items():
            if pd.isna(v):
                if k in (
                    "physical_progress_pct",
                    "delay_note",
                    "approval_date",
                    "start_date",
                    "target_doc",
                    "original_doc",
                    "revised_doc",
                    "actual_completion",
                ):
                    continue
                cleaned[k] = None
            else:
                cleaned[k] = v

        cleaned.setdefault("assigned_officer", None)
        cleaned.setdefault("assigned_contractor", None)

        risk_info = compute_india_risk(cleaned, reports=reports)
        cleaned["is_flagged"] = risk_info["is_flagged"]
        cleaned["risk_reasons"] = risk_info["risk_reasons"]

        results.append(cleaned)

    return results



@app.get("/india/alerts")
def get_india_alerts():
    """
    Return only flagged India infrastructure projects (is_flagged == true) from the full list,
    sorted by number of reasons descending (most flags first).
    """
    all_projects = list_india_projects(status=None, search=None)
    flagged = [p for p in all_projects if p.get("is_flagged")]
    flagged.sort(key=lambda p: len(p.get("risk_reasons", [])), reverse=True)
    return flagged


# ── India Projects — Admin Write Endpoints ─────────────────────────────

class CreateProjectRequest(BaseModel):
    name: str
    sector: Optional[str] = None
    ministry: Optional[str] = None
    state: Optional[str] = None
    status: Optional[str] = "Newly Added"
    original_cost_cr: Optional[float] = None
    revised_cost_cr: Optional[float] = None
    expenditure_cr: Optional[float] = None
    physical_progress_pct: Optional[float] = None
    approval_date: Optional[str] = None
    start_date: Optional[str] = None
    target_doc: Optional[str] = None
    original_doc: Optional[str] = None
    revised_doc: Optional[str] = None
    actual_completion: Optional[str] = None
    delay_note: Optional[str] = None
    assigned_officer: Optional[str] = None
    assigned_contractor: Optional[str] = None


class UpdateStatusRequest(BaseModel):
    status: str


class AssignProjectRequest(BaseModel):
    assigned_officer: Optional[str] = None
    assigned_contractor: Optional[str] = None


def _get_projects_file_path() -> str:
    """Return the resolved path to real_projects.json, creating dirs if needed."""
    candidates = [
        os.path.join(".", "data", "india", "real_projects.json"),
        os.path.join("data", "india", "real_projects.json"),
        os.path.join(BASE_DIR, "data", "india", "real_projects.json"),
        os.path.join(BASE_DIR, "..", "data", "india", "real_projects.json"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    # Default: create inside BASE_DIR
    target = os.path.join(BASE_DIR, "data", "india", "real_projects.json")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    return os.path.abspath(target)


def _load_projects_file() -> dict:
    """Load real_projects.json and return the raw dict (preserves metadata keys)."""
    path = _get_projects_file_path()
    if not os.path.exists(path):
        return {"projects": []}
    with open(path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)
    if isinstance(data, list):
        return {"projects": data}
    return data  # {"source": ..., "projects": [...]}


def _save_projects_file(data: dict):
    """Write the projects dict back to real_projects.json."""
    path = _get_projects_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _generate_project_id(existing_projects: list) -> str:
    """Generate a unique numeric-string project_id not already in the dataset."""
    existing_ids = {str(p.get("project_id", "")) for p in existing_projects}
    # Start from 900000 and increment to avoid clashing with real MoSPI codes
    candidate = 900000
    while str(candidate) in existing_ids:
        candidate += 1
    return str(candidate)


def _project_to_response(project: dict, reports=None) -> dict:
    """Enrich a raw project dict with is_flagged / risk_reasons and return it."""
    if reports is None:
        reports = load_reports()
    cleaned = {k: v for k, v in project.items() if v is not None}
    risk_info = compute_india_risk(cleaned, reports=reports)
    cleaned["is_flagged"] = risk_info["is_flagged"]
    cleaned["risk_reasons"] = risk_info["risk_reasons"]
    cleaned["assigned_officer"] = project.get("assigned_officer", None)
    cleaned["assigned_contractor"] = project.get("assigned_contractor", None)
    return cleaned


@app.post("/india/projects", status_code=201)
def create_india_project(
    project_data: CreateProjectRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """
    Create a new India infrastructure project. Admin-only.
    Appends to real_projects.json and reloads the in-memory DataFrame.
    Returns the created project object with a newly assigned project_id.
    """
    raw = _load_projects_file()
    projects_list = raw.get("projects", [])

    new_id = _generate_project_id(projects_list)
    now_str = datetime.now(timezone.utc).strftime("%m/%Y")

    new_project = {
        "project_id": new_id,
        "name": project_data.name,
    }
    # Only include optional fields if they were provided (non-None)
    optional_fields = [
        "sector", "ministry", "state", "status",
        "original_cost_cr", "revised_cost_cr", "expenditure_cr",
        "physical_progress_pct", "approval_date", "start_date",
        "target_doc", "original_doc", "revised_doc", "actual_completion",
        "delay_note", "assigned_officer", "assigned_contractor",
    ]
    for field in optional_fields:
        val = getattr(project_data, field, None)
        if val is not None:
            new_project[field] = val

    # Default status if not supplied
    if "status" not in new_project:
        new_project["status"] = "Newly Added"

    # Default assigned fields to None if missing
    new_project.setdefault("assigned_officer", None)
    new_project.setdefault("assigned_contractor", None)

    projects_list.append(new_project)
    raw["projects"] = projects_list
    _save_projects_file(raw)

    # Reload in-memory DataFrame so subsequent GET /india/projects reflects it
    load_india_projects()

    return _project_to_response(new_project)


@app.patch("/india/projects/{project_id}/status")
def update_india_project_status(
    project_id: str,
    body: UpdateStatusRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """
    Update the status field of an existing India project. Admin-only.
    Returns the updated project object (404 if not found).
    """
    allowed_statuses = {"Ongoing", "Completed", "Terminated", "Newly Added"}
    if body.status not in allowed_statuses:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status '{body.status}'. Must be one of: {sorted(allowed_statuses)}",
        )

    raw = _load_projects_file()
    projects_list = raw.get("projects", [])

    target_idx = None
    for i, p in enumerate(projects_list):
        if str(p.get("project_id")) == str(project_id):
            target_idx = i
            break

    if target_idx is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")

    projects_list[target_idx]["status"] = body.status

    # If marking Completed or Terminated and no actual_completion set, stamp today
    if body.status in ("Completed", "Terminated") and not projects_list[target_idx].get("actual_completion"):
        projects_list[target_idx]["actual_completion"] = datetime.now(timezone.utc).strftime("%m/%Y")

    # Automatically unassign officer and contractor when project is Completed or Terminated
    if body.status in ("Completed", "Terminated"):
        old_contractor = projects_list[target_idx].get("assigned_contractor")
        projects_list[target_idx]["assigned_officer"] = None
        projects_list[target_idx]["assigned_contractor"] = None

        if old_contractor:
            users = load_users()
            users_modified = False
            for u in users:
                if u.get("role") == "contractor":
                    uname = u.get("username")
                    uid = str(u.get("id", ""))
                    if (uname == old_contractor or uid == old_contractor) and str(u.get("assigned_project_id")) == str(project_id):
                        u["assigned_project_id"] = None
                        users_modified = True
            if users_modified:
                save_users(users)

    raw["projects"] = projects_list
    _save_projects_file(raw)

    # Reload in-memory DataFrame
    load_india_projects()

    return _project_to_response(projects_list[target_idx])


@app.patch("/india/projects/{project_id}/assign")
def assign_india_project(
    project_id: str,
    body: AssignProjectRequest,
    current_user: dict = Depends(require_role("admin")),
):
    """
    Assign an officer and/or contractor to an existing India project. Admin-only.
    Accepts assigned_officer and/or assigned_contractor (either can be provided, both optional).
    Rejects assignment on Completed or Terminated projects (400).
    Returns the updated project object (404 if project doesn't exist).
    """
    raw = _load_projects_file()
    projects_list = raw.get("projects", [])

    target_idx = None
    for i, p in enumerate(projects_list):
        if str(p.get("project_id")) == str(project_id):
            target_idx = i
            break

    if target_idx is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")

    target_project = projects_list[target_idx]

    # Reject assignment if project is Completed or Terminated
    if target_project.get("status") in ("Completed", "Terminated"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot assign personnel to a {target_project.get('status').lower()} project. Only active projects can have personnel assigned.",
        )

    fields_set = getattr(body, "model_fields_set", getattr(body, "__fields_set__", set()))
    if not fields_set:
        if body.assigned_officer is not None:
            fields_set.add("assigned_officer")
        if body.assigned_contractor is not None:
            fields_set.add("assigned_contractor")

    if "assigned_officer" in fields_set:
        new_officer = body.assigned_officer or None
        if new_officer:
            officer_str = str(new_officer)
            for p in projects_list:
                if str(p.get("project_id")) != str(project_id) and p.get("status") not in ("Completed", "Terminated"):
                    if str(p.get("assigned_officer")) == officer_str:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Field officer '{officer_str}' is already assigned to active project '{p.get('name', p.get('project_id'))}'.",
                        )
        target_project["assigned_officer"] = new_officer

    if "assigned_contractor" in fields_set:
        old_contractor = target_project.get("assigned_contractor")
        new_contractor = body.assigned_contractor or None
        if new_contractor:
            contractor_str = str(new_contractor)
            for p in projects_list:
                if str(p.get("project_id")) != str(project_id) and p.get("status") not in ("Completed", "Terminated"):
                    if str(p.get("assigned_contractor")) == contractor_str:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Contractor '{contractor_str}' is already assigned to active project '{p.get('name', p.get('project_id'))}'.",
                        )
        target_project["assigned_contractor"] = new_contractor

        # Synchronize assigned_project_id in users.json for contractor accounts
        users = load_users()
        users_modified = False
        for u in users:
            if u.get("role") == "contractor":
                uname = u.get("username")
                uid = str(u.get("id", ""))
                if new_contractor and (uname == new_contractor or uid == new_contractor):
                    u["assigned_project_id"] = str(project_id)
                    users_modified = True
                elif old_contractor and (uname == old_contractor or uid == old_contractor) and str(u.get("assigned_project_id")) == str(project_id):
                    u["assigned_project_id"] = None
                    users_modified = True
        if users_modified:
            save_users(users)

    raw["projects"] = projects_list
    _save_projects_file(raw)

    # Reload in-memory DataFrame
    load_india_projects()

    return _project_to_response(target_project)


@app.get("/india/me/assigned-project")
@app.get("/india/me/assigned-projects")
def get_my_assigned_projects(
    current_user: dict = Depends(require_verified_user),
):
    """
    Fetch the project(s) assigned to the current user (field officer or contractor).
    Returns a list of project objects.
    """
    raw = _load_projects_file()
    projects_list = raw.get("projects", [])
    username = current_user.get("username")
    user_id = str(current_user.get("id") or current_user.get("user_id") or "")
    role = current_user.get("role")

    reports = load_reports()
    matching = []

    for p in projects_list:
        assigned_officer = p.get("assigned_officer")
        assigned_contractor = p.get("assigned_contractor")
        is_match = False

        if role == "field_officer":
            if assigned_officer and (assigned_officer == username or assigned_officer == user_id):
                is_match = True
        elif role == "contractor":
            if assigned_contractor and (assigned_contractor == username or assigned_contractor == user_id):
                is_match = True
        elif role == "admin":
            if (assigned_officer and (assigned_officer == username or assigned_officer == user_id)) or \
               (assigned_contractor and (assigned_contractor == username or assigned_contractor == user_id)):
                is_match = True

        if is_match:
            matching.append(_project_to_response(p, reports=reports))

    return matching


@app.get("/admin/available-officers")
def get_available_officers(
    project_id: Optional[str] = Query(None, description="Optional project ID to include the currently assigned officer"),
    current_user: dict = Depends(require_role("admin")),
):
    """
    Return field officers who are NOT currently assigned to another active project.
    If project_id is provided, the officer currently assigned to that project is also included.
    """
    raw = _load_projects_file()
    projects = raw.get("projects", [])

    busy_officers = set()
    for p in projects:
        if p.get("status") not in ("Completed", "Terminated"):
            if project_id and str(p.get("project_id")) == str(project_id):
                continue
            if p.get("assigned_officer"):
                busy_officers.add(str(p.get("assigned_officer")))

    users = load_users()
    available = []
    for u in users:
        if u.get("role") == "field_officer":
            uname = u.get("username")
            uid = str(u.get("id", ""))
            if uname not in busy_officers and uid not in busy_officers:
                available.append({
                    "username": uname,
                    "full_name": u.get("full_name", uname),
                    "role": u.get("role"),
                })
    return available


@app.get("/admin/available-contractors")
def get_available_contractors(
    project_id: Optional[str] = Query(None, description="Optional project ID to include the currently assigned contractor"),
    current_user: dict = Depends(require_role("admin")),
):
    """
    Return verified contractors who are NOT currently assigned to another active project.
    If project_id is provided, the contractor currently assigned to that project is also included.
    """
    raw = _load_projects_file()
    projects = raw.get("projects", [])

    busy_contractors = set()
    for p in projects:
        if p.get("status") not in ("Completed", "Terminated"):
            if project_id and str(p.get("project_id")) == str(project_id):
                continue
            if p.get("assigned_contractor"):
                busy_contractors.add(str(p.get("assigned_contractor")))

    users = load_users()
    available = []
    for u in users:
        if u.get("role") == "contractor" and u.get("is_verified", False):
            uname = u.get("username")
            uid = str(u.get("id", ""))
            if uname not in busy_contractors and uid not in busy_contractors:
                available.append({
                    "username": uname,
                    "full_name": u.get("full_name", uname),
                    "role": u.get("role"),
                })
    return available


@app.get("/admin/assignable-users")
def get_assignable_users(
    project_id: Optional[str] = Query(None, description="Optional project ID to filter out users assigned elsewhere"),
    current_user: dict = Depends(require_role("admin")),
):
    """
    List field officers and verified contractors for assignment selection.
    Filters out officers/contractors assigned to other active projects.
    Admin-only endpoint.
    """
    officers = get_available_officers(project_id=project_id, current_user=current_user)
    contractors = get_available_contractors(project_id=project_id, current_user=current_user)
    return {
        "officers": officers,
        "contractors": contractors,
    }


@app.post("/india/projects/{project_id}/report")
def create_project_report(
    project_id: str,
    report_data: ProjectReportRequest,
    current_user: dict = Depends(require_role("field_officer")),
):
    """File project report. Only the assigned field_officer for this project is permitted.
    Stores report with status 'pending_confirmation' awaiting contractor confirmation."""
    raw = _load_projects_file()
    projects_list = raw.get("projects", [])
    matching_project = next(
        (p for p in projects_list if str(p.get("project_id")) == str(project_id)),
        None
    )
    if not matching_project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")

    # Isolation check for field_officer
    if current_user.get("role") == "field_officer":
        assigned = matching_project.get("assigned_officer")
        username = current_user.get("username")
        user_id = str(current_user.get("id") or current_user.get("user_id") or "")
        if not assigned or (assigned != username and assigned != user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not assigned to this project.",
            )

    report_id = str(uuid.uuid4())[:8]
    report_entry = {
        "id": report_id,
        "report_id": report_id,
        "project_id": str(project_id),
        "submitted_by": current_user.get("username"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "expenditure_update_cr": report_data.expenditure_update_cr,
        "progress_pct": report_data.progress_pct,
        "delay_reason": report_data.delay_reason,
        "notes": report_data.notes or "",
        "status": "pending_confirmation",
    }
    reports = load_reports()
    reports.append(report_entry)
    save_reports(reports)
    return report_entry



# ── Contractor Delay Flag ─────────────────────────────────────────────

class FlagDelayRequest(BaseModel):
    reason: Optional[str] = None


@app.patch("/india/projects/{project_id}/flag-delay")
def flag_project_delay(
    project_id: str,
    body: FlagDelayRequest,
    current_user: dict = Depends(require_role("contractor")),
):
    """
    Contractor marks their assigned project as delayed, with an optional short reason.
    Only the contractor explicitly assigned to this project may call this.
    Returns the updated project object (403 if not assigned, 404 if project not found).
    """
    raw = _load_projects_file()
    projects_list = raw.get("projects", [])
    target_idx = None
    for i, p in enumerate(projects_list):
        if str(p.get("project_id")) == str(project_id):
            target_idx = i
            break

    if target_idx is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")

    matching_project = projects_list[target_idx]

    # Isolation: contractor must be assigned to this specific project
    assigned = matching_project.get("assigned_contractor")
    username = current_user.get("username")
    user_id = str(current_user.get("id") or current_user.get("user_id") or "")
    if not assigned or (assigned != username and assigned != user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to this project.",
        )

    # Set delay flag, timestamp, and optional reason
    timestamp = datetime.now(timezone.utc).isoformat()
    matching_project["is_delayed_by_contractor"] = True
    matching_project["contractor_delay_timestamp"] = timestamp
    matching_project["contractor_delay_reason"] = body.reason.strip() if body.reason else None

    # Append to delay_note so admin-visible notes are updated too
    contractor_note = f"Contractor delay: {body.reason.strip()}" if body.reason and body.reason.strip() else "Contractor flagged delay"
    existing_note = matching_project.get("delay_note") or ""
    if existing_note:
        matching_project["delay_note"] = existing_note + " | " + contractor_note
    else:
        matching_project["delay_note"] = contractor_note

    raw["projects"] = projects_list
    _save_projects_file(raw)
    load_india_projects()

    return _project_to_response(matching_project)


# ── Contractor Confirmation / Rejection of Reports ────────────────────

class RejectReportRequest(BaseModel):
    reason: str


@app.patch("/india/projects/{project_id}/reports/{report_id}/confirm")
def confirm_project_report(
    project_id: str,
    report_id: str,
    current_user: dict = Depends(require_role("contractor")),
):
    """
    Contractor confirms a pending field report.
    Applies the report's expenditure/progress values to the project's actual fields,
    and marks the report status as 'confirmed'.
    Requires caller to be the assigned_contractor for this project.
    """
    raw = _load_projects_file()
    projects_list = raw.get("projects", [])
    target_idx = None
    for i, p in enumerate(projects_list):
        if str(p.get("project_id")) == str(project_id):
            target_idx = i
            break

    if target_idx is None:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")

    matching_project = projects_list[target_idx]

    # Isolation check: caller must be assigned_contractor
    assigned = matching_project.get("assigned_contractor")
    username = current_user.get("username")
    user_id = str(current_user.get("id") or current_user.get("user_id") or "")
    if not assigned or (assigned != username and assigned != user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to this project.",
        )

    reports = load_reports()
    target_report = next(
        (r for r in reports if str(r.get("project_id")) == str(project_id) and (str(r.get("report_id")) == str(report_id) or str(r.get("id")) == str(report_id))),
        None,
    )
    if not target_report:
        raise HTTPException(status_code=404, detail=f"Report '{report_id}' not found.")

    if target_report.get("status") != "pending_confirmation":
        raise HTTPException(
            status_code=400,
            detail=f"Report is not pending confirmation (current status: '{target_report.get('status')}').",
        )

    target_report["status"] = "confirmed"
    target_report["confirmed_at"] = datetime.now(timezone.utc).isoformat()
    target_report["confirmed_by"] = username
    save_reports(reports)

    # Apply expenditure and/or progress values to the project's real fields
    if target_report.get("expenditure_update_cr") is not None:
        matching_project["expenditure_cr"] = float(target_report["expenditure_update_cr"])
    if target_report.get("progress_pct") is not None:
        matching_project["physical_progress_pct"] = float(target_report["progress_pct"])

    # If project is "Newly Added", transition it to "Ongoing" upon first confirmed report
    if matching_project.get("status") == "Newly Added":
        matching_project["status"] = "Ongoing"

    target_report["project_status"] = matching_project.get("status")

    raw["projects"] = projects_list
    _save_projects_file(raw)
    load_india_projects()

    return target_report


@app.patch("/india/projects/{project_id}/reports/{report_id}/reject")
def reject_project_report(
    project_id: str,
    report_id: str,
    body: RejectReportRequest,
    current_user: dict = Depends(require_role("contractor")),
):
    """
    Contractor rejects a pending field report with a reason.
    Marks the report status as 'rejected'. Does not update project numbers.
    Requires caller to be the assigned_contractor for this project.
    """
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A rejection reason is required.",
        )

    raw = _load_projects_file()
    projects_list = raw.get("projects", [])
    matching_project = next(
        (p for p in projects_list if str(p.get("project_id")) == str(project_id)),
        None,
    )
    if not matching_project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")

    # Isolation check: caller must be assigned_contractor
    assigned = matching_project.get("assigned_contractor")
    username = current_user.get("username")
    user_id = str(current_user.get("id") or current_user.get("user_id") or "")
    if not assigned or (assigned != username and assigned != user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not assigned to this project.",
        )

    reports = load_reports()
    target_report = next(
        (r for r in reports if str(r.get("project_id")) == str(project_id) and (str(r.get("report_id")) == str(report_id) or str(r.get("id")) == str(report_id))),
        None,
    )
    if not target_report:
        raise HTTPException(status_code=404, detail=f"Report '{report_id}' not found.")

    if target_report.get("status") != "pending_confirmation":
        raise HTTPException(
            status_code=400,
            detail=f"Report is not pending confirmation (current status: '{target_report.get('status')}').",
        )

    target_report["status"] = "rejected"
    target_report["rejection_reason"] = reason
    target_report["rejected_at"] = datetime.now(timezone.utc).isoformat()
    target_report["rejected_by"] = username
    save_reports(reports)

    return target_report


@app.get("/india/projects/{project_id}/reports")
def get_project_reports(
    project_id: str,
):
    """Return all reports filed for that project_id from reports.json, sorted newest first."""
    reports = load_reports()
    matching = [
        r for r in reports
        if str(r.get("project_id")) == str(project_id)
    ]
    for r in matching:
        if "status" not in r:
            r["status"] = "confirmed"
        if "id" not in r and "report_id" in r:
            r["id"] = r["report_id"]
        elif "report_id" not in r and "id" in r:
            r["report_id"] = r["id"]
    matching.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return matching


# ── India Project Feedback ─────────────────────────────────────────────

class ProjectFeedbackRequest(BaseModel):
    message: str
    category: Literal["delay", "quality", "safety", "other"]


def _get_feedback_file_path() -> str:
    candidates = [
        os.path.join(".", "data", "india", "feedback.json"),
        os.path.join("data", "india", "feedback.json"),
        os.path.join(BASE_DIR, "data", "india", "feedback.json"),
        os.path.join(BASE_DIR, "paimana_backend", "data", "india", "feedback.json"),
        os.path.join(BASE_DIR, "..", "data", "india", "feedback.json"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    target = os.path.join(BASE_DIR, "data", "india", "feedback.json")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    return os.path.abspath(target)


def load_feedback() -> list:
    path = _get_feedback_file_path()
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            elif isinstance(data, dict):
                return data.get("feedback", [])
            return []
    except Exception as e:
        print(f"Error reading feedback from {path}: {e}")
        return []


def save_feedback(feedback_list: list):
    path = _get_feedback_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(feedback_list, f, indent=2)


@app.post("/india/projects/{project_id}/feedback")
def submit_project_feedback(
    project_id: str,
    feedback_data: ProjectFeedbackRequest,
    current_user: dict = Depends(require_verified_user),
):
    """Submit feedback for a project. Any authenticated user can submit, but contractors must be assigned."""
    raw = _load_projects_file()
    projects_list = raw.get("projects", [])
    matching_project = next(
        (p for p in projects_list if str(p.get("project_id")) == str(project_id)),
        None
    )
    if not matching_project:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")

    if current_user.get("role") == "contractor":
        assigned = matching_project.get("assigned_contractor")
        username = current_user.get("username")
        user_id = str(current_user.get("id") or current_user.get("user_id") or "")
        if not assigned or (assigned != username and assigned != user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not assigned to this project.",
            )

    # Note: submitted_by and role are persisted to feedback.json for backend
    # integrity and abuse-tracing only. They are NEVER exposed via API responses
    # to keep citizen feedback anonymous.
    feedback_entry = {
        "project_id": str(project_id),
        "submitted_by": current_user.get("username"),
        "role": current_user.get("role"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": feedback_data.message,
        "category": feedback_data.category,
    }
    feedbacks = load_feedback()
    feedbacks.append(feedback_entry)
    save_feedback(feedbacks)

    # Return anonymous response to client (omit submitted_by and role)
    return {
        "project_id": feedback_entry["project_id"],
        "timestamp": feedback_entry["timestamp"],
        "message": feedback_entry["message"],
        "category": feedback_entry["category"],
    }


@app.get("/india/projects/{project_id}/feedback")
def get_project_feedback(
    project_id: str,
):
    """Return all feedback for that project_id from feedback.json, sorted newest first."""
    feedbacks = load_feedback()
    matching = [
        f for f in feedbacks
        if str(f.get("project_id")) == str(project_id)
    ]
    matching.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    # Note: submitted_by and role are kept in the file for backend integrity
    # and abuse-tracing only, but are stripped from API responses for all users
    # (including admins) to keep citizen feedback fully anonymous.
    return [
        {
            "project_id": str(f.get("project_id")),
            "timestamp": f.get("timestamp"),
            "message": f.get("message"),
            "category": f.get("category"),
        }
        for f in matching
    ]


# ── India Project Followers & Following ────────────────────────────────

def _get_followers_file_path() -> str:
    candidates = [
        os.path.join(".", "data", "india", "followers.json"),
        os.path.join("data", "india", "followers.json"),
        os.path.join(BASE_DIR, "data", "india", "followers.json"),
        os.path.join(BASE_DIR, "paimana_backend", "data", "india", "followers.json"),
        os.path.join(BASE_DIR, "..", "data", "india", "followers.json"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    dir_candidates = [
        os.path.join(".", "data", "india"),
        os.path.join(BASE_DIR, "data", "india"),
        os.path.join(BASE_DIR, "paimana_backend", "data", "india"),
    ]
    for d in dir_candidates:
        if os.path.isdir(d):
            return os.path.abspath(os.path.join(d, "followers.json"))
    target = os.path.join(BASE_DIR, "data", "india", "followers.json")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    return os.path.abspath(target)


def load_followers() -> dict:
    path = _get_followers_file_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
            return {}
    except Exception as e:
        print(f"Error reading followers from {path}: {e}")
        return {}


def save_followers(followers_dict: dict):
    path = _get_followers_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(followers_dict, f, indent=2)


def _get_india_project_name_map() -> dict:
    global india_projects_df
    if india_projects_df.empty:
        load_india_projects()
    if india_projects_df.empty or "project_id" not in india_projects_df.columns:
        return {}
    name_col = "name" if "name" in india_projects_df.columns else None
    if not name_col:
        return {}
    return {
        str(row["project_id"]): str(row[name_col])
        for _, row in india_projects_df[["project_id", name_col]].iterrows()
        if pd.notna(row["project_id"]) and pd.notna(row[name_col])
    }


@app.post("/india/projects/{project_id}/follow")
def toggle_follow_project(
    project_id: str,
    current_user: dict = Depends(require_verified_user),
):
    """
    Toggle follow status for a project.
    Stores/removes entry in followers.json: {"project_id": ["username1", ...]}
    Returns {"following": true/false}
    """
    username = current_user.get("username")
    proj_id_str = str(project_id)
    followers = load_followers()
    user_list = followers.get(proj_id_str, [])
    if not isinstance(user_list, list):
        user_list = []

    if username in user_list:
        user_list = [u for u in user_list if u != username]
        followers[proj_id_str] = user_list
        following = False
    else:
        user_list.append(username)
        followers[proj_id_str] = user_list
        following = True

    save_followers(followers)
    return {"following": following}


@app.get("/india/me/following")
def get_user_following(
    current_user: dict = Depends(require_verified_user),
):
    """
    Returns list of projects the current user follows,
    cross-referenced with project names from India projects data as [{project_id, name}].
    """
    username = current_user.get("username")
    followers = load_followers()
    name_map = _get_india_project_name_map()

    following_list = []
    for pid, users in followers.items():
        if isinstance(users, list) and username in users:
            pid_str = str(pid)
            following_list.append({
                "project_id": pid_str,
                "name": name_map.get(pid_str, f"Project #{pid_str}"),
            })

    return following_list


@app.get("/india/notifications")
def get_india_notifications(
    current_user: dict = Depends(require_verified_user),
):
    """
    Role-based notifications:
    - admin or field_officer: return flagged-projects data identical to /india/alerts
    - public: reports from projects followed by current user, newest first, capped at 20
    Response shape: {role: str, count: int, items: [...]}
    """
    role = current_user.get("role", "public")
    if role in ("admin", "field_officer"):
        alert_items = get_india_alerts()
        return {
            "role": role,
            "count": len(alert_items),
            "items": alert_items,
        }

    # Public role (or other non-admin/officer users)
    followers = load_followers()
    username = current_user.get("username")
    followed_pids = {
        str(pid)
        for pid, users in followers.items()
        if isinstance(users, list) and username in users
    }

    all_reports = load_reports()
    name_map = _get_india_project_name_map()

    # 1. Followed projects risk status (persistent risk flags at top)
    all_projects = list_india_projects(status=None, search=None)
    risk_flag_items = []
    for p in all_projects:
        pid = str(p.get("project_id"))
        if pid in followed_pids:
            risk_info = compute_india_risk(p, reports=all_reports)
            if risk_info.get("is_flagged"):
                risk_reasons = risk_info.get("risk_reasons", [])
                p_name = p.get("name") or name_map.get(pid, f"Project #{pid}")
                risk_flag_items.append({
                    "project_id": pid,
                    "project_name": p_name,
                    "timestamp": None,
                    "type": "risk_flag",
                    "summary": "Currently flagged: " + ", ".join(risk_reasons),
                })

    # 2. Followed projects report-based updates, sorted by timestamp desc
    matching_reports = [
        r for r in all_reports
        if str(r.get("project_id")) in followed_pids
    ]
    matching_reports.sort(key=lambda x: str(x.get("timestamp") or ""), reverse=True)
    capped_reports = matching_reports[:20]

    report_items = []
    for r in capped_reports:
        pid = str(r.get("project_id"))
        exp_val = r.get("expenditure_update_cr")
        delay = r.get("delay_reason")

        if exp_val is not None:
            summary = f"New report: ₹{exp_val} Cr logged"
        else:
            summary = "New report logged"

        if delay and str(delay).strip():
            summary += f", delay: {str(delay).strip()}"

        report_items.append({
            "project_id": pid,
            "project_name": name_map.get(pid, f"Project #{pid}"),
            "timestamp": r.get("timestamp"),
            "type": "report_update",
            "expenditure_update_cr": exp_val,
            "delay_reason": delay,
            "summary": summary,
        })

    # Merge: persistent risk flags first, followed by timestamp-sorted report updates
    items = risk_flag_items + report_items

    return {
        "role": role,
        "count": len(items),
        "items": items,
    }


@app.post("/india/assistant/ask")
def india_assistant_ask(
    request: AskRequest,
):
    """Answer user questions about real Indian infrastructure projects using Gemini. Publicly accessible for guests and logged-in users."""
    if not gemini_client:
        return {
            "answer": "I'm having trouble connecting right now. "
                      "Try again in a moment."
        }

    try:
        # ── Build context from live real India project data ────────────────────────
        # 1. Fetch fresh list of all projects (loads real_projects.json & runs live compute_india_risk)
        all_projects = list_india_projects(status=None, search=None)
        total_count = len(all_projects)

        status_counts = {}
        for p in all_projects:
            s = p.get("status") or "Unknown"
            status_counts[s] = status_counts.get(s, 0) + 1

        status_line = ", ".join(
            f"{k}={v}" for k, v in status_counts.items()
        ) or "status breakdown unavailable"

        # 2. Flagged projects — reuse live computed risk
        flagged = [p for p in all_projects if p.get("is_flagged")]
        flagged.sort(key=lambda p: len(p.get("risk_reasons", [])), reverse=True)
        top_flagged = flagged[:10]

        # 3. Dynamically extract the top-2 cost-escalation examples from risk_reasons.
        #    compute_india_risk produces strings like: "Cost escalated 142.7% above original estimate"
        escalation_re = re.compile(r"Cost escalated ([\d.]+)%")
        escalation_examples = []
        for p in flagged:
            name = p.get("name", f"Project #{p.get('project_id', '?')}")
            for reason in p.get("risk_reasons", []):
                m = escalation_re.search(reason)
                if m:
                    try:
                        pct = float(m.group(1))
                        escalation_examples.append((pct, name, reason))
                    except ValueError:
                        pass

        escalation_examples.sort(key=lambda x: x[0], reverse=True)
        top2 = escalation_examples[:2]

        escalation_block = ""
        if top2:
            lines = [f"  - {name}: {reason}" for _, name, reason in top2]
            escalation_block = (
                "Most severe cost escalations in the dataset:\n"
                + "\n".join(lines) + "\n"
            )

        # 4. Summary of flagged projects (name, sector, state, risk_reasons)
        flagged_lines = []
        for p in top_flagged:
            name    = p.get("name",   f"Project #{p.get('project_id', '?')}")
            sector  = p.get("sector", "unknown sector")
            state   = p.get("state",  "unknown state")
            reasons = "; ".join(p.get("risk_reasons", [])) or "no reasons recorded"
            flagged_lines.append(f"  - {name} ({sector}, {state}): {reasons}")

        flagged_block = (
            f"Flagged / at-risk projects ({len(flagged)} total, top {len(top_flagged)} shown):\n"
            + ("\n".join(flagged_lines) if flagged_lines else "  None flagged")
            + "\n"
        )

        # 5. Full directory of all projects with live metadata, assignments, and costs
        catalog_lines = []
        for p in all_projects:
            pid = p.get("project_id", "?")
            name = p.get("name", f"Project #{pid}")
            status = p.get("status", "Unknown")
            sector = p.get("sector") or "Unknown"
            state = p.get("state") or "Unknown"
            orig_cost = p.get("original_cost_cr")
            rev_cost = p.get("revised_cost_cr")
            exp = p.get("expenditure_cr")
            prog = p.get("physical_progress_pct")
            officer = p.get("assigned_officer") or "None"
            contractor = p.get("assigned_contractor") or "None"
            is_flg = "Flagged" if p.get("is_flagged") else "Normal"
            reasons = "; ".join(p.get("risk_reasons", []))

            cost_parts = []
            if orig_cost is not None:
                cost_parts.append(f"Cost: ₹{orig_cost} Cr")
            if rev_cost is not None and rev_cost != orig_cost:
                cost_parts.append(f"Revised: ₹{rev_cost} Cr")
            if exp is not None:
                cost_parts.append(f"Spent: ₹{exp} Cr")
            if prog is not None:
                cost_parts.append(f"Progress: {prog}%")
            cost_str = ", ".join(cost_parts) if cost_parts else "Cost: N/A"

            item = (
                f"  - [{pid}] \"{name}\" | Status: {status} | Sector: {sector} | State: {state} | "
                f"{cost_str} | Officer: {officer} | Contractor: {contractor} | Risk: {is_flg}"
            )
            if reasons:
                item += f" ({reasons})"
            catalog_lines.append(item)

        catalog_block = (
            "Complete Monitored Projects Directory (live data):\n"
            + "\n".join(catalog_lines)
            + "\n"
        )

        context = (
            f"Total Indian infrastructure projects monitored: {total_count}\n"
            f"Status breakdown: {status_line}\n"
            f"Total flagged projects: {len(flagged)}\n"
            + escalation_block
            + flagged_block
            + "\n"
            + catalog_block
        )

        prompt = (
            "You are an assistant for PAIMANA's real Indian infrastructure project "
            "monitoring platform. Answer the user's question accurately using the live project data "
            "context provided below. Be concise (2-4 sentences), cite specific project names, status, "
            "costs, progress, and assigned officer/contractor details where relevant. If the question "
            "cannot be answered from this context, say so honestly.\n\n"
            f"Context:\n{context}\n\n"
            f"Question: {request.question}"
        )

        # ── Gemini call with model fallback ─────────────────────────────────────
        models_to_try = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.6-flash"]
        for model_name in models_to_try:
            try:
                response = gemini_client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                )
                return {"answer": response.text}
            except Exception as e:
                print(f"Gemini india-assistant ({model_name}) attempt failed: {e}")
                time.sleep(0.3)

        return {
            "answer": "I'm having trouble connecting right now. "
                      "Try again in a moment."
        }
    except Exception as e:
        print(f"Error in india_assistant_ask: {e}")
        import traceback
        traceback.print_exc()
        return {
            "answer": "I'm having trouble retrieving project intelligence right now. Please try again."
        }


# ── Authentication Endpoints ──────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = ""
    role: Optional[str] = "public"


@app.post("/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    """Authenticate with username and password, return JWT bearer token."""
    user = authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    is_verified = user.get("is_verified", True if user.get("role") != "contractor" else False)
    assigned_project_id = user.get("assigned_project_id", None)
    access_token_expires = timedelta(hours=24)
    access_token = create_access_token(
        data={
            "sub": user["username"],
            "role": user.get("role"),
            "is_verified": is_verified,
            "assigned_project_id": assigned_project_id,
        },
        expires_delta=access_token_expires,
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user["role"],
        "full_name": user["full_name"],
        "is_verified": is_verified,
        "assigned_project_id": assigned_project_id,
    }


@app.post("/auth/register")
def register(request: RegisterRequest):
    """
    Self-registration endpoint.
    Accepts role 'public' (default, is_verified=True) or 'contractor' (is_verified=False).
    """
    username = request.username.strip()
    if not username or not request.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username and password are required",
        )

    requested_role = (request.role or "public").strip().lower()
    if requested_role not in ("public", "contractor"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role '{requested_role}'. Only 'public' and 'contractor' can self-register.",
        )

    existing = get_user(username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    is_verified = False if requested_role == "contractor" else True

    new_user = {
        "id": username,
        "user_id": username,
        "username": username,
        "hashed_password": pwd_context.hash(request.password),
        "role": requested_role,
        "full_name": request.full_name.strip() if request.full_name else username,
        "is_verified": is_verified,
        "assigned_project_id": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    users = load_users()
    users.append(new_user)
    save_users(users)

    message = (
        "Your account is pending admin approval. Once approved, an admin will assign you to a specific project — you'll only be able to see that project."
        if requested_role == "contractor"
        else "User registered successfully"
    )

    return {
        "message": message,
        "username": new_user["username"],
        "role": new_user["role"],
        "full_name": new_user["full_name"],
        "is_verified": new_user["is_verified"],
        "assigned_project_id": new_user["assigned_project_id"],
    }


@app.get("/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    """Return currently authenticated user profile (no password)."""
    user_role = current_user.get("role")
    is_verified = current_user.get("is_verified", True if user_role != "contractor" else False)
    return {
        "id": current_user.get("id", current_user["username"]),
        "username": current_user["username"],
        "role": user_role,
        "full_name": current_user["full_name"],
        "is_verified": is_verified,
        "assigned_project_id": current_user.get("assigned_project_id", None),
    }


# ── Admin Endpoints for Contractor Management ─────────────────────────

@app.get("/admin/pending-contractors")
def get_pending_contractors(current_user: dict = Depends(require_role("admin"))):
    """
    List all registered users with role='contractor' and is_verified=False.
    Admin-only endpoint.
    """
    users = load_users()
    pending = [
        {
            "id": u.get("id", u["username"]),
            "user_id": u.get("id", u["username"]),
            "username": u["username"],
            "full_name": u.get("full_name", u["username"]),
            "role": u.get("role"),
            "is_verified": u.get("is_verified", False),
            "assigned_project_id": u.get("assigned_project_id", None),
            "created_at": u.get("created_at"),
        }
        for u in users
        if u.get("role") == "contractor" and not u.get("is_verified", False)
    ]
    return pending


@app.patch("/admin/contractors/{user_id}/verify")
def verify_contractor(user_id: str, current_user: dict = Depends(require_role("admin"))):
    """
    Verify a contractor account by setting is_verified=True.
    Admin-only endpoint. Validates that the user exists and has role='contractor'.
    """
    users = load_users()
    target_user = None
    for u in users:
        if str(u.get("id")) == str(user_id) or str(u.get("user_id")) == str(user_id) or u.get("username") == user_id:
            target_user = u
            break

    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Contractor '{user_id}' not found",
        )

    if target_user.get("role") != "contractor":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"User '{user_id}' is not a contractor",
        )

    target_user["is_verified"] = True
    save_users(users)

    return {
        "message": f"Contractor '{target_user['username']}' verified successfully",
        "id": target_user.get("id", target_user["username"]),
        "user_id": target_user.get("id", target_user["username"]),
        "username": target_user["username"],
        "full_name": target_user.get("full_name", target_user["username"]),
        "role": target_user.get("role"),
        "is_verified": True,
        "assigned_project_id": target_user.get("assigned_project_id", None),
    }


