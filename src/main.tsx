import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles/index.css'
import { chooseOrganisation, signIn, startSession } from './auth/session'
import { DirectoryUnavailable, OrganisationChoice } from './auth/OrganisationChoice'

// index.html carries envsubst placeholders ("${AUTH_DOMAIN}") that Docker
// substitutes at container start. On the vite dev server nothing substitutes
// them, so readers would see a TRUTHY garbage value and build broken
// "https://${AUTH_DOMAIN}/login" redirects. Blank them out once at boot.
for (const k of ['__API_BASE__', '__AUTH_DOMAIN__', '__GRAFANA_URL__', '__BACKUP_ENABLED__', '__OIDC_AUTHORITY__', '__OIDC_CLIENT_ID__', '__OIDC_AUDIENCE__', '__ORG_AUTHORITY__', '__KRATOS_PUBLIC_URL__', '__ORG_DIRECTORY_AUDIENCE__', '__ORG_DIRECTORY_URL__', '__ORG_SELECTION_URL__'] as const) {
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
const start = await startSession()
if (start.kind === 'ready' && start.returnTo && start.returnTo !== window.location.href) {
  window.location.replace(start.returnTo)
}

// A session that still has to say which organisation it acts in has no token this API would accept,
// so the console is not rendered behind the question: it would only show screens that cannot load.
function opening() {
  if (start.kind === 'choose') {
    return <OrganisationChoice organisations={start.organisations} onChoose={chooseOrganisation} />
  }
  if (start.kind === 'unavailable') {
    return <DirectoryUnavailable reason={start.reason} onRetry={() => void signIn()} />
  }
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{opening()}</React.StrictMode>,
)
