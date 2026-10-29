# ==============================================================================
# 前端镜像：多阶段构建（依赖安装 → Vite 编译 → Nginx 托管）
# ------------------------------------------------------------------------------
# 构建上下文为仓库根目录（见 deploy/docker-compose.prod.yml 的 build.context），
# 因此 COPY 路径以 frontend/ 开头。
#
# 产物直接用 Nginx 托管：SPA 路由回退与 /api 反代见 deploy/nginx/prod.conf。
# ==============================================================================

# ---------- 依赖层 ----------
FROM node:22-alpine AS deps
WORKDIR /app
# 国内构建走 npmmirror，海外构建可覆盖为 https://registry.npmjs.org
ARG NPM_REGISTRY=https://registry.npmmirror.com
COPY frontend/package*.json ./
RUN npm config set registry "$NPM_REGISTRY" && npm ci

# ---------- 构建层 ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ ./
# build:only 跳过 vue-tsc 类型检查：类型门禁交给 CI，避免类型报错阻断部署
RUN npm run build:only

# ---------- 运行层 ----------
FROM nginx:1.27-alpine AS runner
COPY deploy/nginx/prod.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
