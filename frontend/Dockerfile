# Dev-only image. Build from the REPO ROOT context: docker build -f frontend/Dockerfile .
# Production frontend assets are built and served by nginx/Dockerfile.
FROM node:24-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
# frontend/node_modules must be writable by "node" — Vite keeps its cache in node_modules/.vite
RUN npm ci --workspace=frontend \
    && mkdir -p frontend/node_modules \
    && chown -R node:node frontend/node_modules
COPY --chown=node:node frontend/ frontend/
USER node
EXPOSE 5173
CMD ["npm", "run", "dev", "-w", "frontend"]
