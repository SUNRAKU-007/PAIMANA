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

# Allowed CORS origins (configurable via ALLOWED_ORIGINS env var for deployment)
_default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_env_origins = os.environ.get("ALLOWED_ORIGINS", "").strip()
if _env_origins:
    allowed_origins = [orig.strip() for orig in _env_origins.split(",") if orig.strip()]
else:
    allowed_origins = _default_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Feature config (must match train_model.py) ───────────────────────
BASE_FEATURES = [
    "log_original_cost", "expenditure_ratio", "progress_frac", "burn_progress_gap",
    "approval_to_start_months", "project_age_months", "start_month", "is_monsoon_start",
    "sector_freq", "ministry_freq", "state_freq", "agency_freq"
]

_hr_features_path = _resolve_file("models", "hr_features.json")
try:
    with open(_hr_features_path, "r") as _f:
        HR_FEATURES = json.load(_f)
    print(f"Loaded HR_FEATURES ({len(HR_FEATURES)} features) from {_hr_features_path}")
except Exception as _e:
    HR_FEATURES = BASE_FEATURES
    print(f"hr_features.json not found ({_e}); using fallback HR_FEATURES ({len(HR_FEATURES)})")

FEATURES = HR_FEATURES
_HR_FEATURES_FALLBACK = HR_FEATURES


def _prob_to_tier(p: float) -> str:
    """Bucket a high_risk probability into Low / Medium / High tier string."""
    if p < 0.33:
        return "Low"
    elif p <= 0.66:
        return "Medium"
    return "High"

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
    global projects_df, cost_model, risk_model, feature_influence, india_projects_df, FEATURES, HR_FEATURES

    # --- Load CSV ---
    csv_path = _resolve_file("data", "india", "moSPI_paimana_all_ongoing_projects_Aug2026.csv")
    df = pd.read_csv(csv_path)

    # --- Target Engineering (exact same as train_model.py) ---
    target_date = pd.to_datetime(df["Target_DoC"], format="%m/%Y", errors="coerce")
    has_revised = (df["Revised_DoC"] != "-") & df["Revised_DoC"].notna()
    revised_clean = df["Revised_DoC"].replace("-", np.nan)
    revised_date = pd.to_datetime(revised_clean, format="%m/%Y", errors="coerce")

    REF_YEAR = 2026
    REF_MONTH = 8

    rev_delay_months = (revised_date.dt.year - target_date.dt.year) * 12 + (revised_date.dt.month - target_date.dt.month)
    overdue_months = (REF_YEAR - target_date.dt.year) * 12 + (REF_MONTH - target_date.dt.month)

    raw_delay = np.where(
        has_revised,
        rev_delay_months,
        np.where(overdue_months > 0, overdue_months, 0.0)
    )

    # Clip to 1st-99th percentile range (same as train_model.py)
    lo = float(np.percentile(raw_delay, 1))
    hi = float(np.percentile(raw_delay, 99))
    df["delay_months"] = np.clip(raw_delay, lo, hi)

    # --- Feature Engineering (exact same as train_model.py) ---
    df["Approval_Date"] = df["Approval_Date"].fillna(df["Start_Date"])
    approval_date = pd.to_datetime(df["Approval_Date"], format="%m/%Y", errors="coerce")
    start_date = pd.to_datetime(df["Start_Date"], format="%m/%Y", errors="coerce")

    df["log_original_cost"] = np.log1p(df["Original_Cost_Cr"])
    df["expenditure_ratio"] = df["Cumulative_Expenditure_Cr"] / df["Original_Cost_Cr"]
    df["progress_frac"] = df["Physical_Progress_Pct"] / 100.0
    df["burn_progress_gap"] = df["expenditure_ratio"] - df["progress_frac"]
    df["approval_to_start_months"] = (start_date.dt.year - approval_date.dt.year) * 12 + (start_date.dt.month - approval_date.dt.month)
    df["project_age_months"] = (REF_YEAR - start_date.dt.year) * 12 + (REF_MONTH - start_date.dt.month)
    df["start_month"] = start_date.dt.month
    df["is_monsoon_start"] = df["start_month"].isin([6, 7, 8, 9]).astype(int)

    # Frequency encoding
    for col in ["Sector", "Ministry", "State", "Agency"]:
        freq_col = f"{col.lower()}_freq"
        df[freq_col] = df[col].map(df[col].value_counts(normalize=True))

    # One-hot encode Sector and Ministry directly
    sector_dummies = pd.get_dummies(df["Sector"], prefix="sector", dtype=int)
    ministry_dummies = pd.get_dummies(df["Ministry"], prefix="ministry", dtype=int)
    df = pd.concat([df, sector_dummies, ministry_dummies], axis=1)

    # Ensure all HR_FEATURES columns exist
    for f in HR_FEATURES:
        if f not in df.columns:
            df[f] = 0

    # --- Load models ---
    cost_model_path = _resolve_file("models", "cost_model.joblib")
    risk_model_path = _resolve_file("models", "risk_model.joblib")
    cost_model = joblib.load(cost_model_path)
    risk_model = joblib.load(risk_model_path)

    # --- Predictions ---
    X = df[HR_FEATURES]
    df["predicted_delay_months"] = cost_model.predict(X)

    # Binary high-risk model: use predict_proba then bucket into Low/Medium/High
    hr_proba = risk_model.predict_proba(X)[:, 1]
    df["high_risk_prob"] = hr_proba
    df["predicted_risk_tier"] = [_prob_to_tier(p) for p in hr_proba]

    # --- Assign project_id from index ---
    df = df.reset_index(drop=True)
    df["project_id"] = df.index

    # --- Compute feature influence (works for both model types) ---
    if hasattr(cost_model, "feature_importances_"):
        feature_influence = {
            feat: round(float(val), 4)
            for feat, val in zip(HR_FEATURES, cost_model.feature_importances_)
        }
    elif hasattr(cost_model, "coef_"):
        raw = np.abs(cost_model.coef_)
        normed = raw / raw.sum() if raw.sum() > 0 else raw
        feature_influence = {
            feat: round(float(val), 4) for feat, val in zip(HR_FEATURES, normed)
        }
    else:
        feature_influence = {}

    # Renamed / normalized fields
    df["original_cost_cr"] = df["Original_Cost_Cr"]
    df["cumulative_expenditure_cr"] = df["Cumulative_Expenditure_Cr"]
    df["physical_progress_pct"] = df["Physical_Progress_Pct"]
    df["project_name"] = df["Project_Name"]
    df["ministry"] = df["Ministry"]
    df["sector"] = df["Sector"]
    df["state"] = df["State"]
    df["agency"] = df["Agency"]

    # Backward-compatible aliases for legacy frontend bindings
    df["engineers_estimate"] = df["Original_Cost_Cr"]
    df["bid_total"] = df["Cumulative_Expenditure_Cr"]
    df["bid_days"] = df["delay_months"]
    df["item_count"] = df["project_age_months"]
    df["actual_cost_overrun_pct"] = df["delay_months"]
    df["predicted_overrun_pct"] = df["predicted_delay_months"]
    df["materials_ppi"] = df["burn_progress_gap"]

    # --- Keep only columns we need ---
    keep_cols = [
        "project_id", "project_name", "ministry", "sector", "state", "agency",
        "original_cost_cr", "cumulative_expenditure_cr", "physical_progress_pct",
        "delay_months", "predicted_delay_months", "predicted_risk_tier", "high_risk_prob",
        # Legacy compatibility columns
        "engineers_estimate", "bid_total", "bid_days", "item_count",
        "actual_cost_overrun_pct", "predicted_overrun_pct", "materials_ppi",
    ] + [f for f in HR_FEATURES if f not in [
        "project_id", "original_cost_cr", "cumulative_expenditure_cr", "physical_progress_pct",
        "delay_months", "predicted_delay_months", "predicted_risk_tier", "high_risk_prob"
    ]]
    projects_df = df[keep_cols].copy()

    print(f"Loaded {len(projects_df)} Indian infrastructure projects, models ready.")
    load_india_projects()


