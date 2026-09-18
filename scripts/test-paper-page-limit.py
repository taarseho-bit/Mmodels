from __future__ import annotations

import importlib.util
from pathlib import Path


SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "resources"
    / "builtin-skills"
    / "paper-page-fit"
    / "scripts"
    / "check_page_limit.py"
)
SPEC = importlib.util.spec_from_file_location("check_page_limit", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_infer_body_range_with_contents_and_references() -> None:
    pages = [
        "论文标题\n摘要",
        "目 录\n1 问题重述 ...... 3",
        "一、问题重述\n题目要求如下",
        "模型建立\n公式与结果",
        "参考文献\n[1] ...",
        "附录 A\n代码",
    ]
    assert MODULE.infer_body_range(pages, len(pages)) == (3, 4, "high")


def test_infer_body_range_falls_back_after_contents() -> None:
    pages = ["封面", "目录", "模型正文", "结论"]
    assert MODULE.infer_body_range(pages, len(pages)) == (3, 4, "medium")


if __name__ == "__main__":
    test_infer_body_range_with_contents_and_references()
    test_infer_body_range_falls_back_after_contents()
    print("2 tests passed")
