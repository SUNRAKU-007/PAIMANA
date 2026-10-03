"""
store.py -- small JSON-backed persistence helpers shared by main.py and governance.py.

Holds platform settings (alert thresholds), the audit log, issued verification IDs
and contractor notices. Every write is atomic (temp file + rename) so a crash cannot
leave a half-written file behind.
"""

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

_lock = threading.RLock()

DEFAULT_SETTINGS = {
    # Percentage-point gap between budget spent and physical progress.
    "spend_gap_warning_pts": 25.0,
    "spend_gap_critical_pts": 40.0,
    # Ignore projects that have barely started so early mobilisation advances do not alert.
    "spend_gap_min_spend_pct": 10.0,
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _path(name: str) -> str:
    return os.path.join(DATA_DIR, name)


def read_json(name: str, default: Any) -> Any:
    path = _path(name)
    with _lock:
        if not os.path.exists(path):
            return default
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as exc:
            print(f"[store] could not read {name}: {exc}")
            return default


def write_json(name: str, data: Any) -> None:
    path = _path(name)
    tmp = f"{path}.{uuid.uuid4().hex[:6]}.tmp"
    with _lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)


# ── Settings ───────────────────────────────────────────────────────────

def get_settings() -> dict:
    stored = read_json("settings.json", {})
    merged = dict(DEFAULT_SETTINGS)
    merged.update({k: v for k, v in stored.items() if k in DEFAULT_SETTINGS})
    return merged


def save_settings(values: dict) -> dict:
    current = get_settings()
    current.update({k: float(v) for k, v in values.items() if k in DEFAULT_SETTINGS})
    write_json("settings.json", current)
    return current


# ── Audit log ──────────────────────────────────────────────────────────

def log_audit(actor: str, action: str, target: Optional[str] = None, detail: Optional[str] = None) -> None:
    with _lock:
        entries = read_json("audit_log.json", [])
        entries.append({
            "id": uuid.uuid4().hex[:10],
            "timestamp": now_iso(),
            "actor": actor,
            "action": action,
            "target": target,
            "detail": detail,
        })
        write_json("audit_log.json", entries[-2000:])


def read_audit(limit: int = 200) -> list:
    entries = read_json("audit_log.json", [])
    return list(reversed(entries))[:limit]


# ── Issued verification IDs ────────────────────────────────────────────

def load_issued_ids() -> list:
    return read_json("issued_ids.json", [])


def save_issued_ids(items: list) -> None:
    write_json("issued_ids.json", items)


# ── Contractor notices ─────────────────────────────────────────────────

def load_notices() -> list:
    return read_json("notices.json", [])


def save_notices(items: list) -> None:
    write_json("notices.json", items)


# ── Spend vs progress ──────────────────────────────────────────────────

def spend_analysis(project: dict, settings: Optional[dict] = None) -> dict:
    """Compare share of budget spent with physical progress.

    Returns spend_pct, progress_gap (spend_pct - progress, in points) and a
    spend_alert level of 'critical', 'warning' or None.
    """
    settings = settings or get_settings()
    cost = project.get("revised_cost_cr") or project.get("original_cost_cr")
    spent = project.get("expenditure_cr")
    progress = project.get("physical_progress_pct")
    result = {"spend_pct": None, "progress_gap": None, "spend_alert": None}
    try:
        cost_v, spent_v = float(cost), float(spent)
        if cost_v <= 0:
            return result
        spend_pct = round(spent_v / cost_v * 100, 1)
        result["spend_pct"] = spend_pct
        if progress is None:
            return result
        gap = round(spend_pct - float(progress), 1)
        result["progress_gap"] = gap
    except (TypeError, ValueError):
        return result

    if str(project.get("status") or "") != "Ongoing":
        return result
    if spend_pct < settings["spend_gap_min_spend_pct"]:
        return result
    if gap >= settings["spend_gap_critical_pts"]:
        result["spend_alert"] = "critical"
    elif gap >= settings["spend_gap_warning_pts"]:
        result["spend_alert"] = "warning"
    return result
