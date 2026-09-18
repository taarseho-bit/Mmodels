# Node ≥22.18 能直接执行 .ts（内置类型剥离），所以这个镜像不需要构建步骤 ——
# 没有 tsc、没有打包器，改完代码重启容器即生效。
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# 先只拷 manifest，让依赖层可缓存：改代码不会触发重装依赖
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

# 以非 root 运行
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8787

# 健康检查：编排器据此判断容器是否真的可用，而不是"进程还在"
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.ts"]
