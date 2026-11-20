/**
 * Painel Documentos da central: repositório de documentos da obra (pranchas, memoriais, planilhas,
 * desenhos), agrupado por disciplina. Envia documentos e novas revisões, mostra o histórico da série,
 * baixa e retira (o arquivo fica guardado). Em coluna única, para o painel estreito.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ComDados, mensagemDe } from '../../../../admin/componentes.tsx'
import { useRepositorioAdmin } from '../../../../admin/dados/contexto.tsx'
import { useDocumentos, useHistoricoDocumento, useRetirarDocumento } from '../../../../admin/dados/hooks.ts'
import type { ObraCentral } from '../../../modelos/domain/tipos.ts'
import { IconeHistorico, IconeRetirar } from '../../../modelos/presentation/admin/central/icones.tsx'
import {
  extensaoArquivo,
  mimeDoArquivo,
  problemaDocumento,
  sugerirProximaRevisao,
  temPrevia,
  tipoSugerido,
  TIPOS_DOCUMENTO,
  type Documento,
  type RevisaoDocumento,
  type TipoDocumento,
} from '../../domain/documentos.ts'
import { enviarDocumento } from '../../application/use-cases/enviarDocumento.ts'
import { depsCripto } from '../../infra/depsCripto.ts'
import { salvarBlob } from './salvarBlob.ts'

interface Props {
  obra: ObraCentral
  /** Disciplinas com modelo na obra, sugeridas no formulário. */
  siglas: string[]
  aoAbrir(doc: Documento): void
}

const SEM_DISCIPLINA = 'Sem disciplina'
const data = (iso: string) => new Date(iso).toLocaleString('pt-BR')
const rotuloTipo = (t: TipoDocumento) => TIPOS_DOCUMENTO.find((x) => x.valor === t)?.rotulo ?? t

