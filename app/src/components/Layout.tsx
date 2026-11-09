import { useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { dentroDoTelegram } from '../telegram.ts'
import { useBackButtonTelegram, useVoltar } from '../telegramBack.ts'
import { BarraInferior } from './BarraInferior.tsx'
import { TelaCheiaContexto } from './telaCheia.ts'

export function Layout() {
  const [telaCheia, setTelaCheia] = useState(false)
  const { pathname } = useLocation()
  const voltar = useVoltar()
  useBackButtonTelegram()

  // Fora do Telegram não há BackButton nativo: oferece um botão na página.
  const botaoVoltar = pathname !== '/' && !dentroDoTelegram()

  return (
    <TelaCheiaContexto.Provider value={setTelaCheia}>
      <div className="app">
        <header className="app-header">
          {botaoVoltar && (
            <button type="button" className="botao-voltar" onClick={voltar}>
              ← Voltar
            </button>
          )}
          <h1>Diário da obra</h1>
        </header>
        <main className="app-main">
          <Outlet />
        </main>
        {!telaCheia && <BarraInferior />}
      </div>
    </TelaCheiaContexto.Provider>
  )
}
