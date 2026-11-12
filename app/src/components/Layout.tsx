import { useState } from 'react'
import { Outlet } from 'react-router'
import { useOrganizacao } from '../dados/hooks.ts'
import { useBackButtonTelegram } from '../telegramBack.ts'
import { BarraSincronizacao } from './BarraSincronizacao.tsx'
import { BarraInferior } from './BarraInferior.tsx'
import { FaixaDoTopo } from './faixaDoTopo.ts'
import { OrganizacaoContexto } from './identidade.ts'
import { TelaCheiaContexto } from './telaCheia.ts'

/**
 * Moldura das telas. Cada tela desenha o próprio topo (`TopoTela`), com a faixa de identidade
 * da organização (entregue daqui) no alto e a faixa de envio logo abaixo do azul.
 */
export function Layout() {
  const [telaCheia, setTelaCheia] = useState(false)
  const organizacao = useOrganizacao()
  useBackButtonTelegram()

  return (
    <OrganizacaoContexto.Provider value={organizacao.data ?? null}>
      <TelaCheiaContexto.Provider value={setTelaCheia}>
        <FaixaDoTopo.Provider value={<BarraSincronizacao />}>
          <div className="app">
            <main className="app-main">
              <Outlet />
            </main>
            {!telaCheia && <BarraInferior />}
          </div>
        </FaixaDoTopo.Provider>
      </TelaCheiaContexto.Provider>
    </OrganizacaoContexto.Provider>
  )
}
