# Factory LP · Production Mix Optimization Studio

**Live App:** (https://dyamegowda.github.io/Analytics-of-Factory-/#p=40,30,2,1,1,2,100,80)

An offline-first, zero-server **Prescriptive Analytics & Linear Programming** web studio built with **HTML5, CSS3, Vanilla JavaScript, and inline SVG**. Designed to move manufacturing production-mix planning from static spreadsheets to live, explainable decision intelligence across a base factory problem and **300 solved production scenarios**.

### Key Features
- **Interactive 2D LP Workbench (`index.html`):** Drag constraint lines directly on the feasible-region plot, toggle exact rational fractions (`p/q`), test intuition in Blind Mode, add custom `≤ / ≥ / =` demand or contract constraints, and inspect live capacity meters and shadow prices.
- **5-Tab Decision & Research Lab:**
  - *Core & Sensitivity:* Plain-language diagnosis, ±10% Tornado chart, basis optimality ranges, parametric breakpoint curves, Make-or-Buy ROI optimizer, and A4 print / PNG / CSV exports.
  - *Simplex, Dual & ILP:* Step-by-step Two-Phase Simplex tableau with **Student Pivot Mode**, Primal ↔ Dual visualizer, and **2D ILP Branch-and-Bound** tree.
  - *Alternatives & XAI:* **MGA** near-optimal explorer, **Counterfactual** regime-flip explainer, and **Inverse Optimization** from any clicked/dragged point.
  - *Uncertainty, Pareto & ML:* **Bertsimas–Sim** budgeted robustness (`Γ`), **Pareto** profit-vs-energy frontier, a 140-tree GBDT surrogate benchmark, and **`SPO+` decision regret**.
  - *Scale-Up:* Pure-JS **4-product** mix and **3-month** multi-period rolling inventory solver.
- **Scenario Portfolio & Batch CSV (`data.html`):** Cross-filtered 300-scenario Regime Map (`SCN-009`, `SCN-194`, `SCN-213` alternative optima highlighted) and local `FileReader` batch CSV re-solver.
- **Stochastic Simulator & Dual Histograms (`results.html`):** Interactive Two-Stage Stochastic `EVPI` / `VSS` simulator and clickable 300-scenario shadow-price distributions.

### Run Locally
Open `index.html` directly in any browser (no build step or server required), or serve locally with:
```powershell
npx --yes serve .
```
