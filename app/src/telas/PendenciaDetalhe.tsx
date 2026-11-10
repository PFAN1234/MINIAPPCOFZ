import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { GaleriaFotos } from '../components/GaleriaFotos.tsx'
import { EstadoConsulta, EstadoVazio } from '../components/Estado.tsx'
import { Horario } from '../components/Horario.tsx'
import { IconeUsuario } from '../components/Icones.tsx'
import { SeloSituacao } from '../components/CartaoPendencia.tsx'
import { Publicacao } from '../components/ListaRegistros.tsx'
import { textoEstadoEncerramento } from '../components/RegistroLocal.tsx'
import { SeletorFotos } from '../components/SeletorFotos.tsx'
import { useFotosEscolhidas } from '../components/useFotosEscolhidas.ts'
import { criarRascunhoEncerramento } from '../dados/envio.ts'
import { usePendencia } from '../dados/hooks.ts'
import type { PendenciaDetalhe } from '../dados/tipos.ts'
import { useEncerramentoLocal, useFila } from '../offline/contexto.tsx'
import { disableClosingConfirmation, enableClosingConfirmation } from '../telegram.ts'
import { registrarGuardaSaida } from '../util/guardaSaida.ts'

const MAX_OBSERVACAO = 1000

export default function PendenciaDetalheTela() {
  const { id = '' } = useParams()
  const consulta = usePendencia(id)
  return (
    <EstadoConsulta consulta={consulta}>
      {(detalhe) =>
        detalhe ? (
          <Carregada detalhe={detalhe} />
        ) : (
          <EstadoVazio
            titulo="Pendência não encontrada"
            texto="Ela não existe ou você não tem acesso a ela."
          />
        )
      }
    </EstadoConsulta>
  )
}

function Carregada({ detalhe }: { detalhe: PendenciaDetalhe }) {
  const { registro, pavimento, papel, encerramento } = detalhe
  const aberta = registro.situacao !== 'resolvida'
  const local = useEncerramentoLocal(registro.id)
  return (
    <section aria-labelledby="titulo-pendencia">
      <p className="voltar-linha">
        <Link to={`/obras/${registro.obra.slug}?pav=${pavimento.codigo}`}>
          ← {registro.obra.nome} / {pavimento.nome}
        </Link>
      </p>
      <h2 id="titulo-pendencia" className="titulo-tela">
        {registro.ambiente.nome}
      </h2>
      <div className="pendencia-cabeca">
        <p className="pendencia-legenda">{registro.legenda}</p>
        <SeloSituacao situacao={registro.situacao} />
      </div>
      <GaleriaFotos fotos={registro.fotos} rotulo={`Fotos da pendência: ${registro.legenda}`} />
      <p className="lista-sub pendencia-meta">
        {registro.autor} · <Horario iso={registro.capturado_em} />
      </p>
      <Publicacao estado={registro.publicacao} />

      {!aberta && encerramento ? (
        <section className="resolucao" aria-labelledby="titulo-resolucao">
          <h3 id="titulo-resolucao" className="secao-titulo">
            Resolução
          </h3>
          <GaleriaFotos fotos={encerramento.fotos} rotulo="Fotos da comprovação da correção" />
          {encerramento.observacao && <p className="resolucao-obs">{encerramento.observacao}</p>}
          <p className="lista-sub">
            Encerrada por {encerramento.gestor} · <Horario iso={encerramento.encerrado_em} />
          </p>
          <Publicacao estado={encerramento.publicacao} />
        </section>
      ) : local ? (
        <EncerramentoNoAparelho item={local} />
      ) : papel === 'gestor' ? (
        <FormularioEncerramento detalhe={detalhe} />
      ) : (
        <p className="nota-acesso">
          <IconeUsuario tamanho={18} />
          Só gestores da obra podem encerrar pendências.
        </p>
      )}
    </section>
  )
}

function EncerramentoNoAparelho({
  item,
}: {
  item: NonNullable<ReturnType<typeof useEncerramentoLocal>>
}) {
  const { tentarDeNovo, descartar } = useFila()
  const erro = item.estado === 'erro'
  return (
    <section className="resolucao" aria-labelledby="titulo-encerramento-local">
      <h3 id="titulo-encerramento-local" className="secao-titulo">
        Encerramento
      </h3>
      <p
        className={`publicacao ${erro ? 'publicacao-problema' : 'publicacao-espera'}`}
        role="status"
      >
        {textoEstadoEncerramento(item)}
      </p>
      {erro && (
        <div className="registro-acoes">
          <button
            type="button"
            className="botao"
            onClick={() => void tentarDeNovo(item.encerramento.id)}
          >
            Tentar de novo
          </button>
          <button
            type="button"
            className="botao botao-secundario"
            onClick={() => {
              if (window.confirm('Descartar este encerramento? Ele ainda não foi enviado.')) {
                void descartar(item.encerramento.id)
              }
            }}
          >
            Descartar
          </button>
        </div>
      )}
    </section>
  )
}

