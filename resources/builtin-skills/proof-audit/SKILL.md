---
name: proof-audit
description: "逐条审计论文中的证明与推导：每一步依据是否充分、结论是否真正成立。"
metadata:
  version: 0.2.0
---

# Proof Audit

Locate the first exact logical gap. Do not replace a proof with a preferred proof until the existing argument has been assessed.

## Inputs

Read the definitions, assumptions, statements, proofs, cited lemmas, algorithms, and complexity corollaries in scope. Include appendix versions when they exist. Record missing source material instead of guessing.

Read [optimization-theory.md](../../references/optimization-theory.md), [claim-strength.md](../../references/claim-strength.md), and [review-severity.md](../../references/review-severity.md).

## Build the dependency graph

Construct this chain with actual labels and locations:

`assumptions -> definitions -> lemmas -> propositions -> theorems -> corollaries -> complexity claims`

For each edge, record the result used, the conditions required, and where those conditions are established. Detect unused assumptions, unused lemmas, missing edges, and circular dependencies.

## Audit each statement and proof

Check:

- undefined symbols and symbols whose meaning changes
- missing domains, quantifiers, probability spaces, filtrations, or conditioning
- hidden assumptions and conditions introduced only inside the proof
- theorem assumptions weaker than proof assumptions
- a cited lemma applied outside its conditions
- unjustified interchange of minimum, maximum, limit, derivative, integral, or expectation
- unjustified differentiability, envelope, implicit-function, or Danskin-type steps
- invalid compactness, existence, measurability, or attainment arguments
- incorrect use or conflation of convexity, strong convexity, PL, QG, error bounds, KL, smoothness, Lipschitzness, submodularity, and modularity
- constants that change meaning or acquire undeclared dependence
- incompatible norms, dimensions, or inner products
- stochastic conditioning and independence errors
- big-O notation that hides dependence needed for the claimed comparison
- disagreement between the main-text and appendix statement
- disagreement between the analyzed algorithm and the stated algorithm

For convergence and complexity, identify the target criterion, per-iteration cost, oracle model, expectation or probability guarantee, and all parameter dependence that affects the headline bound.

## Finding labels

Use exactly one primary label per finding:

- **correctness issue**: a step or conclusion is false under the stated conditions
- **missing justification**: the step could be valid but the required argument is absent
- **notation issue**: notation blocks verification or changes meaning
- **assumption mismatch**: a required condition is missing, introduced late, or stronger than stated
- **presentation improvement**: the argument is valid but hard to follow

Do not merge correctness and presentation findings.

## Output

Provide the dependency graph first. Then report findings in logical order, starting with the earliest broken dependency. For each finding, give the exact location, required statement, observed step, consequence, and the smallest valid repair. State which parts were checked and which remain unverified.
