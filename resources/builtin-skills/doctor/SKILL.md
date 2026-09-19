---
name: doctor
description: MModels 数学建模环境检查与安装向导。仅当用户明确要求“环境检查”“doctor”“检查依赖”“修复数学建模环境”或安装论文/绘图依赖时使用。检查 CUMCM LaTeX、Python 科学计算、科研绘图工具链与 Git，默认使用中国大陆可用的可信镜像安装缺失项，并只在用户明确确认后执行安装。
allowed-tools: Bash(*), Read, AskUserQuestion
---

# Doctor — 数学建模环境检查与安装向导

只在用户明确触发时运行。先做只读检测，再报告；安装任何内容前都必须获得用户确认。

## 范围

- 检查本机论文、绘图与版本存档工具链。不检查 API Key、模型供应商或网络连通性。
- **Git 只管「装没装」。** 缺失时按 `references/install.md` 引导安装，装完只跑
  `git --version` 复检。不要 `git init`、不要提交/推送、不要改动仓库内容，
  不要修改用户的 `git config`（用户名、邮箱、凭据、代理一律不碰）。
- 不把可选项缺失判定为核心环境不可用。
- 不静默安装，不静默创建虚拟环境，不修改系统 Python。

## 检查分级

### 必需项

| 项目 | 用途 |
| --- | --- |
| Python 3 | 建模求解与绘图脚本 |
| `git` | MModels 的本地项目版本存档与回合快照恢复 |
| `xelatex` | `mma-paper` 的 CUMCM 中文 LaTeX 模板 |
| `latexmk` | 论文自动多轮编译 |
| `bibtex` | 参考文献编译 |
| `numpy`, `scipy`, `pandas` | 数值计算、优化与数据处理 |
| `matplotlib`, `seaborn`, `python-dateutil` | 内置绘图模板与科研图 |

### 建议项

| 项目 | 用途 |
| --- | --- |
| `uv` | Python、虚拟环境与依赖管理；MModels 安装包通常自带 |
| `drawio` / `draw.io` | 技术路线图与流程图导出 |
| `pdftoppm` / `mutool` / `magick` 任一 | PDF 转图片后的视觉检查 |
| 可用中文字体 | SimSun、STSong、Songti SC 或 Noto Serif CJK SC |

### 按需项

- `typst`：用户选择 Typst 论文工作流时。
- `Rscript`：用户在 `nature-figure` 中明确选择 R 时。
- `dot`：使用 Graphviz 时。
- 地理空间绘图模板：`cartopy`, `shapely`。
- Python 扩展包：`scikit-learn`, `openpyxl`, `plotnine`, `plotly`, `networkx`,
  `shap`, `optuna`, `geopandas`, `folium`, `graphviz`, `wordcloud`。

## 工作流

### 1. 确定本机共用的 Python

所有项目默认共用软件环境，不因切换项目重复安装。优先使用软件共用解释器，尚未创建时复用本机 Python。已有系统工具留在原处，不复制或迁移。

```bash
if [ -n "$MMODELS_SHARED_PYTHON" ] && [ -x "$MMODELS_SHARED_PYTHON" ]; then
  PYTHON="$MMODELS_SHARED_PYTHON"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  echo "MISS python"
fi
```

Windows 上 shell 为 PowerShell 时用等价探测（后续命令中 `"$PYTHON"` 同样换成
PowerShell 变量写法）：

```powershell
if ($env:MMODELS_SHARED_PYTHON -and (Test-Path -LiteralPath $env:MMODELS_SHARED_PYTHON)) { $PYTHON = $env:MMODELS_SHARED_PYTHON }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $PYTHON = "python" }
elseif (Get-Command python3 -ErrorAction SilentlyContinue) { $PYTHON = "python3" }
else { Write-Output "MISS python" }
```

如果没有 Python，先报告这一项，继续用 `command -v`（PowerShell 用 `Get-Command`）
检查 LaTeX 和建议工具；不要尝试运行 Python 检查脚本。

### 2. 运行结构化检查

定位本 Skill 所在目录，也就是包含本 `SKILL.md` 的 `doctor` 目录，然后运行：

```bash
"$PYTHON" "<doctor-skill-directory>/scripts/check_environment.py"
```

脚本只读取命令路径、当前 Python 包和字体信息，不安装、不联网、不修改配置。

### 3. 按工作流解释结果

- `summary.coreReady=true`：CUMCM LaTeX + Python 核心环境可用。
- `missingRequired`：必须修复，否则论文编译或内置绘图流程会中断。
- `missingRecommended`：展示影响，但不要阻断核心工作流。
- `optional`：只有用户明确要用对应功能时才建议安装。
- `fonts.installed=false`：提醒中文图表可能出现方框；不要仅凭字体名称假定可用。

