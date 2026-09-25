"""
train_model.py -- Indian Infrastructure Project Delay & Risk Predictor
Replaces the US Caltrans bidding dataset with MoSPI Indian Infrastructure project data.
Predicts:
  - Regression: delay_months (schedule delay in months)
  - Binary classification: high_risk (1 if delay_months > 75th percentile, else 0)
Trains LinearRegression, RandomForest, and GradientBoosting models,
evaluates with 5-fold cross-validation, and saves the best models:
  - cost_model.joblib: best regressor for delay_months
  - risk_model.joblib: best classifier for high_risk probability
  - hr_features.json: exact feature list and column order
"""

import os
import json
import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.ensemble import (
    RandomForestRegressor, RandomForestClassifier,
    GradientBoostingRegressor, GradientBoostingClassifier,
)
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import (
    r2_score, accuracy_score, classification_report,
    confusion_matrix, precision_score, recall_score, f1_score
)
from sklearn.utils.class_weight import compute_sample_weight
import joblib


def _resolve_file(*paths):
    candidates = [
        os.path.join(".", *paths),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), *paths),
        os.path.join("paimana_backend", *paths),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "paimana_backend", *paths),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    return os.path.join(".", *paths)


# ── 1. Load data ────────────────────────────────────────────────────────
data_path = _resolve_file("data", "india", "moSPI_paimana_all_ongoing_projects_Aug2026.csv")
print(f"Loading data from: {data_path}")
df = pd.read_csv(data_path)
print(f"Raw shape: {df.shape}")

# ── 2. Target Engineering (delay_months & high_risk) ───────────────────
# Parse dates as MM/YYYY
target_date = pd.to_datetime(df["Target_DoC"], format="%m/%Y", errors="coerce")
has_revised = (df["Revised_DoC"] != "-") & df["Revised_DoC"].notna()
revised_clean = df["Revised_DoC"].replace("-", np.nan)
revised_date = pd.to_datetime(revised_clean, format="%m/%Y", errors="coerce")

# Reference date: August 2026
REF_YEAR = 2026
REF_MONTH = 8

# Delay calculation:
# 1. Where Revised_DoC != "-": (Revised_DoC - Target_DoC) in months
rev_delay_months = (revised_date.dt.year - target_date.dt.year) * 12 + (revised_date.dt.month - target_date.dt.month)

# 2. Where Revised_DoC == "-" and Target_DoC < Aug 2026: overdue months to Aug 2026
overdue_months = (REF_YEAR - target_date.dt.year) * 12 + (REF_MONTH - target_date.dt.month)

# 3. Where Revised_DoC == "-" and Target_DoC >= Aug 2026: 0 delay
raw_delay = np.where(
    has_revised,
    rev_delay_months,
    np.where(overdue_months > 0, overdue_months, 0.0)
)

# Clip to 1st-99th percentile range
lo = float(np.percentile(raw_delay, 1))
hi = float(np.percentile(raw_delay, 99))
clipped_mask = (raw_delay < lo) | (raw_delay > hi)
n_clipped = int(clipped_mask.sum())
df["delay_months"] = np.clip(raw_delay, lo, hi)

print(f"Clipped {n_clipped} outlier rows to [{lo:.2f}, {hi:.2f}] months range")
print(f"\ndelay_months stats (after clip):\n{df['delay_months'].describe().round(4).to_string()}\n")

# Binary target: high_risk = 1 if delay_months > 75th percentile, else 0
threshold_75 = float(df["delay_months"].quantile(0.75))
df["high_risk"] = (df["delay_months"] > threshold_75).astype(int)

n_total = len(df)
n_high = int(df["high_risk"].sum())
n_low = n_total - n_high

print("=" * 70)
print("BINARY HIGH-RISK TARGET")
print("=" * 70)
print(f"  75th-percentile threshold: {threshold_75:.4f} months")
print(f"  High-risk (=1):     {n_high:>6d}  ({100 * n_high / n_total:.2f}%)")
print(f"  Not high-risk (=0): {n_low:>6d}  ({100 * n_low / n_total:.2f}%)")
print()

# ── 3. Feature Engineering ──────────────────────────────────────────────
# Impute missing Approval_Date with Start_Date if any
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

# Frequency encoding for high/medium cardinality categoricals
for col in ["Sector", "Ministry", "State", "Agency"]:
    freq_col = f"{col.lower()}_freq"
    df[freq_col] = df[col].map(df[col].value_counts(normalize=True))

# One-hot encode Sector and Ministry directly (16 ministries, 21 sectors)
sector_dummies = pd.get_dummies(df["Sector"], prefix="sector", dtype=int)
ministry_dummies = pd.get_dummies(df["Ministry"], prefix="ministry", dtype=int)
df = pd.concat([df, sector_dummies, ministry_dummies], axis=1)

