import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { EstadoConsulta } from '../components/Estado.tsx'
import { MAX_FOTOS, SeletorFotos } from '../components/SeletorFotos.tsx'
import { TopoTela } from '../components/TopoTela.tsx'
import { useFotosEscolhidas } from '../components/useFotosEscolhidas.ts'
import { useTelaCheia } from '../components/telaCheia.ts'
import { useRepositorio } from '../dados/contexto.tsx'
import { useAmbiente, useGeometria, useModelos, useUrlsImagens } from '../dados/hooks.ts'
import { criarRascunho } from '../dados/envio.ts'
import { useFila } from '../offline/contexto.tsx'
import type { AmbienteDetalhe, TipoRegistro } from '../dados/tipos.ts'
import { disableClosingConfirmation, enableClosingConfirmation } from '../telegram.ts'
import { registrarGuardaSaida } from '../util/guardaSaida.ts'
import { capturadoEm } from '../util/imagem.ts'
import { modeloComCache } from '../modelo/cacheModelo.ts'
import type { ModeloFrag } from '../modelo/modelos.ts'
import { recursos } from '../recursos.ts'
import type { FotoRA } from '../ra/tipos.ts'

// Three.js, That Open e a tela de RA ficam fora do pacote inicial.
const TelaRA = lazy(() => import('../ra/TelaRA.tsx'))

const MAX_LEGENDA = 1000

export default function NovoRegistro() {
  const { slug = '', codigo = '' } = useParams()
  const consulta = useAmbiente(slug, codigo)
  return (
    <EstadoConsulta consulta={consulta} topo={<TopoTela titulo="Novo registro" />}>
      {(detalhe) => <Formulario detalhe={detalhe} />}
    </EstadoConsulta>
  )
}

