# syntax=docker/dockerfile:1

# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# 用 corepack + package.json 的 packageManager 字段锁定 pnpm 版本，
# 避免 pnpm@latest 漂移到新版后改变 install 语义（新版默认拒绝执行依赖构建脚本）。
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
# esbuild 的构建脚本已在 package.json 的 pnpm.onlyBuiltDependencies 中显式放行，
# 因此这里必须带 --frozen-lockfile 严格安装；失败就说明锁文件和清单不一致，应修清单而不是回退。
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Runtime stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8765
ENV HOST=0.0.0.0

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
# 生产依赖只有 ws，不含任何需要构建脚本的包
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

EXPOSE 8765

CMD ["node", "dist/index.js"]
