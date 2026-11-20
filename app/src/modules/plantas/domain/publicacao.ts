/** Payload de `admin_publicar_revisao` e o PDF de origem (puro: sem Storage nem DOM). */
import { configParaSalvar, type EstadoEdicao, type Extracao } from './editor.ts'
import { caminhoOriginal, type PlantaCalculada } from './plantas.ts'
import type { DadosEditorPlanta, ResultadoExtracao } from './tipos.ts'

export interface ArquivoPdf {
  nome: string
  bytes: Uint8Array
  sha256: string
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
