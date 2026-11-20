/** Entrada do site de administração (/admin/): navegador do computador, sem o SDK do Telegram. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './admin.css'
import AdminApp from './AdminApp.tsx'
import ErrorBoundary from '../shared/ui/feedback/ErrorBoundary.tsx'
import { instalarCapturaGlobal } from '../shared/infra/erros.ts'
import { Carregando } from './componentes.tsx'
import { RepositorioAdminProvider } from './dados/contexto.tsx'
import { consumirTokenDaUrl, criarEntrada } from './entrada.ts'

instalarCapturaGlobal('admin')

// Lido e apagado da URL antes de tudo, para o token não ficar no histórico nem ser usado duas vezes.
const entrada = criarEntrada(consumirTokenDaUrl())

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <RepositorioAdminProvider carregando={<Carregando />}>
        <BrowserRouter basename="/admin">
          <AdminApp entrada={entrada} />
        </BrowserRouter>
      </RepositorioAdminProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
