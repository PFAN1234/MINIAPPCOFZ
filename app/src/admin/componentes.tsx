import type { ReactNode } from 'react'
import { CATEGORIAS, ROTULO_CATEGORIA } from './dados/tipos.ts'

export function mensagemDe(e: unknown, padrao = 'Não foi possível concluir a operação.'): string {
  return e instanceof Error && e.message ? e.message : padrao
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <p className="adm-estado" role="status" aria-live="polite">
      {texto}
    </p>
  )
}

export function Erro({ erro, onTentar }: { erro: unknown; onTentar?: () => void }) {
  return (
    <div className="adm-alerta adm-alerta-erro" role="alert">
      <p>{mensagemDe(erro, 'Não foi possível carregar.')}</p>
      {onTentar && (
        <button type="button" className="adm-botao" onClick={onTentar}>
          Tentar de novo
        </button>
      )}
    </div>
  )
}

interface Consulta<T> {
  data: T | undefined
  isPending: boolean
  error: unknown
  refetch: () => unknown
}

/** Carregando, erro ou o conteúdo com os dados. */
export function ComDados<T>({ consulta, children }: { consulta: Consulta<T>; children: (d: T) => ReactNode }) {
  if (consulta.data !== undefined) return <>{children(consulta.data)}</>
  if (consulta.isPending) return <Carregando />
  return <Erro erro={consulta.error} onTentar={() => void consulta.refetch()} />
}

/** Resultado de uma gravação: mensagem de sucesso ou de erro. */
export function Resultado({ sucesso, erro }: { sucesso: string | null; erro: unknown }) {
  if (erro) {
    return (
      <p className="adm-alerta adm-alerta-erro" role="alert">
        {mensagemDe(erro)}
      </p>
    )
  }
  if (sucesso) {
    return (
      <p className="adm-alerta adm-alerta-ok" role="status">
        {sucesso}
      </p>
    )
  }
  return null
}

/** Select das categorias do extrator (mantém um valor fora da lista, se já existir). */
export function SelectCategoria({
  valor,
  rotulo,
  onMudar,
}: {
  valor: string
  rotulo: string
  onMudar: (v: string) => void
}) {
  const opcoes: string[] = CATEGORIAS.includes(valor as (typeof CATEGORIAS)[number]) || !valor ? [...CATEGORIAS] : [...CATEGORIAS, valor]
  return (
    <select aria-label={rotulo} value={valor} onChange={(e) => onMudar(e.target.value)}>
      {!valor && <option value="">Escolha…</option>}
      {opcoes.map((c) => (
        <option key={c} value={c}>
          {ROTULO_CATEGORIA[c] ?? c}
        </option>
      ))}
    </select>
  )
}
