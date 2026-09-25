"""
train_model.py -- Construction Bid Cost-Overrun Predictor
Loads the Kaggle construction bidding dataset, engineers features from
~8748 bid-item pay-code columns, and trains three model families:
  Regressors:  LinearRegression, RandomForest, GradientBoosting
  Classifiers: LogisticRegression, RandomForest, GradientBoosting
Saves whichever model scores best on 5-fold CV.
"""

import re
import os
import pandas as pd
import numpy as np
from sklearn.ensemble import (
    RandomForestRegressor, RandomForestClassifier,
    GradientBoostingRegressor, GradientBoostingClassifier,
)
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import r2_score, accuracy_score, classification_report, confusion_matrix
import joblib

# ── 1. Load data ────────────────────────────────────────────────────────
DATA_PATH = os.path.join("data", "ConstructionData.csv")
df = pd.read_csv(DATA_PATH)
print(f"Raw shape: {df.shape}")

# ── 2. Identify bid-item-code columns (digits-hyphen-digits pattern) ───
BID_ITEM_RE = re.compile(r"^\d+-\d+$")
bid_item_cols = [c for c in df.columns if BID_ITEM_RE.match(c)]
named_cols = ["engineers_estimate", "bid_total", "bid_days", "start_date"]
print(f"Bid-item columns detected: {len(bid_item_cols)}")
print(f"Named columns: {named_cols}")

# ── 3. Engineer features ───────────────────────────────────────────────
# item_count: how many distinct bid items this project actually has
bid_items = df[bid_item_cols]
df["item_count"] = (bid_items.fillna(0) != 0).sum(axis=1)

# total_quantity: sum of all bid-item quantities per row
df["total_quantity"] = bid_items.fillna(0).sum(axis=1)

# log-transformed engineers_estimate (raw range ~3.5K-68M, log helps the trees)
df["log_engineers_estimate"] = np.log1p(df["engineers_estimate"])

# cost per item -- a useful normalised signal
df["estimate_per_item"] = df["engineers_estimate"] / (df["item_count"] + 1)

# ── 3b. Parse start_date and derive date features ───────────────────
before = len(df)
df = df.dropna(subset=["start_date"])  # drop nulls first
df["start_date_parsed"] = pd.to_datetime(
    df["start_date"].astype(int).astype(str), format="%Y%m%d", errors="coerce"
)
bad_dates = df["start_date_parsed"].isna().sum()
df = df.dropna(subset=["start_date_parsed"])
print(f"Dropped {before - len(df)} rows with missing/unparseable start_date -> {len(df)} remain")

df["start_month"] = df["start_date_parsed"].dt.month
df["start_year"] = df["start_date_parsed"].dt.year
df["is_monsoon_season"] = df["start_month"].isin([6, 7, 8, 9]).astype(int)

# year_month key for PPI merge
df["year_month"] = df["start_date_parsed"].dt.to_period("M")

# ── 3c. Load & merge FRED Construction PPI ────────────────────────
ppi = pd.read_csv(os.path.join("data", "construction_ppi.csv"))
ppi["observation_date"] = pd.to_datetime(ppi["observation_date"])
ppi["year_month"] = ppi["observation_date"].dt.to_period("M")
ppi = ppi[["year_month", "WPUSOP3000"]].rename(columns={"WPUSOP3000": "materials_ppi"})

df = df.merge(ppi, on="year_month", how="left")

# Forward-fill for rows beyond PPI coverage (after Dec 2015)
fill_count = df["materials_ppi"].isna().sum()
LAST_PPI = 190.1  # Dec 2015, last available value
df["materials_ppi"] = df["materials_ppi"].fillna(LAST_PPI)
print(f"PPI merged. Forward-filled {fill_count} rows beyond Dec 2015 with PPI={LAST_PPI}")

# ppi_deviation: above/below average materials pricing period
df["ppi_deviation"] = df["materials_ppi"] - df["materials_ppi"].mean()

# ── 4. Drop rows with missing bid_days (~7 rows) ──────────────────────
before = len(df)
df = df.dropna(subset=["bid_days"])
print(f"Dropped {before - len(df)} rows with missing bid_days -> {len(df)} rows remain")

# ── 5. Compute target: cost overrun percentage ────────────────────────
df["cost_overrun_pct"] = (
    (df["bid_total"] - df["engineers_estimate"]) / df["engineers_estimate"] * 100
)