base_features = [
    "log_original_cost", "expenditure_ratio", "progress_frac", "burn_progress_gap",
    "approval_to_start_months", "project_age_months", "start_month", "is_monsoon_start",
    "sector_freq", "ministry_freq", "state_freq", "agency_freq"
]
one_hot_features = list(sector_dummies.columns) + list(ministry_dummies.columns)
FEATURES = base_features + one_hot_features

print(f"Total engineered features: {len(FEATURES)} ({len(base_features)} numeric/frequency + {len(one_hot_features)} one-hot)")
print(f"  Base features ({len(base_features)}): {base_features}")
print()

# ── 4. Train / Test Split ───────────────────────────────────────────────
X = df[FEATURES]
y_reg = df["delay_months"]
y_clf = df["high_risk"]

X_train, X_test, y_train_reg, y_test_reg, y_train_clf, y_test_clf = train_test_split(
    X, y_reg, y_clf, test_size=0.2, random_state=42, stratify=y_clf
)

print(f"Train size: {len(X_train)}  |  Test size: {len(X_test)}")
print()

# ── 5. Regression Models (delay_months) ──────────────────────────────────
# 5a. LinearRegression baseline
lr = LinearRegression()
lr.fit(X_train, y_train_reg)
lr_train_r2 = r2_score(y_train_reg, lr.predict(X_train))
lr_test_r2 = r2_score(y_test_reg, lr.predict(X_test))
lr_cv_r2 = cross_val_score(lr, X, y_reg, cv=5, scoring="r2").mean()

print("=" * 60)
print("BASELINE REGRESSOR: LinearRegression")
print(f"  Train R2:      {lr_train_r2:.4f}")
print(f"  Test  R2:      {lr_test_r2:.4f}")
print(f"  5-Fold CV R2:  {lr_cv_r2:.4f}")

# 5b. RandomForestRegressor
rf_reg = RandomForestRegressor(
    n_estimators=300, max_depth=6, min_samples_leaf=10,
    random_state=42, n_jobs=-1
)
rf_reg.fit(X_train, y_train_reg)
rf_train_r2 = r2_score(y_train_reg, rf_reg.predict(X_train))
rf_test_r2 = r2_score(y_test_reg, rf_reg.predict(X_test))
rf_cv_r2 = cross_val_score(rf_reg, X, y_reg, cv=5, scoring="r2").mean()

print("\n" + "=" * 60)
print("RANDOMFOREST REGRESSOR")
print(f"  Train R2:      {rf_train_r2:.4f}")
print(f"  Test  R2:      {rf_test_r2:.4f}")
print(f"  5-Fold CV R2:  {rf_cv_r2:.4f}")

# 5c. GradientBoostingRegressor
gb_reg = GradientBoostingRegressor(
    n_estimators=200, max_depth=4, min_samples_leaf=10,
    learning_rate=0.05, random_state=42
)
gb_reg.fit(X_train, y_train_reg)
gb_train_r2 = r2_score(y_train_reg, gb_reg.predict(X_train))
gb_test_r2 = r2_score(y_test_reg, gb_reg.predict(X_test))
gb_cv_r2 = cross_val_score(gb_reg, X, y_reg, cv=5, scoring="r2").mean()

print("\n" + "=" * 60)
print("GRADIENTBOOSTING REGRESSOR")
print(f"  Train R2:      {gb_train_r2:.4f}")
print(f"  Test  R2:      {gb_test_r2:.4f}")
print(f"  5-Fold CV R2:  {gb_cv_r2:.4f}")

# Regression Summary
print("\n" + "=" * 70)
print("REGRESSION SUMMARY (delay_months)")
print("=" * 70)
print(f"{'Metric':<20s} {'LinearRegression':>18s} {'RandomForest':>15s} {'GradientBoosting':>18s}")
print(f"  {'Train R2':<18s} {lr_train_r2:>18.4f} {rf_train_r2:>15.4f} {gb_train_r2:>18.4f}")
print(f"  {'Test  R2':<18s} {lr_test_r2:>18.4f} {rf_test_r2:>15.4f} {gb_test_r2:>18.4f}")
print(f"  {'5-Fold CV R2':<18s} {lr_cv_r2:>18.4f} {rf_cv_r2:>15.4f} {gb_cv_r2:>18.4f}")

