---
name: citation-management
description: "管理引用：BibTeX 生成与清洗、引用格式统一（APA/IEEE/GB）、文中引用与参考文献表一致性核对。"
argument-hint: [tex-or-bib-file]
---

# 引用管理

用于数学建模论文的引用收集、整理、核验和格式统一。

## 输入

- `$0`：`harvest`、`validate`、`add` 或 `format`
- `$1`：`.tex` 或 `.bib` 文件路径

## 常用检查

```bash
python resources/builtin-skills/citation-management/scripts/validate_citations.py \
  --tex paper/main.tex --bib paper/references.bib --check-figures --figures-dir paper/figures/
```

检查缺失引用、未使用条目、重复键、重复章节、重复标签、未定义引用和缺失图片。

## 生成 BibTeX

```bash
python resources/builtin-skills/deep-research/scripts/bibtex_manager.py \
  --jsonl paper_db.jsonl --output references.bib
```

检索公开文献时只使用可核验来源。API 密钥从运行环境变量 `S2_API_KEY` 读取，不要写入项目文件、脚本或日志。

```bash
python resources/builtin-skills/deep-research/scripts/search_semantic_scholar.py \
  --query "attention is all you need" --max-results 5 --api-key "${S2_API_KEY}"
```

## 收集缺失引用

```bash
python resources/builtin-skills/citation-management/scripts/harvest_citations.py \
  --tex paper/main.tex --bib paper/references.bib --output candidates.bib --max-rounds 10
```

候选条目必须逐条核验后才能并入正式 `.bib` 文件。

## 生成待核验清单

```bash
python resources/builtin-skills/citation-management/scripts/validate_citations.py \
  --tex paper/main.tex --bib paper/references.bib --fix
```

`--fix` 只生成 `references_missing.txt`，不会写入虚假的作者、标题、年份或占位 BibTeX。最终论文不得包含 `TODO`、`20XX`、空作者或无法核验的引用。

## 工作规则

- 不编造文献，不把搜索结果标题直接当作正式引用。
- 优先使用 DOI、出版社页面、期刊官网或公开数据库中的可核验记录。
- 引用键、正文引用和参考文献表必须在编译前统一检查。
- 对数学建模论文，数据来源、算法来源和外部公式都要分别标注。
- 生成候选引用后，必须运行 `verifying-bibliography` 再进入交付流程。

## 相关技能

- `literature-search`、`literature-review`、`deep-research`
- `verifying-bibliography`、`claim-evidence-audit`
- `latex-paper-audit`、`paper-page-fit`、`submission-package-audit`
