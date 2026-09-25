import sys
import os
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "paimana_backend"))

from fastapi.testclient import TestClient
from main import app, load_data_and_models
from auth import create_access_token

token = create_access_token({"sub": "admin", "role": "admin"})
headers = {"Authorization": f"Bearer {token}"}

def run_tests():
    print("=" * 60)
    print("STEP 2 SERVING VERIFICATION")
    print("=" * 60)

    # Use context manager so on_event('startup') runs cleanly
    with TestClient(app) as client:
        # 1. Test /docs
        print("\n1. Testing GET /docs...")
        res_docs = client.get("/docs")
        assert res_docs.status_code == 200, f"/docs failed: {res_docs.status_code}"
        print("   [OK] /docs returned 200 OK")

        # 2. Test /dashboard/summary
        print("\n2. Testing GET /dashboard/summary...")
        res_summary = client.get("/dashboard/summary", headers=headers)
        assert res_summary.status_code == 200, f"/dashboard/summary failed: {res_summary.text}"
        summary = res_summary.json()
        print(f"   total_projects: {summary.get('total_projects')}")
        print(f"   avg_predicted_delay_months: {summary.get('avg_predicted_delay_months')}")
        print(f"   risk_tier_counts: {summary.get('risk_tier_counts')}")
        print(f"   model_performance: {json.dumps(summary.get('model_performance'), indent=2)}")

        assert summary.get("total_projects") == 1731, f"Expected 1731 projects, got {summary.get('total_projects')}"
        mp = summary.get("model_performance", {})
        assert mp.get("overall_accuracy") == 0.9222, f"Expected 0.9222, got {mp.get('overall_accuracy')}"
        assert mp.get("rf_test_r2") == 0.7292, f"Expected 0.7292, got {mp.get('rf_test_r2')}"
        assert mp.get("gb_test_r2") == 0.7432, f"Expected 0.7432, got {mp.get('gb_test_r2')}"
        assert mp.get("high_risk_precision") == 0.8295
        assert mp.get("high_risk_recall") == 0.8588
        assert mp.get("high_risk_base_rate") == 0.2461
        print("   [OK] /dashboard/summary verified with real MoSPI metrics!")

        # 3. Test /projects
        print("\n3. Testing GET /projects...")
        res_projects = client.get("/projects", headers=headers)
        assert res_projects.status_code == 200, f"/projects failed: {res_projects.text}"
        projects = res_projects.json()
        print(f"   Returned {len(projects)} projects")
        assert len(projects) == 1731, f"Expected 1731 projects, got {len(projects)}"
        first_p = projects[0]
        print(f"   Sample Project #0:")
        print(f"     Name:                   {first_p.get('project_name')}")
        print(f"     Ministry:               {first_p.get('ministry')}")
        print(f"     Original Cost (Cr):     Rs. {first_p.get('original_cost_cr')}")
        print(f"     Actual Delay (months):  {first_p.get('delay_months')}")
        print(f"     Predicted Delay (mo):   {first_p.get('predicted_delay_months')}")
        print(f"     Predicted Risk Tier:    {first_p.get('predicted_risk_tier')}")
        assert "original_cost_cr" in first_p
        assert "predicted_delay_months" in first_p
        assert "predicted_risk_tier" in first_p
        print("   [OK] /projects returned complete list with renamed + legacy fields!")

        # 4. Test /projects/0/risk
        print("\n4. Testing GET /projects/0/risk...")
        res_risk = client.get("/projects/0/risk", headers=headers)
        assert res_risk.status_code == 200, f"/projects/0/risk failed: {res_risk.text}"
        risk_data = res_risk.json()
        fvals = risk_data.get("feature_values", {})
        finfl = risk_data.get("feature_influence", {})
        print(f"   Feature values count:    {len(fvals)}")
        print(f"   Feature influence count: {len(finfl)}")
        assert len(fvals) == 49, f"Expected 49 feature values, got {len(fvals)}"
        assert len(finfl) == 49, f"Expected 49 feature influences, got {len(finfl)}"
        print("   [OK] /projects/0/risk returns all 49 feature values and influences without error!")

        # 5. Test /alerts
        print("\n5. Testing GET /alerts...")
        res_alerts = client.get("/alerts", headers=headers)
        assert res_alerts.status_code == 200, f"/alerts failed: {res_alerts.text}"
        alerts = res_alerts.json()
        print(f"   High-risk alerts count: {len(alerts)}")
        assert len(alerts) > 0, "Expected at least 1 high-risk alert"
        assert all(a.get("predicted_risk_tier") == "High" for a in alerts), "All alerts must be High tier"
        delays = [a.get("predicted_delay_months") for a in alerts]
        assert delays == sorted(delays, reverse=True), "Alerts must be sorted descending by predicted delay"
        print(f"   Top alert delay: {alerts[0].get('predicted_delay_months'):.1f} months ({alerts[0].get('project_name')})")
        print("   [OK] /alerts verified!")

        print("\n" + "=" * 60)
        print("ALL SERVING CHECKS PASSED WITH ZERO ERRORS!")
        print("=" * 60)

if __name__ == "__main__":
    run_tests()
