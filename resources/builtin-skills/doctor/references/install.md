# 安装命令参考

只为检测到的缺失项生成命令。执行前展示完整命令、预计下载体积以及是否需要管理员权限，等待用户明确确认。

首次安装默认使用文末“中国大陆网络环境（默认）”一节。国内镜像不可用时再回退本节
列出的官方源命令，不要先等待官方源超时。

## Python 与项目环境

优先使用 MModels 自带或 PATH 中的 `uv`：

```bash
uv python install
uv venv .venv
uv pip install --python .venv/bin/python numpy scipy pandas matplotlib seaborn python-dateutil
```

Windows 项目的解释器路径改为 `.venv\Scripts\python.exe`。如果项目已经有虚拟环境，复用它，不要重新创建。

扩展包只按实际任务安装：

```bash
uv pip install --python .venv/bin/python cartopy shapely scikit-learn openpyxl plotnine plotly networkx shap optuna geopandas folium graphviz wordcloud
```

如果 `uv` 不可用，优先引导用户从 MModels“设置 → Environment”安装托管 Python。除非用户明确要求，不对系统 Python 执行全局 `pip install`。

## Git

MModels 的项目版本存档与回合快照恢复依赖本机 Git，缺失会阻断这些能力。
只装二进制；不要初始化仓库，也不要写用户的 `git config`。

- **macOS**：`brew install git`；没有 Homebrew 时用 `xcode-select --install`
  （装 Xcode 命令行工具，同时带上 git，约 1-2GB）。
- **Windows**：`winget install --id Git.Git -e`（约 60MB，静默安装会写系统 PATH）。
- **Debian / Ubuntu**：`sudo apt install git`
- **Fedora / RHEL / Arch**：先确认发行版包名，再执行 `dnf install git` 或 `pacman -S git`。

装完用 `git --version` 复检。Windows 上当前 shell 仍是旧 PATH，敲 `git` 大概率
仍报「找不到」，改用绝对路径确认：

```powershell
& "C:\Program Files\Git\cmd\git.exe" --version
```

## XeLaTeX、latexmk 与 bibtex

### macOS

```bash
brew install --cask mactex-no-gui
```

TeX 发行版体积较大。安装前说明下载和磁盘影响，安装后重新打开 shell，再检查 `xelatex`、`latexmk`、`bibtex`。

### Debian / Ubuntu

```bash
sudo apt install texlive-xetex latexmk texlive-lang-chinese texlive-latex-extra
```

### Fedora / RHEL / Arch

先查询当前发行版的 TeX Live/XeTeX 包名；只有用户确认后才执行 `dnf` 或 `pacman` 命令。

### Windows

```powershell
winget install MiKTeX.MiKTeX
```

安装后检查 MiKTeX 的自动补包设置，并重新运行 Doctor。

## DrawIO

- macOS：`brew install --cask drawio`
- Windows（官方源退路）：
  `winget install --id JGraph.Draw --exact --source winget --silent --accept-source-agreements --accept-package-agreements`
- Linux：使用当前发行版包或 DrawIO Desktop 官方 AppImage/deb。

## PDF 视觉检查（三选一）

| 平台 | pdftoppm | mutool | ImageMagick |
| --- | --- | --- | --- |
| macOS | `brew install poppler` | `brew install mupdf` | `brew install imagemagick` |
| Debian/Ubuntu | `sudo apt install poppler-utils` | `sudo apt install mupdf-tools` | `sudo apt install imagemagick` |
| Windows | `winget install oschwartz10612.poppler` | 使用已确认来源的 MuPDF | `winget install ImageMagick.ImageMagick` |

只需安装其中一个；优先 `pdftoppm`。

## Typst 与 R（按需）

- Typst：macOS `brew install typst`；Windows `winget install Typst.Typst`；Linux 使用发行版包或官方二进制。
- R：只在用户明确选择 `nature-figure` 的 R 后端时安装。
- CRAN 包：`ggplot2`, `patchwork`, `ggrepel`, `svglite`, `ragg`。
- `ComplexHeatmap` 使用 Bioconductor 安装流程，必须单独说明并确认。

## 中国大陆网络环境（默认）

首次安装优先使用以下方案。一个镜像不可用时换下一个可信镜像；都不可用才回退上文官方源。

### uv 本体

已有 Python 时直接从清华 PyPI 安装到当前用户，不先访问官方安装脚本：

```bash
python -m pip install --user uv -i https://pypi.tuna.tsinghua.edu.cn/simple
```

清华不可用时改用 `https://mirrors.aliyun.com/pypi/simple/`。安装后用 Python 用户脚本
目录下的 `uv` 绝对路径复检；当前进程看不到新 PATH 不代表安装失败。

