import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles/index.css'
import { startSession } from './auth/session'

// index.html carries envsubst placeholders ("${AUTH_DOMAIN}") that Docker
// substitutes at container start. On the vite dev server nothing substitutes
// them, so readers would see a TRUTHY garbage value and build broken
// "https://${AUTH_DOMAIN}/login" redirects. Blank them out once at boot.
for (const k of ['__API_BASE__', '__AUTH_DOMAIN__', '__GRAFANA_URL__', '__BACKUP_ENABLED__', '__OIDC_AUTHORITY__', '__OIDC_CLIENT_ID__', '__OIDC_AUDIENCE__'] as const) {
  const v = (window as unknown as Record<string, unknown>)[k]
  if (typeof v === 'string' && v.startsWith('${')) {
    (window as unknown as Record<string, unknown>)[k] = ''
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

// The authority may be answering this very load with a code to exchange. Done before the first
// render, so no component ever sees a half-finished sign-in — and awaited, because the API client
// asks for a token as soon as anything mounts.
const returnTo = await startSession()
if (returnTo && returnTo !== window.location.href) {
  window.location.replace(returnTo)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
