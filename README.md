# PAIMANA: AI Early-Warning System for Infrastructure Project Risk

An ML-powered early-warning system that predicts cost risk in infrastructure projects and flags high-risk projects before they escalate. Built for **Smart India Hackathon 2026** around the MoSPI **PAIMANA** (project monitoring) problem statement.

**Live demo:** https://paimana-phi.vercel.app

---

## Problem

Infrastructure projects regularly run over cost and time, and problems are usually noticed late. PAIMANA's goal is to turn project data into early warnings: which projects are likely to be high-risk, and how risky, so monitoring teams can act first.

## What it does

- Predicts a project's **bid-vs-estimate cost deviation** (regression).
- Classifies projects into **Low / Medium / High** risk tiers.
- Trains a **binary high-risk classifier** (top-quartile deviation) and converts its probability into risk tiers.
- Serves predictions, alerts and a dashboard summary through a REST API.
- Shows everything in a React dashboard.

## Tech stack

| Layer | Tools |
|-------|-------|
| ML | Python, pandas, NumPy, scikit-learn, joblib |
| Backend | FastAPI |
| Frontend | React, Vite, Tailwind CSS (deployed on Vercel) |

## Project structure

```
PAIMANA/
├── data/                 # Datasets (construction bids CSV, FRED materials PPI CSV)
├── models/               # Saved models (.joblib) and feature list (.json)
├── paimana_backend/      # Backend modules
├── paimana-frontend/     # React + Vite + Tailwind dashboard
├── scratch/              # Experiments
├── auth.py               # Authentication
├── main.py               # FastAPI app entry point
└── train_model.py        # Feature engineering + model training
```

## Data

- **Construction bid dataset** (`data/ConstructionData.csv`): public construction bidding data with `engineers_estimate`, `bid_total`, `bid_days`, `start_date`, and ~8,700 bid-item pay-code columns.
- **Materials price index** (`data/construction_ppi.csv`): FRED series `WPUSOP3000`, merged by start month.

**Target:** `cost_overrun_pct = (bid_total - engineers_estimate) / engineers_estimate * 100`, clipped to the 1st-99th percentile. This measures how a bid deviates from the engineer's estimate, not final execution cost.

## Approach

1. **Feature engineering**
   - `item_count`, `estimate_per_item`, `log_engineers_estimate`, `bid_days`
   - Start month and a monsoon-season flag
   - `materials_ppi` and `ppi_deviation` (external price signal)
   - Work-category share features (`pct_earthwork`, `pct_surfacing`, `pct_structures`, `pct_drainage_traffic`, `pct_other`)
2. **Models:** Linear / Logistic Regression baselines, Random Forest, Gradient Boosting. The best model per task is chosen by 5-fold cross-validation.
3. **Binary high-risk classifier:** Random Forest with balanced class weights, evaluated against a majority-class baseline.
4. **Risk tiers:** predicted high-risk probability is bucketed into Low (<0.33), Medium (0.33-0.66) and High (>0.66).

## Results

| Task | Model | Metric | Baseline |
|------|-------|--------|----------|
| Risk tier (3-class) | [model] | [accuracy] | ~0.33 (random) |
| High-risk (binary) | Random Forest | [accuracy / recall] | [majority-class accuracy] |

> Fill these in from the output of `python train_model.py`.

## Getting started

### 1. Clone

```bash
git clone https://github.com/SUNRAKU-007/PAIMANA.git
cd PAIMANA
```

### 2. Backend

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install fastapi uvicorn pandas numpy scikit-learn joblib
python train_model.py           # trains and saves models to models/
uvicorn main:app --reload
```

The API runs at `http://127.0.0.1:8000`, with interactive docs at `/docs`.

### 3. Frontend

```bash
cd paimana-frontend
npm install
npm run dev
```

## API overview

| Endpoint | Description |
|----------|-------------|
| `GET /projects` | List projects |
| `GET /projects/{id}/risk` | Risk prediction for one project |
| `GET /alerts` | Projects flagged as high-risk |
| `GET /dashboard/summary` | Aggregate KPIs for the dashboard |

## Limitations

- The training data is a public construction bid dataset, not live PAIMANA project data; the system is designed so PAIMANA data can be plugged in.
- The target is bid-vs-estimate deviation, a proxy for execution cost overrun.
- PPI values after Dec 2015 are forward-filled with the last available value.
- Signal is moderate, so predictions are meant as early-warning flags, not exact forecasts.

## Roadmap

- Retrain on real PAIMANA project-monitoring data
- Add schedule-overrun prediction
- Per-project explanations of why a project was flagged

## Author

**Manjot Singh**: CSE, NIT Srinagar. [GitHub](https://github.com/SUNRAKU-007)
