import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './shared/ui/feedback/ErrorBoundary.tsx'
import { EstadoCarregando } from './shared/ui/feedback/Estado.tsx'
import { RepositorioProvider } from './dados/contexto.tsx'
import { registrarSw } from './shared/infra/sw/registrarSw.ts'
import { aplicarCoresTelegram, expand, ready, telaCheia } from './shared/infra/telegram/telegram.ts'
import { instalarCapturaGlobal } from './shared/infra/erros.ts'

ready()
expand()
telaCheia()
aplicarCoresTelegram()
registrarSw()
instalarCapturaGlobal('miniapp')

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, networkMode: 'offlineFirst' } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <RepositorioProvider carregando={<EstadoCarregando />}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </RepositorioProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