function tamanho(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('pt-BR')} kB`
}

/** Formulário aberto: documento novo (sem série) ou nova revisão de uma série. */
interface Rascunho {
  serie?: string
  titulo: string
  codigo: string
  tipo: TipoDocumento
  disciplina: string
  revisao: string
}

const RASCUNHO_VAZIO: Rascunho = { titulo: '', codigo: '', tipo: 'prancha', disciplina: '', revisao: '' }

export default function PainelDocumentos({ obra, siglas, aoAbrir }: Props) {
  const consulta = useDocumentos(obra.slug)
  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState<'' | TipoDocumento>('')
  const [formulario, setFormulario] = useState<Rascunho | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  return (
    <div className="central-docs">
      <div className="central-gestao-acoes">
        <button
          type="button"
          className="central-botao central-botao-principal"
          onClick={() => {
            setAviso(null)
            setFormulario({ ...RASCUNHO_VAZIO })
          }}
        >
          Enviar documento
        </button>
      </div>
      {aviso && (
        <p className="central-gestao-alerta central-gestao-ok" role="status">
          {aviso}
        </p>
      )}
      {formulario && (
        <Formulario
          // Remonta ao trocar de documento (nova revisão de outra série).
          key={formulario.serie ?? 'novo'}
          obra={obra}
          siglas={siglas}
          inicial={formulario}
          aoCancelar={() => setFormulario(null)}
          aoEnviar={(d) => {
            setFormulario(null)
            setAviso(`Enviado: ${d.titulo}, revisão ${d.revisao} (${tamanho(d.bytes)}).`)
          }}
        />
      )}
      <div className="central-gestao-form">
        <label>
          Buscar
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Título, código ou arquivo"
          />
        </label>
        <label>
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as '' | TipoDocumento)}>
            <option value="">Todos os tipos</option>
            {TIPOS_DOCUMENTO.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ComDados consulta={consulta}>
        {(docs: Documento[]) => (
          <Lista
            docs={docs}
            busca={busca}
            tipo={tipo}
            aoAbrir={aoAbrir}
            aoNovaRevisao={(d) => {
              setAviso(null)
              setFormulario({
                serie: d.serie,
                titulo: d.titulo,
                codigo: d.codigo ?? '',
                tipo: d.tipo,
                disciplina: d.disciplina ?? '',
                revisao: sugerirProximaRevisao(d.revisao),
              })
            }}
          />
        )}
      </ComDados>
    </div>
  )
}

function Lista({
  docs,
  busca,
  tipo,
  aoAbrir,
  aoNovaRevisao,
}: {
  docs: Documento[]
  busca: string
  tipo: '' | TipoDocumento
  aoAbrir(doc: Documento): void
  aoNovaRevisao(doc: Documento): void
}) {
  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const filtrados = docs.filter(
      (d) =>
        (!tipo || d.tipo === tipo) &&
        (!q || [d.titulo, d.codigo ?? '', d.arquivoNome].some((t) => t.toLowerCase().includes(q))),
    )
    const mapa = new Map<string, Documento[]>()
    for (const d of filtrados) {
      const g = d.disciplina || SEM_DISCIPLINA
      mapa.set(g, [...(mapa.get(g) ?? []), d])
    }
    return [...mapa.entries()].sort(([a], [b]) =>
      a === SEM_DISCIPLINA ? 1 : b === SEM_DISCIPLINA ? -1 : a.localeCompare(b, 'pt-BR'),
    )
  }, [docs, busca, tipo])

  if (docs.length === 0) {
    return <p className="central-sec">Nenhum documento enviado nesta obra ainda.</p>
  }
  if (grupos.length === 0) return <p className="central-sec">Nenhum documento encontrado com esse filtro.</p>
  return (
    <>
      {grupos.map(([grupo, itens]) => (
        <section key={grupo} aria-label={grupo}>
          <h3 className="central-docs-grupo">
            {grupo} <span className="central-sec">({itens.length})</span>
          </h3>
          <ul className="central-gestao-lista" aria-label={`Documentos de ${grupo}`}>
            {itens.map((d) => (
              <Item key={d.id} doc={d} aoAbrir={aoAbrir} aoNovaRevisao={aoNovaRevisao} />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

function Item({
  doc,
  aoAbrir,
  aoNovaRevisao,
}: {
  doc: Documento
  aoAbrir(doc: Documento): void
  aoNovaRevisao(doc: Documento): void
}) {
  const repo = useRepositorioAdmin()
  const retirar = useRetirarDocumento()
  const [confirmando, setConfirmando] = useState(false)
  const [historico, setHistorico] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function baixar(caminho: string, nome: string) {
    setErro(null)
    try {
      salvarBlob(await repo.baixarDocumento(caminho), nome)
    } catch (e) {
      setErro(mensagemDe(e))
    }
  }

  return (
    <li data-testid={`documento-${doc.id}`}>
      <strong>{doc.titulo}</strong>
      <span className="central-sec">
        {[doc.codigo, doc.revisao, rotuloTipo(doc.tipo), tamanho(doc.bytes)].filter(Boolean).join(' · ')}
      </span>
      <span className="central-gestao-acoes">
        {temPrevia(doc) && (
          <button type="button" className="central-botao" aria-label="Ver" onClick={() => aoAbrir(doc)}>
            Ver
          </button>
        )}
        <button
          type="button"
          className="central-botao"
          aria-label="Baixar"
          onClick={() => void baixar(doc.caminho, doc.arquivoNome)}
        >
          Baixar
        </button>
        <button type="button" className="central-botao" aria-label="Nova revisão" onClick={() => aoNovaRevisao(doc)}>
          Nova revisão
        </button>
        <button
          type="button"
          className="central-botao central-botao-icone central-docs-fim"
          aria-label="Histórico"
          data-dica="Histórico de revisões"
          aria-expanded={historico}
          onClick={() => setHistorico((h) => !h)}
        >
          <IconeHistorico />
        </button>
        <button
          type="button"
          className="central-botao central-botao-icone"
          aria-label="Retirar"
          data-dica="Retirar documento"
          onClick={() => setConfirmando(true)}
        >
          <IconeRetirar />
        </button>
      </span>
      {confirmando && (
        <div className="central-gestao-form">
          <p className="central-sec">O arquivo fica guardado e continua no histórico.</p>
          <span className="central-gestao-acoes">
            <button
              type="button"
              className="central-botao central-botao-perigo"
              disabled={retirar.isPending}
              onClick={() => retirar.mutate(doc.id, { onSuccess: () => setConfirmando(false) })}
            >
              Confirmar: retirar
            </button>
            <button type="button" className="central-botao" onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
          </span>
        </div>
      )}
      {retirar.isError && (
        <p className="central-gestao-alerta" role="alert">
          {mensagemDe(retirar.error)}
        </p>
      )}
      {erro && (
        <p className="central-gestao-alerta" role="alert">
          {erro}
        </p>
      )}
      {historico && <Historico serie={doc.serie} aoBaixar={(r) => void baixar(r.caminho, r.arquivoNome)} />}
    </li>
  )
}

function Historico({ serie, aoBaixar }: { serie: string; aoBaixar(r: RevisaoDocumento): void }) {
  const consulta = useHistoricoDocumento(serie)
  return (
    <div className="central-docs-historico" aria-label="Revisões">
      <ComDados consulta={consulta}>
        {(revisoes: RevisaoDocumento[]) => (
          <ul className="central-gestao-lista">
            {revisoes.map((r) => (
              <li key={r.id}>
                <strong>{r.revisao}</strong>
                <span className="central-sec">
                  {data(r.enviadoEm)}
                  {r.enviadoPorNome ? ` · ${r.enviadoPorNome}` : ''}
                  {r.retiradoEm ? ` · retirada em ${data(r.retiradoEm)}` : ''}
                </span>
                <span className="central-gestao-acoes">
                  <button
                    type="button"
                    className="central-botao"
                    aria-label={`Baixar revisão ${r.revisao}`}
                    onClick={() => aoBaixar(r)}
                  >
                    Baixar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </ComDados>
    </div>
  )
}

function Formulario({
  obra,
  siglas,
  inicial,
  aoCancelar,
  aoEnviar,
}: {
  obra: ObraCentral
  siglas: string[]
  inicial: Rascunho
  aoCancelar(): void
  aoEnviar(d: Documento): void
}) {
  const repo = useRepositorioAdmin()
  const qc = useQueryClient()
  const [r, setR] = useState<Rascunho>(inicial)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const novaRevisao = inicial.serie !== undefined

  const mime = arquivo ? mimeDoArquivo(arquivo.name, arquivo.type) : ''
  const problema = arquivo
    ? problemaDocumento({
        titulo: r.titulo,
        tipo: r.tipo,
        revisao: r.revisao,
        codigo: r.codigo,
        disciplina: r.disciplina,
        arquivoNome: arquivo.name,
        bytes: arquivo.size,
        mime,
      })
    : null
  const pode = !!arquivo && !problema && !enviando

  function escolher(f: File) {
    setArquivo(f)
    setErro(null)
    if (novaRevisao) return
    const nome = f.name.replace(/\.[A-Za-z0-9]+$/, '')
    const sigla = (siglas.find((s) => new RegExp(`[-_]${s}[-_]`, 'i').test(f.name)) ?? '').toUpperCase()
    setR((a) => ({
      ...a,
      titulo: nome,
      tipo: tipoSugerido(extensaoArquivo(f.name)),
      disciplina: sigla || a.disciplina,
    }))
  }

  async function enviar() {
    if (!arquivo) return
    setErro(null)
    setEnviando(true)
    try {
      const bytes = new Uint8Array(await arquivo.arrayBuffer())
      const doc = await enviarDocumento({
        deps: {
          enviarArquivo: repo.enviarArquivo.bind(repo),
          registrarDocumento: repo.registrarDocumento.bind(repo),
          ...depsCripto,
        },
        obra: { id: obra.obra_id, slug: obra.slug },
        serie: inicial.serie,
        documento: {
          titulo: r.titulo,
          tipo: r.tipo,
          codigo: r.codigo,
          disciplina: r.disciplina,
          revisao: r.revisao,
          arquivoNome: arquivo.name,
          mime,
          bytes,
        },
      })
      void qc.invalidateQueries({ queryKey: ['admin'], predicate: (q) => q.queryKey[1] !== 'sessao' })
      aoEnviar(doc)
    } catch (e) {
      setErro(mensagemDe(e))
      setEnviando(false)
    }
  }

  return (
    <form
      className="central-gestao-form central-docs-form"
      aria-label={novaRevisao ? 'Nova revisão' : 'Enviar documento'}
      onSubmit={(e) => {
        e.preventDefault()
        if (pode) void enviar()
      }}
    >
      <label>
        Arquivo
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf,.xlsx,.docx"
          disabled={enviando}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) escolher(f)
          }}
        />
      </label>
      <label>
        Título
        <input value={r.titulo} disabled={enviando} onChange={(e) => setR({ ...r, titulo: e.target.value })} />
      </label>
      <label>
        Código (opcional)
        <input value={r.codigo} disabled={enviando} onChange={(e) => setR({ ...r, codigo: e.target.value })} />
      </label>
      <label>
        Tipo do documento
        <select
          value={r.tipo}
          disabled={enviando}
          onChange={(e) => setR({ ...r, tipo: e.target.value as TipoDocumento })}
        >
          {TIPOS_DOCUMENTO.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.rotulo}
            </option>
          ))}
        </select>
      </label>
      <label>
        Disciplina (opcional)
        <input
          value={r.disciplina}
          list="central-docs-siglas"
          maxLength={4}
          disabled={enviando}
          placeholder="ex.: ARQ"
          onChange={(e) => setR({ ...r, disciplina: e.target.value.toUpperCase().trim() })}
        />
        <datalist id="central-docs-siglas">
          {siglas.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <label>
        Revisão
        <input
          value={r.revisao}
          disabled={enviando}
          placeholder="ex.: R07"
          onChange={(e) => setR({ ...r, revisao: e.target.value.trim() })}
        />
      </label>
      {arquivo && (
        <p className="central-sec">
          {arquivo.name} · {tamanho(arquivo.size)}
        </p>
      )}
      {problema && (
        <p className="central-gestao-alerta" role="alert">
          {problema}
        </p>
      )}
      {enviando && (
        <p className="central-sec" role="status">
          Enviando…
        </p>
      )}
      {erro && (
        <p className="central-gestao-alerta" role="alert">
          {erro}
        </p>
      )}
      <div className="central-gestao-acoes">
        <button type="submit" className="central-botao central-botao-principal" disabled={!pode}>
          Enviar
        </button>
        <button type="button" className="central-botao" disabled={enviando} onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
