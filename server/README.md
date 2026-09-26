# MModels 诊断接收服务

给 MModels Desktop 使用的**自建**诊断/遥测接收服务。
完整部署说明与契约见上级目录的 [`诊断服务-自建指南.md`](../诊断服务-自建指南.md)。

## 特点

- **零构建步骤** —— Node ≥22.18 能直接执行 `.ts`（内置类型剥离），
  `node src/index.ts` 就是生产启动命令；Docker 里也不需要 tsc/打包器
- **零原生依赖** —— 存储用 JSONL + 每报告一个文件，不用编译 better-sqlite3
- **两条链路** —— 遥测批量事件 + 用户主动上传的诊断报告，都自带管理台
- **默认不出网** —— 邮件通知是可选的；没配 SMTP 就完全不发信

## 本地跑起来

```bash
npm install
DIAG_TOKEN=$(openssl rand -hex 32) DIAG_DATA_DIR=./data npm start
# 打开 http://127.0.0.1:8787/admin  （用户 admin，密码 = DIAG_TOKEN）
```

## 跑测试

```bash
node test/smoke.mjs
```

会驱动真实进程、用真实 HTTP 请求覆盖：鉴权、字段白名单、体积上限、
路径穿越、管理台、以及**发信失败不影响上报**这条容错路径。

## 接口一览

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| `GET` | `/health` | 无 | 探活 |
| `POST` | `/api/desktop/telemetry/batch` | Bearer | 批量遥测事件 |
| `POST` | `/api/desktop/diagnostics` | Bearer | 用户主动上报的诊断报告 |
| `GET` | `/admin` | Basic | 诊断台（用户名 `admin`，密码为 `DIAG_TOKEN`） |
| `GET`/`DELETE` | `/admin/api/reports[/:id]` | Basic | 报告列表 / 详情 / 删除 |

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `DIAG_TOKEN` | **必填** | Bearer 令牌，同时是 `/admin` 的密码。不设则**拒绝启动** |
| `DIAG_DATA_DIR` | `data` | 数据目录（备份就是拷它） |
| `DIAG_RETENTION_DAYS` | `30` | 保留期，到期自动清理 |
| `DIAG_RATE_PER_MIN` | `120` | 每 IP 每分钟请求上限 |
| `PUBLIC_BASE_URL` | 空 | 邮件里链接的前缀，如 `https://diag.example.com` |
| `SMTP_HOST` 等 | 空 | 邮件通知，留空即关闭。详见 `.env.example` |

## 目录结构

```
src/
  index.ts     路由、鉴权、限流、启动
  validate.ts  字段白名单（真正的那道防线）
  store.ts     JSONL + 报告文件的存储与保留期清理
  admin.ts     诊断台页面（服务端渲染，无构建步骤）
  mailer.ts    邮件通知（只发摘要，不搬数据）
test/
  smoke.mjs    真实进程联调测试
```
