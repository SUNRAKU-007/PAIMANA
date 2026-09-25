import json
import os
import pandas as pd

CSV_PATH = os.path.join("data", "india", "moSPI_paimana_all_ongoing_projects_Aug2026.csv")
BACKEND_JSON_PATH = os.path.join("paimana_backend", "data", "india", "real_projects.json")
ROOT_JSON_PATH = os.path.join("data", "india", "real_projects.json")
USERS_PATH = os.path.join("paimana_backend", "data", "users.json")
REPORTS_PATH = os.path.join("paimana_backend", "data", "india", "reports.json")

# 1. Load existing real_projects.json to preserve assignments / notes
existing_map = {}
if os.path.exists(BACKEND_JSON_PATH):
    try:
        with open(BACKEND_JSON_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
            p_list = raw.get("projects", []) if isinstance(raw, dict) else raw
            for p in p_list:
                existing_map[str(p.get("project_id"))] = p
    except Exception as e:
        print(f"Warning: could not read existing real_projects.json: {e}")

# 2. Read the 1,731 CSV
df = pd.read_csv(CSV_PATH)
print(f"Read {len(df)} rows from {CSV_PATH}")

new_projects = []
for idx, row in df.iterrows():
    p_code = str(row["Project_Code"])
    orig_cost = float(row["Original_Cost_Cr"]) if pd.notna(row["Original_Cost_Cr"]) else 0.0
    rev_cost = float(row["Revised_Cost_Cr"]) if pd.notna(row["Revised_Cost_Cr"]) and float(row["Revised_Cost_Cr"]) > 0 else orig_cost
    cum_exp = float(row["Cumulative_Expenditure_Cr"]) if pd.notna(row["Cumulative_Expenditure_Cr"]) else 0.0
    prog = float(row["Physical_Progress_Pct"]) if pd.notna(row["Physical_Progress_Pct"]) else 0.0
    
    existing = existing_map.get(p_code, {})
    
    # Preserve existing assignments or notes
    assigned_officer = existing.get("assigned_officer", None)
    assigned_contractor = existing.get("assigned_contractor", None)
    is_delayed_by_contractor = existing.get("is_delayed_by_contractor", False)
    contractor_delay_timestamp = existing.get("contractor_delay_timestamp", None)
    contractor_delay_reason = existing.get("contractor_delay_reason", None)
    delay_note = existing.get("delay_note", None)
    status = existing.get("status", "Ongoing")
    
    # Seed Kadapa Airport (612786) for officer1 & contractor1 demo
    if p_code == "612786":
        assigned_officer = "officer1"
        assigned_contractor = "contractor1"
        is_delayed_by_contractor = True
        contractor_delay_timestamp = "2026-09-24T04:07:17.020444+00:00"
        contractor_delay_reason = "Material supply chain disruption - runway equipment delivery"
        delay_note = "Contractor delay: Material supply chain disruption - runway equipment delivery"
    
    # Chennai Metro (702668) assigned to contractor2
    if p_code == "702668":
        assigned_contractor = "contractor2"
    
    proj = {
        "project_id": p_code,
        "name": str(row["Project_Name"]),
        "sector": str(row["Sector"]),
        "ministry": str(row["Ministry"]),
        "agency": str(row["Agency"]) if pd.notna(row["Agency"]) else None,
        "state": str(row["State"]) if pd.notna(row["State"]) else None,
        "original_cost_cr": orig_cost,
        "revised_cost_cr": rev_cost,
        "expenditure_cr": cum_exp,
        "physical_progress_pct": prog,
        "status": status,
        "approval_date": str(row["Approval_Date"]) if pd.notna(row["Approval_Date"]) else None,
        "start_date": str(row["Start_Date"]) if pd.notna(row["Start_Date"]) else None,
        "target_doc": str(row["Target_DoC"]) if pd.notna(row["Target_DoC"]) else None,
        "revised_doc": str(row["Revised_DoC"]) if pd.notna(row["Revised_DoC"]) else None,
        "assigned_officer": assigned_officer,
        "assigned_contractor": assigned_contractor,
        "is_delayed_by_contractor": is_delayed_by_contractor,
        "contractor_delay_timestamp": contractor_delay_timestamp,
        "contractor_delay_reason": contractor_delay_reason,
        "delay_note": delay_note,
    }
    new_projects.append(proj)

print(f"Generated {len(new_projects)} projects.")

# 3. Write out to both real_projects.json paths
out_data = {
    "source": "MoSPI PAIMANA Flash Report, August 2026",
    "source_url": "https://www.mospi.gov.in/uploads/publications_reports/Flash_Report_August_2026.pdf",
    "as_of": "August 2026",
    "total_projects": len(new_projects),
    "projects": new_projects,
}

for path in [BACKEND_JSON_PATH, ROOT_JSON_PATH]:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out_data, f, indent=2, ensure_ascii=False)
    print(f"Saved {len(new_projects)} projects to {path}")

# 4. Synchronize users.json
if os.path.exists(USERS_PATH):
    try:
        with open(USERS_PATH, "r", encoding="utf-8") as f:
            u_data = json.load(f)
        users = u_data.get("users", []) if isinstance(u_data, dict) else u_data
        for u in users:
            if u.get("username") == "contractor1":
                u["assigned_project_id"] = "612786"
            elif u.get("username") == "contractor2":
                u["assigned_project_id"] = "702668"
        with open(USERS_PATH, "w", encoding="utf-8") as f:
            json.dump(u_data, f, indent=2)
        print("Updated contractor1 in users.json to project 612786")
    except Exception as e:
        print(f"Warning: could not update users.json: {e}")

# 5. Synchronize reports.json for 900000 -> 612786
if os.path.exists(REPORTS_PATH):
    try:
        with open(REPORTS_PATH, "r", encoding="utf-8") as f:
            reps = json.load(f)
        report_list = reps if isinstance(reps, list) else reps.get("reports", [])
        for r in report_list:
            if str(r.get("project_id")) in ("900000", "900001"):
                r["project_id"] = "612786"
        with open(REPORTS_PATH, "w", encoding="utf-8") as f:
            json.dump(reps, f, indent=2)
        print("Updated reports in reports.json to point to 612786")
    except Exception as e:
        print(f"Warning: could not update reports.json: {e}")