reg_candidates = [
    (lr, "LinearRegression", lr_cv_r2),
    (rf_reg, "RandomForestRegressor", rf_cv_r2),
    (gb_reg, "GradientBoostingRegressor", gb_cv_r2),
]
best_reg, best_reg_name, best_reg_cv = max(reg_candidates, key=lambda x: x[2])
print(f"\nBest Regressor: {best_reg_name} (5-Fold CV R2: {best_reg_cv:.4f})")
print()

# ── 6. Binary Classification Models (high_risk) ─────────────────────────
# 6a. LogisticRegression baseline with class_weight='balanced'
log_clf = LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42)
log_clf.fit(X_train, y_train_clf)
log_train_acc = accuracy_score(y_train_clf, log_clf.predict(X_train))
log_test_acc = accuracy_score(y_test_clf, log_clf.predict(X_test))
log_cv_acc = cross_val_score(log_clf, X, y_clf, cv=5, scoring="accuracy").mean()

print("=" * 60)
print("BASELINE CLASSIFIER: LogisticRegression (class_weight='balanced')")
print(f"  Train Accuracy:     {log_train_acc:.4f}")
print(f"  Test  Accuracy:     {log_test_acc:.4f}")
print(f"  5-Fold CV Accuracy: {log_cv_acc:.4f}")

# 6b. RandomForestClassifier with class_weight='balanced'
rf_clf = RandomForestClassifier(
    n_estimators=300, max_depth=6, min_samples_leaf=10,
    class_weight="balanced", random_state=42, n_jobs=-1
)
rf_clf.fit(X_train, y_train_clf)
rf_train_acc = accuracy_score(y_train_clf, rf_clf.predict(X_train))
rf_test_acc = accuracy_score(y_test_clf, rf_clf.predict(X_test))
rf_cv_acc = cross_val_score(rf_clf, X, y_clf, cv=5, scoring="accuracy").mean()

print("\n" + "=" * 60)
print("RANDOMFOREST CLASSIFIER (class_weight='balanced')")
print(f"  Train Accuracy:     {rf_train_acc:.4f}")
print(f"  Test  Accuracy:     {rf_test_acc:.4f}")
print(f"  5-Fold CV Accuracy: {rf_cv_acc:.4f}")

# 6c. GradientBoostingClassifier (with sample weights for class balance)
gb_clf = GradientBoostingClassifier(
    n_estimators=200, max_depth=4, min_samples_leaf=10,
    learning_rate=0.05, random_state=42
)
sw_train = compute_sample_weight("balanced", y_train_clf)
gb_clf.fit(X_train, y_train_clf, sample_weight=sw_train)
gb_train_acc = accuracy_score(y_train_clf, gb_clf.predict(X_train))
gb_test_acc = accuracy_score(y_test_clf, gb_clf.predict(X_test))
gb_cv_acc = cross_val_score(gb_clf, X, y_clf, cv=5, scoring="accuracy").mean()

print("\n" + "=" * 60)
print("GRADIENTBOOSTING CLASSIFIER (sample_weight='balanced')")
print(f"  Train Accuracy:     {gb_train_acc:.4f}")
print(f"  Test  Accuracy:     {gb_test_acc:.4f}")
print(f"  5-Fold CV Accuracy: {gb_cv_acc:.4f}")

# Classification Summary
print("\n" + "=" * 70)
print("CLASSIFICATION SUMMARY (high_risk binary)")
print("=" * 70)
print(f"{'Metric':<20s} {'LogisticRegression':>20s} {'RandomForest':>15s} {'GradientBoosting':>18s}")
print(f"  {'Train Acc':<18s} {log_train_acc:>20.4f} {rf_train_acc:>15.4f} {gb_train_acc:>18.4f}")
print(f"  {'Test  Acc':<18s} {log_test_acc:>20.4f} {rf_test_acc:>15.4f} {gb_test_acc:>18.4f}")
print(f"  {'5-Fold CV Acc':<18s} {log_cv_acc:>20.4f} {rf_cv_acc:>15.4f} {gb_cv_acc:>18.4f}")

clf_candidates = [
    (log_clf, "LogisticRegression", log_cv_acc),
    (rf_clf, "RandomForestClassifier", rf_cv_acc),
    (gb_clf, "GradientBoostingClassifier", gb_cv_acc),
]
best_clf, best_clf_name, best_clf_cv = max(clf_candidates, key=lambda x: x[2])
print(f"\nBest Classifier: {best_clf_name} (5-Fold CV Acc: {best_clf_cv:.4f})")

# ── 7. Detailed Evaluation for Best Classifier ───────────────────────────
y_pred_clf = best_clf.predict(X_test)
overall_acc = accuracy_score(y_test_clf, y_pred_clf)
majority_class = int(y_test_clf.value_counts().idxmax())
majority_acc = float((y_test_clf == majority_class).mean())
prec = precision_score(y_test_clf, y_pred_clf)
rec = recall_score(y_test_clf, y_pred_clf)
f1 = f1_score(y_test_clf, y_pred_clf)

