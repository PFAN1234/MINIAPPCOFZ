import { Route, Routes } from 'react-router'
import { GuardaSessao } from './components/GuardaSessao.tsx'
import { AberturaPorLink } from './components/AberturaPorLink.tsx'
import { Layout } from './components/Layout.tsx'
import { OfflineProvider } from './offline/contexto.tsx'
import Acessos from './telas/Acessos.tsx'
import Ambiente from './telas/Ambiente.tsx'
import NovoRegistro from './telas/NovoRegistro.tsx'
import Obra from './telas/Obra.tsx'
import Obras from './telas/Obras.tsx'
import Pendencias from './telas/Pendencias.tsx'
import Registros from './telas/Registros.tsx'

/** Rotas do app. O roteador (BrowserRouter) e os provedores ficam em `main.tsx`. */
export default function App() {
  return (
    <GuardaSessao>
      <OfflineProvider>
        <AberturaPorLink />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Obras />} />
            <Route path="registros" element={<Registros />} />
            <Route path="pendencias" element={<Pendencias />} />
            <Route path="obras/:slug" element={<Obra />} />
            <Route path="obras/:slug/acessos" element={<Acessos />} />
            <Route path="obras/:slug/ambientes/:codigo" element={<Ambiente />} />
            <Route path="obras/:slug/ambientes/:codigo/novo" element={<NovoRegistro />} />
            <Route
              path="*"
              element={<p>Página não encontrada.</p>}
            />
          </Route>
        </Routes>
      </OfflineProvider>
    </GuardaSessao>
  )
}
