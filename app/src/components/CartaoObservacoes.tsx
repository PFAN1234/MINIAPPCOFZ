/**
 * Cartão "Observações do dia" da página da obra (contrato do boletim, parte 2): lista de hoje
 * (no fuso da etapa), adicionar pela fila do aparelho (funciona sem sinal), editar e excluir as
 * próprias com conexão, e o estado travado depois da emissão do boletim do dia.
 */
import { useState, type FormEvent } from 'react'
import { useAlterarObservacao, useObservacoesDoDia } from '../dados/hooks.ts'
import type { Observacao, ObraResumo } from '../dados/tipos.ts'
import { useFila, useObservacoesLocais } from '../offline/contexto.tsx'
import type { ItemObservacao } from '../offline/fila.ts'
import { FUSO_PADRAO, dataNoFuso, formatarDia, horaNoFuso } from '../util/fuso.ts'
import { useOnline } from '../util/online.ts'

export const MAX_OBSERVACAO = 1000
/** O contador aparece quando faltam até 100 caracteres. */
const AVISO_LIMITE = MAX_OBSERVACAO - 100
const VISIVEIS = 3
const DICA_CONEXAO = 'Precisa de conexão'
export const MENSAGEM_TRAVADA = 'O boletim de hoje já foi emitido. Correções são feitas por retificação.'

type Linha =
  | { tipo: 'servidor'; id: string; quando: string; obs: Observacao }
  | { tipo: 'local'; id: string; quando: string; item: ItemObservacao }

function mensagemDoErro(e: unknown, padrao: string): string {
  return e instanceof Error && e.message ? e.message : padrao
}

/** Copia o texto para a área de transferência (ignora se o navegador não deixar). */
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}

export function CartaoObservacoes({ obra }: { obra: ObraResumo }) {
  const consulta = useObservacoesDoDia(obra.id)
  const locais = useObservacoesLocais(obra.id)
  const [todas, setTodas] = useState(false)

  const dia = consulta.data
  const fuso = dia?.fuso ?? FUSO_PADRAO
  const data = dia?.data ?? dataNoFuso(new Date(), fuso)
  const travada = dia?.travada ?? false
  const servidor = dia?.observacoes ?? []
  const ids = new Set(servidor.map((o) => o.id))
  const linhas: Linha[] = [
    ...servidor.map((o): Linha => ({ tipo: 'servidor', id: o.id, quando: o.escrito_em, obs: o })),
    ...locais
      .filter((i) => !ids.has(i.observacao.id))
      .map((i): Linha => ({ tipo: 'local', id: i.observacao.id, quando: i.observacao.escritoEm, item: i })),
  ].sort((a, b) => a.quando.localeCompare(b.quando) || a.id.localeCompare(b.id))
  const visiveis = todas ? linhas : linhas.slice(-VISIVEIS)
  const semDados = !dia

  return (
    <section className="cartao-obs" aria-labelledby="titulo-observacoes">
      <div className="cartao-obs-cabeca">
        <h3 id="titulo-observacoes" className="cartao-obs-titulo">
          Observações do dia
        </h3>
        <span className="cartao-obs-data">{formatarDia(data)}</span>
      </div>

      {travada && <p className="aviso-inativo cartao-obs-travada">{MENSAGEM_TRAVADA}</p>}

      {linhas.length > 0 ? (
        <ul className="cartao-obs-lista">
          {visiveis.map((l) =>
            l.tipo === 'servidor' ? (
              <ItemServidor key={l.id} obs={l.obs} obraId={obra.id} fuso={fuso} travada={travada} />
            ) : (
              <ItemLocal key={l.id} item={l.item} fuso={fuso} />
            ),
          )}
        </ul>
      ) : semDados && consulta.isError ? (
        <div className="cartao-obs-vazio" role="alert">
          <p>Não foi possível carregar as observações.</p>
          <button type="button" className="obs-acao" onClick={() => void consulta.refetch()}>
            Tentar de novo
          </button>
        </div>
      ) : semDados && consulta.fetchStatus === 'paused' ? (
        <p className="cartao-obs-vazio">Sem conexão. As observações de hoje aparecem quando o sinal voltar.</p>
      ) : semDados ? (
        <p className="cartao-obs-vazio" role="status">
          Carregando…
        </p>
      ) : (
        <p className="cartao-obs-vazio">Nenhuma observação hoje.</p>
      )}

      {linhas.length > VISIVEIS && (
        <button type="button" className="obs-ver-todas" aria-expanded={todas} onClick={() => setTodas(!todas)}>
          {todas ? 'Ver só as últimas' : `Ver todas (${linhas.length})`}
        </button>
      )}

      {!travada && <FormularioObservacao obra={obra} />}
    </section>
  )
}

