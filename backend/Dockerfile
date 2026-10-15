# ==============================================================================
# 后端镜像：多阶段构建（依赖安装 → 编译 → 运行）
# 说明：
#   1. 构建上下文为仓库根目录（见 deploy/docker-compose.yml 的 build.context），
#      因此 COPY 路径以 backend/ 开头；
#   2. 运行阶段只带生产依赖与编译产物，镜像更小；
#   3. 需要 prisma generate 后才能编译（@prisma/client 类型由生成器产出）。
# ==============================================================================

# ---------- 依赖层 ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci

# ---------- 构建层 ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./
RUN npx prisma generate && npm run build

# ---------- 运行层 ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY backend/prisma ./prisma
EXPOSE 8080
CMD ["node", "dist/main"]
