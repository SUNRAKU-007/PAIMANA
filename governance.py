"""
governance.py -- admin powers, verification IDs, spend-gap alerts, notices, ledger and public stats.
Mounted onto the main FastAPI app from main.py.
"""

import re
import secrets
import uuid
from collections import Counter, defaultdict
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import load_users, require_role, require_verified_user, save_users
from store import (
    DEFAULT_SETTINGS,
    get_settings,
    load_issued_ids,
    load_notices,
    log_audit,
    now_iso,
    read_audit,
    save_issued_ids,
    save_notices,
    save_settings,
    spend_analysis,
)

router = APIRouter()

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROLE_PREFIX = {"contractor": "CON", "field_officer": "OFF"}
STAFF_ROLES = ("contractor", "field_officer", "officer")


def _main():
    import main as m  # imported lazily to avoid a circular import at load time
    return m


def _find_user(users: list, user_id: str):
    for u in users:
        if user_id in (str(u.get("id")), str(u.get("user_id")), u.get("username")):
            return u
    return None


def _public_user(u: dict) -> dict:
    return {
        "id": u.get("id", u["username"]),
        "username": u["username"],
        "full_name": u.get("full_name", u["username"]),
        "role": u.get("role"),
        "is_verified": u.get("is_verified", u.get("role") not in STAFF_ROLES),
        "account_status": u.get("account_status") or ("active" if u.get("is_verified", True) else "pending"),
        "assigned_project_id": u.get("assigned_project_id"),
        "verification_id": u.get("verification_id"),
        "organization": u.get("organization"),
        "rejection_reason": u.get("rejection_reason"),
        "created_at": u.get("created_at"),
    }


# ── Verification IDs ───────────────────────────────────────────────────

class IssueIdRequest(BaseModel):
    role: Literal["contractor", "field_officer"]
    holder_name: str
    organization: Optional[str] = None
    project_id: Optional[str] = None
    note: Optional[str] = None


@router.post("/admin/issued-ids", status_code=201)
def issue_verification_id(body: IssueIdRequest, admin: dict = Depends(require_role("admin"))):
    holder = body.holder_name.strip()
    if len(holder) < 3:
        raise HTTPException(400, "Enter the full name of the person this ID is being issued to.")

    project_id = (body.project_id or "").strip() or None
    if project_id:
        projects = _main()._load_projects_file().get("projects", [])
        if not any(str(p.get("project_id")) == project_id for p in projects):
            raise HTTPException(404, f"Project '{project_id}' not found.")

    items = load_issued_ids()
    existing = {i["code"] for i in items}
    while True:
        code = f"PMN-{ROLE_PREFIX[body.role]}-" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if code not in existing:
            break

    record = {
        "code": code,
        "role": body.role,
        "holder_name": holder,
        "organization": (body.organization or "").strip() or None,
        "project_id": project_id,
        "note": (body.note or "").strip() or None,
        "issued_by": admin["username"],
        "issued_at": now_iso(),
        "used_by": None,
        "used_at": None,
        "revoked": False,
    }
    items.append(record)
    save_issued_ids(items)
    log_audit(admin["username"], "issue_id", code, f"{body.role} for {holder}" + (f", project {project_id}" if project_id else ""))
    return record


@router.get("/admin/issued-ids")
def list_verification_ids(admin: dict = Depends(require_role("admin"))):
    return list(reversed(load_issued_ids()))


@router.delete("/admin/issued-ids/{code}")
def revoke_verification_id(code: str, admin: dict = Depends(require_role("admin"))):
    items = load_issued_ids()
    record = next((i for i in items if i["code"] == code.upper()), None)
    if not record:
        raise HTTPException(404, "Verification ID not found.")
    if record.get("used_by"):
        raise HTTPException(400, "This ID has already been used to register. Suspend the account instead.")
    record["revoked"] = True
    save_issued_ids(items)
    log_audit(admin["username"], "revoke_id", record["code"])
    return record


# ── Account approval review ────────────────────────────────────────────

