#!/usr/bin/env python3
"""轻量检查 LaTeX 表格是否存在明显的宽度风险。

它不替代编译和渲染，只负责在编译前把最容易导致右侧裁切的表格标出来。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

BEGIN = re.compile(r"\\begin\{(tabular\*?|tabularx|longtable|array)\}(?:\[.*?\])?\{([^}]*)\}")
END = re.compile(r"\\end\{(tabular\*?|tabularx|longtable|array)\}")
TEXT_COL = re.compile(r"[pmbX] *(?:\{[^}]+\}|\([^)]*\))")


def files_for(value: str) -> list[Path]:
    p = Path(value).expanduser()
    if p.is_file():
        return [p] if p.suffix.lower() in {".tex", ".ltx"} else []
    if p.is_dir():
        return sorted(x for x in p.rglob("*.tex") if all(part not in {"build", "out", ".git"} for part in x.parts))
    return []


def audit(path: Path) -> list[str]:
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    findings: list[str] = []
    active: tuple[int, str, str] | None = None
    for number, line in enumerate(lines, 1):
        if active is None:
            match = BEGIN.search(line)
            if not match:
                continue
            env, spec = match.groups()
            active = (number, env, spec)
            columns = len(re.findall(r"(?<!\\)[clrXSpmb]", spec))
            has_wrapping = bool(TEXT_COL.search(spec)) or env in {"tabularx", "longtable"}
            if env in {"tabular", "tabular*", "array"} and columns >= 7 and not has_wrapping:
                findings.append(f"{path}:{number}: {env} 约 {columns} 列且没有可换行列，优先拆表或改成 tabularx")
            if columns >= 9:
                findings.append(f"{path}:{number}: {env} 列数为 {columns}，很可能超过正文宽度，编译后必须渲染复核")
        elif END.search(line):
            active = None
    if active:
        findings.append(f"{path}:{active[0]}: 表格环境 {active[1]} 没有找到对应的结束标记")
    return findings


def main() -> int:
    if len(sys.argv) != 2:
        print("用法：py -3 check_table_layout.py <论文目录或 tex 文件>", file=sys.stderr)
        return 2
    files = files_for(sys.argv[1])
    if not files:
        print("没有找到 tex 文件")
        return 1
    findings = [item for file in files for item in audit(file)]
    if findings:
        print("发现需要人工确认的表格：")
        print("\n".join(f"- {item}" for item in findings))
        return 3
    print(f"已检查 {len(files)} 个 tex 文件，未发现明显的宽表风险；仍需渲染 PDF 做最终确认。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
