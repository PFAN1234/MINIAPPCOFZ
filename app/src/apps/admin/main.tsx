/** Entrada do site de administração (/admin/): navegador do computador, sem o SDK do Telegram. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './admin.css'
import AdminApp from './AdminApp.tsx'
import { fabricaMotor } from './motor.ts'
import { FabricaMotorProvider } from '@modules/modelos/presentation/admin/central/motorContexto.tsx'
import ErrorBoundary from '@shared/ui/feedback/ErrorBoundary.tsx'
import { instalarCapturaGlobal } from '@shared/infra/erros.ts'
import { Carregando } from '../../admin/componentes.tsx'
import { RepositorioAdminProvider } from '../../admin/dados/contexto.tsx'
import { consumirTokenDaUrl, criarEntrada } from '../../admin/entrada.ts'

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
        <FabricaMotorProvider fabrica={fabricaMotor}>
          <BrowserRouter basename="/admin">
            <AdminApp entrada={entrada} />
          </BrowserRouter>
        </FabricaMotorProvider>
      </RepositorioAdminProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
