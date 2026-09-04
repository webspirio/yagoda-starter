# Build from the REPO ROOT context: docker build -f backend/Dockerfile .
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace=backend

# Dev stage runs as root intentionally: `nest --watch` recompiles into
# /app/backend/dist inside the container (needs write access to the workspace),
# and the `build` stage below derives FROM dev. This image is never deployed —
# the deployed `prod` stage below drops to USER node.
FROM base AS dev
COPY backend/ backend/
EXPOSE 3000
CMD ["npm", "run", "start:dev", "-w", "backend"]

FROM dev AS build
RUN npm run build -w backend

FROM node:24-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --workspace=backend --omit=dev
COPY --from=build --chown=node:node /app/backend/dist backend/dist
# main.ts creates (and the upload endpoint writes into) UPLOADS_DIR at boot.
# /app is root-owned, so pre-create the default location owned by `node` — a
# fresh named volume mounted here inherits this ownership, keeping it writable.
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "backend/dist/main.js"]