# Clip extreme outliers to 1st-99th percentile range
lo = df["cost_overrun_pct"].quantile(0.01)
hi = df["cost_overrun_pct"].quantile(0.99)
clipped = ((df["cost_overrun_pct"] < lo) | (df["cost_overrun_pct"] > hi)).sum()
df["cost_overrun_pct"] = df["cost_overrun_pct"].clip(lo, hi)
print(f"Clipped {clipped} outlier rows to [{lo:.2f}%, {hi:.2f}%] range")

# Quick sanity check
print(f"\ncost_overrun_pct stats (after clip):\n{df['cost_overrun_pct'].describe()}\n")

# ── 6. Prepare features & splits ─────────────────────────────────────
FEATURES = ["log_engineers_estimate", "bid_days", "item_count", "estimate_per_item",
            "start_month", "is_monsoon_season", "materials_ppi", "ppi_deviation"]
X = df[FEATURES]
y_reg = df["cost_overrun_pct"]

# Correlation matrix so we can eyeball feature-target relationships
print("=" * 80)
print("CORRELATION MATRIX (features + target)")
print("=" * 80)
corr_cols = FEATURES + ["cost_overrun_pct"]
print(df[corr_cols].corr().round(3).to_string())
print()

# Monsoon + PPI hypothesis check
print("--- Feature-target correlations (hypotheses) ---")
for col in ["start_month", "is_monsoon_season", "materials_ppi", "ppi_deviation"]:
    r = df[col].corr(df["cost_overrun_pct"])
    print(f"  corr({col}, cost_overrun_pct) = {r:.4f}")
print()

X_train, X_test, y_train, y_test = train_test_split(
    X, y_reg, test_size=0.2, random_state=42
)

# ── 6a. Baseline: LinearRegression ─────────────────────────────────
lr = LinearRegression()
lr.fit(X_train, y_train)
lr_train_r2 = r2_score(y_train, lr.predict(X_train))
lr_test_r2 = r2_score(y_test, lr.predict(X_test))
lr_cv_r2 = cross_val_score(lr, X, y_reg, cv=5, scoring="r2").mean()
print("=" * 60)
print("BASELINE REGRESSOR: LinearRegression")
print(f"  Train R2:      {lr_train_r2:.4f}")
print(f"  Test  R2:      {lr_test_r2:.4f}")
print(f"  5-Fold CV R2:  {lr_cv_r2:.4f}")

# ── 6b. RandomForestRegressor ──────────────────────────────────────
rf_reg = RandomForestRegressor(
    n_estimators=300, max_depth=4, min_samples_leaf=20,
    random_state=42, n_jobs=-1
)
rf_reg.fit(X_train, y_train)
rf_train_r2 = r2_score(y_train, rf_reg.predict(X_train))
rf_test_r2 = r2_score(y_test, rf_reg.predict(X_test))
rf_cv_r2 = cross_val_score(rf_reg, X, y_reg, cv=5, scoring="r2").mean()
print("\n" + "=" * 60)
print("RANDOMFOREST REGRESSOR")
print(f"  Train R2:      {rf_train_r2:.4f}")
print(f"  Test  R2:      {rf_test_r2:.4f}")
print(f"  5-Fold CV R2:  {rf_cv_r2:.4f}")
print(f"  Feature importances:")
for feat, imp in zip(FEATURES, rf_reg.feature_importances_):
    print(f"    {feat:25s} {imp:.4f}")

# ── 6c. GradientBoostingRegressor ──────────────────────────────────
gb_reg = GradientBoostingRegressor(
    n_estimators=200, max_depth=4, min_samples_leaf=20,
    learning_rate=0.05, random_state=42
)
gb_reg.fit(X_train, y_train)
gb_train_r2 = r2_score(y_train, gb_reg.predict(X_train))
gb_test_r2 = r2_score(y_test, gb_reg.predict(X_test))
gb_cv_r2 = cross_val_score(gb_reg, X, y_reg, cv=5, scoring="r2").mean()
print("\n" + "=" * 60)
print("GRADIENTBOOSTING REGRESSOR")
print(f"  Train R2:      {gb_train_r2:.4f}")
print(f"  Test  R2:      {gb_test_r2:.4f}")
print(f"  5-Fold CV R2:  {gb_cv_r2:.4f}")
print(f"  Feature importances:")
for feat, imp in zip(FEATURES, gb_reg.feature_importances_):
    print(f"    {feat:25s} {imp:.4f}")

# ── 7. Classification: predict risk_tier (tercile buckets) ────────────
df["risk_tier"] = pd.qcut(
    df["cost_overrun_pct"], q=3, labels=["Low", "Medium", "High"]
)

y_cls = df["risk_tier"]
X_train_c, X_test_c, y_train_c, y_test_c = train_test_split(
    X, y_cls, test_size=0.2, random_state=42
)

