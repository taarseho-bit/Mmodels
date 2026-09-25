#!/usr/bin/env python3
"""把数学建模的“题目—模型—求解—验证”证据链画成可编辑 draw.io 图。

模板不是课题申请书的装饰路线图，而是论文中能解释“问题如何被解决”的主流程。
内容 JSON 只需要提供 steps 和 edges；layout 用于选择问题流程、模型结构、优化决策或验证闭环。
"""
from __future__ import annotations

import argparse
import html
import json
import pathlib
import sys
from typing import Any

W, H = 1400, 900
FONT = 'Microsoft YaHei,PingFang SC,Hiragino Sans GB,Helvetica'
INK = '#253047'
PALE = {
    'input': ('#e8f2ff', '#3b82f6'),
    'model': ('#f1ecff', '#7c3aed'),
    'solve': ('#e9f8f1', '#059669'),
    'check': ('#fff4df', '#d97706'),
    'output': ('#fcecef', '#db2777'),
    'neutral': ('#f5f7fb', '#64748b'),
}


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def lines(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(x) for x in value]
    return str(value or '').split('\\n')


def text(value: Any) -> str:
    return '&lt;br&gt;'.join(esc(x) for x in lines(value))


def cell(cid: str, value: str, x: float, y: float, w: float, h: float,
         fill: str, stroke: str, *, bold: bool = False, fs: int = 16,
         rounded: bool = True) -> str:
    shape = f'rounded=1;arcSize=14;' if rounded else ''
    style = (
        f'{shape}whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};'
        f'strokeWidth=1.8;fontSize={fs};fontStyle={1 if bold else 0};'
        f'fontColor={INK};fontFamily={FONT};align=center;verticalAlign=middle;'
        'spacingLeft=10;spacingRight=10;spacingTop=6;spacingBottom=6;'
    )
    return (f'<mxCell id="{esc(cid)}" value="{value}" style="{style}" vertex="1" parent="1">'
            f'<mxGeometry x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" as="geometry" />'
            '</mxCell>')


def edge(eid: str, source: str, target: str, label: str = '', *, dashed: bool = False) -> str:
    style = ('edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;'
             'html=1;strokeWidth=2;endArrow=block;endFill=1;strokeColor=#64748b;')
    if dashed:
        style += 'dashed=1;dashPattern=7 5;'
    return (f'<mxCell id="{esc(eid)}" value="{text(label)}" style="{style}" edge="1" '
            f'parent="1" source="{esc(source)}" target="{esc(target)}">'
            '<mxGeometry relative="1" as="geometry" /></mxCell>')


def positions(layout: str, count: int) -> list[tuple[float, float]]:
    if layout == 'model-architecture':
        base = [(75, 355), (345, 355), (615, 355), (885, 355), (1155, 355),
                (365, 130), (905, 610), (635, 130)]
    elif layout == 'optimization-decision':
        base = [(75, 180), (345, 180), (615, 180), (885, 180), (1155, 180),
                (635, 500), (905, 500), (365, 500)]
    elif layout == 'validation-loop':
        base = [(560, 155), (930, 300), (930, 560), (560, 690),
                (190, 560), (190, 300), (560, 430), (930, 155)]
    else:  # problem-flow：两行主流程，避免一条横线拉到底
        base = [(80, 180), (390, 180), (700, 180), (1010, 180),
                (1010, 500), (700, 500), (390, 500), (80, 500)]
    return base[:count]


def build(content: dict[str, Any], theme: str) -> str:
    layout = str(content.get('layout', 'problem-flow'))
    steps = content.get('steps') or []
    if not isinstance(steps, list) or not steps:
        raise SystemExit('content JSON 至少需要一个 steps 数组')
    if len(steps) > 8:
        raise SystemExit('建模流程图最多 8 个步骤，请合并重复环节后再画')
    coords = positions(layout, len(steps))
    if len(coords) != len(steps):
        raise SystemExit('当前版式无法容纳这些步骤，请减少步骤或改用分问图')

    palette = PALE if theme == 'color' else {
        key: ('#ffffff', '#4b5563') for key in PALE
    }
    cells: list[str] = []
    title = content.get('title', '数学建模求解流程')
    subtitle = content.get('subtitle', '每个箭头都应对应一份数据、公式、代码或验证证据')
    cells.append(cell('title', text(title), 70, 25, 1260, 54, '#ffffff', '#cbd5e1', bold=True, fs=24))
    cells.append(cell('subtitle', text(subtitle), 180, 84, 1040, 36, '#ffffff', '#ffffff', fs=13))

    ids: list[str] = []
    for i, step in enumerate(steps):
        if not isinstance(step, dict):
            raise SystemExit(f'steps[{i}] 必须是对象')
        sid = str(step.get('id', f'step-{i + 1}'))
        ids.append(sid)
        x, y = coords[i]
        kind = str(step.get('kind', 'neutral'))
        fill, stroke = palette.get(kind, palette['neutral'])
        label = step.get('title', sid)
        detail = step.get('detail', '')
        value = text(f'{label}\\n{detail}' if detail else label)
        cells.append(cell(sid, value, x, y, 230, 130, fill, stroke, bold=True, fs=16))

    for i, item in enumerate(content.get('edges') or []):
        if not isinstance(item, dict):
            continue
        source, target = str(item.get('from', '')), str(item.get('to', ''))
        if source not in ids or target not in ids:
            raise SystemExit(f'连接 {source} → {target} 指向了不存在的步骤')
        cells.append(edge(f'edge-{i}', source, target, str(item.get('label', '')), dashed=bool(item.get('dashed'))))

    if content.get('loop'):
        loop = content['loop']
        cells.append(edge('loop', str(loop.get('from')), str(loop.get('to')), str(loop.get('label', '未通过：修正模型')), dashed=True))

    legend = content.get('legend') or '实线：主流程　虚线：验证不通过时回到模型修正'
    cells.append(cell('legend', text(legend), 260, 845, 880, 32, '#ffffff', '#ffffff', fs=12))
    return ('<mxfile host="app.diagrams.net" agent="MModels" version="24.7.17" pages="1">\n'
            f'  <diagram id="modeling-flow" name="{esc(title)}">\n'
            f'    <mxGraphModel dx="{W}" dy="{H}" grid="0" gridSize="10" guides="1" '
            f'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{W}" pageHeight="{H}" '
            'math="0" shadow="0">\n      <root>\n        <mxCell id="0" />\n'
            '        <mxCell id="1" parent="0" />\n' + '\n'.join(cells) +
            '\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n')


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description='生成数学建模问题流程/模型结构/验证闭环图')
    ap.add_argument('content')
    ap.add_argument('-o', '--out')
    ap.add_argument('--theme', choices=('mono', 'color'), default='mono')
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    content = json.loads(pathlib.Path(args.content).read_text(encoding='utf-8'))
    xml = build(content, args.theme)
    if args.check:
        print('✓ 建模流程内容检查通过')
        return
    out = pathlib.Path(args.out or pathlib.Path(args.content).with_suffix('.drawio'))
    out.write_text(xml, encoding='utf-8')
    print(f'✓ 已写出 {out}')


if __name__ == '__main__':
    main()
