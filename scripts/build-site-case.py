"""Reproducible synthetic transportation case for the marketing screenshots."""
from pathlib import Path
import csv
import json
import sys
import numpy as np
from scipy.optimize import linprog
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root = Path(sys.argv[1]).resolve()
for folder in ['data', 'results', 'figures', 'code', 'paper']:
    (root / folder).mkdir(parents=True, exist_ok=True)
cost = np.array([[8, 19, 14, 23], [17, 7, 16, 12], [13, 18, 6, 15]], dtype=float)
capacity = np.array([500, 400, 350], dtype=float)
demand = np.array([420, 310, 260, 180], dtype=float)
depots = ['中心仓', '西部仓', '南部仓']
districts = ['东区', '西区', '南区', '北区']

def solve(scale=1):
    a_ub = np.zeros((3, 12))
    a_eq = np.zeros((4, 12))
    for i in range(3): a_ub[i, i*4:(i+1)*4] = 1
    for j in range(4): a_eq[j, j::4] = 1
    res = linprog(cost.ravel(), A_ub=a_ub, b_ub=capacity, A_eq=a_eq,
                  b_eq=demand*scale, bounds=(0, None), method='highs')
    return res

res = solve()
assert res.success
x = res.x.reshape(3, 4)
assert np.allclose(x.sum(axis=0), demand)
assert np.all(x.sum(axis=1) <= capacity + 1e-6)
# Baseline: allocate in district order from the first warehouse with stock.
stock = capacity.copy()
baseline = np.zeros_like(x)
for j in range(4):
    remaining = demand[j]
    for i in range(3):
        amount = min(stock[i], remaining)
        baseline[i, j] = amount
        stock[i] -= amount
        remaining -= amount
baseline_cost = float((baseline * cost).sum())
optimal_cost = float(res.fun)
reduction = (1 - optimal_cost / baseline_cost) * 100
rows = [(int(round((s-1)*100)), solve(s)) for s in np.arange(.90, 1.101, .025)]
metrics = {'synthetic': True, 'solver': 'scipy.optimize.linprog / HiGHS',
           'demand': int(demand.sum()), 'capacity': int(capacity.sum()),
           'baseline_cost': baseline_cost, 'optimal_cost': optimal_cost,
           'reduction_percent': round(reduction, 2), 'allocation': x.tolist(),
           'sensitivity': [{'change_percent': p, 'feasible': r.success,
                            'cost': float(r.fun) if r.success else None} for p, r in rows]}
(root/'results/metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding='utf-8')
with (root/'data/应急资源需求.csv').open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.writer(f); writer.writerow(['区域', '需求量', '优先级'])
    writer.writerows(zip(districts, demand.astype(int), [1,2,1,3]))
with (root/'data/运输距离.csv').open('w', encoding='utf-8-sig', newline='') as f:
    writer = csv.writer(f); writer.writerow(['仓库', *districts, '容量'])
    writer.writerows([[depots[i], *cost[i].astype(int), int(capacity[i])] for i in range(3)])
plt.rcParams.update({'font.sans-serif': ['Microsoft YaHei', 'SimHei', 'DejaVu Sans'],
                     'axes.unicode_minus': False, 'font.size': 11, 'svg.fonttype': 'none',
                     'axes.spines.top': False, 'axes.spines.right': False})
colors = ['#635bff', '#23b59b', '#f2af57']
fig, axs = plt.subplots(1, 3, figsize=(15, 4.8), layout='constrained')
fig.patch.set_facecolor('#fafaff')
bottom = np.zeros(4)
for i in range(3):
    axs[0].bar(districts, x[i], bottom=bottom, color=colors[i], label=depots[i], width=.55)
    bottom += x[i]
axs[0].set(title='各服务区资源分配', ylabel='物资单位'); axs[0].legend(frameon=False, ncol=3, fontsize=9)
axs[1].bar(['顺序分配基线', '线性规划'], [baseline_cost, optimal_cost], color=['#c2c1d4', colors[0]], width=.5)
axs[1].set(title=f'运输成本降低 {reduction:.1f}%', ylabel='单位 · km')
for j, value in enumerate([baseline_cost, optimal_cost]): axs[1].text(j, value+200, f'{value:,.0f}', ha='center')
feasible = [(p, r.fun) for p, r in rows if r.success]
axs[2].plot(*zip(*feasible), marker='o', color=colors[0], linewidth=2)
axs[2].axvline((capacity.sum()/demand.sum()-1)*100, color='#ed7864', linestyle='--', label='供给上限')
axs[2].set(title='需求扰动与可行性', xlabel='需求变化 (%)', ylabel='最优运输成本'); axs[2].legend(frameon=False, fontsize=9)
for ax in axs: ax.grid(axis='y', alpha=.12); ax.set_axisbelow(True)
fig.suptitle('城市应急资源调度 · 模型结果与稳健性分析', fontsize=17, fontweight='bold')
fig.savefig(root/'figures/模型结果.png', dpi=160)
fig.savefig(root/'figures/模型结果.svg')
plt.close(fig)
report = f'''# 城市应急资源调度 · 结果报告

> 教学演示案例。数据为合成数据，结果由本地 SciPy / HiGHS 实际求解，不代表真实城市或获奖结果。

## 求解结果

| 核验项 | 结果 |
| --- | --- |
| 总需求 / 可用供给 | 1,170 / 1,250 单位 |
| 顺序分配基线 | {baseline_cost:,.0f} 单位·km |
| 线性规划最优值 | {optimal_cost:,.0f} 单位·km |
| 运输成本改善 | {reduction:.2f}% |
| 需求满足 / 容量约束 | 全部通过 |

![模型结果](../figures/模型结果.png)

## 灵敏度与适用边界

需求增加 5% 时仍然可行；总需求增加超过 6.84% 后超过供给容量。需求增加 10% 时不可行，需要补充仓储供给或允许缺口。当前目标仅衡量运输量与距离，不能直接解释为实际到达时间。

## 复算入口

运行 `python code/solver.py .`。原始数据位于 data，结构化输出位于 results/metrics.json，图表位于 figures。
'''
(root/'模型结果报告.md').write_text(report, encoding='utf-8')
(root/'建模路线.md').write_text('''# 城市应急资源调度 · 技术路线

> 教学演示 · 合成数据 · 完整建模过程

```mermaid
flowchart LR
 A[赛题与约束] --> B[数据体检]
 B --> C[基线方案]
 B --> D[线性规划]
 C --> E[结果比较]
 D --> E
 E --> F[灵敏度分析]
 F --> G{容量是否满足}
 G -->|满足| H[论文与图表]
 G -->|不满足| I[补充供给方案]
 I --> D
 H --> J[复算与交付]
```

## 从输入到交付

三座仓库、四个服务区，以运输量 × 距离为目标函数，同时满足区域需求和仓储容量。保留不可行场景，避免只展示有利结论。
''', encoding='utf-8')
(root/'题目说明.md').write_text('''# 城市应急资源调度

> 官网教学演示案例，使用合成数据。

三座仓库需要为四个应急服务区配送物资。在满足各区需求与仓库容量约束的前提下，降低总运输成本。

## 三个研究问题

1. 怎样定义决策变量、目标函数与供需约束？
2. 优化方案相对顺序分配基线能改善多少？
3. 需求变化后，方案何时失去可行性？

## 已准备的材料

data/需求与距离数据；code/solver.py 求解脚本；figures/模型结果.png 科研图表；results/metrics.json 数值结果；建模路线.md 技术流程图。
''', encoding='utf-8')
print(json.dumps(metrics, ensure_ascii=False))
