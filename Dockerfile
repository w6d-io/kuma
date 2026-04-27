# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# ── Serve ────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runner

# Install envsubst (part of gettext)
RUN apk add --no-cache gettext

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template

# JINBE_URL: in-cluster URL of the jinbe service
# e.g. http://auth-jinbe.w6d-ops:8080 or http://test-auth-jinbe:8080
ENV JINBE_URL=http://jinbe:8080

EXPOSE 8080

# envsubst replaces ${JINBE_URL} in the nginx template at startup
CMD ["/bin/sh", "-c", "envsubst '${JINBE_URL}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
