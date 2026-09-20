---
name: experiment-audit
description: "审计实验设置与结果完整性：基线、消融、统计显著性、可复现性是否齐备。"
metadata:
  version: 0.2.0
---

# Experiment Audit

Determine whether the experiments test the claims under a fair and interpretable protocol.

Read [experiment-reporting.md](../../references/experiment-reporting.md), [claim-strength.md](../../references/claim-strength.md), and [review-severity.md](../../references/review-severity.md).

## Establish the evidence chain

Map each empirical claim to the dataset or problem, metric, baseline set, budget, protocol, result, and uncertainty estimate that support it. Record missing logs, code, configurations, or per-seed outputs instead of inferring them.

## Audit the design

Check:

- datasets, synthetic problems, splits, preprocessing, and inclusion criteria
- baseline relevance and implementation provenance
- metric definitions and direction
- computation, time, iteration, and oracle budget matching
- hyperparameter search spaces, tuning budgets, and validation data
- initialization and random seeds
- stopping criteria and convergence tolerances
- wall-clock versus iteration comparisons
- gradient, stochastic first-order, Hessian-vector, projection, linear-optimization, and lower-level oracle counts
- ablations, sensitivity checks, and failure analysis
- scalability along the dimension named in the claim
- variance, confidence intervals, and statistical tests where they matter

Check whether preprocessing, warm starts, compilation, data loading, line searches, and expensive inner solves are counted consistently. Identify stopping rules that favor one method.

## Baseline failures

Treat did not finish, diverged, ran out of memory, and timed out as different outcomes. Require the paper to state the condition and evidence. When a bilevel baseline scales poorly with lower-level dimension, connect the failure to its actual algorithm or implementation, such as an expanding inner solve, Hessian system, stored Jacobian, or repeated oracle call. Do not infer the mechanism from the failure alone.

## Result interpretation

Distinguish absolute differences, relative differences, percentage points, percent improvement, and statistical significance. Separate observation from interpretation. Do not narrate every cell. Identify the few observations that test the paper's main claims.

## Output

Lead with the validity of the main empirical comparison. Report blockers before reporting improvements. For each issue, name the affected claim, evidence, consequence, and minimum repair. Do not rewrite Results prose unless requested. If requested, follow the results-to-writing procedure in the shared reference.
