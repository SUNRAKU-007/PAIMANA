import sys
import os
import json

# Ensure paimana_backend directory is in sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "paimana_backend"))

from fastapi.testclient import TestClient
from main import app, _load_projects_file, _save_projects_file, load_reports, save_reports
from auth import create_access_token

client = TestClient(app)

admin_token = create_access_token({"sub": "admin", "role": "admin"})
officer_token = create_access_token({"sub": "officer1", "role": "field_officer"})
contractor_token = create_access_token({"sub": "contractor1", "role": "contractor"})

def get_project(proj_id):
    res = client.get("/india/projects", headers={"Authorization": f"Bearer {officer_token}"})
    assert res.status_code == 200, f"Failed to list projects: {res.text}"
    projects = res.json()
    for p in projects:
        if str(p.get("project_id")) == str(proj_id):
            return p
    return None

def run_test():
    print("--- 1. Creating project with expenditure_cr = 0.0 ---")
    create_payload = {
        "name": "Test Cumulative Expenditure Project",
        "sector": "Roads & Highways",
        "ministry": "Ministry of Road Transport",
        "state": "Maharashtra",
        "status": "Newly Added",
        "original_cost_cr": 500.0,
        "expenditure_cr": 0.0,
        "approval_date": "01/2026",
        "start_date": "02/2026",
        "target_doc": "12/2027",
        "assigned_officer": "officer1",
        "assigned_contractor": "contractor1",
        "physical_progress_pct": 0.0
    }
    res = client.post("/india/projects", json=create_payload, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 201, f"Failed to create project: {res.text}"
    created_proj = res.json()
    proj_id = created_proj["project_id"]
    print(f"Created project {proj_id}: initial expenditure_cr = {created_proj.get('expenditure_cr')}")
    assert created_proj.get("expenditure_cr") == 0.0, f"Expected 0.0, got {created_proj.get('expenditure_cr')}"

    try:
        print("\n--- 2. Submitting report 1 with expenditure_update_cr = 35.0 ---")
        rep1_payload = {
            "expenditure_update_cr": 35.0,
            "progress_pct": 5.0,
            "notes": "First week milestone"
        }
        res = client.post(f"/india/projects/{proj_id}/report", json=rep1_payload, headers={"Authorization": f"Bearer {officer_token}"})
        assert res.status_code == 200, f"Failed to submit report 1: {res.text}"
        rep1 = res.json()
        rep1_id = rep1["report_id"]
        print(f"Submitted report {rep1_id}: expenditure_update_cr = {rep1.get('expenditure_update_cr')}")

        print("\n--- 3. Confirming report 1 ---")
        res = client.patch(f"/india/projects/{proj_id}/reports/{rep1_id}/confirm", headers={"Authorization": f"Bearer {contractor_token}"})
        assert res.status_code == 200, f"Failed to confirm report 1: {res.text}"
        confirmed_rep1 = res.json()
        print(f"Confirmed report 1. Returned new_expenditure_cr: {confirmed_rep1.get('new_expenditure_cr')}")

        # Check project expenditure_cr
        proj_after_1 = get_project(proj_id)
        assert proj_after_1 is not None, f"Project {proj_id} not found in GET /india/projects"
        print(f"Project after Report 1: expenditure_cr = {proj_after_1.get('expenditure_cr')}, physical_progress_pct = {proj_after_1.get('physical_progress_pct')}")
        assert proj_after_1.get("expenditure_cr") == 35.0, f"Expected 35.0, got {proj_after_1.get('expenditure_cr')}"

        print("\n--- 4. Submitting report 2 with expenditure_update_cr = 20.0 ---")
        rep2_payload = {
            "expenditure_update_cr": 20.0,
            "progress_pct": 10.0,
            "notes": "Second week milestone"
        }
        res = client.post(f"/india/projects/{proj_id}/report", json=rep2_payload, headers={"Authorization": f"Bearer {officer_token}"})
        assert res.status_code == 200, f"Failed to submit report 2: {res.text}"
        rep2 = res.json()
        rep2_id = rep2["report_id"]
        print(f"Submitted report {rep2_id}: expenditure_update_cr = {rep2.get('expenditure_update_cr')}")

        print("\n--- 5. Confirming report 2 ---")
        res = client.patch(f"/india/projects/{proj_id}/reports/{rep2_id}/confirm", headers={"Authorization": f"Bearer {contractor_token}"})
        assert res.status_code == 200, f"Failed to confirm report 2: {res.text}"
        confirmed_rep2 = res.json()
        print(f"Confirmed report 2. Returned new_expenditure_cr: {confirmed_rep2.get('new_expenditure_cr')}")

        # Check project expenditure_cr
        proj_after_2 = get_project(proj_id)
        assert proj_after_2 is not None, f"Project {proj_id} not found in GET /india/projects"
        print(f"Project after Report 2: expenditure_cr = {proj_after_2.get('expenditure_cr')}, physical_progress_pct = {proj_after_2.get('physical_progress_pct')}")
        assert proj_after_2.get("expenditure_cr") == 55.0, f"Expected 55.0, got {proj_after_2.get('expenditure_cr')}"

        # Also verify directly in raw json on disk
        disk_projects = _load_projects_file().get("projects", [])
        disk_proj = next((p for p in disk_projects if str(p.get("project_id")) == str(proj_id)), None)
        assert disk_proj is not None
        print(f"Project in real_projects.json on disk: expenditure_cr = {disk_proj.get('expenditure_cr')}")
        assert disk_proj.get("expenditure_cr") == 55.0, f"Expected 55.0 on disk, got {disk_proj.get('expenditure_cr')}"

        print("\nSUCCESS: All tests passed!")
        print(f"Initial: 0 -> Report 1 (+35): {proj_after_1.get('expenditure_cr')} -> Report 2 (+20): {proj_after_2.get('expenditure_cr')}")

    finally:
        print("\n--- Cleaning up test project and test reports ---")
        raw = _load_projects_file()
        raw["projects"] = [p for p in raw.get("projects", []) if str(p.get("project_id")) != str(proj_id)]
        _save_projects_file(raw)

        reps = load_reports()
        reps = [r for r in reps if str(r.get("project_id")) != str(proj_id)]
        save_reports(reps)
        print("Cleanup completed.")

if __name__ == "__main__":
    run_test()
