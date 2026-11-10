import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import App from '../App.tsx'
import { RepositorioProvider } from '../dados/contexto.tsx'
import { criarRepositorioFixture } from '../dados/fixture.ts'
import type { Repositorio } from '../dados/repositorio.ts'

/** Renderiza o app inteiro numa rota, com a fixture (ou o repositório dado). */
export function renderizarApp(
  rota: string,
  repositorio: Repositorio = criarRepositorioFixture(),
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RepositorioProvider repositorio={repositorio}>
        <MemoryRouter initialEntries={[rota]}>
          <App />
        </MemoryRouter>
      </RepositorioProvider>
    </QueryClientProvider>,
  )
}
