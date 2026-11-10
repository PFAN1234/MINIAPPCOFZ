import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { EstadoConsulta } from '../components/Estado.tsx'
import { MAX_FOTOS, SeletorFotos, type ItemFoto } from '../components/SeletorFotos.tsx'
import { useTelaCheia } from '../components/telaCheia.ts'
import { useAmbiente } from '../dados/hooks.ts'
import { criarRascunho } from '../dados/envio.ts'
import { useFila } from '../offline/contexto.tsx'
import type { AmbienteDetalhe, TipoRegistro } from '../dados/tipos.ts'
import { disableClosingConfirmation, enableClosingConfirmation } from '../telegram.ts'
import { registrarGuardaSaida } from '../util/guardaSaida.ts'
import { capturadoEm, prepararFoto, type FotoPreparada } from '../util/imagem.ts'

const MAX_LEGENDA = 1000

interface FotoEscolhida extends ItemFoto {
  arquivo: File
  preparada?: FotoPreparada
}

export default function NovoRegistro() {
  const { slug = '', codigo = '' } = useParams()
  const consulta = useAmbiente(slug, codigo)
  return (
    <EstadoConsulta consulta={consulta}>
      {(detalhe) => <Formulario detalhe={detalhe} />}
    </EstadoConsulta>
  )
}

function criarPrevia(arquivo: File): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(arquivo) : null
}

function Formulario({ detalhe }: { detalhe: AmbienteDetalhe }) {
  const { obra, ambiente, pavimento } = detalhe
  const navigate = useNavigate()
  const { estado: estadoFila, adicionar: adicionarNaFila } = useFila()
  const [fotos, setFotos] = useState<FotoEscolhida[]>([])
  const [tipo, setTipo] = useState<TipoRegistro | null>(null)
  const [legenda, setLegenda] = useState('')
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const saindo = useRef(false)
  const contador = useRef(0)
  const previas = useRef<string[]>([])
  const fotosRef = useRef<FotoEscolhida[]>([])

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

  useEffect(
    () => () => {
      for (const url of previas.current) URL.revokeObjectURL?.(url)
    },
    [],
  )

  const adicionar = useCallback((arquivos: File[]) => {
    const vagas = MAX_FOTOS - fotosRef.current.length
    const aceitos = arquivos.slice(0, Math.max(0, vagas))
    setAviso(
      aceitos.length < arquivos.length
        ? `Só cabem ${MAX_FOTOS} fotos; ${arquivos.length - aceitos.length} ficou de fora.`
        : '',
    )
    const novos: FotoEscolhida[] = aceitos.map((arquivo) => {
      const previa = criarPrevia(arquivo)
      if (previa) previas.current.push(previa)
      return { chave: `f${++contador.current}`, arquivo, previa, estado: 'preparando' }
    })
    fotosRef.current = [...fotosRef.current, ...novos]
    setFotos(fotosRef.current)
    for (const item of novos) {
      prepararFoto(item.arquivo).then(
        (preparada) => atualizar(item.chave, { estado: 'pronta', preparada }),
        (e: unknown) =>
          atualizar(item.chave, {
            estado: 'erro',
            mensagem: e instanceof Error ? e.message : 'Não foi possível ler esta foto.',
          }),
      )
    }
    function atualizar(chave: string, mudanca: Partial<FotoEscolhida>) {
      fotosRef.current = fotosRef.current.map((f) => (f.chave === chave ? { ...f, ...mudanca } : f))
      setFotos(fotosRef.current)
    }
  }, [])

  function remover(chave: string) {
    fotosRef.current = fotosRef.current.filter((f) => f.chave !== chave)
    setFotos(fotosRef.current)
    setAviso('')
  }

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
        e instanceof Error && e.message
          ? e.message
          : 'Não foi possível guardar o registro no aparelho. Tente de novo.',
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
      <h2 id="titulo-novo" className="titulo-tela">
        Novo registro
      </h2>
      <p className="subtitulo">
        {obra.nome} · {pavimento.nome} · {ambiente.nome_operacional}
      </p>
      <form className="form-registro" onSubmit={(e) => void salvar(e)} noValidate>
        <fieldset className="form-conjunto" disabled={guardando}>
          <SeletorFotos
            itens={fotos}
            desabilitado={guardando}
            onAdicionar={adicionar}
            onRemover={remover}
          />
          <p className="campo-dica" role="status">
            {aviso}
          </p>

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
        <button
          type="submit"
          className="botao botao-bloco"
          disabled={!valido || guardando}
          aria-busy={guardando}
        >
          {guardando ? 'Guardando…' : 'Salvar registro'}
        </button>
      </form>
    </section>
  )
}
