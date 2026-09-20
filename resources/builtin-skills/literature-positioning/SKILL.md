---
name: literature-positioning
description: "基于文献梳理研究定位：相关工作对比、差异点与创新点表述，撰写引言与相关工作章时使用。"
metadata:
  version: 0.2.0
---

# Literature Positioning

Identify the precise technical gap without turning related work into a paper-by-paper catalog.

## Evidence rule

Verify citations and technical characterizations from primary sources whenever access is available. Do not generate titles, authors, venues, years, theorems, or citation keys from memory. Mark inaccessible claims as unverified.

Read [literature-positioning.md](../../references/literature-positioning.md), [claim-strength.md](../../references/claim-strength.md), and [writing-style.md](../../references/writing-style.md).

## Workflow

1. Define the exact technical axis on which the paper claims a difference.
2. Identify the closest papers before expanding to broader families.
3. Cluster work by methodological family rather than chronology or author.
4. Extract each family's problem class, assumptions, oracle model, algorithm structure, guarantee, stationarity notion, and empirical regime.
5. Separate direct comparisons from comparisons that change more than one axis.
6. Map agreements, contradictions, and unresolved gaps.
7. Formulate the smallest verified gap filled by the paper.
8. Draft thematic prose or a comparison matrix only after the evidence map is stable.

For optimization, compare constrained versus unconstrained, continuous versus discrete, convex versus nonconvex, exact versus approximate lower-level solutions, first-order versus second-order access, single-loop versus nested methods, value-function versus implicit-differentiation versus penalty approaches, deterministic versus stochastic settings, asymptotic convergence versus finite-time complexity, stationarity notions, oracle types, and oracle counts.

## Boundaries

- Do not rank papers by citation count as a substitute for technical relevance.
- Do not claim apples-to-apples improvement when the assumptions, oracle, criterion, or problem class differ.
- Do not manufacture a gap by omitting the closest work.
- Do not perform a PRISMA workflow unless the user separately requests a systematic review.
- Do not draft generic praise or dismissal of prior work.

## Output

Provide the technical comparison basis, the closest-work synthesis, the verified gap, and unresolved citation questions. If prose is requested, organize it by methodological family and state the paper's delta in technical terms.
