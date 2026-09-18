#!/usr/bin/env python3
"""Prepare a PDF for fast, repeatable paper review using only bundled system tools."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


VISUAL_MARKERS = re.compile(
    r"(?:^|\s)(?:图|表)\s*[0-9一二三四五六七八九十]+|\b(?:figure|fig\.?|table)\s*\d+",
    re.IGNORECASE | re.MULTILINE,
)


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")


def cache_dir(pdf: Path) -> Path:
    stat = pdf.stat()
    signature = hashlib.sha256(
        f"{pdf.resolve()}|{stat.st_size}|{stat.st_mtime_ns}".encode("utf-8")
    ).hexdigest()[:16]
    # Older Windows Poppler builds cannot write to a Unicode output path.
    return Path(tempfile.gettempdir()) / "MModels" / "pdf-review" / f"paper-{signature}"


def pdf_metadata(pdf: Path) -> tuple[dict[str, str], int]:
    tool = shutil.which("pdfinfo")
    if not tool:
        return {}, 0
    result = run([tool, str(pdf)])
    if result.returncode != 0:
        return {}, 0
    metadata: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    try:
        pages = int(metadata.get("Pages", "0"))
    except ValueError:
        pages = 0
    return metadata, pages


def extract_text(pdf: Path, output: Path) -> str:
    pdftotext = shutil.which("pdftotext")
    if pdftotext:
        result = run([pdftotext, "-layout", "-enc", "UTF-8", str(pdf), str(output)])
        if result.returncode == 0 and output.exists():
            return "pdftotext"

    mutool = shutil.which("mutool")
    if mutool:
        result = run([mutool, "draw", "-F", "txt", "-o", str(output), str(pdf)])
        if result.returncode == 0 and output.exists():
            return "mutool"

    raise RuntimeError("没有找到可用的 PDF 文字读取工具")


def split_pages(text: str, expected_pages: int) -> list[str]:
    pages = text.split("\f")
    while pages and not pages[-1].strip():
        pages.pop()
    if expected_pages and len(pages) < expected_pages:
        pages.extend([""] * (expected_pages - len(pages)))
    return pages


def build_manifest(pdf: Path, output_dir: Path) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    pages_dir = output_dir / "pages"
    pages_dir.mkdir(exist_ok=True)
    metadata, expected_pages = pdf_metadata(pdf)
    full_text_path = output_dir / "paper.txt"
    extractor = extract_text(pdf, full_text_path)
    pages = split_pages(full_text_path.read_text(encoding="utf-8", errors="replace"), expected_pages)

    page_items: list[dict[str, object]] = []
    visual_pages: list[int] = []
    for index, page_text in enumerate(pages, start=1):
        page_path = pages_dir / f"page-{index:03d}.txt"
        page_path.write_text(page_text.strip() + "\n", encoding="utf-8")
        compact_length = len(re.sub(r"\s+", "", page_text))
        reasons: list[str] = []
        if index <= 2:
            reasons.append("封面或摘要")
        if VISUAL_MARKERS.search(page_text):
            reasons.append("包含图表")
        if compact_length < 80:
            reasons.append("文字较少，可能需要看原页")
        if index == len(pages):
            reasons.append("末页或附录")
        if reasons:
            visual_pages.append(index)
        page_items.append(
            {
                "page": index,
                "textPath": str(page_path),
                "characters": compact_length,
                "visualReasons": reasons,
            }
        )

    return {
        "source": str(pdf.resolve()),
        "cacheDir": str(output_dir.resolve()),
        "textPath": str(full_text_path.resolve()),
        "textExtractor": extractor,
        "pageCount": len(pages),
        "metadata": metadata,
        "suggestedVisualPages": visual_pages,
        "pages": page_items,
    }


def parse_pages(value: str, page_count: int) -> list[int]:
    selected: set[int] = set()
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start, end = int(start_text), int(end_text)
            selected.update(range(min(start, end), max(start, end) + 1))
        else:
            selected.add(int(part))
    return sorted(page for page in selected if 1 <= page <= page_count)


def render_pages(pdf: Path, output_dir: Path, pages: list[int]) -> list[str]:
    image_dir = output_dir / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    pdftoppm = shutil.which("pdftoppm")
    mutool = shutil.which("mutool")
    rendered: list[str] = []
    for page in pages:
        target = image_dir / f"page-{page:03d}.png"
        if target.exists():
            rendered.append(str(target.resolve()))
            continue
        if pdftoppm:
            prefix = image_dir / f"page-{page:03d}"
            result = run(
                [pdftoppm, "-f", str(page), "-l", str(page), "-r", "110", "-singlefile", "-png", str(pdf), str(prefix)]
            )
        elif mutool:
            result = run([mutool, "draw", "-r", "110", "-o", str(target), str(pdf), str(page)])
        else:
            raise RuntimeError("没有找到可用的 PDF 页面渲染工具")
        if result.returncode != 0 or not target.exists():
            raise RuntimeError(f"第 {page} 页准备失败")
        rendered.append(str(target.resolve()))
    return rendered


def main() -> int:
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="为论文评审准备按页文本与必要的页面图片")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--render", help="需要转成图片的页码，例如 1,2,6-9")
    args = parser.parse_args()

    pdf = args.pdf.expanduser().resolve()
    if not pdf.is_file() or pdf.suffix.lower() != ".pdf":
        raise SystemExit("请提供存在的 PDF 文件")

    output_dir = args.output.expanduser().resolve() if args.output else cache_dir(pdf)
    manifest_path = output_dir / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest = build_manifest(pdf, output_dir)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.render:
        pages = parse_pages(args.render, int(manifest.get("pageCount", 0)))
        manifest["renderedImages"] = render_pages(pdf, output_dir, pages)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"论文已准备好：{manifest.get('pageCount', 0)} 页，后续会直接复用，不重复转换。")
    print(str(manifest_path.resolve()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