# ── 7a. Baseline: LogisticRegression ────────────────────────────────
log_clf = LogisticRegression(max_iter=1000, random_state=42)
log_clf.fit(X_train_c, y_train_c)
log_train_acc = accuracy_score(y_train_c, log_clf.predict(X_train_c))
log_test_acc = accuracy_score(y_test_c, log_clf.predict(X_test_c))
log_cv_acc = cross_val_score(log_clf, X, y_cls, cv=5, scoring="accuracy").mean()
print("\n" + "=" * 60)
print("BASELINE CLASSIFIER: LogisticRegression")
print(f"  Train Accuracy:     {log_train_acc:.4f}")
print(f"  Test  Accuracy:     {log_test_acc:.4f}")
print(f"  5-Fold CV Accuracy: {log_cv_acc:.4f}")

# ── 7b. RandomForestClassifier ─────────────────────────────────────
rf_clf = RandomForestClassifier(
    n_estimators=300, max_depth=4, min_samples_leaf=20,
    random_state=42, n_jobs=-1
)
rf_clf.fit(X_train_c, y_train_c)
rf_train_acc = accuracy_score(y_train_c, rf_clf.predict(X_train_c))
rf_test_acc = accuracy_score(y_test_c, rf_clf.predict(X_test_c))
rf_cv_acc = cross_val_score(rf_clf, X, y_cls, cv=5, scoring="accuracy").mean()
print("\n" + "=" * 60)
print("RANDOMFOREST CLASSIFIER")
print(f"  Train Accuracy:     {rf_train_acc:.4f}")
print(f"  Test  Accuracy:     {rf_test_acc:.4f}")
print(f"  5-Fold CV Accuracy: {rf_cv_acc:.4f}")
print(f"  Feature importances:")
for feat, imp in zip(FEATURES, rf_clf.feature_importances_):
    print(f"    {feat:25s} {imp:.4f}")

# ── 7c. GradientBoostingClassifier ─────────────────────────────────
gb_clf = GradientBoostingClassifier(
    n_estimators=200, max_depth=4, min_samples_leaf=20,
    learning_rate=0.05, random_state=42
)
gb_clf.fit(X_train_c, y_train_c)
gb_train_acc = accuracy_score(y_train_c, gb_clf.predict(X_train_c))
gb_test_acc = accuracy_score(y_test_c, gb_clf.predict(X_test_c))
gb_cv_acc = cross_val_score(gb_clf, X, y_cls, cv=5, scoring="accuracy").mean()
print("\n" + "=" * 60)
print("GRADIENTBOOSTING CLASSIFIER")
print(f"  Train Accuracy:     {gb_train_acc:.4f}")
print(f"  Test  Accuracy:     {gb_test_acc:.4f}")
print(f"  5-Fold CV Accuracy: {gb_cv_acc:.4f}")
print(f"  Feature importances:")
for feat, imp in zip(FEATURES, gb_clf.feature_importances_):
    print(f"    {feat:25s} {imp:.4f}")

# ── 8. Side-by-side summary (3 models) ───────────────────────────
print("\n" + "=" * 70)
print("SUMMARY: Baseline vs RandomForest vs GradientBoosting")
print("=" * 70)
print(f"{'REGRESSION (R2)':<24s} {'Baseline':>10s} {'RF':>10s} {'GB':>10s}")
print(f"  {'Train':<20s} {lr_train_r2:>10.4f} {rf_train_r2:>10.4f} {gb_train_r2:>10.4f}")
print(f"  {'Test':<20s} {lr_test_r2:>10.4f} {rf_test_r2:>10.4f} {gb_test_r2:>10.4f}")
print(f"  {'5-Fold CV':<20s} {lr_cv_r2:>10.4f} {rf_cv_r2:>10.4f} {gb_cv_r2:>10.4f}")
print()
print(f"{'CLASSIFICATION (Acc)':<24s} {'Baseline':>10s} {'RF':>10s} {'GB':>10s}")
print(f"  {'Train':<20s} {log_train_acc:>10.4f} {rf_train_acc:>10.4f} {gb_train_acc:>10.4f}")
print(f"  {'Test':<20s} {log_test_acc:>10.4f} {rf_test_acc:>10.4f} {gb_test_acc:>10.4f}")
print(f"  {'5-Fold CV':<20s} {log_cv_acc:>10.4f} {rf_cv_acc:>10.4f} {gb_cv_acc:>10.4f}")

# ── 9. Save best model per task (by CV score) ────────────────────
os.makedirs("models", exist_ok=True)
print()