@router.get("/admin/approval-queue")
def approval_queue(admin: dict = Depends(require_role("admin"))):
    """Pending staff accounts with the evidence needed to decide: ID match, name match, role match."""
    issued = {i["code"]: i for i in load_issued_ids()}
    queue = []
    for u in load_users():
        if u.get("role") not in STAFF_ROLES or u.get("is_verified") or u.get("account_status") == "rejected":
            continue
        record = issued.get(u.get("verification_id") or "")
        name_match = None
        if record:
            a = re.sub(r"\s+", " ", (u.get("full_name") or "").strip().lower())
            b = re.sub(r"\s+", " ", record["holder_name"].strip().lower())
            name_match = a == b
        queue.append({
            **_public_user(u),
            "id_valid": bool(record and not record.get("revoked")),
            "id_role_matches": bool(record and (record["role"] == u.get("role") or (record["role"] == "field_officer" and u.get("role") == "officer"))),
            "name_matches": name_match,
            "issued_holder_name": record["holder_name"] if record else None,
            "issued_organization": record.get("organization") if record else None,
            "pre_assigned_project_id": record.get("project_id") if record else None,
        })
    return queue


class ApproveRequest(BaseModel):
    note: Optional[str] = None


@router.patch("/admin/users/{user_id}/approve")
def approve_user(user_id: str, body: ApproveRequest = ApproveRequest(), admin: dict = Depends(require_role("admin"))):
    users = load_users()
    user = _find_user(users, user_id)
    if not user:
        raise HTTPException(404, f"User '{user_id}' not found")
    if user.get("role") not in STAFF_ROLES:
        raise HTTPException(400, "Only contractor and field officer accounts need approval.")

    code = user.get("verification_id")
    issued = load_issued_ids()
    record = next((i for i in issued if i["code"] == code), None)
    if not record or record.get("revoked"):
        raise HTTPException(400, "This account has no valid verification ID and cannot be approved.")

    user["is_verified"] = True
    user["account_status"] = "active"
    user.pop("rejection_reason", None)
    assigned = None

    if record.get("project_id") and not user.get("assigned_project_id"):
        m = _main()
        raw = m._load_projects_file()
        for p in raw.get("projects", []):
            if str(p.get("project_id")) == str(record["project_id"]):
                key = "assigned_contractor" if user["role"] == "contractor" else "assigned_officer"
                if not p.get(key):
                    p[key] = user["username"]
                    user["assigned_project_id"] = str(record["project_id"])
                    assigned = str(record["project_id"])
                    m._save_projects_file(raw)
                break

    save_users(users)
    log_audit(admin["username"], "approve_user", user["username"], f"ID {code}" + (f", auto-assigned project {assigned}" if assigned else "") + (f", note: {body.note}" if body.note else ""))
    return {**_public_user(user), "auto_assigned_project_id": assigned}


class RejectRequest(BaseModel):
    reason: str


@router.patch("/admin/users/{user_id}/reject")
def reject_user(user_id: str, body: RejectRequest, admin: dict = Depends(require_role("admin"))):
    if len(body.reason.strip()) < 5:
        raise HTTPException(400, "Give a short reason so the applicant knows why.")
    users = load_users()
    user = _find_user(users, user_id)
    if not user:
        raise HTTPException(404, f"User '{user_id}' not found")
    if user.get("role") not in STAFF_ROLES:
        raise HTTPException(400, "Only contractor and field officer accounts can be rejected.")
    user["is_verified"] = False
    user["account_status"] = "rejected"
    user["rejection_reason"] = body.reason.strip()
    save_users(users)

    code = user.get("verification_id")
    if code:
        issued = load_issued_ids()
        for i in issued:
            if i["code"] == code:
                i["revoked"] = True
        save_issued_ids(issued)
    log_audit(admin["username"], "reject_user", user["username"], body.reason.strip())
    return _public_user(user)


@router.get("/admin/users")
def list_users(role: Optional[str] = None, admin: dict = Depends(require_role("admin"))):
    users = [_public_user(u) for u in load_users()]
    if role:
        users = [u for u in users if u["role"] == role]
    users.sort(key=lambda u: str(u.get("created_at") or ""), reverse=True)
    return users


@router.patch("/admin/users/{user_id}/suspend")
def suspend_user(user_id: str, body: RejectRequest, admin: dict = Depends(require_role("admin"))):
    users = load_users()
    user = _find_user(users, user_id)
    if not user:
        raise HTTPException(404, f"User '{user_id}' not found")
    if user.get("role") == "admin":
        raise HTTPException(400, "Administrator accounts cannot be suspended here.")
    user["account_status"] = "suspended"
    user["suspension_reason"] = body.reason.strip()
    save_users(users)
    log_audit(admin["username"], "suspend_user", user["username"], body.reason.strip())
    return _public_user(user)


