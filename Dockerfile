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
# OIDC_AUTHORITY / OIDC_CLIENT_ID: sign in against an OpenID Connect authority instead of
#              redirecting to the login UI for a session cookie. Both empty (default) → the cookie
#              redirect, exactly as before. Naming an authority is all this console learns about the
#              identity stack: which login screen it shows, and which directory decided what the
#              token asserts, stay its business.
# OIDC_AUDIENCE: the audience the token is minted for, when the authority wants it named.
ENV OIDC_AUTHORITY=""
ENV OIDC_CLIENT_ID=""
ENV OIDC_AUDIENCE=""
# ORG_AUTHORITY: the name of the directory that owns organisation membership, shown to the reader
#              when this console does not own it. Empty -> "your identity provider". Never a name
#              this code knows: a console that hardcoded one would stop being portable.
ENV ORG_AUTHORITY=""
# KRATOS_PUBLIC_URL: where the identity service answers, for the deployments that sign in with its
#                    session rather than a token. Needed only when it is not at the root of
#                    AUTH_DOMAIN: behind a path prefix, the self-service endpoints move with it.
ENV KRATOS_PUBLIC_URL=""
# Deployments where a session must say which organisation it acts in before it can hold a token for
# this API. All three or none: an audience that opens a directory, where to list what the signed-in
# person may act in, and where to record the one they picked. Unset, there is one sign-in and no
# such step — which is how this console behaves everywhere that has no such model.
ENV ORG_DIRECTORY_AUDIENCE=""
ENV ORG_DIRECTORY_URL=""
ENV ORG_SELECTION_URL=""

EXPOSE 8080

# Inject runtime config into index.html, then start nginx.
# envsubst whitelist: only the listed vars are substituted (preserves other ${...} content).
CMD ["/bin/sh", "-c", \
  "envsubst '${API_BASE} ${AUTH_DOMAIN} ${GRAFANA_URL} ${BACKUP_ENABLED} ${OIDC_AUTHORITY} ${OIDC_CLIENT_ID} ${OIDC_AUDIENCE} ${ORG_AUTHORITY} ${KRATOS_PUBLIC_URL} ${ORG_DIRECTORY_AUDIENCE} ${ORG_DIRECTORY_URL} ${ORG_SELECTION_URL}' < /usr/share/nginx/html/index.html > /tmp/index.html && \
   mv /tmp/index.html /usr/share/nginx/html/index.html && \
   nginx -g 'daemon off;'"]
