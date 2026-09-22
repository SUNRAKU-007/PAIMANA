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
from sklearn.metrics import r2_score, accuracy_score
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