function FormularioEncerramento({ detalhe }: { detalhe: PendenciaDetalhe }) {
  const { registro } = detalhe
  const navigate = useNavigate()
  const { estado: estadoFila, adicionarEncerramento } = useFila()
  const { fotos, aviso, adicionar, remover } = useFotosEscolhidas()
  const [observacao, setObservacao] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const saindo = useRef(false)

  const preparando = fotos.some((f) => f.estado === 'preparando')
  const comErro = fotos.some((f) => f.estado === 'erro')
  const valido = fotos.length >= 1 && !preparando && !comErro && observacao.length <= MAX_OBSERVACAO
  const preenchido = fotos.length > 0 || observacao.trim() !== ''

  const preenchidoRef = useRef(preenchido)
  useEffect(() => {
    preenchidoRef.current = preenchido
  }, [preenchido])

  useEffect(
    () =>
      registrarGuardaSaida(() => {
        if (saindo.current || !preenchidoRef.current) return true
        return window.confirm('Descartar este encerramento?')
      }),
    [],
  )

  useEffect(() => {
    if (!preenchido) return
    enableClosingConfirmation()
    return () => disableClosingConfirmation()
  }, [preenchido])

  async function encerrar(e: FormEvent) {
    e.preventDefault()
    if (!valido || guardando) return
    if (!window.confirm('Encerrar esta pendência? A resolução será publicada no tópico da obra.')) {
      return
    }
    const rascunho = criarRascunhoEncerramento({
      registroId: registro.id,
      obraId: registro.obra.id,
      observacao: observacao.trim(),
      fotos: fotos.map((f) => f.preparada!),
    })
    setErro(null)
    setGuardando(true)
    try {
      await adicionarEncerramento({
        rascunho,
        obra: { slug: registro.obra.slug, nome: registro.obra.nome },
        ambiente: {
          id: registro.ambiente.id,
          codigo: registro.ambiente.codigo,
          nome: registro.ambiente.nome,
        },
        legenda: registro.legenda,
      })
    } catch (err) {
      setErro(
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível guardar o encerramento no aparelho. Tente de novo.',
      )
      setGuardando(false)
      return
    }
    saindo.current = true
    navigate(`/obras/${registro.obra.slug}/pendencias`, {
      replace: true,
      state: { aviso: 'Encerramento salvo no aparelho' },
    })
  }

  return (
    <form className="form-registro form-encerramento" onSubmit={(e) => void encerrar(e)} noValidate>
      <fieldset className="form-conjunto" disabled={guardando}>
        <h3 className="secao-titulo">Comprovação da correção</h3>
        <SeletorFotos
          itens={fotos}
          desabilitado={guardando}
          onAdicionar={adicionar}
          onRemover={remover}
        />
        <p className="campo-dica" role="status">
          {aviso}
        </p>
        <div className="campo">
          <label className="campo-rotulo" htmlFor="observacao">
            Observação
          </label>
          <textarea
            id="observacao"
            className="campo-texto"
            rows={3}
            maxLength={MAX_OBSERVACAO}
            aria-describedby="observacao-contador"
            placeholder="Descreva a correção"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />
          <p id="observacao-contador" className="campo-dica contador">
            {observacao.length}/{MAX_OBSERVACAO}
          </p>
        </div>
      </fieldset>
      <p className="nota-acesso">
        <IconeUsuario tamanho={18} />
        Acesso de gestor
      </p>
      {erro && (
        <p className="form-erro" role="alert">
          {erro}
        </p>
      )}
      {!estadoFila.persistente && (
        <p className="campo-dica">
          Este aparelho não permite guardar encerramentos. Não feche o app até o envio terminar.
        </p>
      )}
      <button
        type="submit"
        className="botao botao-bloco"
        disabled={!valido || guardando}
        aria-busy={guardando}
      >
        {guardando ? 'Guardando…' : 'Encerrar pendência'}
      </button>
    </form>
  )
}
