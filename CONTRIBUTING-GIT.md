# 本地 Git 修改与发布流程

本项目由多个智能体和人工共同维护。为了让每一次修改都可追溯、可回退，统一采用“检查 → 精确暂存 → 本地提交 → 提交后验证”的流程。此流程只操作本地 Git，不会自动上传远程仓库，也不会删除未跟踪文件。

## 日常修改

1. 开始前先查看状态：

   ```powershell
   npm run git:check
   ```

2. 完成一组能独立说明的修改后，先运行与改动相关的验证（至少是类型检查或定向测试），再精确暂存文件。不要使用 `git add .`，以免把截图、构建产物、临时日志或其他智能体的文件一起加入。

   ```powershell
   git add src/某个文件.tsx server/某个文件.cjs plans/00-协作主文档-所有AI从这里开始.md
   npm run git:check -- --strict
   ```

3. 使用提交助手创建本地提交：

   ```powershell
   npm run git:checkpoint -- "fix: 修复反馈审核流程"
   ```

   `git:checkpoint` 只提交已经暂存的文件，不会自动暂存、推送、删除文件或修改历史。提交信息使用 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`chore` 等类型，并写清楚本次改动。

4. 提交完成后确认已跟踪文件干净：

   ```powershell
   npm run git:verify
   ```

   未跟踪文件会保留在磁盘上，脚本不会替用户判断是否删除。确认属于本次版本的文件后，再单独精确暂存。

## 协作主文档要求

- 改动 `src/`、`server/`、`docs/`、`scripts/` 或 `package.json` 时，同一提交必须更新 `plans/00-协作主文档-所有AI从这里开始.md` 的“改动日志”和“待办”。
- `npm run git:checkpoint` 默认按严格模式执行：业务文件已暂存但协作主文档未暂存时会阻止提交。
- 如果只是文档本身的校正，可直接提交文档；如果是打包版本，需同时记录版本号、验证结果和产物清单。

## 产物、截图与敏感信息

- `dist/`、`out/`、`release/`、`build/`、`.playwright-cli/`、临时审计 JSON、安装包和压缩包默认不进入源码提交。
- 官网展示截图应放在 `docs/assets/screenshots/site/`，并在截图清单中记录来源；原始临时截图放在 `docs/assets/screenshots/00-inbox/` 或本地未跟踪目录。
- 不得提交 `.env`、密码、令牌、私钥、SSH 凭证或真实 API Key。`git:check` 会检查暂存路径和差异中的高风险模式；发现阻止项时先移除敏感内容，再继续提交。
- 如确实需要提交发布二进制，必须明确使用 `--allow-generated`，并在协作主文档记录原因、SHA256 和验证结果。一般业务提交不应使用该选项。

## 发布前

发布版本除日常检查外，还要完成：

- `npm run typecheck`
- 相关单元/冒烟测试
- `npm run build` 或对应的加固打包命令
- `npm run git:check -- --strict`
- `npm run git:checkpoint -- "release: 发布 vX.Y.Z"`
- `npm run git:verify`

安装版、便携版和官网发布仍需人工确认后执行；本地 Git 提交不等于已经上传服务器或发布给用户。

