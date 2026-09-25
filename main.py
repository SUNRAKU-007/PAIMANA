"""
main.py -- FastAPI backend for Construction Bid Cost-Overrun Dashboard
Loads the dataset + trained models on startup, serves project data and predictions.
"""

import re
import os
import time
import json
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
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

load_dotenv()
load_dotenv(os.path.join(BASE_DIR, "paimana_backend", ".env"))
load_dotenv(os.path.join(BASE_DIR, "..", "paimana_backend", ".env"))
_api_key = os.getenv("GEMINI_API_KEY")
gemini_client = genai.Client(api_key=_api_key) if _api_key else None


def _resolve_file(*paths):
    candidates = [
        os.path.join(BASE_DIR, *paths),
        os.path.join(".", *paths),
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

# HR_FEATURES: 13-feature list for the binary high-risk model.
# Loaded at startup from models/hr_features.json (written by train_model.py).
# Falls back to the hardcoded list if the file is missing.
_HR_FEATURES_FALLBACK = FEATURES + [
    "pct_earthwork", "pct_surfacing", "pct_structures",
    "pct_drainage_traffic", "pct_other",
]
_hr_features_path = _resolve_file("models", "hr_features.json")
try:
    with open(_hr_features_path, "r") as _f:
        HR_FEATURES = json.load(_f)
    print(f"Loaded HR_FEATURES ({len(HR_FEATURES)} features) from {_hr_features_path}")
except Exception as _e:
    HR_FEATURES = _HR_FEATURES_FALLBACK
    print(f"hr_features.json not found ({_e}); using fallback HR_FEATURES ({len(HR_FEATURES)})")

_PCT_GROUPS = ["earthwork", "surfacing", "structures", "drainage_traffic", "other"]


def _section_group(col_name: str) -> str:
    """Map a Caltrans bid-item pay-code column to a section group by leading number."""
    try:
        leading = int(col_name.split("-")[0])
    except (ValueError, IndexError):
        return "other"
    if 200 <= leading <= 299:
        return "earthwork"
    elif 300 <= leading <= 399:
        return "surfacing"
    elif 400 <= leading <= 499:
        return "structures"
    elif 500 <= leading <= 699:
        return "drainage_traffic"
    return "other"


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
        os.path.join(BASE_DIR, "paimana_backend", "data", "india", "real_projects.json"),
        os.path.join(BASE_DIR, "..", "data", "india", "real_projects.json"),
    ]
    file_path = None
    for c in candidates:
        if os.path.exists(c):
            file_path = c
            break

    if file_path and os.path.exists(file_path):
        try:
            with open(file_path, "r", encoding="utf-8") as f:
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

    # --- Section-group pct_* features (required by binary high-risk model) ---
    # Re-identify bid_item_cols after row drops so indices are consistent.
    bid_item_cols = [c for c in df.columns if BID_ITEM_RE.match(c)]
    col_to_group = {c: _section_group(c) for c in bid_item_cols}
    group_col_map = {
        g: [c for c, grp in col_to_group.items() if grp == g]
        for g in _PCT_GROUPS
    }
    bid_matrix = df[bid_item_cols].fillna(0)
    row_totals = bid_matrix.sum(axis=1)
    for g in _PCT_GROUPS:
        cols = group_col_map[g]
        group_sum = bid_matrix[cols].sum(axis=1) if cols else pd.Series(0, index=df.index)
        df[f"pct_{g}"] = np.where(row_totals > 0, group_sum / row_totals, 0.0)

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

    # Binary high-risk model: use predict_proba then bucket into Low/Medium/High
    X_hr = df[HR_FEATURES]
    hr_proba = risk_model.predict_proba(X_hr)[:, 1]
    df["high_risk_prob"] = hr_proba
    df["predicted_risk_tier"] = [_prob_to_tier(p) for p in hr_proba]

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
        "predicted_risk_tier", "high_risk_prob",
        # original feature values for detail endpoint
        "log_engineers_estimate", "estimate_per_item",
        "start_month", "is_monsoon_season", "materials_ppi", "ppi_deviation",
        # section-group pct_* features
        "pct_earthwork", "pct_surfacing", "pct_structures",
        "pct_drainage_traffic", "pct_other",
    ]
    projects_df = df[keep_cols].copy()

    print(f"Loaded {len(projects_df)} projects, models ready.")
    load_india_projects()