# Regression: pick best CV R2 among all 3
reg_candidates = [
    (lr, "LinearRegression", lr_cv_r2),
    (rf_reg, "RandomForestRegressor", rf_cv_r2),
    (gb_reg, "GradientBoostingRegressor", gb_cv_r2),
]
best_reg, best_reg_name, best_reg_cv = max(reg_candidates, key=lambda x: x[2])
joblib.dump(best_reg, os.path.join("models", "cost_model.joblib"))
print(f"Saved {best_reg_name} as cost_model.joblib (best CV R2: {best_reg_cv:.4f})")

# Classification: pick best CV accuracy among all 3
clf_candidates = [
    (log_clf, "LogisticRegression", log_cv_acc),
    (rf_clf, "RandomForestClassifier", rf_cv_acc),
    (gb_clf, "GradientBoostingClassifier", gb_cv_acc),
]
best_clf, best_clf_name, best_clf_cv = max(clf_candidates, key=lambda x: x[2])
joblib.dump(best_clf, os.path.join("models", "risk_model.joblib"))
print(f"Saved {best_clf_name} as risk_model.joblib (best CV Acc: {best_clf_cv:.4f})")

# ═══════════════════════════════════════════════════════════════════════════
# ── 10. BINARY HIGH-RISK CLASSIFIER (additional – not saved to disk) ──────
# ═══════════════════════════════════════════════════════════════════════════

# ── 10a. Project-type proxy: section-group percentage features ────────────
def _section_group(col_name: str) -> str:
    """Map a bid-item pay-code column name to a Caltrans section group.

    Groups are determined by the leading number before the first hyphen:
      200-299  -> earthwork
      300-399  -> surfacing
      400-499  -> structures
      500-699  -> drainage_traffic
      anything else -> other
    """
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
    else:
        return "other"


# Build a mapping: column -> group, then group -> list of columns
col_to_group = {c: _section_group(c) for c in bid_item_cols}
groups = ["earthwork", "surfacing", "structures", "drainage_traffic", "other"]
group_cols = {g: [c for c, grp in col_to_group.items() if grp == g] for g in groups}

print("\n" + "=" * 70)
print("SECTION-GROUP COLUMN COUNTS (bid-item -> group mapping)")
print("=" * 70)
for g in groups:
    print(f"  {g:20s}: {len(group_cols[g])} columns")

# For each project, sum bid-item values per group, then divide by row total
# Re-slice from cleaned df so row indices match after dropna filtering above
bid_matrix = df[bid_item_cols].fillna(0)
row_totals = bid_matrix.sum(axis=1)       # project-level total bid-item amount

for g in groups:
    cols = group_cols[g]
    group_sum = bid_matrix[cols].sum(axis=1) if cols else pd.Series(0, index=df.index)
    # Guard against division-by-zero: projects with no bid-item amounts get 0
    df[f"pct_{g}"] = np.where(row_totals > 0, group_sum / row_totals, 0.0)

PCT_FEATURES = [f"pct_{g}" for g in groups]
print(f"\nAdded pct_* features: {PCT_FEATURES}")
print(df[PCT_FEATURES].describe().round(4).to_string())

# ── 10b. Binary high-risk target (75th-percentile threshold) ─────────────
threshold_75 = df["cost_overrun_pct"].quantile(0.75)
df["high_risk"] = (df["cost_overrun_pct"] > threshold_75).astype(int)

n_total = len(df)
n_high = df["high_risk"].sum()
n_low = n_total - n_high

print("\n" + "=" * 70)
print("BINARY HIGH-RISK TARGET")
print("=" * 70)
print(f"  75th-percentile threshold: {threshold_75:.4f}%")
print(f"  High-risk (=1):  {n_high:>6d}  ({100 * n_high / n_total:.1f}%)")
print(f"  Not high-risk (=0): {n_low:>6d}  ({100 * n_low / n_total:.1f}%)")

# ── 10c. Combined feature set & train/test split ──────────────────────────
HR_FEATURES = FEATURES + PCT_FEATURES     # 8 original + 5 pct_* = 13 total

X_hr = df[HR_FEATURES]
y_hr = df["high_risk"]

X_hr_train, X_hr_test, y_hr_train, y_hr_test = train_test_split(
    X_hr, y_hr, test_size=0.2, random_state=42, stratify=y_hr
)

print(f"\n  Train size: {len(X_hr_train)}  |  Test size: {len(X_hr_test)}")
print(f"  HR_FEATURES ({len(HR_FEATURES)}): {HR_FEATURES}")

