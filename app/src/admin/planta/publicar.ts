/**
 * Publicação de um pavimento: gera as imagens (como o `gerar_plantas.py`), envia o PDF para
 * `originais` e as WebP para `plantas` (upsert) e chama `admin_publicar_revisao` (o mesmo
 * efeito do seed do `gerar_seed.py`). A ordem garante que a RPC só rode com tudo no Storage.
 */
import type { Bucket, DadosEditorPlanta, ResultadoPublicacao } from '../dados/tipos.ts'
import { configParaSalvar, type EstadoEdicao, type Extracao } from './editor.ts'
import { calcularPlanta, caminhoOriginal, caminhosPlanta, type PlantaCalculada } from './plantas.ts'
import type { PaginaAberta } from './servico.ts'
import type { ResultadoExtracao } from './tipos.ts'

export interface ArquivoPdf {
  nome: string
  bytes: Uint8Array
  sha256: string
}

export interface Progresso {
  feito: number
  total: number
  texto: string
}

export interface DepsPublicacao {
  enviarArquivo(bucket: Bucket, caminho: string, arquivo: Blob, tipo: string): Promise<void>
  publicarRevisao(slug: string, payload: unknown): Promise<ResultadoPublicacao>
}

/** Payload da RPC `admin_publicar_revisao` para um pavimento. */
export function montarPayload(args: {
  dados: DadosEditorPlanta
  pav: string
  edicao: EstadoEdicao
  extracao: Extracao
  calculada: PlantaCalculada
  pdf: ArquivoPdf
}) {
  const { dados, pav, edicao, extracao, calculada, pdf } = args
  const r: ResultadoExtracao = extracao.resultado
  const ambientes = r.ambientes.filter((a) => a.pavimento === pav)
  return {
    pavimentos: [
      {
        codigo: pav,
        revisao: edicao.revisao,
        pdf: {
          path: caminhoOriginal(dados.obra.id, edicao.revisao, pav, pdf.sha256),
          sha256: pdf.sha256,
          nome: pdf.nome,
          pagina: edicao.pagina,
        },
        pagina_pt: calculada.pagina_pt,
        recorte_pt: calculada.recorte_pt,
        imagem: { largura: calculada.imagens.planta.largura, altura: calculada.imagens.planta.altura },
        imagem_hd: { largura: calculada.imagens['planta-hd'].largura, altura: calculada.imagens['planta-hd'].altura },
        detalhes: Object.fromEntries(
          Object.entries(calculada.detalhes).map(([id, d]) => [
            id,
            { recorte_pt: d.recorte_pt, largura: d.largura, altura: d.altura },
          ]),
        ),
        resumo: { diferencas: r.diferencas, revisar: r.revisar.length },
      },
    ],
    ambientes: ambientes.map((a) => ({
      codigo: a.id,
      pavimento: a.pavimento,
      nome_operacional: a.nome_operacional,
      nome_planta: a.nome_planta,
      categoria: a.categoria,
      area_m2: a.area_m2,
      marcadores: a.marcadores,
    })),
    ambientes_removidos: r.ambientes_removidos.map((x) => x.id),
    config: configParaSalvar(dados, pav, edicao, extracao.config),
    config_atualizada_em: dados.config_atualizada_em,
  }
}

/** Gera, envia e publica. `aoProgredir` recebe cada passo (para a barra de progresso). */
export async function publicarPavimento(args: {
  deps: DepsPublicacao
  dados: DadosEditorPlanta
  pav: string
  edicao: EstadoEdicao
  extracao: Extracao
  pagina: PaginaAberta
  pdf: ArquivoPdf
  aoProgredir?: (p: Progresso) => void
}): Promise<ResultadoPublicacao> {
  const { deps, dados, pav, edicao, extracao, pagina, pdf, aoProgredir } = args
  const ambientes = extracao.resultado.ambientes.filter((a) => a.pavimento === pav)
  const calculada = calcularPlanta(edicao.prancha, pagina, ambientes)
  const caminhos = caminhosPlanta(dados.obra.id, edicao.revisao, pav)
  const ids = Object.keys(calculada.detalhes)
  const total = 1 + 2 + ids.length + 1
  let feito = 0
  const passo = (texto: string) => aoProgredir?.({ feito, total, texto })
  const concluir = () => {
    feito++
  }

  passo('Enviando o PDF original…')
  await deps.enviarArquivo(
    'originais',
    caminhoOriginal(dados.obra.id, edicao.revisao, pav, pdf.sha256),
    new Blob([pdf.bytes as BlobPart], { type: 'application/pdf' }),
    'application/pdf',
  )
  concluir()

  for (const [nome, img, caminho] of [
    ['visão geral', calculada.imagens.planta, caminhos.planta],
    ['visão em alta resolução', calculada.imagens['planta-hd'], caminhos.hd],
  ] as const) {
    passo(`Gerando a ${nome}…`)
    const blob = await pagina.webp(img, calculada.mascaras)
    await deps.enviarArquivo('plantas', caminho, blob, 'image/webp')
    concluir()
  }

  for (const id of ids) {
    passo(`Recorte de ${ambientes.find((a) => a.id === id)?.nome_operacional ?? id} (${feito - 2} de ${ids.length})…`)
    const blob = await pagina.webp(calculada.detalhes[id], calculada.mascaras)
    await deps.enviarArquivo('plantas', caminhos.detalhe(id), blob, 'image/webp')
    concluir()
  }

  passo('Gravando ambientes e planta no banco…')
  const payload = montarPayload({ dados, pav, edicao, extracao, calculada, pdf })
  const resultado = await deps.publicarRevisao(dados.obra.slug, payload)
  concluir()
  aoProgredir?.({ feito, total, texto: 'Publicado.' })
  return resultado
}
