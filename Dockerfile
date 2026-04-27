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

# API_BASE: absolute URL of the jinbe API.
# - Leave empty (default) → uses relative /api (Oathkeeper proxies /api on same domain)
# - Set to https://jinbe.dev.w6d.io → SPA calls jinbe directly (separate domain)
ENV API_BASE=""

EXPOSE 8080

# Inject API_BASE into index.html at startup, then start nginx
CMD ["/bin/sh", "-c", \
  "envsubst '${API_BASE}' < /usr/share/nginx/html/index.html > /tmp/index.html && \
   mv /tmp/index.html /usr/share/nginx/html/index.html && \
   nginx -g 'daemon off;'"]
