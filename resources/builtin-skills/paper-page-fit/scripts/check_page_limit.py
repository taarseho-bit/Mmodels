#!/usr/bin/env python3
"""Count total or body pages in a contest-paper PDF."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


def run_text(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, check=False)
    if result.returncode != 0:
        return ""
    return result.stdout.decode("utf-8", errors="replace")


def total_pages(pdf: Path) -> int:
    pdfinfo = shutil.which("pdfinfo")
    if pdfinfo:
        text = run_text([pdfinfo, str(pdf)])
        match = re.search(r"^Pages:\s*(\d+)\s*$", text, re.MULTILINE | re.IGNORECASE)
        if match:
            return int(match.group(1))
    for module_name in ("pypdf", "PyPDF2"):
        try:
            module = __import__(module_name)
            return len(module.PdfReader(str(pdf)).pages)
        except (ImportError, OSError, ValueError):
            continue
    raise RuntimeError("无法读取 PDF 页数，请先安装或修复 pdfinfo")


def page_texts(pdf: Path, pages: int) -> list[str] | None:
    pdftotext = shutil.which("pdftotext")
    if not pdftotext:
        return None
    out: list[str] = []
    for page in range(1, pages + 1):
        out.append(
            run_text(
                [pdftotext, "-f", str(page), "-l", str(page), "-layout", "-enc", "UTF-8", str(pdf), "-"]
            )
        )
    return out


def heading_on_page(text: str, patterns: tuple[re.Pattern[str], ...]) -> bool:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    return any(pattern.fullmatch(line) for pattern in patterns for line in lines if line)


START_HEADINGS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"(?:第?[一二三四五六七八九十1-9][、.． ]*)?问题重述",
        r"(?:第?[一二三四五六七八九十1-9][、.． ]*)?问题分析",
        r"(?:1(?:\.\d+)?[. ]*)?introduction",
        r"(?:1(?:\.\d+)?[. ]*)?problem restatement",
    )
)
END_HEADINGS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"参考文献",
        r"references",
        r"附录(?:[ A-Z一二三四五六七八九十]*)?",
        r"appendix(?:[ A-Z0-9]*)?",
        r"AI(?:工具)?使用(?:情况)?说明",
    )
)
CONTENTS = re.compile(r"^(?:目\s*录|contents)$", re.IGNORECASE)


def infer_body_range(texts: list[str], pages: int) -> tuple[int, int, str]:
    contents_pages = [
        index + 1
        for index, text in enumerate(texts)
        if heading_on_page(text, (CONTENTS,))
    ]
    after = max(contents_pages, default=0)
    starts = [
        index + 1
        for index, text in enumerate(texts)
        if index + 1 > after and heading_on_page(text, START_HEADINGS)
    ]
    start = starts[0] if starts else max(1, after + 1)
    ends = [
        index + 1
        for index, text in enumerate(texts)
        if index + 1 > start and heading_on_page(text, END_HEADINGS)
    ]
    end = (ends[0] - 1) if ends else pages
    confidence = "high" if starts and ends else "medium" if starts or contents_pages else "low"
    return start, max(start, end), confidence


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="检查数学建模论文页数上限")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--max-pages", type=int, required=True)
    parser.add_argument("--scope", choices=("body", "total"), default="body")
    parser.add_argument("--start-page", type=int)
    parser.add_argument("--end-page", type=int)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.pdf.is_file() or args.max_pages < 1:
        print("PDF 不存在，或页数上限无效", file=sys.stderr)
        return 1
    try:
        pages = total_pages(args.pdf)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1

    confidence = "exact"
    if args.scope == "total":
        start, end = 1, pages
    else:
        start, end = args.start_page, args.end_page
        if start is None or end is None:
            texts = page_texts(args.pdf, pages)
            if texts is None:
                print("正文模式需要填写起止页，或提供 pdftotext 用于自动识别", file=sys.stderr)
                return 3
            inferred_start, inferred_end, confidence = infer_body_range(texts, pages)
            start = start or inferred_start
            end = end or inferred_end

    if start < 1 or end < start or end > pages:
        print(f"计页范围无效：PDF 共 {pages} 页，当前范围为 {start}-{end}", file=sys.stderr)
        return 1

    counted = end - start + 1
    over_by = max(0, counted - args.max_pages)
    needs_confirmation = args.scope == "body" and confidence in {"low", "medium"} and (
        args.start_page is None or args.end_page is None
    )
    status = "needs-confirmation" if needs_confirmation else "over" if over_by else "pass"
    result = {
        "status": status,
        "scope": args.scope,
        "totalPages": pages,
        "startPage": start,
        "endPage": end,
        "countedPages": counted,
        "maxPages": args.max_pages,
        "overBy": over_by,
        "confidence": confidence,
    }
    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        label = "整份 PDF" if args.scope == "total" else f"正文第 {start}-{end} 页"
        verdict = "符合要求" if over_by == 0 else f"超出 {over_by} 页"
        print(f"{label}：计入 {counted} 页，上限 {args.max_pages} 页，{verdict}")
        if needs_confirmation:
            print("正文起止页为自动识别结果，请核对后再定稿")
    if needs_confirmation:
        return 3
    return 2 if over_by else 0


if __name__ == "__main__":
    raise SystemExit(main())