# ── Endpoints ──────────────────────────────────────────────────────────

@app.get("/projects")
def list_projects(current_user: dict = Depends(get_current_user)):
    """All projects with key fields (no raw bid-item columns)."""
    cols = [
        "project_id", "engineers_estimate", "bid_total", "bid_days",
        "item_count", "actual_cost_overrun_pct", "predicted_overrun_pct",
        "predicted_risk_tier", "materials_ppi",
    ]
    return projects_df[cols].to_dict(orient="records")


@app.get("/projects/{project_id}/risk")
def project_risk_detail(project_id: int, current_user: dict = Depends(get_current_user)):
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
def high_risk_alerts(current_user: dict = Depends(get_current_user)):
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
def dashboard_summary(current_user: dict = Depends(get_current_user)):
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
            "classifier_test_accuracy": 0.4742,
        },
    }


# ── Pydantic request model for assistant ───────────────────────────────
class AskRequest(BaseModel):
    question: str


@app.post("/assistant/ask")
def assistant_ask(request: AskRequest, current_user: dict = Depends(get_current_user)):
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
    expenditure_update_cr: float
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
    current_user: dict = Depends(get_current_user),
):
    """Return list of India infrastructure projects with optional status and search filters."""
    global india_projects_df
    if india_projects_df.empty:
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

        risk_info = compute_india_risk(cleaned, reports=reports)
        cleaned["is_flagged"] = risk_info["is_flagged"]
        cleaned["risk_reasons"] = risk_info["risk_reasons"]

        results.append(cleaned)

    return results


@app.get("/india/alerts")
def get_india_alerts(
    current_user: dict = Depends(get_current_user),
):
    """
    Return only flagged India infrastructure projects (is_flagged == true) from the full list,
    sorted by number of reasons descending (most flags first).
    """
    all_projects = list_india_projects(status=None, search=None, current_user=current_user)
    flagged = [p for p in all_projects if p.get("is_flagged")]
    flagged.sort(key=lambda p: len(p.get("risk_reasons", [])), reverse=True)
    return flagged


