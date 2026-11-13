import { useId, useState, type ReactNode } from 'react'
import { useOrganizacao } from './dados/hooks.ts'
import { CATEGORIAS, ROTULO_CATEGORIA } from './dados/tipos.ts'

export const NOME_APP = 'Fiscal Bot'

/**
 * Logo e nome da OM e "Fiscal Bot · Administração" (barra do topo e tela de entrada). Se a
 * organização não carregar, ou o logo falhar, fica só o nome do app: nunca impede o uso do site.
 */
export function IdentidadeOM({ grande = false, comApp = true }: { grande?: boolean; comApp?: boolean }) {
  const org = useOrganizacao()
  const [logoFalhou, setLogoFalhou] = useState<string | null>(null)
  const nome = org.data?.nome
  const logo = org.data?.logo_url && org.data.logo_url !== logoFalhou ? org.data.logo_url : null
  if (!comApp && !logo && !nome) return null
  return (
    <span className={`adm-marca${grande ? ' adm-marca-grande' : ''}`} data-testid="identidade-om">
      {logo && (
        <img className="adm-logo" src={logo} alt={nome ? `Logo da ${nome}` : 'Logo da OM'} onError={() => setLogoFalhou(logo)} />
      )}
      {nome && <span className="adm-nome-om">{nome}</span>}
      {comApp && <span className="adm-nome-app">{NOME_APP} · Administração</span>}
    </span>
  )
}

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

/** Rótulo, controle e dica de um campo de formulário; `obrigatorio` marca o rótulo com um asterisco. */
export function Campo({
  rotulo,
  dica,
  obrigatorio = false,
  largo = false,
  children,
}: {
  rotulo: string
  dica?: ReactNode
  obrigatorio?: boolean
  /** Ocupa a linha inteira da grade. */
  largo?: boolean
  children: (p: { id: string; 'aria-describedby'?: string; 'aria-required'?: boolean }) => ReactNode
}) {
  const id = useId()
  return (
    <div className={`adm-campo-form${largo ? ' adm-campo-largo' : ''}`}>
      <label htmlFor={id} className={obrigatorio ? 'adm-obrigatorio' : undefined}>
        {rotulo}
      </label>
      {children({ id, 'aria-describedby': dica ? `${id}-dica` : undefined, ...(obrigatorio ? { 'aria-required': true } : {}) })}
      {dica && (
        <span className="adm-dica" id={`${id}-dica`}>
          {dica}
        </span>
      )}
    </div>
  )
}
