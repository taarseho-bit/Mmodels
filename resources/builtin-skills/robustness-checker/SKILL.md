---
name: robustness-checker
description: "对已求解结果做灵敏度分析、误差检查与基线对比，验证结论稳健性；没有基线与灵敏度证据不得声称模型更优。"
---

# Purpose

Test the claims most likely to fail. Choose checks from the model's assumptions and decision risks rather than filling a generic checklist.

# Preconditions

- Approved main and usable baseline executed.
- Run summary, method card, probe summary, and relevant outputs exist.
- Claim or decision to be tested is known.

# Workflow

1. Identify load-bearing assumptions and claims.
2. Select applicable checks:
   - parameter or weight perturbation;
   - alternate split or resampling;
   - seed stability;
   - outlier/missing-data treatment;
   - constraint/capacity perturbation;
   - baseline comparison;
   - output concentration/rank stability;
   - error and uncertainty analysis.
3. State perturbation ranges and why they are meaningful before interpreting results.
4. Run checks with fixed seeds where stochastic.
5. Save compact metrics to:

`robustness/Qx/qx_robustness_summary.json`

6. In `submission`, also save:

`robustness/Qx/qx_robustness_report.md`

7. If the stability verdict affects method continuation or claim scope, invoke one choice card and log the human answer in `qx_decisions.jsonl`.

# Summary Contract

Record:

- tested claim/assumption;
- input and result source paths;
- perturbation;
- metric and threshold if predeclared;
- observed value;
- status `PASS`, `CONDITIONAL`, or `FAIL`;
- limitation;
- fallback-trigger relevance.

# Rules

- Do not run irrelevant checks merely to reach a count.
- Do not invent a threshold after seeing the result without labeling it exploratory.
- Do not convert stability metrics into the human confidence verdict.
- Do not create `robustness-checker_modeler_decision.md`.
- A failed robustness check is evidence for adjust/fallback/claim downgrade, not permission for AI to decide.

# Verification

- Every major final claim has a supporting check or explicit limitation.
- Perturbations are justified and reproducible.
- Baseline and main comparisons remain metric-compatible.
- Concentration/degeneracy risks are revisited when relevant.
- Submission report sources its numbers from the summary and experiment artifacts.
