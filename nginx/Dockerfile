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

# Unprivileged nginx runs as a non-root user and listens on 8080
# (nginx/default.conf.template must use "listen 8080;").
#
# The config is a TEMPLATE, not a finished file: the image's entrypoint runs
# envsubst over /etc/nginx/templates/*.template into /etc/nginx/conf.d/ at
# start-up, which is how one image proxies /api/ to `backend` in production and
# to `backend-pr-<N>` in a Coolify preview (docker-compose.prod.yml sets
# BACKEND_HOST). The filter limits substitution to that ONE variable, so nginx's
# own `$host`, `$uri`, … can never be clobbered by an env var sharing a name.
# The BACKEND_HOST default keeps the rendered config identical to the old
# hardcoded one wherever nothing sets it (the standalone path); nginx still
# needs a resolvable `backend` at start-up, exactly as before.
FROM nginxinc/nginx-unprivileged:alpine
ENV BACKEND_HOST=backend
ENV NGINX_ENVSUBST_FILTER="^BACKEND_HOST\$"
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html
# Drop the base image's stock server block. The rendered template lands on the
# same path, so this is a no-op when envsubst runs — and when it does NOT run
# (the entrypoint logs and continues if the output dir is unwritable), nginx
# now starts with no server at all and the deploy fails loudly, instead of
# the stock block quietly serving the SPA with no /api/ proxy, no CSP and no
# client_max_body_size.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
