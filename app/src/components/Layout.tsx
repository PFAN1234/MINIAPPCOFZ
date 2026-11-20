import { useState } from 'react'
import { Outlet } from 'react-router'
import { useOrganizacao } from '../dados/hooks.ts'
import { useBackButtonTelegram } from '../shared/infra/telegram/telegramBack.ts'
import { BarraSincronizacao } from './BarraSincronizacao.tsx'
import { BarraInferior } from '../shared/ui/layout/BarraInferior.tsx'
import { FaixaDoTopo } from '../shared/ui/layout/faixaDoTopo.ts'
import { OrganizacaoContexto } from '../shared/ui/layout/identidade.ts'
import { TelaCheiaContexto } from '../shared/infra/browser/telaCheia.ts'

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