### uv 托管 Python

`uv python install` 默认从 GitHub 下载 python-build-standalone，受限网络下加镜像变量：

```bash
UV_PYTHON_INSTALL_MIRROR=https://gh-proxy.com/https://github.com/astral-sh/python-build-standalone/releases/download uv python install
```

GitHub 加速代理地址不稳定；失败时更换代理前缀（执行前告知用户所用地址），或引导
用户从 MModels「设置 → Environment」安装托管 Python。

### PyPI（uv pip）

清华 TUNA 镜像（备选：阿里云 `https://mirrors.aliyun.com/pypi/simple/`）：

```bash
UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple uv pip install --python .venv/bin/python numpy scipy pandas matplotlib seaborn python-dateutil
```

扩展包同理，加同一个环境变量即可。Windows 解释器路径换成 `.venv\Scripts\python.exe`。

### LaTeX

**macOS**：不走 brew（官方源下载几 GB 极慢）。推荐轻量路径——从 TUNA 下载
BasicTeX（约 100MB，自带 xelatex/bibtex），再把 tlmgr 仓库切到 TUNA 补齐
latexmk 与中文支持：

```bash
curl -LO https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/mac/mactex/BasicTeX.pkg
sudo installer -pkg BasicTeX.pkg -target /
sudo /Library/TeX/texbin/tlmgr option repository https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet
sudo /Library/TeX/texbin/tlmgr update --self
sudo /Library/TeX/texbin/tlmgr install latexmk ctex collection-langchinese collection-fontsrecommended
```

需要完整发行版时改为下载全量 `MacTeX.pkg`（约 6GB，同目录，含 GUI 应用），
安装前必须向用户说明体积。

**Windows**：`winget install MiKTeX.MiKTeX` 本体通常可达；装完必须把补包仓库切到
国内镜像，否则编译中自动补包会卡死：

```powershell
mpm --set-repository=https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/win32/miktex/tm/packages/
```

（管理员安装加 `--admin`；也可在 MiKTeX Console → Settings → Package repository
里选择国内镜像。）

**Linux**：apt/dnf 的 TeX Live 包走发行版镜像源，通常无需处理；若用原生 TeX Live
安装器或 `tlmgr`，把仓库切到 TUNA：

```bash
tlmgr option repository https://mirrors.tuna.tsinghua.edu.cn/CTAN/systems/texlive/tlnet
```

### Git

`winget install --id Git.Git -e` 背后是 GitHub Releases，受限网络下可能极慢或失败。
改从国内镜像下载 Git for Windows 安装包（在浏览器里选最新版的 `*-64-bit.exe`）：

```text
https://registry.npmmirror.com/-/binary/git-for-windows/
```

macOS 用 `xcode-select --install`（走 Apple 的 CDN，不受影响）；Linux 用发行版
自带源即可。

### DrawIO 等 GitHub Releases 下载

DrawIO 没有官方国内镜像。Windows 上先用 `winget show --id JGraph.Draw --exact --source winget`
取得官方 MSI 地址与 SHA256，再通过可信的 GitHub 国内加速地址下载。下载完成后必须同时满足：

1. `Get-FileHash -Algorithm SHA256` 与 winget 清单一致；
2. `Get-AuthenticodeSignature` 状态为 `Valid`，签名发布者包含 `draw.io Ltd`；
3. 使用 PowerShell 的 `Start-Process msiexec.exe -ArgumentList @(...) -Wait` 显式传参数，
   不从 Git Bash 直接调用 `msiexec`；
4. 安装后直接检查 `%LOCALAPPDATA%\Programs\draw.io\draw.io.exe` 并执行一次导出验证，
   不要求 `drawio` 这个命令名存在，也不额外创建转发器。

国内加速连续失败时，换用本页 DrawIO 的完整 winget 命令。DrawIO 是建议项，官方源仍不可用时
说明“流程图导出暂未装好，其他建模功能不受影响”，不要无限重试，也不要显示整段下载日志。

### R / CRAN（如确需）

```r
options(repos = c(CRAN = "https://mirrors.tuna.tsinghua.edu.cn/CRAN/"))
```

## 安全边界

- Git 只装二进制：不 `git init`、不提交/推送、不改动仓库内容、不写 `git config`。
- 不静默执行 `sudo`、管理员 PowerShell 或大体积 TeX 安装。
- 不因为可选项缺失而安装全部绘图库。
- 安装失败后保留原始错误；只按本页规定的镜像顺序重试，不用未验证的下载站或包管理器。