@router.patch("/admin/users/{user_id}/reinstate")
def reinstate_user(user_id: str, admin: dict = Depends(require_role("admin"))):
    users = load_users()
    user = _find_user(users, user_id)
    if not user:
        raise HTTPException(404, f"User '{user_id}' not found")
    user["account_status"] = "active" if user.get("is_verified", True) else "pending"
    user.pop("suspension_reason", None)
    save_users(users)
    log_audit(admin["username"], "reinstate_user", user["username"])
    return _public_user(user)


# ── Settings, audit, overview ──────────────────────────────────────────

class SettingsRequest(BaseModel):
    spend_gap_warning_pts: Optional[float] = None
    spend_gap_critical_pts: Optional[float] = None
    spend_gap_min_spend_pct: Optional[float] = None


@router.get("/admin/settings")
def read_settings(admin: dict = Depends(require_role("admin"))):
    return get_settings()


@router.put("/admin/settings")
def update_settings(body: SettingsRequest, admin: dict = Depends(require_role("admin"))):
    values = {k: v for k, v in body.model_dump().items() if v is not None}
    merged = {**get_settings(), **values}
    if not 0 < merged["spend_gap_warning_pts"] < merged["spend_gap_critical_pts"] <= 100:
        raise HTTPException(400, "Warning gap must be above 0 and below the critical gap (max 100).")
    if not 0 <= merged["spend_gap_min_spend_pct"] <= 100:
        raise HTTPException(400, "Minimum spend must be between 0 and 100.")
    saved = save_settings(values)
    log_audit(admin["username"], "update_settings", None, ", ".join(f"{k}={v}" for k, v in values.items()))
    return saved


@router.get("/admin/audit-log")
def audit_log(limit: int = Query(100, ge=1, le=500), admin: dict = Depends(require_role("admin"))):
    return read_audit(limit)


def _spend_alert_rows(only_level: Optional[str] = None):
    projects = _main()._projects_snapshot()
    settings = get_settings()
    open_notice_by_pid = {}
    for n in load_notices():
        if not n.get("resolved"):
            open_notice_by_pid.setdefault(str(n.get("project_id")), n)
    rows = []
    for p in projects:
        a = spend_analysis(p, settings)
        if not a["spend_alert"] or (only_level and a["spend_alert"] != only_level):
            continue
        open_notice = open_notice_by_pid.get(str(p.get("project_id")))
        rows.append({
            "project_id": str(p.get("project_id")),
            "name": p.get("name"),
            "sector": p.get("sector"),
            "state": p.get("state"),
            "agency": p.get("agency"),
            "cost_cr": p.get("revised_cost_cr") or p.get("original_cost_cr"),
            "expenditure_cr": p.get("expenditure_cr"),
            "physical_progress_pct": p.get("physical_progress_pct"),
            "assigned_contractor": p.get("assigned_contractor"),
            "assigned_officer": p.get("assigned_officer"),
            "open_notice_id": open_notice.get("id") if open_notice else None,
            **a,
        })
    rows.sort(key=lambda r: r["progress_gap"], reverse=True)
    return rows


@router.get("/admin/spend-alerts")
def spend_alerts(level: Optional[Literal["warning", "critical"]] = None, admin: dict = Depends(require_role("admin"))):
    return _spend_alert_rows(level)