# ── Endpoints ──────────────────────────────────────────────────────────

@app.get("/projects")
def list_projects(current_user: dict = Depends(require_verified_user)):
    """All projects with key fields."""
    cols = [
        "project_id", "project_name", "ministry", "sector", "state", "agency",
        "original_cost_cr", "cumulative_expenditure_cr", "physical_progress_pct",
        "delay_months", "predicted_delay_months", "predicted_risk_tier",
        # Legacy compatibility aliases
        "engineers_estimate", "bid_total", "bid_days", "item_count",
        "actual_cost_overrun_pct", "predicted_overrun_pct", "materials_ppi",
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
        feat: round(float(rec.get(feat, 0)), 4) for feat in HR_FEATURES
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
    """Projects predicted as High risk, sorted by predicted delay descending."""
    high = projects_df[projects_df["predicted_risk_tier"] == "High"].copy()
    high = high.sort_values("predicted_delay_months", ascending=False)
    cols = [
        "project_id", "project_name", "ministry", "sector", "state",
        "original_cost_cr", "cumulative_expenditure_cr", "physical_progress_pct",
        "delay_months", "predicted_delay_months", "predicted_risk_tier",
        # Legacy compatibility aliases
        "engineers_estimate", "bid_total", "bid_days", "item_count",
        "actual_cost_overrun_pct", "predicted_overrun_pct",
    ]
    return high[cols].to_dict(orient="records")


@app.get("/dashboard/summary")
def dashboard_summary(current_user: dict = Depends(require_verified_user)):
    """Aggregate stats + real model performance from training run."""
    tier_counts = projects_df["predicted_risk_tier"].value_counts().to_dict()
    avg_delay = round(float(projects_df["predicted_delay_months"].mean()), 2)
    return {
        "total_projects": len(projects_df),
        "avg_predicted_delay_months": avg_delay,
        "avg_predicted_overrun_pct": avg_delay,
        "risk_tier_counts": {
            "Low": tier_counts.get("Low", 0),
            "Medium": tier_counts.get("Medium", 0),
            "High": tier_counts.get("High", 0),
        },
        # Real metrics from train_model.py run on MoSPI Indian Infrastructure data
        "model_performance": {
            "baseline_test_r2": 0.5846,
            "rf_test_r2": 0.7292,
            "gb_test_r2": 0.7432,
            "overall_accuracy": 0.9222,
            "majority_baseline_accuracy": 0.7550,
            "improvement_pp": 16.71,
            "high_risk_precision": 0.8295,
            "high_risk_recall": 0.8588,
            "high_risk_f1": 0.8439,
            "high_risk_base_rate": 0.2461,
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
    avg_delay = round(float(projects_df["predicted_delay_months"].mean()), 2)

    top5 = (
        projects_df
        .sort_values("predicted_delay_months", ascending=False)
        .head(5)[["project_id", "project_name", "predicted_delay_months", "original_cost_cr"]]
    )
    top5_lines = "\n".join(
        f"  - Project #{int(r.project_id)} ({r.project_name}): "
        f"diagnosed slippage {r.predicted_delay_months:.1f} months, "
        f"cost ₹{r.original_cost_cr:.1f} Cr"
        for _, r in top5.iterrows()
    )

    context = (
        f"Total projects: {total}\n"
        f"Distress tier counts: Low={tier_counts.get('Low', 0)}, "
        f"Medium={tier_counts.get('Medium', 0)}, "
        f"High={tier_counts.get('High', 0)}\n"
        f"Average diagnosed schedule slippage: {avg_delay} months\n"
        f"Top 5 most-distressed projects:\n{top5_lines}\n"
        f"Key finding: this model diagnoses CURRENT distress in active projects "
        f"using project age and burn-progress gap as the strongest signals — "
        f"it identifies which ongoing projects are already showing signs of trouble, "
        f"not which future projects will fail before they start."
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

REF_YEAR = 2026
REF_MONTH = 8


def calculate_project_age_months(start_date_str: Optional[str]) -> Optional[int]:
    """Calculate project age in months from start_date (mm/YYYY) relative to reference date (August 2026).
    Reuses the exact same calculation as train_model.py and load_data_and_models():
        project_age_months = (REF_YEAR - start_date.year) * 12 + (REF_MONTH - start_date.month)
    """
    if not start_date_str or not str(start_date_str).strip() or str(start_date_str).strip() == "-":
        return None
    try:
        parts = str(start_date_str).strip().split("/")
        if len(parts) == 2:
            s_month, s_year = int(parts[0]), int(parts[1])
            return (REF_YEAR - s_year) * 12 + (REF_MONTH - s_month)
    except (ValueError, TypeError):
        pass
    return None


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

    # 2. Ongoing with physical progress < 20% and running > 12 months
    status = str(project.get("status") or "").strip()
    prog = project.get("physical_progress_pct")
    if status == "Ongoing" and prog is not None:
        try:
            prog_val = float(prog)
            if prog_val < 20:
                s_date = project.get("start_date") or project.get("approval_date")
                age_m = calculate_project_age_months(s_date)
                if age_m is not None and age_m > 12:
                    risk_reasons.append("Physical progress under 20%")
        except (ValueError, TypeError):
            pass

    # 3. Schedule extension from target_doc to revised_doc
    target_doc = project.get("target_doc")
    revised_doc = project.get("revised_doc")
    if target_doc and revised_doc:
        try:
            t_parts = str(target_doc).strip().split("/")
            r_parts = str(revised_doc).strip().split("/")
            if len(t_parts) == 2 and len(r_parts) == 2:
                t_m = int(t_parts[1]) * 12 + int(t_parts[0])
                r_m = int(r_parts[1]) * 12 + int(r_parts[0])
                diff_m = r_m - t_m
                if diff_m >= 12:
                    risk_reasons.append(f"Schedule delayed by {diff_m} months (Target: {target_doc} -> Revised: {revised_doc})")
        except Exception:
            pass

    # 4. Contractor operational delay
    if project.get("is_delayed_by_contractor"):
        r_text = project.get("contractor_delay_reason") or "Contractor reported operational delay"
        risk_reasons.append(f"Contractor delay: {r_text}")

    # 5. Completed with delay_note
    delay_note = project.get("delay_note")
    if status == "Completed" and delay_note and str(delay_note).strip():
        risk_reasons.append(str(delay_note).strip())

    # 6. Field officer report with non-empty delay_reason
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
    search: Optional[str] = Query(None, description="Case-insensitive substring match on project name, sector, ministry, state, or ID"),
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

    # Filter by case-insensitive substring match on project name, sector, ministry, state, or ID
    if search:
        s = str(search).strip()
        mask = pd.Series(False, index=df.index)
        for col in ["name", "sector", "ministry", "state", "project_id"]:
            if col in df.columns:
                mask |= df[col].astype(str).str.contains(s, case=False, na=False)
        df = df[mask]

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


class UpdateRevisedCostRequest(BaseModel):
    revised_cost_cr: float


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


@app.patch("/india/projects/{project_id}/revised-cost")
def update_project_revised_cost(
    project_id: str,
    body: UpdateRevisedCostRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Update project revised cost in Cr.
    Permitted only for 'admin' or the assigned 'contractor'.
    """
    user_role = current_user.get("role")
    username = current_user.get("username")
    user_id = str(current_user.get("id") or current_user.get("user_id") or "")

    raw = _load_projects_file()
    projects = raw.get("projects", [])
    target = next((p for p in projects if str(p.get("project_id")) == str(project_id)), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found.")

    if user_role == "admin":
        pass  # Admin is always authorized
    elif user_role == "contractor":
        assigned = str(target.get("assigned_contractor") or "")
        if not assigned or (assigned != username and assigned != user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the assigned contractor or an administrator can update the revised cost for this project.",
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only contractors and administrators are authorized to update revised costs.",
        )

    if body.revised_cost_cr < 0:
        raise HTTPException(status_code=400, detail="Revised cost must be a non-negative number.")

    new_revised = round(float(body.revised_cost_cr), 2)
    target["revised_cost_cr"] = new_revised
    _save_projects_file(raw)
    load_india_projects()

    reports = load_reports()
    return _project_to_response(target, reports=reports)


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

    users = load_users()
    users_modified = False

    if "assigned_officer" in fields_set:
        old_officer = target_project.get("assigned_officer")
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

        # Synchronize assigned_project_id and is_verified for officer in users.json
        for u in users:
            if u.get("role") in ("field_officer", "officer"):
                uname = u.get("username")
                uid = str(u.get("id", ""))
                if new_officer and (uname == new_officer or uid == new_officer):
                    u["assigned_project_id"] = str(project_id)
                    u["is_verified"] = True
                    users_modified = True
                elif old_officer and (uname == old_officer or uid == old_officer) and str(u.get("assigned_project_id")) == str(project_id):
                    u["assigned_project_id"] = None
                    users_modified = True

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

        # Synchronize assigned_project_id and is_verified for contractor in users.json
        for u in users:
            if u.get("role") == "contractor":
                uname = u.get("username")
                uid = str(u.get("id", ""))
                if new_contractor and (uname == new_contractor or uid == new_contractor):
                    u["assigned_project_id"] = str(project_id)
                    u["is_verified"] = True
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
    current_user: dict = Depends(get_current_user),
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

        if role in ("field_officer", "officer"):
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
        current_exp = float(matching_project.get("expenditure_cr") or 0.0)
        matching_project["expenditure_cr"] = round(current_exp + float(target_report["expenditure_update_cr"]), 2)
    if target_report.get("progress_pct") is not None:
        matching_project["physical_progress_pct"] = float(target_report["progress_pct"])

    # If project is "Newly Added", transition it to "Ongoing" upon first confirmed report
    if matching_project.get("status") == "Newly Added":
        matching_project["status"] = "Ongoing"

    target_report["project_status"] = matching_project.get("status")
    target_report["new_expenditure_cr"] = matching_project.get("expenditure_cr")

    save_reports(reports)

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


def _format_feedback_item(f: dict) -> dict:
    """Format feedback entry: public citizen feedback is strictly anonymous,
    while feedback by contractors, field officers, and admins displays their role and name."""
    raw_role = (f.get("role") or "public").strip().lower()
    
    # Public / Citizen feedback is strictly anonymous
    if raw_role in ("public", "citizen", ""):
        return {
            "project_id": str(f.get("project_id")),
            "timestamp": f.get("timestamp"),
            "message": f.get("message"),
            "category": f.get("category"),
            "role": "public",
            "author_role": "Citizen",
            "author_name": "Anonymous Citizen",
            "is_anonymous": True,
        }
    
    # Official / Gated accounts: contractor, field_officer, admin
    author = f.get("submitted_by") or "Official"
    role_label_map = {
        "contractor": "Contractor",
        "field_officer": "Field Officer",
        "officer": "Field Officer",
        "admin": "Admin",
    }
    normalized_role = "field_officer" if raw_role == "officer" else raw_role
    return {
        "project_id": str(f.get("project_id")),
        "timestamp": f.get("timestamp"),
        "message": f.get("message"),
        "category": f.get("category"),
        "role": normalized_role,
        "author_role": role_label_map.get(raw_role, raw_role.capitalize()),
        "author_name": author,
        "is_anonymous": False,
    }


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

    return _format_feedback_item(feedback_entry)


@app.get("/india/projects/{project_id}/feedback")
def get_project_feedback(
    project_id: str,
):
    """Return all feedback for that project_id from feedback.json, sorted newest first.
    Citizen feedback is kept anonymous; contractor, officer, and admin feedback shows their role & name."""
    feedbacks = load_feedback()
    matching = [
        f for f in feedbacks
        if str(f.get("project_id")) == str(project_id)
    ]
    matching.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    return [_format_feedback_item(f) for f in matching]


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
    - admin: return nationwide flagged-projects data identical to /india/alerts
    - field_officer / contractor: return alerts ONLY for project(s) assigned to them
      (risk flags, contractor confirmation requests, rejection notices, recent updates)
    - public: reports from projects followed by current user, newest first, capped at 20
    Response shape: {role: str, count: int, items: [...]}
    """
    role = current_user.get("role", "public")
    username = current_user.get("username")
    user_id = str(current_user.get("id") or current_user.get("user_id") or "")

    # 1. Admin retains nationwide overview of all flagged projects
    if role == "admin":
        alert_items = get_india_alerts()
        for a in alert_items:
            if not a.get("summary") and a.get("risk_reasons"):
                a["summary"] = "Flagged: " + ", ".join(a["risk_reasons"][:2])
            a.setdefault("project_name", a.get("name"))
        return {
            "role": role,
            "count": len(alert_items),
            "items": alert_items,
        }

    raw = _load_projects_file()
    projects_list = raw.get("projects", [])
    all_reports = load_reports()
    name_map = _get_india_project_name_map()

    # 2. Field Officer & Contractor: strictly scoped to assigned projects only
    if role in ("field_officer", "officer", "contractor"):
        user_assigned_pid = str(current_user.get("assigned_project_id") or "")

        assigned_pids = set()
        if user_assigned_pid and user_assigned_pid not in ("None", "null", ""):
            assigned_pids.add(user_assigned_pid)

        for p in projects_list:
            pid = str(p.get("project_id"))
            assigned_officer = str(p.get("assigned_officer") or "")
            assigned_contractor = str(p.get("assigned_contractor") or "")

            if role in ("field_officer", "officer"):
                if assigned_officer and (assigned_officer == username or assigned_officer == user_id):
                    assigned_pids.add(pid)
            elif role == "contractor":
                if assigned_contractor and (assigned_contractor == username or assigned_contractor == user_id):
                    assigned_pids.add(pid)

        assigned_project_records = [
            p for p in projects_list if str(p.get("project_id")) in assigned_pids
        ]

        items = []

        for p in assigned_project_records:
            pid = str(p.get("project_id"))
            p_name = p.get("name") or name_map.get(pid, f"Project #{pid}")
            sector = p.get("sector")
            state = p.get("state")

            proj_reports = [r for r in all_reports if str(r.get("project_id")) == pid]
            proj_reports.sort(key=lambda x: str(x.get("timestamp") or ""), reverse=True)

            action_report_ids = set()

            # Priority 1: Actionable report notices
            if role == "contractor":
                for r in proj_reports:
                    if r.get("status") == "pending_confirmation":
                        action_report_ids.add(str(r.get("report_id")))
                        exp_str = f"₹{r.get('expenditure_update_cr')} Cr" if r.get('expenditure_update_cr') is not None else ""
                        items.append({
                            "project_id": pid,
                            "name": p_name,
                            "project_name": p_name,
                            "sector": sector,
                            "state": state,
                            "timestamp": r.get("timestamp"),
                            "type": "pending_action",
                            "action_required": True,
                            "summary": f"Report #{r.get('report_id', '')}: Awaiting your confirmation {('(' + exp_str + ')') if exp_str else ''}",
                        })
            elif role in ("field_officer", "officer"):
                for r in proj_reports:
                    if r.get("status") == "rejected":
                        action_report_ids.add(str(r.get("report_id")))
                        note = r.get("contractor_note") or "Needs revision"
                        items.append({
                            "project_id": pid,
                            "name": p_name,
                            "project_name": p_name,
                            "sector": sector,
                            "state": state,
                            "timestamp": r.get("timestamp"),
                            "type": "rejected_report",
                            "action_required": True,
                            "summary": f"Report #{r.get('report_id', '')} rejected by contractor: {note}",
                        })

            # Priority 2: Risk Flag alert on assigned project
            risk_info = compute_india_risk(p, reports=all_reports)
            if risk_info.get("is_flagged"):
                risk_reasons = risk_info.get("risk_reasons", [])
                items.append({
                    "project_id": pid,
                    "name": p_name,
                    "project_name": p_name,
                    "sector": sector,
                    "state": state,
                    "timestamp": None,
                    "type": "risk_flag",
                    "risk_reasons": risk_reasons,
                    "summary": "Assigned project flagged: " + ", ".join(risk_reasons),
                    "is_flagged": True,
                    "action_required": True,
                })

            # Priority 3: Recent report updates on assigned project (up to 5)
            for r in proj_reports[:5]:
                rid = str(r.get("report_id"))
                if rid in action_report_ids:
                    continue
                exp_val = r.get("expenditure_update_cr")
                delay = r.get("delay_reason")
                status = r.get("status")

                if exp_val is not None:
                    summary = f"Report logged: ₹{exp_val} Cr expenditure"
                else:
                    summary = "Progress report logged"

                if delay and str(delay).strip():
                    summary += f", delay noted: {str(delay).strip()}"
                elif status == "confirmed":
                    summary += " (confirmed by contractor)"

                items.append({
                    "project_id": pid,
                    "name": p_name,
                    "project_name": p_name,
                    "sector": sector,
                    "state": state,
                    "timestamp": r.get("timestamp"),
                    "type": "report_update",
                    "expenditure_update_cr": exp_val,
                    "delay_reason": delay,
                    "summary": summary,
                })

        return {
            "role": role,
            "count": len(items),
            "items": items,
        }

    # 3. Public role (citizens following projects)
    followers = load_followers()
    followed_pids = {
        str(pid)
        for pid, users in followers.items()
        if isinstance(users, list) and username in users
    }

    # Followed projects risk status (persistent risk flags at top)
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
                    "name": p_name,
                    "project_name": p_name,
                    "sector": p.get("sector"),
                    "state": p.get("state"),
                    "timestamp": None,
                    "type": "risk_flag",
                    "risk_reasons": risk_reasons,
                    "summary": "Currently flagged: " + ", ".join(risk_reasons),
                })

    # Followed projects report-based updates, sorted by timestamp desc
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

        p_name = name_map.get(pid, f"Project #{pid}")
        report_items.append({
            "project_id": pid,
            "name": p_name,
            "project_name": p_name,
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


def _synthesize_india_response(question: str, all_projects: list, flagged: list, scored_matches: list) -> str:
    """Fast, accurate deterministic intelligence generator for Indian infrastructure projects."""
    q_lower = question.lower()

    # 1. If user asks about a specific project (top match has a strong score)
    if scored_matches and scored_matches[0][0] >= 10:
        best_p = scored_matches[0][1]
        name = best_p.get("name", "Unknown Project")
        pid = best_p.get("project_id", "N/A")
        cost = best_p.get("original_cost_cr")
        spent = best_p.get("expenditure_cr")
        prog = best_p.get("physical_progress_pct")
        state = best_p.get("state") or "India"
        ministry = best_p.get("ministry") or "Central Ministry"
        agency = best_p.get("agency")
        target_doc = best_p.get("target_doc") or "TBD"
        revised_doc = best_p.get("revised_doc")
        status = best_p.get("status") or "Ongoing"
        officer = best_p.get("assigned_officer")
        contractor = best_p.get("assigned_contractor")
        reasons = best_p.get("risk_reasons", [])

        cost_str = f"₹{cost:,.2f} Cr" if cost is not None else "N/A"
        spent_str = f"₹{spent:,.2f} Cr" if spent is not None else "₹0.00 Cr"
        prog_str = f"{prog:.1f}%" if prog is not None else "0.0%"
        agency_str = f" (executed by {agency})" if agency else ""
        doc_str = f"target completion of {target_doc}" + (f", revised to {revised_doc}" if revised_doc and revised_doc != target_doc and revised_doc != "-" else "")

        risk_str = ""
        if reasons:
            risk_str = f" Flagged on the watch list due to: {'; '.join(reasons)}."
        else:
            risk_str = " Currently progressing without flagged risk alerts."

        assignment_str = ""
        if officer or contractor:
            parts = []
            if officer: parts.append(f"Officer: {officer}")
            if contractor: parts.append(f"Contractor: {contractor}")
            assignment_str = f" Assigned personnel: {', '.join(parts)}."

        return (
            f"**{name} (Project #{pid})** is an {status.lower()} infrastructure project in **{state}** "
            f"under the **{ministry}**{agency_str}. It has an original capital outlay of **{cost_str}** "
            f"with **{spent_str}** cumulative expenditure recorded. Physical progress stands at **{prog_str}** "
            f"against a {doc_str}.{risk_str}{assignment_str}"
        )

    # 2. General / Aggregated Questions
    if any(k in q_lower for k in ("flagged", "how many", "count", "risk", "at risk", "watchlist")):
        reasons_tally = {}
        for p in flagged:
            for r in p.get("risk_reasons", []):
                key = r.split(":")[0] if ":" in r else r
                reasons_tally[key] = reasons_tally.get(key, 0) + 1
        top_reasons = sorted(reasons_tally.items(), key=lambda x: x[1], reverse=True)[:3]
        reasons_summary = ", ".join(f"{k} ({v} projects)" for k, v in top_reasons)

        return (
            f"Out of **{len(all_projects):,} total monitored projects**, **{len(flagged):,} projects** "
            f"({len(flagged) / max(1, len(all_projects)) * 100:.1f}%) are currently flagged for risk review. "
            f"The primary risk factors driving these flags are: {reasons_summary}."
        )

    if any(k in q_lower for k in ("cost", "escalat", "overrun", "worst", "expensive", "spend")):
        escalated = [p for p in all_projects if (p.get("revised_cost_cr") or 0) > (p.get("original_cost_cr") or 0)]
        escalated.sort(key=lambda p: (p.get("revised_cost_cr", 0) - p.get("original_cost_cr", 0)), reverse=True)
        top3 = escalated[:3] if escalated else sorted(all_projects, key=lambda p: p.get("original_cost_cr", 0), reverse=True)[:3]
        lines = [f"**{p.get('name')}** (₹{p.get('original_cost_cr', 0):,.1f} Cr)" for p in top3]
        return (
            f"Major capital outlay projects under active MoSPI monitoring include {'; '.join(lines)}. "
            f"Cost overruns and expenditure velocity are actively tracked against physical progress milestones."
        )

    if any(k in q_lower for k in ("delay", "late", "schedule", "target", "timeline")):
        return (
            f"Schedule delays across the 1,731 monitored projects are tracked by comparing Target Date of Commissioning "
            f"against Revised DoC and field progress. Projects with 12+ months schedule extension or physical progress "
            f"under 20% are flagged automatically for officer review."
        )

    # 3. If multiple partial matches were found
    if scored_matches:
        names = [f"**{p.get('name')}** (#{p.get('project_id')})" for _, p in scored_matches[:3]]
        return (
            f"Found {len(scored_matches)} matching projects in the national database, including: {', '.join(names)}. "
            f"Please specify a project name or ID for full cost, progress, and delay metrics."
        )

    return (
        f"PAIMANA is currently monitoring **{len(all_projects):,} ongoing Indian infrastructure projects** "
        f"across 21 sectors with **{len(flagged):,} flagged risk projects**. You can ask about any specific project "
        f"by name (e.g. 'Bihta Civil Enclave', 'Kadapa Airport'), project ID, or state/sector."
    )


@app.post("/india/assistant/ask")
def india_assistant_ask(
    request: AskRequest,
):
    """Answer user questions about real Indian infrastructure projects using fast targeted RAG with instant intelligence fallback."""
    try:
        all_projects = list_india_projects(status=None, search=None)
        flagged = [p for p in all_projects if p.get("is_flagged")]

        q_lower = request.question.lower().strip()
        words = [w for w in q_lower.split() if len(w) > 2 and w not in ('the', 'and', 'for', 'with', 'from', 'what', 'which', 'about', 'how', 'many', 'project', 'projects')]

        # Targeted scoring of projects against the query
        scored = []
        for p in all_projects:
            score = 0
            name = str(p.get("name", "")).lower()
            state = str(p.get("state", "")).lower()
            sector = str(p.get("sector", "")).lower()
            agency = str(p.get("agency", "")).lower()
            pid = str(p.get("project_id", "")).lower()

            if q_lower in name:
                score += 35
            for w in words:
                if w in name:
                    score += 8
                if w in state or w in sector or w in agency:
                    score += 3
                if w == pid:
                    score += 25
            if score > 0:
                scored.append((score, p))

        scored.sort(key=lambda x: x[0], reverse=True)
        top_matches = scored[:5]

        # If gemini client is available, attempt fast generate with concise targeted context
        if gemini_client:
            match_lines = []
            for score, p in top_matches:
                pid = p.get("project_id", "?")
                pname = p.get("name")
                cost = p.get("original_cost_cr")
                spent = p.get("expenditure_cr")
                prog = p.get("physical_progress_pct")
                target_doc = p.get("target_doc", "N/A")
                revised_doc = p.get("revised_doc", "N/A")
                state = p.get("state", "India")
                sector = p.get("sector", "Infrastructure")
                agency = p.get("agency", "")
                risk = "; ".join(p.get("risk_reasons", [])) or "None"
                match_lines.append(
                    f"- [{pid}] \"{pname}\" | State: {state} | Sector: {sector} | Agency: {agency} | Cost: ₹{cost} Cr | Spent: ₹{spent} Cr | Progress: {prog}% | Target: {target_doc} | Revised: {revised_doc} | Risk: {risk}"
                )

            context_matches = "\n".join(match_lines) if match_lines else "No specific keyword matches found."

            prompt = (
                "You are an assistant for PAIMANA's real Indian infrastructure project monitoring platform. "
                "Answer the user's question accurately using the live project data context provided below. "
                "Be concise (2-4 sentences), cite specific project names, status, costs, progress, and dates where relevant. "
                "If the project is found in the context, give its exact figures.\n\n"
                f"Context:\n"
                f"Total Indian infrastructure projects monitored: {len(all_projects)} (Flagged: {len(flagged)})\n"
                f"Top relevant projects for this query:\n{context_matches}\n\n"
                f"Question: {request.question}"
            )

            # Try gemini-3.6-flash first
            for model_name in ["gemini-3.6-flash", "gemini-3.5-flash-lite"]:
                try:
                    response = gemini_client.models.generate_content(
                        model=model_name,
                        contents=prompt,
                    )
                    if response and response.text and response.text.strip():
                        return {"answer": response.text.strip()}
                except Exception as e:
                    print(f"Gemini call to {model_name} failed: {e}")
                    # If 503 or error, break directly to instant fallback instead of wasting user's time
                    break

        # Fallback: immediate deterministic synthesized answer
        answer = _synthesize_india_response(request.question, all_projects, flagged, scored)
        return {"answer": answer}

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
    is_verified = user.get("is_verified", True if user.get("role") not in ("contractor", "field_officer", "officer") else False)
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
    Accepts role 'public' (is_verified=True), 'contractor' (is_verified=False), or 'field_officer' (is_verified=False).
    """
    username = request.username.strip()
    if not username or not request.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username and password are required",
        )

    requested_role = (request.role or "public").strip().lower()
    if requested_role in ("officer", "field_officer"):
        requested_role = "field_officer"

    if requested_role not in ("public", "contractor", "field_officer"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role '{requested_role}'. Only 'public', 'contractor', and 'field_officer' can self-register.",
        )

    existing = get_user(username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    is_verified = False if requested_role in ("contractor", "field_officer") else True

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

    if requested_role == "contractor":
        message = "Your contractor account is pending admin approval. Once approved, an admin will assign you to a specific project."
    elif requested_role == "field_officer":
        message = "Your field officer account is pending admin approval and assignment before field reporting access is enabled."
    else:
        message = "User registered successfully"

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
    is_verified = current_user.get("is_verified", True if user_role not in ("contractor", "field_officer", "officer") else False)
    return {
        "id": current_user.get("id", current_user["username"]),
        "username": current_user["username"],
        "role": user_role,
        "full_name": current_user["full_name"],
        "is_verified": is_verified,
        "assigned_project_id": current_user.get("assigned_project_id", None),
    }


# ── Admin Endpoints for Contractor & Officer Management ────────────────

@app.get("/admin/pending-contractors")
@app.get("/admin/pending-users")
def get_pending_users(current_user: dict = Depends(require_role("admin"))):
    """
    List all registered users with role in ('contractor', 'field_officer') and is_verified=False.
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
        if u.get("role") in ("contractor", "field_officer", "officer") and not u.get("is_verified", False)
    ]
    return pending


@app.patch("/admin/contractors/{user_id}/verify")
@app.patch("/admin/users/{user_id}/verify")
def verify_user_account(user_id: str, current_user: dict = Depends(require_role("admin"))):
    """
    Verify a user account (contractor or field officer) by setting is_verified=True.
    Admin-only endpoint. Validates that user exists and requires verification.
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
            detail=f"User '{user_id}' not found",
        )

    target_role = target_user.get("role", "")
    if target_role not in ("contractor", "field_officer", "officer"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"User '{user_id}' is role '{target_role}', which does not require approval.",
        )

    target_user["is_verified"] = True
    save_users(users)

    role_display = "Field Officer" if target_role in ("field_officer", "officer") else "Contractor"
    return {
        "message": f"{role_display} '{target_user['username']}' verified successfully",
        "id": target_user.get("id", target_user["username"]),
        "user_id": target_user.get("id", target_user["username"]),
        "username": target_user["username"],
        "full_name": target_user.get("full_name", target_user["username"]),
        "role": target_user.get("role"),
        "is_verified": True,
        "assigned_project_id": target_user.get("assigned_project_id", None),
    }