用户只选择 Python 绘图时，不要求 R；用户只写 LaTeX 论文时，不要求 Typst。

### 4. 输出简洁报告

按以下格式汇总，不粘贴整段 JSON：

```text
Doctor 检查完成（macOS arm64）

核心环境：未就绪
✓ Python 3.12.x
✗ xelatex — CUMCM 中文论文无法编译
✓ numpy 2.x
✗ scipy — 优化与科学计算不可用

建议项：DrawIO 缺失；PDF 预览可用（pdftoppm）
按需项：R 未安装（不影响当前 Python 工作流）
```

面向用户只说“正在做什么、结果怎样、下一步是什么”。不要主动展示 PATH、MSI、
退出码、下载速度、参数或整段日志。可恢复的超时和单步失败说“正在重试”或
“正在换一种办法”，只有确定是 MModels 自身故障时才使用“软件错误”。诊断细节保留，
仅在用户主动排查或所有重试都失败时给出关键几行。

### 5. 默认使用国内镜像

首次安装一律先用 [`references/install.md`](references/install.md) 的“中国大陆网络环境
（默认）”方案，不需要先等待官方源超时。只使用文档列出的可信镜像或加速方式：

- Python 包与 uv：清华 TUNA，失败后换阿里云；
- Python 运行时与 GitHub Release：使用文档中的国内加速，并校验官方哈希或签名；
- Git for Windows：npmmirror；
- LaTeX：清华 TUNA CTAN；
- Linux 系统包：沿用用户已经配置的发行版镜像。

国内镜像不可用时，自动换下一个可信镜像；都不可用才回退官方源。切换过程中只用一句
“当前下载较慢，正在换一种方式”告知用户，不逐次贴网络错误。DrawIO 没有官方国内镜像，
必须先从 winget 清单取得官方安装地址与 SHA256，再通过国内加速下载并校验哈希和发布者
签名；无法完成校验时不得安装，改用官方 winget 作为退路。

### 6. 安装前询问

先用通俗中文说明将安装哪些项目、约需多少空间、是否需要管理员权限，再用
`AskUserQuestion` 询问一次：

- `立即安装必需项（Recommended）`
- `只显示安装命令`
- `暂不处理`

用户没有明确选择“立即安装”时，只能显示命令。安装命令见
[`references/install.md`](references/install.md)。不要默认安装全部可选绘图库。
如果用户已经在 MModels“让 Agent 配置”确认框中同意，或当前消息明确说“安装/修复”，
这就算已经确认，不要再问一次。

### 7. 安装与复检

- 已安装且可用的解释器、库和工具直接复用；只补本次任务缺失项。
- 仅在缺库且安装已授权时，按 `references/install.md` 建立一次软件共用环境，复用系统包；不默认创建项目 `.venv`，不对系统 Python 执行全局 `pip install`。
- 各子智能体沿用同一解释器；新增依赖交给主助手串行安装，不并发修改环境。
- 不用 `uv sync` 清理共用环境，不自动升级/降级现有依赖。版本冲突时先解释，再由用户选择隔离环境。
- 保留旧项目环境，不自动删除或搬动；后续不再按项目重装。软件共用目录取 `MMODELS_RUNTIME_ROOT`，不使用免安装包的临时解压目录。
- 系统包安装可能请求管理员权限；执行前明确说明。
- 每类安装完成后复检。可恢复失败先按镜像顺序重试；所有可信来源都失败后才用通俗中文
  说明未完成项，原始错误只保留为可选详情。
- 安装完成后，用同一个 Python 解释器重新运行 `scripts/check_environment.py`。
- **Windows 复检要当心 PATH 快照**：安装器把新目录写进注册表后，当前已运行的
  shell 与 agent 进程仍是旧 PATH，`git`、`xelatex` 直接敲会「找不到」，看起来
  像装失败。这时用绝对路径复检（例如 `& "C:\Program Files\Git\cmd\git.exe" --version`），
  并告诉用户 MModels「设置 → 运行环境」点「重新检查」即可识别，不必重启电脑。
- **DrawIO 不依赖 PATH**：同时检查 `drawio`、`draw.io` 与
  `%LOCALAPPDATA%\Programs\draw.io\draw.io.exe`。标准目录存在且可执行就算通过，
  不要为了迎合命令名额外创建转发脚本。
- 只有复检通过后才能声称环境已就绪。

## R 后端补充检查

仅当用户已选择 R 时执行：

```bash
Rscript -e 'pkgs <- c("ggplot2","patchwork","ggrepel","svglite","ragg"); for (p in pkgs) cat(if (requireNamespace(p, quietly=TRUE)) "OK" else "MISS", p, "\n")'
```

`ComplexHeatmap` 来自 Bioconductor，单独报告，不要与 CRAN 包混装或静默安装。