@router.get("/admin/overview")
def admin_overview(admin: dict = Depends(require_role("admin"))):
    m = _main()
    projects = m._projects_snapshot()
    users = load_users()
    issued = load_issued_ids()
    notices = load_notices()
    alerts = _spend_alert_rows()
    reports = m.load_reports()
    active = [p for p in projects if p.get("status") in ("Ongoing", "Newly Added")]
    return {
        "projects_total": len(projects),
        "projects_unassigned_contractor": sum(1 for p in active if not p.get("assigned_contractor")),
        "projects_unassigned_officer": sum(1 for p in active if not p.get("assigned_officer")),
        "users_by_role": dict(Counter(u.get("role") for u in users)),
        "pending_approvals": sum(1 for u in users if u.get("role") in STAFF_ROLES and not u.get("is_verified") and u.get("account_status") != "rejected"),
        "suspended_accounts": sum(1 for u in users if u.get("account_status") == "suspended"),
        "ids_issued": len(issued),
        "ids_unused": sum(1 for i in issued if not i.get("used_by") and not i.get("revoked")),
        "spend_alerts_critical": sum(1 for a in alerts if a["spend_alert"] == "critical"),
        "spend_alerts_warning": sum(1 for a in alerts if a["spend_alert"] == "warning"),
        "spend_alerts_without_notice": sum(1 for a in alerts if a["spend_alert"] == "critical" and not a["open_notice_id"]),
        "open_notices": sum(1 for n in notices if not n.get("resolved")),
        "notices_awaiting_response": sum(1 for n in notices if not n.get("resolved") and not n.get("response")),
        "reports_pending": sum(1 for r in reports if r.get("status") == "pending_confirmation"),
        "top_alerts": alerts[:5],
    }


# ── Contractor notices ─────────────────────────────────────────────────

class NoticeRequest(BaseModel):
    project_id: str
    message: str
    severity: Literal["warning", "critical"] = "warning"


@router.post("/admin/notices", status_code=201)
def create_notice(body: NoticeRequest, admin: dict = Depends(require_role("admin"))):
    projects = _main()._load_projects_file().get("projects", [])
    project = next((p for p in projects if str(p.get("project_id")) == body.project_id), None)
    if not project:
        raise HTTPException(404, f"Project '{body.project_id}' not found.")
    if not project.get("assigned_contractor"):
        raise HTTPException(400, "This project has no contractor assigned, so there is nobody to notify.")
    if len(body.message.strip()) < 10:
        raise HTTPException(400, "Write a clear message (at least 10 characters).")

    notices = load_notices()
    notice = {
        "id": uuid.uuid4().hex[:8],
        "project_id": body.project_id,
        "project_name": project.get("name"),
        "contractor": project["assigned_contractor"],
        "message": body.message.strip(),
        "severity": body.severity,
        "created_by": admin["username"],
        "created_at": now_iso(),
        "response": None,
        "responded_at": None,
        "resolved": False,
    }
    notices.append(notice)
    save_notices(notices)
    log_audit(admin["username"], "issue_notice", body.project_id, f"to {notice['contractor']}: {notice['message'][:120]}")
    return notice


@router.get("/admin/notices")
def list_notices(admin: dict = Depends(require_role("admin"))):
    return list(reversed(load_notices()))


@router.patch("/admin/notices/{notice_id}/resolve")
def resolve_notice(notice_id: str, admin: dict = Depends(require_role("admin"))):
    notices = load_notices()
    notice = next((n for n in notices if n["id"] == notice_id), None)
    if not notice:
        raise HTTPException(404, "Notice not found.")
    notice["resolved"] = True
    notice["resolved_at"] = now_iso()
    save_notices(notices)
    log_audit(admin["username"], "resolve_notice", notice["project_id"], notice_id)
    return notice


class NoticeResponse(BaseModel):
    response: str


@router.get("/india/me/notices")
def my_notices(user: dict = Depends(require_role("contractor"))):
    return [n for n in reversed(load_notices()) if n.get("contractor") in (user["username"], str(user.get("id")))]


@router.post("/india/notices/{notice_id}/respond")
def respond_to_notice(notice_id: str, body: NoticeResponse, user: dict = Depends(require_role("contractor"))):
    notices = load_notices()
    notice = next((n for n in notices if n["id"] == notice_id), None)
    if not notice or notice.get("contractor") not in (user["username"], str(user.get("id"))):
        raise HTTPException(404, "Notice not found.")
    if notice.get("resolved"):
        raise HTTPException(400, "This notice is already closed.")
    if len(body.response.strip()) < 20:
        raise HTTPException(400, "Explain the spend-versus-progress gap in at least 20 characters.")
    notice["response"] = body.response.strip()
    notice["responded_at"] = now_iso()
    save_notices(notices)
    log_audit(user["username"], "notice_response", notice["project_id"], notice_id)
    return notice


# ── Project ledger: where money went and how progress was measured ─────