@app.post("/india/projects/{project_id}/report")
def create_project_report(
    project_id: str,
    report_data: ProjectReportRequest,
    current_user: dict = Depends(require_role("admin", "field_officer")),
):
    """File project report. Only admin and field_officer roles permitted."""
    report_entry = {
        "project_id": str(project_id),
        "submitted_by": current_user.get("username"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "expenditure_update_cr": report_data.expenditure_update_cr,
        "delay_reason": report_data.delay_reason,
        "notes": report_data.notes or "",
    }
    reports = load_reports()
    reports.append(report_entry)
    save_reports(reports)
    return report_entry


@app.get("/india/projects/{project_id}/reports")
def get_project_reports(
    project_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return all reports filed for that project_id from reports.json, sorted newest first."""
    reports = load_reports()
    matching = [
        r for r in reports
        if str(r.get("project_id")) == str(project_id)
    ]
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
    current_user: dict = Depends(get_current_user),
):
    """Submit feedback for a project. Any authenticated user can submit."""
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
    current_user: dict = Depends(get_current_user),
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
    current_user: dict = Depends(get_current_user),
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
    current_user: dict = Depends(get_current_user),
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
    current_user: dict = Depends(get_current_user),
):
    """
    Role-based notifications:
    - admin or field_officer: return flagged-projects data identical to /india/alerts
    - public: reports from projects followed by current user, newest first, capped at 20
    Response shape: {role: str, count: int, items: [...]}
    """
    role = current_user.get("role", "public")
    if role in ("admin", "field_officer"):
        alert_items = get_india_alerts(current_user=current_user)
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
    all_projects = list_india_projects(status=None, search=None, current_user=current_user)
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
    """Answer user questions about real Indian infrastructure projects using Gemini."""
    if not gemini_client:
        return {
            "answer": "I'm having trouble connecting right now. "
                      "Try again in a moment."
        }

    # ── Build context from real India project data ────────────────────────────

    # 1. Total count & status breakdown
    global india_projects_df
    if india_projects_df.empty:
        load_india_projects()

    total_count = len(india_projects_df)
    status_counts: dict = {}
    if not india_projects_df.empty and "status" in india_projects_df.columns:
        status_counts = india_projects_df["status"].value_counts().to_dict()

    status_line = ", ".join(
        f"{k}={v}" for k, v in status_counts.items()
    ) or "status breakdown unavailable"

    # 2. Flagged projects — reuse get_india_alerts (which calls compute_india_risk)
    flagged = get_india_alerts(current_user=current_user)

    # Cap to top-10 by number of risk_reasons (already sorted that way by get_india_alerts)
    top_flagged = flagged[:10]

    # 3. Dynamically extract the top-2 cost-escalation examples from risk_reasons
    #    compute_india_risk writes: "Cost escalated X% above original estimate"
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

    # Sort highest-overrun first, take top-2
    escalation_examples.sort(key=lambda x: x[0], reverse=True)
    top2_escalations = escalation_examples[:2]

    escalation_block = ""
    if top2_escalations:
        lines = [
            f"  - {name}: {reason}"
            for _, name, reason in top2_escalations
        ]
        escalation_block = (
            "Most severe cost escalations in the dataset:\n"
            + "\n".join(lines)
            + "\n"
        )

    # 4. Flagged project detail lines (name, sector, state, risk_reasons)
    flagged_lines = []
    for p in top_flagged:
        name    = p.get("name",   f"Project #{p.get('project_id', '?')}")
        sector  = p.get("sector", "unknown sector")
        state   = p.get("state",  "unknown state")
        reasons = "; ".join(p.get("risk_reasons", [])) or "no reasons recorded"
        flagged_lines.append(
            f"  - {name} ({sector}, {state}): {reasons}"
        )

    flagged_block = (
        f"Flagged / at-risk projects ({len(flagged)} total, showing top {len(top_flagged)}):\n"
        + ("\n".join(flagged_lines) if flagged_lines else "  None flagged")
        + "\n"
    )

    context = (
        f"Total Indian infrastructure projects monitored: {total_count}\n"
        f"Status breakdown: {status_line}\n"
        f"Total flagged projects: {len(flagged)}\n"
        + escalation_block
        + flagged_block
    )

    prompt = (
        "You are an assistant for PAIMANA's real Indian infrastructure project "
        "monitoring platform. Answer using ONLY the following real data context. "
        "Be concise (2-4 sentences), cite specific project names and numbers where "
        "relevant, and if the question can't be answered from this context, say so "
        "honestly.\n\n"
        f"Context:\n{context}\n\n"
        f"Question: {request.question}"
    )

    # ── Gemini call — same retry-once pattern as /assistant/ask ──────────────
    for n in range(1, 3):
        try:
            response = gemini_client.models.generate_content(
                model="gemini-3.6-flash",
                contents=prompt,
            )
            return {"answer": response.text}
        except Exception as e:
            print(f"Gemini india-assistant attempt {n} failed: {e}")
            if n < 2:
                time.sleep(1)

    return {
        "answer": "I'm having trouble connecting right now. "
                  "Try again in a moment."
    }


# ── Authentication Endpoints ──────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str
    full_name: str


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
    access_token_expires = timedelta(hours=24)
    access_token = create_access_token(
        data={"sub": user["username"], "role": user.get("role")},
        expires_delta=access_token_expires,
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user["role"],
        "full_name": user["full_name"],
    }


@app.post("/auth/register")
def register(request: RegisterRequest):
    """Public self-registration. Always assigns role 'public'."""
    username = request.username.strip()
    if not username or not request.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username and password are required",
        )
    existing = get_user(username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )
    new_user = {
        "username": username,
        "hashed_password": pwd_context.hash(request.password),
        "role": "public",
        "full_name": request.full_name.strip() if request.full_name else username,
    }
    users = load_users()
    users.append(new_user)
    save_users(users)
    return {
        "message": "User registered successfully",
        "username": new_user["username"],
        "role": new_user["role"],
        "full_name": new_user["full_name"],
    }


@app.get("/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    """Return currently authenticated user profile (no password)."""
    return {
        "username": current_user["username"],
        "role": current_user["role"],
        "full_name": current_user["full_name"],
    }

