import type { ReactNode } from 'react'
import { IconeAlerta, IconeLista, IconeSemSinal } from './Icones.tsx'

/** Carregando: só uma linha discreta, de altura fixa, que aparece com atraso (não pisca nem empurra a tela). */
export function EstadoCarregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="estado estado-carregando" role="status" aria-live="polite">
      <p className="estado-texto">{texto}</p>
    </div>
  )
}

/** Caixa tracejada com o círculo do ícone, o título e o texto (estados vazio, erro e sem sinal). */
function CaixaEstado({
  icone,
  titulo,
  texto,
  acao,
  className = '',
  papel,
}: {
  icone: ReactNode
  titulo?: string
  texto?: ReactNode
  acao?: ReactNode
  className?: string
  papel?: 'alert' | 'status'
}) {
  return (
    <div className={`estado-caixa ${className}`.trim()} role={papel}>
      <span className="estado-icone">{icone}</span>
      {titulo && <p className="estado-titulo">{titulo}</p>}
      {texto && <p className="estado-texto">{texto}</p>}
      {acao && <div className="estado-acao">{acao}</div>}
    </div>
  )
}

interface ErroProps {
  mensagem?: string
  onTentarDeNovo?: () => void
}

export function EstadoErro({
  mensagem = 'Não foi possível carregar.',
  onTentarDeNovo,
}: ErroProps) {
  return (
    <CaixaEstado
      className="estado-erro"
      papel="alert"
      icone={<IconeAlerta tamanho={30} />}
      titulo="Algo deu errado"
      texto={mensagem}
      acao={
        onTentarDeNovo && (
          <button type="button" className="botao" onClick={onTentarDeNovo}>
            Tentar de novo
          </button>
        )
      }
    />
  )
}

export function EstadoVazio({
  titulo,
  texto,
  icone,
  acao,
}: {
  titulo: string
  texto?: string
  /** Ícone do círculo (padrão: lista). */
  icone?: ReactNode
  /** Botão ou link abaixo do texto. */
  acao?: ReactNode
}) {
  return (
    <CaixaEstado
      className="estado-vazio"
      icone={icone ?? <IconeLista tamanho={30} />}
      titulo={titulo}
      texto={texto}
      acao={acao}
    />
  )
}

interface Consulta<T> {
  data: T | undefined
  isPending: boolean
  isError: boolean
  error: unknown
  refetch: () => unknown
  fetchStatus?: 'fetching' | 'paused' | 'idle'
}

/**
 * Trata carregamento e erro de uma consulta e entrega os dados prontos. `topo` (opcional) é o
 * topo da tela enquanto os dados não chegam; com os dados, quem desenha o topo é `children`.
 */
export function EstadoConsulta<T>({
  consulta,
  topo,
  children,
}: {
  consulta: Consulta<T>
  topo?: ReactNode
  children: (dados: T) => ReactNode
}) {
  // Dados já vistos (inclusive os guardados no aparelho) valem mais que um erro de rede.
  if (consulta.data !== undefined) return <>{children(consulta.data)}</>
  return (
    <>
      {topo}
      <SemDados consulta={consulta} />
    </>
  )
}

function SemDados<T>({ consulta }: { consulta: Consulta<T> }) {
  if (consulta.fetchStatus === 'paused') {
    return (
      <CaixaEstado
        papel="status"
        icone={<IconeSemSinal tamanho={30} />}
        texto="Sem conexão. Esta tela aparece quando o sinal voltar."
        acao={
          <button type="button" className="botao" onClick={() => void consulta.refetch()}>
            Tentar de novo
          </button>
        }
      />
    )
  }
  if (consulta.isPending) return <EstadoCarregando />
  const msg = consulta.error instanceof Error ? consulta.error.message : undefined
  return <EstadoErro mensagem={msg} onTentarDeNovo={() => void consulta.refetch()} />
}
