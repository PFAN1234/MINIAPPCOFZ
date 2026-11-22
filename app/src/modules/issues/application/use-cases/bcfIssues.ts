/**
 * Importar e exportar issues em BCF (etapa 7D). Orquestra o mapeamento (`domain/bcf.ts`), o arquivo
 * (`infra/bcf/bcfZip.ts`) e a porta de issues; imagens e GlobalIds entram por funções injetadas.
 */
import type { Ponto3, RefElemento } from '../../../modelos/domain/central.ts'
import {
  globalIdsDoTopico,
  issueParaTopicoBcf,
  topicoBcfParaTopico,
  type PacoteBcf,
  type VersaoBcf,
} from '../../domain/bcf.ts'
import {
  caminhoImagemVista,
  IMAGEM_VISTA_MAX_BYTES,
  type Issue,
  type ResultadoImportacaoBcf,
  type TopicoBcf,
} from '../../domain/issues.ts'
import type { DepsIssueComVista } from './criarIssueComVista.ts'

/** Leitura e escrita do arquivo (`infra/bcf/bcfZip.ts`), injetadas para a camada não depender da infraestrutura. */
export interface CodecBcf {
  ler(dados: Uint8Array): PacoteBcf
  escrever(pacote: PacoteBcf): Uint8Array
}

/** A RPC aceita até 1000 tópicos por chamada. */
const LOTE_TOPICOS = 500

export function nomeArquivoBcf(slug: string, data: Date = new Date()): string {
  return `${slug}-issues-${data.toISOString().slice(0, 10)}.bcfzip`
}

export interface ResultadoExportacao {
  dados: Uint8Array
  topicos: number
  /** Vistas que foram sem snapshot (sem imagem ou falha ao baixar). */
  semImagem: number
}

export async function exportarIssuesBcf(args: {
  codec: Pick<CodecBcf, 'escrever'>
  issues: Issue[]
  versao: VersaoBcf
  projeto: { id: string; nome: string } | null
  /** Bytes da imagem da vista, ou `null` se não há/ não deu para baixar. */
  baixarImagem(imagemPath: string): Promise<Uint8Array | null>
  origemCena?: Ponto3
}): Promise<ResultadoExportacao> {
  const { codec, issues, versao, projeto, baixarImagem, origemCena } = args
  let semImagem = 0
  const topicos = []
  for (const issue of issues) {
    const imagens = new Map<string, Uint8Array | null>()
    for (const v of issue.vistas) {
      let bytes: Uint8Array | null = null
      if (v.imagemPath) {
        try {
          bytes = await baixarImagem(v.imagemPath)
        } catch {
          bytes = null
        }
      }
      if (!bytes) semImagem++
      imagens.set(v.guid, bytes)
    }
    topicos.push(issueParaTopicoBcf(issue, { imagens, origemCena }))
  }
  return { dados: codec.escrever({ versao, projeto, topicos } satisfies PacoteBcf), topicos: topicos.length, semImagem }
}

export interface ResumoImportacaoBcf extends ResultadoImportacaoBcf {
  elementosNaoEncontrados: number
  imagensNaoEnviadas: number
}

export function resumoImportacao(r: ResumoImportacaoBcf): string {
  const n = (k: number, um: string, varios: string) => `${k} ${k === 1 ? um : varios}`
  return [
    n(r.criadas, 'criada', 'criadas'),
    n(r.atualizadas, 'atualizada', 'atualizadas'),
    n(r.elementosNaoEncontrados, 'elemento não encontrado', 'elementos não encontrados'),
    n(r.imagensNaoEnviadas, 'imagem não enviada', 'imagens não enviadas'),
  ].join(', ')
}

export interface DepsImportacaoBcf extends DepsIssueComVista {
  importarBcf(obraId: string, topicos: TopicoBcf[]): Promise<ResultadoImportacaoBcf>
  listarIssues(obraId: string): Promise<Issue[]>
}

