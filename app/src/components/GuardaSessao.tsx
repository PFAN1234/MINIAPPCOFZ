import type { ReactNode } from 'react'
import { useSessao } from '../dados/hooks.ts'
import { EstadoCarregando, EstadoErro } from './Estado.tsx'
import { TelaDeEntrada } from './FaixaIdentidade.tsx'
import { NOME_APP } from './identidade.ts'

/** Em modo Supabase sem sessão, pede para abrir pelo Telegram (login real na fase 6). */
export function GuardaSessao({ children }: { children: ReactNode }) {
  const sessao = useSessao()
  if (sessao.isPending) {
    return (
      <TelaDeEntrada>
        <EstadoCarregando />
      </TelaDeEntrada>
    )
  }
  if (sessao.isError) {
    return (
      <TelaDeEntrada>
        <EstadoErro
          mensagem="Não foi possível verificar a sessão."
          onTentarDeNovo={() => void sessao.refetch()}
        />
      </TelaDeEntrada>
    )
  }
  if (!sessao.data) {
    return (
      <TelaDeEntrada className="sem-sessao">
        <h1>Abra o {NOME_APP} pelo Telegram</h1>
        <p>
          Este app funciona dentro do Telegram. Abra-o pelo botão do bot da sua
          obra para entrar.
        </p>
      </TelaDeEntrada>
    )
  }
  return <>{children}</>
}
