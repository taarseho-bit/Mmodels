# GitHub Pages 发布说明

营销首页已经放在 [`docs/`](./docs/) 目录中，桌面端源码与营销页相互独立。仓库包含 [`deploy-pages.yml`](./.github/workflows/deploy-pages.yml)，推送 `main` 分支后会自动把 `docs/` 发布到 GitHub Pages。

## 首次发布

1. 在 GitHub 创建一个仓库，并把它作为本地仓库的 `origin`：

   ```bash
   git remote add origin https://github.com/<你的账号>/<仓库名>.git
   git push -u origin main
   ```

2. 在仓库的 **Settings → Pages** 中，把发布来源设为 **GitHub Actions**。
3. 等待 `Deploy marketing site to GitHub Pages` 工作流完成，站点地址通常是：
   `https://<你的账号>.github.io/<仓库名>/`

当前工作区还没有配置 GitHub 远程仓库，所以需要先填入真实的仓库地址再推送。拿到仓库地址后，应把首页中的 GitHub 按钮从 `https://github.com` 替换成对应仓库或 Releases 地址。

## 自定义域名

如果后续使用自己的域名，可以在 `docs/CNAME` 写入完整域名（例如 `model.example.com`），再在域名 DNS 中添加 GitHub Pages 要求的记录。GitHub Pages 会继续使用同一份工作流发布。
