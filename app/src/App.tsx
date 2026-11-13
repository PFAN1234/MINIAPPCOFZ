import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { GuardaSessao } from './components/GuardaSessao.tsx'
import { AberturaPorLink } from './components/AberturaPorLink.tsx'
import { Layout } from './components/Layout.tsx'
import { OfflineProvider } from './offline/contexto.tsx'
import Acessos from './telas/Acessos.tsx'
import Ambiente from './telas/Ambiente.tsx'
import Gestao from './telas/Gestao.tsx'
import Modelo from './telas/Modelo.tsx'
import NaoEncontrada from './telas/NaoEncontrada.tsx'
import NovoRegistro from './telas/NovoRegistro.tsx'
import Obra from './telas/Obra.tsx'
import Obras from './telas/Obras.tsx'
import PendenciaDetalhe from './telas/PendenciaDetalhe.tsx'
import Pendencias from './telas/Pendencias.tsx'
import Registros from './telas/Registros.tsx'
import Relatorios from './telas/Relatorios.tsx'

// Tela de teste da realidade aumentada (RA0): fora do pacote inicial.
const DiagnosticoRA = lazy(() => import('./ra/DiagnosticoRA.tsx'))

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
            <Route path="pendencias" element={<Navigate replace to="/registros?tipo=abertas" />} />
            <Route path="relatorios" element={<Relatorios />} />
            <Route path="obras/:slug" element={<Obra />} />
            <Route path="obras/:slug/acessos" element={<Acessos />} />
            <Route path="obras/:slug/modelo" element={<Modelo />} />
            <Route path="obras/:slug/pendencias" element={<Pendencias />} />
            <Route path="obras/:slug/pendencias/:id" element={<PendenciaDetalhe />} />
            <Route path="obras/:slug/gestao" element={<Gestao />} />
            <Route path="obras/:slug/ambientes/:codigo" element={<Ambiente />} />
            <Route path="obras/:slug/ambientes/:codigo/novo" element={<NovoRegistro />} />
            <Route
              path="ra-teste"
              element={
                <Suspense fallback={null}>
                  <DiagnosticoRA />
                </Suspense>
              }
            />
            <Route path="*" element={<NaoEncontrada />} />
          </Route>
        </Routes>
      </OfflineProvider>
    </GuardaSessao>
  )
}
