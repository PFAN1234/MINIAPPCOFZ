/**
 * Publicação de um pavimento: gera as imagens (como o `gerar_plantas.py`), envia o PDF para
 * `originais` e as WebP para `plantas` (upsert) e chama `admin_publicar_revisao` (o mesmo
 * efeito do seed do `gerar_seed.py`). A ordem garante que a RPC só rode com tudo no Storage.
 */
import type { EstadoEdicao, Extracao } from '../../domain/editor.ts'
import { calcularPlanta, caminhoOriginal, caminhosPlanta } from '../../domain/plantas.ts'
import { montarPayload, type ArquivoPdf } from '../../domain/publicacao.ts'
import type { DadosEditorPlanta, ResultadoPublicacao } from '../../domain/tipos.ts'
import type { PlantasRepositorio } from '../ports/PlantasRepositorio.port.ts'
import type { PaginaAberta } from '../ports/ServicoPdfPort.port.ts'

export interface Progresso {
  feito: number
  total: number
  texto: string
}

export type DepsPublicacao = Pick<PlantasRepositorio, 'enviarArquivo' | 'publicarRevisao'>

/** Gera, envia e publica. `aoProgredir` recebe cada passo (para a barra de progresso). */
export async function publicarRevisaoPlanta(args: {
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
