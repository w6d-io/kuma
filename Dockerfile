# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ── Serve ────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

RUN apk add --no-cache gettext

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Runtime configuration — substituted into index.html on container start.
# API_BASE:    absolute URL of the jinbe API.
#              Empty (default) → relative /api (Oathkeeper proxies /api on same domain).
#              https://jinbe.dev.w6d.io → SPA calls jinbe directly on a separate domain.
# AUTH_DOMAIN: bare hostname of the auth/login UI, e.g. auth.dev.w6d.io.
#              Used for redirect on 401 responses. Empty → falls back to in-app default.
# GRAFANA_URL: base URL of Grafana for per-event audit trace deep-links.
#              Empty (default) → no trace link rendered.
ENV API_BASE=""
ENV AUTH_DOMAIN=""
ENV GRAFANA_URL=""
ENV BACKUP_ENABLED=""

EXPOSE 8080

# Inject runtime config into index.html, then start nginx.
# envsubst whitelist: only the listed vars are substituted (preserves other ${...} content).
CMD ["/bin/sh", "-c", \
  "envsubst '${API_BASE} ${AUTH_DOMAIN} ${GRAFANA_URL} ${BACKUP_ENABLED}' < /usr/share/nginx/html/index.html > /tmp/index.html && \
   mv /tmp/index.html /usr/share/nginx/html/index.html && \
   nginx -g 'daemon off;'"]
