/**
 * Editor da planta de um pavimento (`/admin/obras/<slug>/planta/<pavimento>`), em etapas:
 * 1. PDF e revisão; 2. recorte e máscaras; 3. ambientes; 4. nova revisão; 5. prova e publicar.
 * O processamento (pdf.js, imagens) roda no navegador; nada é gravado até "Publicar".
 */
import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ComDados, mensagemDe } from '../../componentes.tsx'
import { useRepositorioAdmin } from '../../dados/contexto.tsx'
import { useEditorPlanta, useInvalidarPlanta } from '../../dados/hooks.ts'
import type { DadosEditorPlanta, PavimentoEditor } from '../../dados/tipos.ts'
import {
  confirmarMesmo,
  desfazerMesmo,
  edicaoInicial,
  extrairPavimento,
  incluirManual,
  moverPino,
  mudarCategoria,
  problemaRevisao,
  removerManual,
  removerPino,
  renomearAmbiente,
  restaurarPinos,
  revisaoDoNome,
  type EstadoEdicao,
  type Extracao,
} from '../../planta/editor.ts'
import { calcularPlanta, prancha as validarPrancha } from '../../planta/plantas.ts'
import { publicarPavimento, type ArquivoPdf, type Progresso } from '../../planta/publicar.ts'
import { sha256Hex, type DocumentoPdf, type PaginaAberta } from '../../planta/servico.ts'
import type { Ambiente } from '../../planta/tipos.ts'
import Ambientes, { type AcoesAmbientes } from './Ambientes.tsx'
import NovaRevisao from './NovaRevisao.tsx'
import Recorte, { usePrevia } from './Recorte.tsx'
import { useServicoPdf } from './servicoPdf.tsx'

const LIMITE_PDF = 50 * 1024 * 1024

const ETAPAS = ['Arquivo', 'Recorte e máscaras', 'Ambientes', 'Nova revisão', 'Prova e publicar'] as const

export default function EditorPlanta() {
  const { slug = '', pavimento = '' } = useParams()
  const consulta = useEditorPlanta(slug)
  return (
    <ComDados consulta={consulta}>
      {(dados) => {
        const pav = dados.pavimentos.find((p) => p.codigo === pavimento)
        if (!pav) {
          return (
            <p className="adm-alerta adm-alerta-erro" role="alert">
              Pavimento não encontrado: {pavimento}. <Link to={`/obras/${slug}/planta`}>Escolher outro</Link>
            </p>
          )
        }
        return <Editor key={pav.codigo} dados={dados} pav={pav} />
      }}
    </ComDados>
  )
}

type ResultadoExtracaoTela = { ok: Extracao; erro?: undefined } | { ok?: undefined; erro: string }