@router.get("/india/projects/{project_id}/ledger")
def project_ledger(project_id: str, user: dict = Depends(require_verified_user)):
    m = _main()
    project = next((p for p in m._projects_snapshot() if str(p.get("project_id")) == str(project_id)), None)
    if not project:
        raise HTTPException(404, f"Project '{project_id}' not found.")

    reports = [r for r in m.load_reports() if str(r.get("project_id")) == str(project_id)]
    reports.sort(key=lambda r: str(r.get("timestamp") or ""), reverse=True)

    by_category = defaultdict(float)
    spend_entries, progress_entries = [], []
    for r in reports:
        if r.get("expenditure_update_cr") is not None:
            entry = {
                "report_id": r.get("report_id"),
                "timestamp": r.get("timestamp"),
                "amount_cr": r["expenditure_update_cr"],
                "category": r.get("spend_category") or "Uncategorised (legacy report)",
                "description": r.get("spend_description"),
                "bill_reference": r.get("bill_reference"),
                "submitted_by": r.get("submitted_by"),
                "status": r.get("status"),
            }
            spend_entries.append(entry)
            if r.get("status") == "confirmed":
                by_category[entry["category"]] += float(r["expenditure_update_cr"])
        if r.get("progress_pct") is not None:
            progress_entries.append({
                "report_id": r.get("report_id"),
                "timestamp": r.get("timestamp"),
                "progress_pct": r["progress_pct"],
                "method": r.get("measurement_method") or "Not recorded (legacy report)",
                "details": r.get("measurement_details"),
                "submitted_by": r.get("submitted_by"),
                "status": r.get("status"),
            })

    confirmed_total = round(sum(by_category.values()), 2)
    return {
        "project_id": str(project_id),
        "name": project.get("name"),
        "recorded_expenditure_cr": project.get("expenditure_cr"),
        "confirmed_ledger_total_cr": confirmed_total,
        "by_category": [{"category": k, "amount_cr": round(v, 2)} for k, v in sorted(by_category.items(), key=lambda kv: -kv[1])],
        "spend_entries": spend_entries,
        "progress_entries": progress_entries,
        "spend": spend_analysis(project),
        "notices": [n for n in load_notices() if str(n.get("project_id")) == str(project_id)],
    }


@router.get("/india/measurement-options")
def measurement_options():
    m = _main()
    return {"spend_categories": m.SPEND_CATEGORIES, "measurement_methods": m.MEASUREMENT_METHODS}


# ── Public statistics for the home page ────────────────────────────────

@router.get("/public/stats")
def public_stats():
    # First thing every visitor loads on the home page, so memoize per data version.
    m = _main()
    return m._memo("public_stats", m._data_version(), _build_public_stats)


def _build_public_stats():
    projects = _main()._projects_snapshot()
    settings = get_settings()

    sectors = Counter()
    sector_cost = defaultdict(float)
    states = Counter()
    state_sectors = defaultdict(Counter)
    nationwide = Counter()
    total_cost = total_spent = 0.0
    alerts = 0

    for p in projects:
        cost = float(p.get("revised_cost_cr") or p.get("original_cost_cr") or 0)
        total_cost += cost
        total_spent += float(p.get("expenditure_cr") or 0)
        sectors[p.get("sector") or "Other"] += 1
        sector_cost[p.get("sector") or "Other"] += cost
        if spend_analysis(p, settings)["spend_alert"]:
            alerts += 1

        raw_state = str(p.get("state") or "")
        if raw_state in ("PAN India", "Offshore"):
            nationwide[raw_state] += 1
            continue
        multi = re.match(r"Multi-States \((.+)\)", raw_state)
        names = [s.strip() for s in multi.group(1).split(",")] if multi else [raw_state]
        for name in names:
            name = "Andaman and Nicobar Islands" if name.startswith("Andaman") else name
            states[name] += 1
            state_sectors[name][p.get("sector") or "Other"] += 1

    return {
        "total_projects": len(projects),
        "total_cost_cr": round(total_cost),
        "total_spent_cr": round(total_spent),
        "spend_alerts": alerts,
        "sectors": [
            {"sector": s, "count": c, "cost_cr": round(sector_cost[s])} for s, c in sectors.most_common()
        ],
        "states": {
            s: {"count": c, "top_sectors": [{"sector": k, "count": v} for k, v in state_sectors[s].most_common(3)]}
            for s, c in states.items()
        },
        "nationwide": dict(nationwide),
    }