function Meta({ hora, nome, editada }: { hora: string; nome: string; editada?: boolean }) {
  return (
    <p className="obs-meta">
      {hora} · {nome}
      {editada && <span className="obs-editada"> · editada</span>}
    </p>
  )
}

function ItemServidor({
  obs,
  obraId,
  fuso,
  travada,
}: {
  obs: Observacao
  obraId: string
  fuso: string
  travada: boolean
}) {
  const online = useOnline()
  const alterar = useAlterarObservacao(obraId)
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(obs.texto)
  const hora = horaNoFuso(obs.escrito_em, fuso)
  const podeAlterar = obs.minha && !obs.travada && !travada
  const limpo = texto.trim()
  const valido = limpo.length >= 1 && limpo.length <= MAX_OBSERVACAO && limpo !== obs.texto

  function salvar(e: FormEvent) {
    e.preventDefault()
    if (!valido || alterar.isPending) return
    alterar.mutate(
      {
        tipo: 'editar',
        dados: { id: obs.id, obraId, texto: limpo, escritoEm: obs.escrito_em },
      },
      { onSuccess: () => setEditando(false) },
    )
  }

  function excluir() {
    if (!window.confirm('Excluir esta observação?')) return
    alterar.mutate({ tipo: 'excluir', id: obs.id })
  }

  return (
    <li className="obs-item">
      <Meta hora={hora} nome={obs.autor.nome} editada={obs.editado_em !== null} />
      {editando ? (
        <form className="obs-edicao" onSubmit={salvar} noValidate>
          <label className="sr-only" htmlFor={`editar-${obs.id}`}>
            Texto da observação das {hora}
          </label>
          <textarea
            id={`editar-${obs.id}`}
            className="campo-texto"
            rows={3}
            maxLength={MAX_OBSERVACAO}
            value={texto}
            disabled={alterar.isPending}
            onChange={(e) => setTexto(e.target.value)}
          />
          <Contador tamanho={texto.length} />
          <div className="obs-acoes">
            <button type="submit" className="botao" disabled={!valido || !online || alterar.isPending}>
              {alterar.isPending ? 'Salvando…' : 'Salvar alteração'}
            </button>
            <button
              type="button"
              className="obs-acao"
              disabled={alterar.isPending}
              onClick={() => {
                setEditando(false)
                setTexto(obs.texto)
                alterar.reset()
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <p className="obs-texto">{obs.texto}</p>
      )}
      {podeAlterar && !editando && (
        <div className="obs-acoes">
          <button
            type="button"
            className="obs-acao"
            aria-label={`Editar observação das ${hora}`}
            disabled={!online || alterar.isPending}
            onClick={() => {
              alterar.reset()
              setTexto(obs.texto)
              setEditando(true)
            }}
          >
            Editar
          </button>
          <button
            type="button"
            className="obs-acao"
            aria-label={`Excluir observação das ${hora}`}
            disabled={!online || alterar.isPending}
            onClick={excluir}
          >
            {alterar.isPending && alterar.variables?.tipo === 'excluir' ? 'Excluindo…' : 'Excluir'}
          </button>
          {!online && <span className="campo-dica">{DICA_CONEXAO}</span>}
        </div>
      )}
      {editando && !online && <p className="campo-dica">{DICA_CONEXAO}</p>}
      {alterar.isError && (
        <p className="erro-texto" role="alert">
          {mensagemDoErro(alterar.error, 'Não foi possível alterar a observação.')}
        </p>
      )}
    </li>
  )
}

function textoEstado(item: ItemObservacao): string {
  if (item.estado === 'erro') {
    return `Não foi possível enviar: ${item.observacao.erro?.mensagem ?? 'erro desconhecido.'}`
  }
  if (item.estado === 'enviando') return 'Enviando…'
  return 'Salvo no aparelho · aguardando envio'
}

function ItemLocal({ item, fuso }: { item: ItemObservacao; fuso: string }) {
  const { tentarDeNovo, descartar } = useFila()
  const [copiado, setCopiado] = useState<boolean | null>(null)
  const { observacao } = item
  const erro = item.estado === 'erro'
  // 22023 (dia já emitido, texto inválido): tentar de novo não adianta.
  const definitivo = observacao.erro?.tipo === 'validacao'
  return (
    <li className="obs-item obs-local">
      <Meta hora={horaNoFuso(observacao.escritoEm, fuso)} nome="Você" />
      <p className="obs-texto">{observacao.texto}</p>
      <p className={`publicacao ${erro ? 'publicacao-problema' : 'publicacao-espera'}`}>{textoEstado(item)}</p>
      {erro && (
        <div className="obs-acoes">
          {!definitivo && (
            <button type="button" className="obs-acao" onClick={() => void tentarDeNovo(observacao.id)}>
              Tentar de novo
            </button>
          )}
          <button
            type="button"
            className="obs-acao"
            onClick={() => void copiar(observacao.texto).then(setCopiado)}
          >
            Copiar texto
          </button>
          <button
            type="button"
            className="obs-acao"
            onClick={() => {
              if (window.confirm('Descartar esta observação? Ela não foi enviada.')) {
                void descartar(observacao.id)
              }
            }}
          >
            Descartar
          </button>
          {copiado !== null && (
            <span className="campo-dica" role="status">
              {copiado ? 'Texto copiado.' : 'Não foi possível copiar; selecione o texto acima.'}
            </span>
          )}
        </div>
      )}
    </li>
  )
}

function Contador({ tamanho, id }: { tamanho: number; id?: string }) {
  if (tamanho < AVISO_LIMITE) return null
  return (
    <p id={id} className="campo-dica contador">
      {tamanho}/{MAX_OBSERVACAO}
    </p>
  )
}

function FormularioObservacao({ obra }: { obra: ObraResumo }) {
  const { estado, adicionarObservacao } = useFila()
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const limpo = texto.trim()
  const valido = limpo.length >= 1 && limpo.length <= MAX_OBSERVACAO

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!valido || guardando) return
    setErro(null)
    setGuardando(true)
    try {
      // O id nasce no aparelho e é o mesmo em toda tentativa de envio.
      await adicionarObservacao({
        id: crypto.randomUUID(),
        obra: { id: obra.id, slug: obra.slug, nome: obra.nome },
        texto: limpo,
        escritoEm: new Date().toISOString(),
      })
      setTexto('')
    } catch (err) {
      setErro(mensagemDoErro(err, 'Não foi possível guardar a observação no aparelho. Tente de novo.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form className="obs-form" onSubmit={(e) => void salvar(e)} noValidate>
      <label className="campo-rotulo" htmlFor="nova-observacao">
        Adicionar observação
      </label>
      <textarea
        id="nova-observacao"
        className="campo-texto"
        rows={2}
        maxLength={MAX_OBSERVACAO}
        placeholder="Ex.: chuva forte das 14h às 15h; concretagem adiada"
        value={texto}
        disabled={guardando}
        aria-describedby={texto.length >= AVISO_LIMITE ? 'nova-observacao-contador' : undefined}
        onChange={(e) => setTexto(e.target.value)}
      />
      <Contador tamanho={texto.length} id="nova-observacao-contador" />
      {erro && (
        <p className="form-erro" role="alert">
          {erro}
        </p>
      )}
      {!estado.persistente && (
        <p className="campo-dica">
          Este aparelho não permite guardar observações. Não feche o app até o envio terminar.
        </p>
      )}
      <button type="submit" className="botao obs-salvar" disabled={!valido || guardando} aria-busy={guardando}>
        {guardando ? 'Guardando…' : 'Salvar'}
      </button>
    </form>
  )
}
