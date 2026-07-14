# Build frontend + API in one image (Railway Root Directory = repo root)
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Frontend deps + build
COPY package.json package-lock.json* ./
COPY index.html vite.config.ts tsconfig*.json ./
COPY src ./src
COPY public ./public
RUN npm install
RUN npm run build

# API deps
COPY server/package.json ./server/
RUN npm --prefix server install --omit=dev

COPY server/*.js ./server/

# Runtime
FROM node:22-bookworm-slim

WORKDIR /app
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV PUBLIC_DIR=/app/server/public

COPY --from=build /app/server /app/server
COPY --from=build /app/dist /app/server/public

WORKDIR /app/server
EXPOSE 3000
CMD ["npm", "start"]
