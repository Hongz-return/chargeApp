# 充电桩后端（server/）的容器镜像。
#
#   docker build -t charging-pile-server .
#   docker run -d --name charging-api \
#     -p 3000:3000 \
#     -e NODE_ENV=production \
#     -e HOST=0.0.0.0 \
#     -e JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
#     -v charging-data:/data \
#     -e DATA_DIR=/data \
#     charging-pile-server
#
# 只跑后端。小程序前端由微信客户端加载，不进这个镜像。
# 完整上线步骤见 docs/PRODUCTION.md。

FROM node:20-alpine

# 服务本身零 npm 依赖，只需要 tini 来正确转发 SIGTERM——
# 收不到信号就走不了优雅退出，最后一批还没落盘的写就丢了
RUN apk add --no-cache tini

WORKDIR /app

# 运行时真正需要的只有后端和它复用的领域层
COPY package.json ./
COPY server ./server
COPY utils ./utils

# 数据卷：不挂载的话容器一删数据就没了
ENV DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