function Editor({ dados, pav }: { dados: DadosEditorPlanta; pav: PavimentoEditor }) {
  const carregarServico = useServicoPdf()
  const [etapa, setEtapa] = useState(0)
  const [arquivo, setArquivo] = useState<ArquivoPdf | null>(null)
  const [doc, setDoc] = useState<DocumentoPdf | null>(null)
  const [pagina, setPagina] = useState<PaginaAberta | null>(null)
  const [edicao, setEdicao] = useState<EstadoEdicao>(() => edicaoInicial(dados, pav.codigo))
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [publicado, setPublicado] = useState<string | null>(null)

  useEffect(
    () => () => {
      void doc?.fechar()
    },
    [doc],
  )

  const erroPrancha = useMemo(() => {
    try {
      validarPrancha(edicao.prancha)
      return null
    } catch (e) {
      return mensagemDe(e)
    }
  }, [edicao.prancha])

  const extracao = useMemo((): ResultadoExtracaoTela | null => {
    if (!pagina) return null
    try {
      return { ok: extrairPavimento(dados, pav.codigo, edicao, pagina) }
    } catch (e) {
      return { erro: mensagemDe(e) }
    }
  }, [dados, pav.codigo, edicao, pagina])

  const calculada = useMemo(() => {
    if (!pagina || !extracao?.ok || erroPrancha) return null
    try {
      return calcularPlanta(edicao.prancha, pagina, extracao.ok.resultado.ambientes)
    } catch {
      return null
    }
  }, [pagina, extracao, edicao.prancha, erroPrancha])

  /** Aplica uma edição; erro de regra vira mensagem na tela. */
  function editar(f: (e: EstadoEdicao) => EstadoEdicao) {
    try {
      setEdicao((e) => f(e))
      setErroAcao(null)
      setPublicado(null)
    } catch (e) {
      setErroAcao(mensagemDe(e))
    }
  }
  function editarDireto(f: () => EstadoEdicao) {
    try {
      const novo = f()
      setEdicao(novo)
      setErroAcao(null)
      setPublicado(null)
    } catch (e) {
      setErroAcao(mensagemDe(e))
    }
  }

  const acoes: AcoesAmbientes = {
    renomear: (a, nome) => editarDireto(() => renomearAmbiente(dados, edicao, a, nome)),
    categoria: (a, c) => editar((e) => mudarCategoria(e, a, c)),
    moverPino: (a, i, x, y) => editar((e) => moverPino(e, a, i, x, y)),
    removerPino: (a, i) => editarDireto(() => removerPino(edicao, a, i)),
    restaurarPinos: (a) => editar((e) => restaurarPinos(e, a)),
    incluir: (nome, cat, x, y) => editarDireto(() => incluirManual(edicao, pav.codigo, nome, cat, x, y)),
    removerManual: (a: Ambiente) => editar((e) => removerManual(e, a)),
  }

  const liberadas = [true, !!pagina, !!pagina && !erroPrancha, !!extracao?.ok && !erroPrancha, !!extracao?.ok && !!calculada]
  const ajustados = useMemo(
    () => new Set(Object.keys(extracao?.ok?.config.marcadores_ajustados ?? {})),
    [extracao],
  )

  return (
    <article aria-labelledby="titulo-editor" className="adm-editor">
      <p>
        <Link to={`/obras/${dados.obra.slug}`}>← {dados.obra.nome}</Link> ·{' '}
        <Link to={`/obras/${dados.obra.slug}/planta`}>Pavimentos</Link>
      </p>
      <h1 id="titulo-editor">
        Planta · {dados.obra.nome} · {pav.nome}
      </h1>
      <p className="adm-dica">
        {pav.planta ? `Publicada: revisão ${pav.planta.revisao}.` : 'Ainda sem planta publicada.'}
        {arquivo && ` Arquivo: ${arquivo.nome}${edicao.revisao ? ` · revisão ${edicao.revisao}` : ''}.`}
      </p>
      <nav aria-label="Etapas" className="adm-etapas">
        <ol>
          {ETAPAS.map((nome, i) => (
            <li key={nome}>
              <button
                type="button"
                className={`adm-etapa${etapa === i ? ' adm-etapa-atual' : ''}`}
                aria-current={etapa === i ? 'step' : undefined}
                disabled={!liberadas[i]}
                onClick={() => setEtapa(i)}
              >
                {i + 1}. {nome}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {erroAcao && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          {erroAcao}
        </p>
      )}
      {etapa > 0 && extracao?.erro && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          Não foi possível extrair os ambientes: {extracao.erro}
        </p>
      )}

      {etapa === 0 && (
        <EtapaArquivo
          dados={dados}
          pav={pav}
          arquivo={arquivo}
          doc={doc}
          edicao={edicao}
          carregarServico={carregarServico}
          onArquivo={(a, d) => {
            void doc?.fechar()
            setArquivo(a)
            setDoc(d)
            setPagina(null)
            setPublicado(null)
            setEdicao((e) => ({
              ...e,
              pdfNome: a.nome,
              revisao: revisaoDoNome(a.nome) ?? e.revisao,
              pagina: Math.min(e.pagina, d.paginas),
            }))
          }}
          onEdicao={(f) => setEdicao((e) => ({ ...e, ...f }))}
          onPagina={(p) => {
            setPagina(p)
            setEtapa(1)
          }}
        />
      )}
      {etapa === 1 && pagina && (
        <>
          <Recorte
            pagina={pagina}
            prancha={edicao.prancha}
            paraTodos={edicao.pranchaParaTodos}
            onMudar={(p) => setEdicao((e) => ({ ...e, prancha: p }))}
            onParaTodos={(v) => setEdicao((e) => ({ ...e, pranchaParaTodos: v }))}
          />
          {erroPrancha && (
            <p className="adm-alerta adm-alerta-erro" role="alert">
              {erroPrancha}
            </p>
          )}
          <Avancar disabled={!!erroPrancha} onClick={() => setEtapa(2)} />
        </>
      )}
      {etapa === 2 && pagina && extracao?.ok && calculada && (
        <>
          <Ambientes
            pagina={pagina}
            imagem={calculada.imagens.planta}
            mascaras={calculada.mascaras}
            chaveImagem={JSON.stringify(edicao.prancha)}
            ambientes={extracao.ok.resultado.ambientes}
            revisar={extracao.ok.resultado.revisar}
            ignorados={extracao.ok.ignorados}
            ajustados={ajustados}
            acoes={acoes}
          />
          <Avancar onClick={() => setEtapa(3)} />
        </>
      )}
      {etapa === 3 && extracao?.ok && (
        <>
          <NovaRevisao
            diferencas={extracao.ok.resultado.diferencas}
            primeira={!dados.ambientes.some((a) => a.pavimento === pav.codigo)}
            totalAmbientes={extracao.ok.resultado.ambientes.length}
            onConfirmar={(novo, antigo) => editar((e) => confirmarMesmo(e, novo, antigo))}
            onDesfazer={(antigo) => editar((e) => desfazerMesmo(e, antigo))}
          />
          <Avancar onClick={() => setEtapa(4)} />
        </>
      )}
      {etapa === 4 && pagina && arquivo && extracao?.ok && calculada && (
        <EtapaPublicar
          dados={dados}
          pav={pav}
          edicao={edicao}
          extracao={extracao.ok}
          pagina={pagina}
          arquivo={arquivo}
          calculadaChave={JSON.stringify([edicao.prancha, extracao.ok.resultado.ambientes.map((a) => a.marcadores)])}
          publicado={publicado}
          onPublicado={setPublicado}
        />
      )}
    </article>
  )
}

function Avancar({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <div className="adm-acoes adm-acoes-fim">
      <button type="button" className="adm-botao adm-botao-principal" disabled={disabled} onClick={onClick}>
        Continuar
      </button>
    </div>
  )
}

// --- Etapa 1: arquivo ------------------------------------------------------------------------------

function EtapaArquivo({
  dados,
  pav,
  arquivo,
  doc,
  edicao,
  carregarServico,
  onArquivo,
  onEdicao,
  onPagina,
}: {
  dados: DadosEditorPlanta
  pav: PavimentoEditor
  arquivo: ArquivoPdf | null
  doc: DocumentoPdf | null
  edicao: EstadoEdicao
  carregarServico: ReturnType<typeof useServicoPdf>
  onArquivo: (a: ArquivoPdf, d: DocumentoPdf) => void
  onEdicao: (f: Partial<EstadoEdicao>) => void
  onPagina: (p: PaginaAberta) => void
}) {
  const repo = useRepositorioAdmin()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const problema = arquivo ? problemaRevisao(edicao.revisao, edicao.pdfNome) : null

  async function abrir(nome: string, obterBytes: () => Promise<Uint8Array>) {
    setErro(null)
    setOcupado('Lendo o PDF…')
    try {
      const bytes = await obterBytes()
      if (bytes.length > LIMITE_PDF) throw new Error('O PDF passa de 50 MB, o limite do armazenamento.')
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('O arquivo escolhido não é um PDF.')
      const servico = await carregarServico()
      const [sha256, d] = await Promise.all([sha256Hex(bytes), servico.abrir(bytes)])
      onArquivo({ nome, bytes, sha256 }, d)
    } catch (e) {
      setErro(mensagemDe(e, 'Não foi possível abrir o PDF.'))
    } finally {
      setOcupado(null)
    }
  }

  async function ler() {
    if (!doc) return
    setErro(null)
    setOcupado('Lendo o texto da página…')
    try {
      onPagina(await doc.pagina(edicao.pagina))
    } catch (e) {
      setErro(mensagemDe(e, 'Não foi possível ler a página.'))
    } finally {
      setOcupado(null)
    }
  }

  const guardado = pav.ultimo_pdf
  return (
    <section aria-labelledby="titulo-arquivo">
      <h2 id="titulo-arquivo">Arquivo</h2>
      <div className="adm-form">
        <label>
          PDF da planta de arquitetura
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void abrir(f.name, async () => new Uint8Array(await f.arrayBuffer()))
              e.target.value = ''
            }}
          />
          <span className="adm-dica">Até 50 MB. O arquivo fica guardado (só admins acessam) para reabrir e ajustar depois.</span>
        </label>
        {guardado && (
          <div>
            <button
              type="button"
              className="adm-botao"
              disabled={!!ocupado}
              onClick={() => void abrir(guardado.nome ?? `${guardado.sha256}.pdf`, () => repo.baixarOriginal(guardado.path))}
            >
              Reabrir o PDF guardado ({guardado.nome ?? 'sem nome'}, revisão {guardado.revisao},{' '}
              {new Date(guardado.publicado_em).toLocaleDateString('pt-BR')})
            </button>
          </div>
        )}
        {ocupado && (
          <p className="adm-estado" role="status">
            {ocupado}
          </p>
        )}
        {erro && (
          <p className="adm-alerta adm-alerta-erro" role="alert">
            {erro}
          </p>
        )}
        {arquivo && doc && (
          <>
            <p>
              <strong>{arquivo.nome}</strong> · {doc.paginas} página(s) · {(arquivo.bytes.length / 1e6).toFixed(1)} MB
            </p>
            <label>
              Página
              <select value={edicao.pagina} onChange={(e) => onEdicao({ pagina: Number(e.target.value) })}>
                {Array.from({ length: doc.paginas }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Revisão
              <input value={edicao.revisao} onChange={(e) => onEdicao({ revisao: e.target.value.trim() })} placeholder="ex.: R07" />
              <span className="adm-dica">
                {pav.planta ? `A publicada é ${pav.planta.revisao}. ` : ''}Mesma revisão: substitui as imagens dela; outra:
                a anterior fica como histórico.
              </span>
            </label>
            {problema && (
              <p className="adm-alerta adm-alerta-erro" role="alert">
                {problema}
              </p>
            )}
            <div>
              <button
                type="button"
                className="adm-botao adm-botao-principal"
                disabled={!!problema || !!ocupado}
                onClick={() => void ler()}
              >
                Ler a página
              </button>
            </div>
          </>
        )}
        {!arquivo && dados.ambientes.some((a) => a.pavimento === pav.codigo) && (
          <p className="adm-dica">
            O pavimento já tem ambientes publicados: a lista nova é comparada com eles na etapa "Nova revisão".
          </p>
        )}
      </div>
    </section>
  )
}

// --- Etapa 5: prova e publicar -----------------------------------------------------------------------

function EtapaPublicar({
  dados,
  pav,
  edicao,
  extracao,
  pagina,
  arquivo,
  calculadaChave,
  publicado,
  onPublicado,
}: {
  dados: DadosEditorPlanta
  pav: PavimentoEditor
  edicao: EstadoEdicao
  extracao: Extracao
  pagina: PaginaAberta
  arquivo: ArquivoPdf
  calculadaChave: string
  publicado: string | null
  onPublicado: (texto: string) => void
}) {
  const repo = useRepositorioAdmin()
  const invalidar = useInvalidarPlanta()
  const [progresso, setProgresso] = useState<Progresso | null>(null)
  const ambientes = extracao.resultado.ambientes
  const removidos = extracao.resultado.diferencas.removidos.length
  // A prova muda quando recorte, máscaras ou pinos mudam (calculadaChave).
  const { imagem: prova, erro: erroProva } = usePrevia(() => {
    const calc = calcularPlanta(edicao.prancha, pagina, ambientes)
    return pagina.prova(calc.imagens.planta, calc.mascaras, ambientes.flatMap((a) => a.marcadores))
  }, calculadaChave)

  const publicar = useMutation({
    mutationFn: () =>
      publicarPavimento({
        deps: repo,
        dados,
        pav: pav.codigo,
        edicao,
        extracao,
        pagina,
        pdf: arquivo,
        aoProgredir: setProgresso,
      }),
    onSuccess: (r) => {
      onPublicado(
        `Publicado: ${pav.nome}, revisão ${edicao.revisao}, ${ambientes.length} ambiente(s)` +
          (r.inativados ? `; ambientes que ficaram inativos: ${r.inativados}` : '') +
          '.',
      )
      void invalidar()
    },
  })

  const marcarRevisado = useMutation({
    mutationFn: async () => {
      const obra = await repo.obterObra(dados.obra.slug)
      await repo.salvarConfig(dados.obra.slug, {
        ...(obra.config ?? {}),
        status: 'revisado',
        revisao_humana: {
          data: new Date().toISOString().slice(0, 10),
          revisao_planta: edicao.revisao,
          decisoes: ['Conferido no site de administração (prova e lista de ambientes).'],
        },
      })
    },
    onSuccess: () => void invalidar(),
  })

  const pct = progresso ? Math.round((progresso.feito / progresso.total) * 100) : 0
  return (
    <section aria-labelledby="titulo-publicar">
      <h2 id="titulo-publicar">Prova e publicar</h2>
      <p>
        {pav.nome}, revisão <strong>{edicao.revisao}</strong>: {ambientes.length} ambiente(s)
        {removidos > 0 && `, ${removidos} removido(s) (ficam inativos)`}. Confira os pinos na prova antes de publicar.
      </p>
      {erroProva && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          {erroProva}
        </p>
      )}
      <div className="adm-rolagem adm-prova">
        {prova ? (
          <img src={prova.url} alt="Prova: visão geral com todos os pinos" />
        ) : (
          !erroProva && <p className="adm-estado">Gerando a prova…</p>
        )}
      </div>
      {prova && (
        <p>
          <a href={prova.url} download={`prova-${dados.obra.slug}-${pav.codigo}-${edicao.revisao}.png`}>
            Baixar a prova (PNG)
          </a>
        </p>
      )}
      {progresso && (publicar.isPending || publicar.isError) && (
        <div className="adm-progresso">
          <progress max={progresso.total} value={progresso.feito} aria-label="Progresso da publicação" />
          <span role="status">
            {pct}% · {progresso.texto}
          </span>
        </div>
      )}
      {publicar.isError && (
        <p className="adm-alerta adm-alerta-erro" role="alert">
          Não foi possível publicar: {mensagemDe(publicar.error)} Nada foi alterado no banco; tente de novo.
        </p>
      )}
      {publicado ? (
        <div className="adm-alerta adm-alerta-ok" role="status">
          <p>{publicado}</p>
          <p>A obra volta para "aguardando revisão humana". Depois de conferir no app, marque como revisada.</p>
          {marcarRevisado.isSuccess ? (
            <p>Marcada como revisada.</p>
          ) : (
            <button
              type="button"
              className="adm-botao"
              disabled={marcarRevisado.isPending}
              onClick={() => marcarRevisado.mutate()}
            >
              Marcar como revisado
            </button>
          )}
          {marcarRevisado.isError && <p role="alert">{mensagemDe(marcarRevisado.error)}</p>}
          <p>
            <Link to={`/obras/${dados.obra.slug}`}>Voltar para a obra</Link>
          </p>
        </div>
      ) : (
        <div className="adm-acoes">
          <button
            type="button"
            className="adm-botao adm-botao-principal"
            disabled={publicar.isPending}
            onClick={() => publicar.mutate()}
          >
            {publicar.isPending ? 'Publicando…' : 'Publicar'}
          </button>
        </div>
      )}
    </section>
  )
}