# ── 10d. Train binary RandomForestClassifier ──────────────────────────────
hr_clf = RandomForestClassifier(
    n_estimators=100, max_depth=8, min_samples_leaf=5,
    class_weight="balanced", random_state=42, n_jobs=-1
)
hr_clf.fit(X_hr_train, y_hr_train)

# ── 10e. Evaluate ─────────────────────────────────────────────────────────
y_hr_pred = hr_clf.predict(X_hr_test)

overall_acc = accuracy_score(y_hr_test, y_hr_pred)
majority_class = y_hr_test.value_counts().idxmax()
majority_acc = (y_hr_test == majority_class).mean()

print("\n" + "=" * 70)
print("BINARY HIGH-RISK CLASSIFIER -- EVALUATION RESULTS")
print("=" * 70)
print(f"  Overall Accuracy:              {overall_acc:.4f}  ({overall_acc * 100:.2f}%)")
print(f"  Majority-Class Baseline Acc:   {majority_acc:.4f}  ({majority_acc * 100:.2f}%)"  \
      f"  <- always predicting class {majority_class}")
delta = overall_acc - majority_acc
print(f"  Improvement over baseline:     {delta:+.4f}  ({delta * 100:+.2f} pp)")

print("\n--- Classification Report ---")
print(classification_report(y_hr_test, y_hr_pred, target_names=["Not High-Risk", "High-Risk"]))

print("--- Confusion Matrix ---")
cm = confusion_matrix(y_hr_test, y_hr_pred)
print(f"  {'':20s}  Predicted 0   Predicted 1")
print(f"  {'Actual 0 (not high)':20s}  {cm[0, 0]:>11d}   {cm[0, 1]:>11d}")
print(f"  {'Actual 1 (high)':20s}  {cm[1, 0]:>11d}   {cm[1, 1]:>11d}")

print("\n--- Feature Importances (Binary HR Classifier) ---")
for feat, imp in sorted(zip(HR_FEATURES, hr_clf.feature_importances_),
                         key=lambda x: x[1], reverse=True):
    print(f"  {feat:30s} {imp:.4f}")

# ── 10f. Probability-based tier bucketing ─────────────────────────────────
# Use the probability of the high_risk class (column index 1)
hr_proba = hr_clf.predict_proba(X_hr_test)[:, 1]

def _prob_to_tier(p: float) -> str:
    if p < 0.33:
        return "Low"
    elif p <= 0.66:
        return "Medium"
    else:
        return "High"

# Build a results frame aligned to the test set
test_results = X_hr_test.copy()
test_results["high_risk_prob"]    = hr_proba
test_results["risk_tier_prob"]    = [_prob_to_tier(p) for p in hr_proba]
test_results["actual_overrun_pct"] = df.loc[X_hr_test.index, "cost_overrun_pct"].values

print("\n" + "=" * 70)
print("PROBABILITY-BASED RISK TIERS (test set)")
print("=" * 70)

tier_order = ["Low", "Medium", "High"]
print(f"\n  {'Tier':<10}  {'Count':>6}  {'% of test':>10}  {'Avg actual overrun %':>22}")
print(f"  {'-'*10}  {'-'*6}  {'-'*10}  {'-'*22}")
for tier in tier_order:
    mask = test_results["risk_tier_prob"] == tier
    n    = mask.sum()
    pct  = 100 * n / len(test_results)
    avg_overrun = test_results.loc[mask, "actual_overrun_pct"].mean() if n > 0 else float("nan")
    print(f"  {tier:<10}  {n:>6}  {pct:>9.1f}%  {avg_overrun:>21.2f}%")

print()
print("  Sanity check: avg overrun should increase Low -> Medium -> High")

# ── 10g. Save model and feature list ──────────────────────────────────────
import json

model_path    = os.path.join("models", "risk_model.joblib")
features_path = os.path.join("models", "hr_features.json")

joblib.dump(hr_clf, model_path)

with open(features_path, "w") as f:
    json.dump(HR_FEATURES, f, indent=2)

print("\n" + "=" * 70)
print("SAVED")
print("=" * 70)
print(f"  Model   -> {model_path}")
print(f"    type         : RandomForestClassifier (class_weight='balanced')")
print(f"    n_estimators : 100  max_depth: 8  min_samples_leaf: 5")
print(f"    trained on   : {len(X_hr_train)} rows  |  tested on: {len(X_hr_test)} rows")
print(f"  Features-> {features_path}")
print(f"    {len(HR_FEATURES)} features: {HR_FEATURES}")
print()
print("  NOTE: main.py not yet updated -- update HR_FEATURES there before serving.")