export async function importarArquivoBcf(args: {
  codec: Pick<CodecBcf, 'ler'>
  deps: DepsImportacaoBcf
  obraId: string
  dados: Uint8Array
  /** Disciplinas carregadas, na ordem em que o GlobalId é procurado. */
  siglas: string[]
  existem(refs: RefElemento[]): Promise<(boolean | null)[]>
  /** Converte o snapshot (PNG ou JPEG) em PNG de até 5 MB; rejeita se não conseguir. */
  paraPng(bytes: Uint8Array): Promise<Blob>
  origemCena?: Ponto3
}): Promise<ResumoImportacaoBcf> {
  const { codec, deps, obraId, dados, siglas, existem, paraPng, origemCena } = args
  const pacote = codec.ler(dados)
  if (pacote.topicos.length === 0) throw new Error('O arquivo BCF não tem nenhum tópico para importar.')

  // Disciplina de cada GlobalId: a primeira carregada que o contém.
  const ids = [...new Set(pacote.topicos.flatMap(globalIdsDoTopico))]
  const siglaPorId = new Map<string, string>()
  if (ids.length && siglas.length) {
    const refs = ids.flatMap((globalId) => siglas.map((sigla) => ({ sigla, globalId })))
    const achou = await existem(refs)
    refs.forEach((r, i) => {
      if (achou[i] === true && !siglaPorId.has(r.globalId)) siglaPorId.set(r.globalId, r.sigla)
    })
  }
  const siglaDe = (g: string) => siglaPorId.get(g) ?? null

  let elementosNaoEncontrados = 0
  const topicos: TopicoBcf[] = []
  for (const t of pacote.topicos) {
    const r = topicoBcfParaTopico(t, { siglaDe, origemCena })
    elementosNaoEncontrados += r.descartados
    topicos.push(r.topico)
  }

  let criadas = 0
  let atualizadas = 0
  for (let i = 0; i < topicos.length; i += LOTE_TOPICOS) {
    const r = await deps.importarBcf(obraId, topicos.slice(i, i + LOTE_TOPICOS))
    criadas += r.criadas
    atualizadas += r.atualizadas
  }

  // Snapshots: só das vistas do arquivo que ainda estão sem imagem no banco.
  const comSnapshot = pacote.topicos.flatMap((t) =>
    t.viewpoints.filter((v) => v.snapshot).map((v) => ({ topico: t.guid, vista: v.guid, bytes: v.snapshot as Uint8Array })),
  )
  let imagensNaoEnviadas = 0
  if (comSnapshot.length) {
    let issues: Issue[] = []
    try {
      issues = await deps.listarIssues(obraId)
    } catch {
      imagensNaoEnviadas = comSnapshot.length
    }
    for (const s of imagensNaoEnviadas ? [] : comSnapshot) {
      const issue = issues.find((i) => i.guid === s.topico)
      const vista = issue?.vistas.find((v) => v.guid === s.vista)
      if (!issue || !vista) {
        // Vista descartada na importação (sem câmera) ou issue de outro lugar: não há onde anexar.
        if (topicos.find((t) => t.guid === s.topico)?.vistas?.some((v) => v.guid === s.vista)) imagensNaoEnviadas++
        continue
      }
      if (vista.imagemPath) continue
      try {
        const png = await paraPng(s.bytes)
        if (png.size > IMAGEM_VISTA_MAX_BYTES) throw new Error('A imagem da vista passa de 5 MB.')
        const caminho = caminhoImagemVista(obraId, issue.id, vista.id)
        await deps.enviarArquivo('issues', caminho, png, 'image/png')
        await deps.salvarVistaIssue(issue.id, vista.id, vista.vista, caminho)
      } catch {
        imagensNaoEnviadas++
      }
    }
  }
  return { criadas, atualizadas, elementosNaoEncontrados, imagensNaoEnviadas }
}
