import type { ReactNode } from 'react'
import { useSessao } from '../dados/hooks.ts'
import { EstadoCarregando, EstadoErro } from './Estado.tsx'

/** Em modo Supabase sem sessão, pede para abrir pelo Telegram (login real na fase 6). */
export function GuardaSessao({ children }: { children: ReactNode }) {
  const sessao = useSessao()
  if (sessao.isPending) return <EstadoCarregando />
  if (sessao.isError) {
    return (
      <EstadoErro
        mensagem="Não foi possível verificar a sessão."
        onTentarDeNovo={() => void sessao.refetch()}
      />
    )
  }
  if (!sessao.data) {
    return (
      <main className="app-main sem-sessao">
        <h1>Abra o Diário da obra pelo Telegram</h1>
        <p>
          Este app funciona dentro do Telegram. Abra-o pelo botão do bot da sua
          obra para entrar.
        </p>
      </main>
    )
  }
  return <>{children}</>
}