print("\n" + "=" * 70)
print(f"SELECTED MODEL: {best_clf_name} -- DETAILED TEST EVALUATION")
print("=" * 70)
print(f"  Overall Accuracy:              {overall_acc:.4f}  ({overall_acc * 100:.2f}%)")
print(f"  Majority-Class Baseline Acc:   {majority_acc:.4f}  ({majority_acc * 100:.2f}%)  <- always predicting class {majority_class}")
delta = overall_acc - majority_acc
print(f"  Improvement over baseline:     {delta:+.4f}  ({delta * 100:+.2f} pp)")
print(f"  High-Risk Precision:           {prec:.4f}")
print(f"  High-Risk Recall:              {rec:.4f}")
print(f"  High-Risk F1-Score:            {f1:.4f}")

print("\n--- Classification Report ---")
print(classification_report(y_test_clf, y_pred_clf, target_names=["Not High-Risk", "High-Risk"]))

print("--- Confusion Matrix ---")
cm = confusion_matrix(y_test_clf, y_pred_clf)
print(f"  {'':20s}  Predicted 0   Predicted 1")
print(f"  {'Actual 0 (not high)':20s}  {cm[0, 0]:>11d}   {cm[0, 1]:>11d}")
print(f"  {'Actual 1 (high)':20s}  {cm[1, 0]:>11d}   {cm[1, 1]:>11d}")

print("\n--- Feature Importances / Top Coefficients ---")
if hasattr(best_clf, "feature_importances_"):
    for feat, imp in sorted(zip(FEATURES, best_clf.feature_importances_), key=lambda x: x[1], reverse=True)[:15]:
        print(f"  {feat:35s} {imp:.4f}")
elif hasattr(best_clf, "coef_"):
    for feat, coef in sorted(zip(FEATURES, best_clf.coef_[0]), key=lambda x: abs(x[1]), reverse=True)[:15]:
        print(f"  {feat:35s} {coef:+.4f}")

# ── 8. Probability-based Tier Bucketing (test set) ──────────────────────
# Column 1 = probability of high_risk
hr_proba = best_clf.predict_proba(X_test)[:, 1]

def _prob_to_tier(p: float) -> str:
    if p < 0.33:
        return "Low"
    elif p <= 0.66:
        return "Medium"
    else:
        return "High"

test_results = X_test.copy()
test_results["high_risk_prob"] = hr_proba
test_results["risk_tier"] = [_prob_to_tier(p) for p in hr_proba]
test_results["actual_delay_months"] = y_test_reg.values

print("\n" + "=" * 70)
print("PROBABILITY-BASED RISK TIERS (test set)")
print("=" * 70)
tier_order = ["Low", "Medium", "High"]
print(f"  {'Tier':<10}  {'Count':>6}  {'% of test':>10}  {'Avg actual delay (mo)':>24}")
print(f"  {'-'*10}  {'-'*6}  {'-'*10}  {'-'*24}")
for tier in tier_order:
    mask = test_results["risk_tier"] == tier
    n = int(mask.sum())
    pct = 100 * n / len(test_results)
    avg_delay = float(test_results.loc[mask, "actual_delay_months"].mean()) if n > 0 else float("nan")
    print(f"  {tier:<10}  {n:>6}  {pct:>9.1f}%  {avg_delay:>23.2f} mo")

print()
print("  Sanity check: avg actual delay should monotonically increase Low -> Medium -> High.")

# ── 9. Save Models & HR_FEATURES ─────────────────────────────────────────
save_dirs = [
    os.path.join(".", "models"),
    os.path.join("paimana_backend", "models"),
]

for sdir in save_dirs:
    os.makedirs(sdir, exist_ok=True)
    joblib.dump(best_reg, os.path.join(sdir, "cost_model.joblib"))
    joblib.dump(best_clf, os.path.join(sdir, "risk_model.joblib"))
    with open(os.path.join(sdir, "hr_features.json"), "w") as f:
        json.dump(FEATURES, f, indent=2)

print("\n" + "=" * 70)
print("SAVED ARTIFACTS")
print("=" * 70)
print(f"  cost_model.joblib -> {best_reg_name} (saved to models/ and paimana_backend/models/)")
print(f"  risk_model.joblib -> {best_clf_name} (saved to models/ and paimana_backend/models/)")
print(f"  hr_features.json  -> {len(FEATURES)} features saved (models/ and paimana_backend/models/)")
print("  Ready for serving.")