function Formulario({ detalhe }: { detalhe: AmbienteDetalhe }) {
  const { obra, ambiente, pavimento } = detalhe
  const navigate = useNavigate()
  const { estado: estadoFila, adicionar: adicionarNaFila } = useFila()
  const { fotos, aviso, adicionar, remover } = useFotosEscolhidas()
  const [tipo, setTipo] = useState<TipoRegistro | null>(null)
  const [legenda, setLegenda] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const saindo = useRef(false)

  // Realidade aumentada: disponível quando o ambiente tem geometria e a obra tem modelo.
  const repo = useRepositorio()
  const [params, setParams] = useSearchParams()
  const geometria = useGeometria(obra, ambiente, recursos.ra)
  // Planta do pavimento (HD quando houver), enquadrada no cômodo pela tela de RA.
  const { planta } = detalhe
  const imagemPlanta = planta ? (planta.imagem_hd ?? planta.imagem) : null
  const urlsPlanta = useUrlsImagens(imagemPlanta ? [imagemPlanta.path] : [])
  const plantaRA =
    planta && imagemPlanta
      ? {
          url: urlsPlanta.data?.[imagemPlanta.path],
          pagina_pt: planta.pagina_pt,
          recorte_pt: planta.recorte_pt,
          largura: imagemPlanta.largura,
          altura: imagemPlanta.altura,
        }
      : null
  const modelos = useModelos(obra.slug, recursos.ra)
  const temRA = recursos.ra && Boolean(geometria.data) && (modelos.data?.length ?? 0) > 0
  const raAberta = temRA && params.get('ra') === '1'
  const baixarModelo = useCallback(
    (m: ModeloFrag) => modeloComCache(`${obra.slug}/${m.sigla}@${m.hash}`, () => repo.baixarModelo(obra.slug, m)),
    [repo, obra.slug],
  )
  function alternarRA(aberta: boolean) {
    const prox = new URLSearchParams(params)
    if (aberta) prox.set('ra', '1')
    else prox.delete('ra')
    setParams(prox, { replace: true })
  }
  function receberDaRA(novas: FotoRA[]) {
    adicionar(
      novas.map((f) => f.arquivo),
      novas,
    )
    alternarRA(false)
  }

  const legendaLimpa = legenda.trim()
  const preparando = fotos.some((f) => f.estado === 'preparando')
  const comErro = fotos.some((f) => f.estado === 'erro')
  const valido =
    fotos.length >= 1 &&
    !preparando &&
    !comErro &&
    tipo !== null &&
    legendaLimpa.length >= 1 &&
    legendaLimpa.length <= MAX_LEGENDA
  const preenchido = fotos.length > 0 || legenda.trim() !== '' || tipo !== null

  // Sem barra inferior, para que a única saída seja a protegida pela confirmação.
  useTelaCheia(true)

  const preenchidoRef = useRef(preenchido)
  useEffect(() => {
    preenchidoRef.current = preenchido
  }, [preenchido])

  useEffect(
    () =>
      registrarGuardaSaida(() => {
        if (saindo.current || !preenchidoRef.current) return true
        return window.confirm('Descartar este registro?')
      }),
    [],
  )

  useEffect(() => {
    if (!preenchido) return
    enableClosingConfirmation()
    return () => disableClosingConfirmation()
  }, [preenchido])

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!valido || guardando) return
    // Cada salvamento gera um registro novo: depois de salvo no aparelho ele é imutável.
    const r = criarRascunho({
      obraId: obra.id,
      ambienteId: ambiente.id,
      tipo: tipo!,
      legenda: legendaLimpa,
      capturadoEm: capturadoEm(fotos.map((f) => f.arquivo)),
      fotos: fotos.map((f) => f.preparada!),
    })
    setErro(null)
    setGuardando(true)
    try {
      await adicionarNaFila({
        rascunho: r,
        obra: { slug: obra.slug, nome: obra.nome },
        ambiente: { codigo: ambiente.codigo, nome: ambiente.nome_operacional },
      })
    } catch (e) {
      setErro(
        e instanceof Error && e.message ? e.message : 'Não foi possível guardar o registro no aparelho. Tente de novo.',
      )
      setGuardando(false)
      return
    }
    saindo.current = true
    navigate(`/obras/${obra.slug}/ambientes/${ambiente.codigo}`, {
      replace: true,
      state: { aviso: 'Registro salvo no aparelho' },
    })
  }

  return (
    <section aria-labelledby="titulo-novo">
      <TopoTela
        titulo="Novo registro"
        idTitulo="titulo-novo"
        subtitulo={`${obra.nome} · ${pavimento.nome} · ${ambiente.nome_operacional}`}
      />
      <form className="form-registro" onSubmit={(e) => void salvar(e)} noValidate>
        <fieldset className="form-conjunto" disabled={guardando}>
          <SeletorFotos itens={fotos} desabilitado={guardando} onAdicionar={adicionar} onRemover={remover} />
          <p className="campo-dica" role="status">
            {aviso}
          </p>
          {temRA && (
            <button
              type="button"
              className="botao botao-secundario botao-bloco"
              disabled={guardando || MAX_FOTOS - fotos.length < 2}
              onClick={() => alternarRA(true)}
            >
              Comparar com o modelo (RA)
            </button>
          )}

          <fieldset className="campo tipo-registro">
            <legend className="campo-rotulo">Tipo de registro</legend>
            <div className="segmentado">
              <label>
                <input
                  type="radio"
                  name="tipo"
                  value="servico"
                  checked={tipo === 'servico'}
                  onChange={() => setTipo('servico')}
                />
                <span>Serviço</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="tipo"
                  value="pendencia"
                  checked={tipo === 'pendencia'}
                  onChange={() => setTipo('pendencia')}
                />
                <span>Pendência</span>
              </label>
            </div>
          </fieldset>

          <div className="campo">
            <label className="campo-rotulo" htmlFor="legenda">
              Legenda
            </label>
            <textarea
              id="legenda"
              className="campo-texto"
              rows={4}
              maxLength={MAX_LEGENDA}
              required
              aria-describedby="legenda-contador"
              placeholder="Descreva o que foi feito ou o que falta"
              value={legenda}
              onChange={(e) => setLegenda(e.target.value)}
            />
            <p id="legenda-contador" className="campo-dica contador">
              {legenda.length}/{MAX_LEGENDA}
            </p>
          </div>
        </fieldset>

        {erro && (
          <p className="form-erro" role="alert">
            {erro}
          </p>
        )}
        {!estadoFila.persistente && (
          <p className="campo-dica">
            Este aparelho não permite guardar registros. Não feche o app até o envio terminar.
          </p>
        )}
        <button type="submit" className="botao botao-bloco" disabled={!valido || guardando} aria-busy={guardando}>
          {guardando ? 'Guardando…' : 'Salvar registro'}
        </button>
      </form>
      {raAberta && geometria.data && modelos.data && (
        <Suspense fallback={null}>
          <TelaRA
            obra={obra}
            pavimento={pavimento.nome}
            ambiente={{
              codigo: ambiente.codigo,
              nome: ambiente.nome_operacional,
            }}
            geometria={geometria.data}
            modelos={modelos.data}
            baixar={baixarModelo}
            vagas={MAX_FOTOS - fotos.length}
            planta={plantaRA}
            onConcluir={receberDaRA}
            onFechar={() => alternarRA(false)}
          />
        </Suspense>
      )}
    </section>
  )
}
