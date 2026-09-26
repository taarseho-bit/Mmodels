# GitHub Pages 发布说明

营销首页已经放在 [`docs/`](./docs/) 目录中，桌面端源码与营销页相互独立。仓库包含 [`deploy-pages.yml`](./.github/workflows/deploy-pages.yml)，推送 `main` 分支后会自动把 `docs/` 发布到 GitHub Pages。

## 首次发布

1. 当前项目已经连接到 GitHub 仓库 [`taarseho-bit/Mmodels`](https://github.com/taarseho-bit/Mmodels)，本地 `origin` 为：

   ```bash
   git remote -v
   git push -u origin main
   ```

2. 在仓库的 **Settings → Pages** 中，把发布来源设为 **GitHub Actions**。
3. 等待 `Deploy marketing site to GitHub Pages` 工作流完成，站点地址通常是：
   `https://<你的账号>.github.io/<仓库名>/`

首页中的 GitHub 按钮已指向项目仓库。后续如果更换仓库，需要同步修改 `docs/index.html` 中的按钮链接和本文件中的地址。

## 自定义域名

如果后续使用自己的域名，可以在 `docs/CNAME` 写入完整域名（例如 `model.example.com`），再在域名 DNS 中添加 GitHub Pages 要求的记录。GitHub Pages 会继续使用同一份工作流发布。
