---
name: paper-writing
description: "学术论文字级写作纪律：章节结构、段落论证、学术措辞与句式规范，用于提升论文写作质量。"
metadata:
  version: 0.2.0
---

# Paper Writing

Write direct, technically specific prose whose claim strength matches the available evidence.

## Establish the task

Infer what is available before asking questions. Identify:

- the target section and its function
- the venue or format when it affects the writing
- the technical contribution and intended scope
- the authoritative equations, theorems, algorithms, results, tables, and citations
- whether the user wants drafting, revision, compression, or structural advice

Do not invent missing mathematics, empirical results, citations, novelty claims, or implementation details. If a missing fact changes the substance, mark the gap or ask for it.

## Read the relevant references

Always read [writing-style.md](../../references/writing-style.md) and [claim-strength.md](../../references/claim-strength.md) before generating prose.

Then read only what the task needs:

- section drafting or revision: [paper-sections.md](../../references/paper-sections.md)
- assumptions, reformulations, algorithms, theorems, proofs, or complexity: [optimization-theory.md](../../references/optimization-theory.md)
- experiments or results prose: [experiment-reporting.md](../../references/experiment-reporting.md)
- related work or novelty positioning: [literature-positioning.md](../../references/literature-positioning.md)
- venue-sensitive choices: [venue-notes.md](../../references/venue-notes.md)
- rebuttals or response letters: [rebuttals.md](../../references/rebuttals.md)

## Draft from technical content

1. Identify the paragraph or section function.
2. State the narrowest claim that captures the contribution.
3. Attach the supporting theorem, derivation, experiment, citation, or design fact.
4. Separate the claim from interpretation or motivation when they rely on different support.
5. Place definitions and assumptions before the first step that uses them.
6. Check consistency with the abstract, introduction, algorithms, results, and conclusion when those artifacts are available.
7. Apply a final style and claim-strength pass to the exact text being delivered.

For optimization papers, preserve the chain from problem setup through assumptions, reformulation or method, supporting lemmas, convergence, and oracle complexity. State which stationarity or optimality notion is obtained. Distinguish exact and approximate subproblem solutions. Distinguish iteration counts from gradient, stochastic first-order, linear-optimization, Hessian-vector, and lower-level oracle counts.

## Writing boundaries

- Prefer what the paper establishes over discussion of imagined objections.
- State assumptions by their mathematical role. Do not apologize for them.
- Do not create a limitations paragraph unless the venue requires one or a real boundary needs explanation.
- Do not turn observations into theorems, interpretations into facts, or implementation choices into general principles.
- Do not write contributions as promotional slogans.
- Do not impose a fixed number of sentences, contributions, theorems, or pages.
- Do not add a paper roadmap unless the user or venue requires it.

When the request is to diagnose rather than rewrite, report the issue and a revision direction. Do not silently replace the user's prose.
