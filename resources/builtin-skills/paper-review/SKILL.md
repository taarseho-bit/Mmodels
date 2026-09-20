---
name: paper-review
description: "以审稿人视角评审论文：贡献、方法、实验、写作四个维度打分并给出可执行的修改意见。"
metadata:
  version: 0.2.0
---

# Paper Review

Read the paper as a demanding but fair NeurIPS, ICML, ICLR, AISTATS, ICASSP, IEEE, or optimization reviewer.

## Scope and evidence

Identify the active manuscript and its included files. Exclude old drafts, response letters, notes, and generated review reports unless the user places them in scope. Record the target venue, paper type, claimed contribution, and unavailable artifacts.

Review only. Do not edit or rewrite by default. Anchor every substantive finding to a section, theorem, algorithm, equation, figure, table, or quoted phrase. Read [review-severity.md](../../references/review-severity.md) before reporting issues.

## Run eight passes

1. **Contribution and novelty**
   - Identify the precise technical delta over the closest work.
   - Test whether the contribution is specific, supported, and important for the stated problem.
   - Flag unsupported first, novel, state-of-the-art, or scalable claims.

2. **Logical structure**
   - Trace problem, gap, method, result, evidence, and conclusion.
   - Flag missing links, circular motivation, late definitions, and results that do not serve the paper's argument.

3. **Mathematical correctness and assumption usage**
   - Check whether assumptions are introduced before use and whether theorem conditions match proof conditions.
   - Check whether every theorem is used and every lemma supports a later result.
   - Route a deep formal audit to `proof-audit` when correctness cannot be assessed at review depth.

4. **Algorithm and theory consistency**
   - Compare the analyzed update with the stated pseudocode and implementation description.
   - Verify indexing, oracle access, step sizes, stopping rules, exact versus approximate solves, and constrained versus unconstrained regimes.
   - Check that complexity statements use the correct cost model.

5. **Experiment and claim consistency**
   - Map each major empirical claim to a result.
   - Check budget matching, tuning, initialization, stopping criteria, variance, ablations, and the claimed scaling dimension.
   - Use [experiment-reporting.md](../../references/experiment-reporting.md) for optimization-specific checks.

6. **Related-work positioning**
   - Check whether comparisons use the same problem class, oracle model, assumptions, guarantee, and stationarity notion.
   - Use [literature-positioning.md](../../references/literature-positioning.md) when sources are available.

7. **Writing quality**
   - Prioritize ambiguity that changes technical meaning.
   - Apply [writing-style.md](../../references/writing-style.md) and [claim-strength.md](../../references/claim-strength.md).
   - Do not bury substantive findings under copy edits.

8. **Submission readiness**
   - Check unresolved references, missing proof or experiment pointers, inconsistent numbers, anonymization, required statements, and venue constraints.
   - Route exhaustive source checks to `latex-paper-audit`.

## Optimization checks

Explicitly check:

- whether assumptions are stronger than the analysis uses
- whether iteration complexity is confused with oracle complexity
- whether gradient, stochastic first-order, Hessian-vector, projection, linear-optimization, and lower-level calls are counted consistently
- whether exact and approximate lower-level solutions are distinguished
- whether a reformulation is proved equivalent or only approximately related
- whether constrained and unconstrained claims are mixed
- whether an experiment tests the theoretical advantage it is cited to support
- whether baselines receive comparable computation budgets
- whether scalability is measured along the dimension named in the claim

## Output

Lead with the paper's main contribution as understood, then the highest-priority blockers. Separate major issues from local improvements. For each issue, give the anchor, category, consequence, and minimum action needed. State what could not be verified.
