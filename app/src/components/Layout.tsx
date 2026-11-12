import { useState } from 'react'
import { Outlet } from 'react-router'
import { useBackButtonTelegram } from '../telegramBack.ts'
import { BarraSincronizacao } from './BarraSincronizacao.tsx'
import { BarraInferior } from './BarraInferior.tsx'
import { FaixaDoTopo } from './faixaDoTopo.ts'
import { TelaCheiaContexto } from './telaCheia.ts'

/**
 * Moldura das telas. O nome do app já aparece no cabeçalho do Telegram; cada tela desenha o
 * próprio topo (`TopoTela`), que mostra a faixa de envio logo abaixo do azul.
 */
export function Layout() {
  const [telaCheia, setTelaCheia] = useState(false)
  useBackButtonTelegram()

  return (
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
  )
}
