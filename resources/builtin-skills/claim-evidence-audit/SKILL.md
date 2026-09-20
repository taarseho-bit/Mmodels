---
name: claim-evidence-audit
description: "审计论断与证据的对应关系：每个 claim 是否有支撑、表述强度是否与证据匹配，清除过度声明。"
metadata:
  version: 0.2.0
---

# Claim Evidence Audit

Treat the paper as a bidirectional evidence system. A claim needs support, and a major result needs a paper-level purpose.

Read [claim-strength.md](../../references/claim-strength.md), [review-severity.md](../../references/review-severity.md), and the relevant parts of [optimization-theory.md](../../references/optimization-theory.md) and [experiment-reporting.md](../../references/experiment-reporting.md).

## Build the internal claim ledger

For every major claim, record:

- exact wording and location
- claim type
- scope and qualifiers
- supporting theorem, proposition, experiment, figure, table, citation, or implementation evidence
- whether the support establishes, suggests, motivates, or merely co-occurs with the claim
- downstream repetitions in the abstract, introduction, contribution list, results, and conclusion

Trace both directions:

`paper-level claim -> result -> evidence`

`major theorem or experiment -> result -> paper-level claim`

## Forward checks

Flag:

- abstract claims absent from the body
- contribution claims stronger than theorem statements
- conclusions stronger or broader than experiments
- one-dataset observations described as general behavior
- scalable without a scaling experiment along the named dimension
- first or novel without verified literature support
- significantly without a statistical definition or test
- state-of-the-art without adequate comparable baselines
- empirical observations written as mathematical conclusions
- implementation behavior presented as an algorithmic guarantee
- interpretation presented as a proved mechanism

## Reverse checks

Flag major theorems, lemmas, experiments, tables, figures, or ablations that do not support an identifiable paper-level claim. Distinguish genuinely necessary technical support from correct but narratively orphaned material.

## Consistency checks

Compare numerical values, rates, problem classes, assumptions, stationarity notions, datasets, dimensions, and baseline sets wherever a claim is repeated. A weaker qualifier in one section does not license a stronger version elsewhere.

## Output

Summarize the supported story in a few direct sentences. Then report the highest-impact mismatches with exact anchors and the minimum correction. Separate unsupported claims, scope drift, category errors, numerical inconsistencies, and orphan results. Do not rewrite the paper unless requested.
