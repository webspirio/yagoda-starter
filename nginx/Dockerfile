# Build from the REPO ROOT context: docker build -f nginx/Dockerfile .
FROM node:24-alpine AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
RUN npm ci --workspace=frontend
COPY frontend/ frontend/
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w frontend
# frontend/vite.config.ts's build.manifest: true writes dist/.vite/manifest.json — a local
# input for scripts/verify/checks/bundle-size.mjs's first-paint/lazy split, never a
# deployable. Strip it here so the image that gets copied below never carries it.
RUN rm -rf /app/frontend/dist/.vite

# Unprivileged nginx runs as a non-root user and listens on 8080
# (nginx/nginx.conf must use "listen 8080;").
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
