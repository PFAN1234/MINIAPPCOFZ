import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { BucketObra } from '@modules/obras/domain/tiposAdmin.ts'
import ambientesCofz from '../../../../../data/cofz/ambientes.json'
import plantasCofz from '../../../../../data/cofz/plantas.json'
import ambientesHto from '../../../../../data/hto/ambientes.json'
import plantasHto from '../../../../../data/hto/plantas.json'
import type { PlantasRepositorio } from '../application/ports/PlantasRepositorio.port.ts'
import type { AmbienteBanco, ConfigObra, PlantaAtiva, Publicacao } from '../domain/tipos.ts'
import { ehWebp } from './pdf/render.ts'

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export interface AmbientesJson {
  ambientes: {
    id: string
    pavimento: string
    nome_operacional: string
    nome_planta: string | null
    categoria: string
    area_m2: number | null
    revisao: string
    marcadores: { x: number; y: number; rotulo_bbox?: [number, number, number, number] }[]
  }[]
  ambientes_removidos?: { id: string; pavimento: string; nome_operacional: string; revisao_ultima?: string | null }[]
}

interface PlantasJson {
  pavimentos: { id: string; revisao: string; sha256: string; pagina_pt: [number, number]; recorte_pt: number[] }[]
}

/** Estado da planta de uma obra na fixture (o que as RPCs da fase 2 leem e gravam). */
interface PlantaMemoria {
  ambientes: AmbienteBanco[]
  /** pavimento → planta ativa */
  plantas: Map<string, PlantaAtiva>
}

function plantaDoJson(ambientes: AmbientesJson, plantas: PlantasJson): PlantaMemoria {
  const lista: AmbienteBanco[] = ambientes.ambientes.map((a, i) => ({
    codigo: a.id,
    pavimento: a.pavimento,
    nome_operacional: a.nome_operacional,
    nome_planta: a.nome_planta,
    categoria: a.categoria,
    area_m2: a.area_m2,
    revisao_planta: a.revisao,
    marcadores: a.marcadores,
    ordem: i + 1,
    ativo: true,
  }))
  for (const r of ambientes.ambientes_removidos ?? []) {
    lista.push({
      codigo: r.id,
      pavimento: r.pavimento,
      nome_operacional: r.nome_operacional,
      nome_planta: null,
      categoria: 'area_comum',
      area_m2: null,
      revisao_planta: r.revisao_ultima ?? null,
      marcadores: [],
      ordem: lista.length + 1,
      ativo: false,
    })
  }
  return {
    ambientes: lista,
    plantas: new Map(
      plantas.pavimentos.map((p) => [
        p.id,
        {
          revisao: p.revisao,
          pdf_sha256: p.sha256,
          pagina_pt: p.pagina_pt,
          recorte_pt: p.recorte_pt as [number, number, number, number],
          criado_em: '2026-11-11T12:00:00Z',
        },
      ]),
    ),
  }
}

/** O que o adaptador lê e grava da obra da fixture do admin (a obra é mutável: a publicação atualiza a configuração e a contagem de ambientes). */
export interface ObraPlantaFixture {
  id: string
  slug: string
  nome: string
  config: ConfigObra | null
  config_atualizada_em: string | null
  config_atualizada_por: string | null
  pavimentos: { codigo: string; nome: string; ordem: number; ambientes: number }[]
}

/** O que o adaptador pede à fixture do admin (obras, sessão); o padrão basta para o contrato isolado. */
export interface DepsPlantasFixture {
  /** Lança se não houver sessão de admin. */
  exigirAdmin?: () => void
  /** Obra do slug; lança se não existir. */
  obraPorSlug: (slug: string) => ObraPlantaFixture
  /** Se o id existe entre as obras (o Storage só aceita a pasta de uma obra). */
  obraExiste: (id: string) => boolean
  /** Numeração das publicações (compartilhada com o resto da fixture, se houver). */
  proximoId?: () => number
  /** Quem aparece como autor das publicações. */
  nomeUsuario?: string
}

/** Além da porta, o que a fixture do admin usa para resumo, exclusão de obra e o bucket `modelos`. */
export interface PlantasFixture extends PlantasRepositorio {
  quantidadeAmbientes(obraId: string): number
  quantidadePlantas(obraId: string): number
  /** Arquivos da obra por bucket (a obra é a 1ª pasta do caminho em todos). */
  contarArquivos(obraId: string): Record<BucketObra, number>
  /** Tamanho de um arquivo do Storage (`<bucket>/<caminho>`); `undefined` se não houver. */
  tamanhoArquivo(chave: string): number | undefined
  /** Conteúdo de um arquivo do Storage (`<bucket>/<caminho>`); `undefined` se não houver. */
  conteudoArquivo(chave: string): Blob | undefined
  /** Apaga planta, publicações e arquivos da obra; devolve quantos arquivos saíram por bucket. */
  removerObra(obraId: string): Record<BucketObra, number>
}

/**
 * Adaptador de fixture da planta: planta ativa de cada obra (HTO e COFZ vêm de `data/<slug>/`),
 * publicações e Storage em memória, próprios de cada instância.
 */
export function criarPlantasFixture(deps: DepsPlantasFixture): PlantasFixture {
  let contador = 0
  const { obraPorSlug, obraExiste, exigirAdmin = () => {}, proximoId = () => ++contador, nomeUsuario = 'Você' } = deps
  const plantaPorObra = new Map<string, PlantaMemoria>([
    ['obra-hto', plantaDoJson(ambientesHto as unknown as AmbientesJson, plantasHto as unknown as PlantasJson)],
    ['obra-cofz', plantaDoJson(ambientesCofz as unknown as AmbientesJson, plantasCofz as unknown as PlantasJson)],
  ])
  const publicacoes: (Publicacao & { obra_id: string })[] = []
  const arquivos = new Map<string, Blob>()
  const plantaDe = (o: { id: string }): PlantaMemoria => {
    let p = plantaPorObra.get(o.id)
    if (!p) {
      p = { ambientes: [], plantas: new Map() }
      plantaPorObra.set(o.id, p)
    }
    return p
  }
  const ordenarPavs = (o: ObraPlantaFixture) =>
    [...o.pavimentos].sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo))

  return {
    async obterEditorPlanta(slug) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      const planta = plantaDe(o)
      const ordemPav = new Map(o.pavimentos.map((p) => [p.codigo, p.ordem]))
      return copia({
        obra: { id: o.id, slug: o.slug, nome: o.nome },
        config: o.config,
        config_atualizada_em: o.config_atualizada_em,
        pavimentos: ordenarPavs(o).map((p) => {
          const ultimo = publicacoes.find((x) => x.obra_id === o.id && x.pavimento === p.codigo)
          return {
            codigo: p.codigo,
            nome: p.nome,
            ordem: p.ordem,
            planta: planta.plantas.get(p.codigo) ?? null,
            ultimo_pdf: ultimo
              ? {
                  path: ultimo.pdf_path,
                  sha256: ultimo.pdf_sha256,
                  nome: ultimo.pdf_nome,
                  pagina: ultimo.pagina,
                  revisao: ultimo.revisao,
                  publicado_em: ultimo.publicado_em,
                }
              : null,
          }
        }),
        ambientes: [...planta.ambientes].sort(
          (a, b) => (ordemPav.get(a.pavimento) ?? 0) - (ordemPav.get(b.pavimento) ?? 0) || a.ordem - b.ordem,
        ),
      })
    },

    async listarPublicacoes(slug) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      return copia(publicacoes.filter((p) => p.obra_id === o.id).map((p) => ({ ...p, obra_id: undefined })))
    },

    async enviarArquivo(bucket, caminho, arquivo) {
      exigirAdmin()
      const obraId = caminho.split('/')[0]
      if (!obraExiste(obraId)) throw new ErroAdmin(`Sem permissão para gravar ${caminho} no Storage (${bucket}).`)
      if (bucket === 'originais' && !/\.pdf$/.test(caminho)) throw new ErroAdmin('O bucket originais só aceita PDF.')
      // Como as políticas `modelos_admin_*`: <obra_id>/<SIGLA>/<hash16>.frag.
      if (bucket === 'modelos' && !/^[^/]+\/[A-Z]{2,4}\/[0-9a-f]{16}\.frag$/.test(caminho)) {
        throw new ErroAdmin(`Sem permissão para gravar ${caminho} no Storage (${bucket}).`)
      }
      // Como as políticas `documentos_admin_*`: <obra_id>/<serie>/<sha256>.<ext>.
      if (bucket === 'documentos' && !/^[^/]+\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(pdf|png|jpg|webp|dwg|dxf|xlsx|docx)$/.test(caminho)) {
        throw new ErroAdmin(`Sem permissão para gravar ${caminho} no Storage (${bucket}).`)
      }
      // Como o Storage (allowed_mime_types): o bucket plantas só aceita WebP, e aqui conferimos os bytes.
      if (bucket === 'plantas' && !ehWebp(new Uint8Array(await arquivo.slice(0, 12).arrayBuffer()))) {
        throw new ErroAdmin(`O arquivo ${caminho} não é WebP.`)
      }
      arquivos.set(`${bucket}/${caminho}`, arquivo)
    },

    async baixarOriginal(caminho) {
      exigirAdmin()
      const b = arquivos.get(`originais/${caminho}`)
      if (!b) throw new ErroAdmin('Não foi possível baixar o PDF guardado.')
      return new Uint8Array(await b.arrayBuffer())
    },

    async publicarRevisao(slug, payload) {
      exigirAdmin()
      const o = obraPorSlug(slug)
      const p = payload as {
        pavimentos: {
          codigo: string
          revisao: string
          pdf: { path: string; sha256: string; nome: string; pagina: number }
          pagina_pt: [number, number]
          recorte_pt: [number, number, number, number]
          detalhes: Record<string, unknown>
          resumo?: Record<string, unknown>
        }[]
        ambientes: Omit<AmbienteBanco, 'ordem' | 'ativo' | 'revisao_planta'>[]
        ambientes_removidos?: string[]
        config?: ConfigObra
        config_atualizada_em?: string | null
      }
      if (p.config && (p.config_atualizada_em ?? null) !== o.config_atualizada_em) {
        throw new ErroAdmin('A configuração da obra foi alterada por outra pessoa. Recarregue a página e confira antes de publicar.')
      }
      for (const pav of p.pavimentos) {
        if (!o.pavimentos.some((x) => x.codigo === pav.codigo)) throw new ErroAdmin(`Pavimento não encontrado na obra: ${pav.codigo}`)
        if (!arquivos.has(`originais/${pav.pdf.path}`)) {
          throw new ErroAdmin(`PDF não encontrado no Storage (originais/${pav.pdf.path}): envie o arquivo antes de publicar`)
        }
        const base = `plantas/${o.id}/${pav.revisao}/${pav.codigo}/`
        const faltando = ['planta.webp', 'planta-hd.webp', ...Object.keys(pav.detalhes).map((c) => `ambientes/${c}.webp`)]
          .filter((n) => !arquivos.has(base + n))
        if (faltando.length) throw new ErroAdmin(`Imagens não encontradas no Storage (plantas): ${faltando.join(', ')}`)
      }
      const codigos = new Set(p.ambientes.map((a) => a.codigo))
      for (const a of p.ambientes) {
        if (!p.pavimentos.some((x) => x.codigo === a.pavimento && a.codigo in x.detalhes)) {
          throw new ErroAdmin(`Falta o detalhe (recorte) do ambiente ${a.codigo}`)
        }
      }
      const planta = plantaDe(o)
      const revisaoDe = new Map(p.pavimentos.map((x) => [x.codigo, x.revisao]))
      p.ambientes.forEach((a, i) => {
        const novo: AmbienteBanco = { ...copia(a), revisao_planta: revisaoDe.get(a.pavimento) ?? null, ordem: i + 1, ativo: true }
        const k = planta.ambientes.findIndex((x) => x.codigo === a.codigo)
        if (k >= 0) planta.ambientes[k] = novo
        else planta.ambientes.push(novo)
      })
      let inativados = 0
      const removidos = new Set(p.ambientes_removidos ?? [])
      for (const a of planta.ambientes) {
        if (a.ativo && (removidos.has(a.codigo) || (revisaoDe.has(a.pavimento) && !codigos.has(a.codigo)))) {
          a.ativo = false
          inativados++
        }
      }
      const ordemPav = new Map(o.pavimentos.map((x) => [x.codigo, x.ordem]))
      planta.ambientes
        .filter((a) => a.ativo)
        .sort((a, b) => (ordemPav.get(a.pavimento) ?? 0) - (ordemPav.get(b.pavimento) ?? 0) || a.ordem - b.ordem)
        .forEach((a, i) => {
          a.ordem = i + 1
        })
      const agora = new Date().toISOString()
      const feitas = p.pavimentos.map((pav) => {
        planta.plantas.set(pav.codigo, {
          revisao: pav.revisao,
          pdf_sha256: pav.pdf.sha256,
          pagina_pt: pav.pagina_pt,
          recorte_pt: pav.recorte_pt,
          criado_em: agora,
        })
        const pv = o.pavimentos.find((x) => x.codigo === pav.codigo)!
        pv.ambientes = planta.ambientes.filter((a) => a.ativo && a.pavimento === pav.codigo).length
        const id = `publicacao-${proximoId()}`
        publicacoes.unshift({
          id,
          obra_id: o.id,
          pavimento: pav.codigo,
          pavimento_nome: pv.nome,
          revisao: pav.revisao,
          publicado_em: agora,
          publicado_por_nome: nomeUsuario,
          pdf_path: pav.pdf.path,
          pdf_sha256: pav.pdf.sha256,
          pdf_nome: pav.pdf.nome,
          pagina: pav.pdf.pagina,
          resumo: { ...(pav.resumo ?? {}), ambientes: p.ambientes.filter((a) => a.pavimento === pav.codigo).length },
        })
        return { id, pavimento: pav.codigo, revisao: pav.revisao }
      })
      if (p.config) {
        o.config = { ...copia(p.config), status: 'aguardando_revisao_humana' }
        o.config_atualizada_em = agora
        o.config_atualizada_por = nomeUsuario
      }
      return { publicacoes: feitas, ambientes_ativos: planta.ambientes.filter((a) => a.ativo).length, inativados }
    },

    quantidadeAmbientes: (obraId) => plantaPorObra.get(obraId)?.ambientes.length ?? 0,
    quantidadePlantas: (obraId) => plantaPorObra.get(obraId)?.plantas.size ?? 0,
    contarArquivos(obraId) {
      const contagem: Record<BucketObra, number> = { fotos: 0, plantas: 0, originais: 0, modelos: 0 }
      for (const k of arquivos.keys()) {
        const [bucket, obra] = k.split('/')
        if (obra === obraId && bucket in contagem) contagem[bucket as BucketObra]++
      }
      return contagem
    },
    tamanhoArquivo: (chave) => arquivos.get(chave)?.size,
    conteudoArquivo: (chave) => arquivos.get(chave),
    removerObra(obraId) {
      plantaPorObra.delete(obraId)
      const removidos: Record<BucketObra, number> = { fotos: 0, plantas: 0, originais: 0, modelos: 0 }
      for (const k of [...arquivos.keys()]) {
        const [bucket, obra] = k.split('/')
        if (obra !== obraId) continue
        arquivos.delete(k)
        if (bucket in removidos) removidos[bucket as BucketObra]++
      }
      for (let i = publicacoes.length - 1; i >= 0; i--) if (publicacoes[i].obra_id === obraId) publicacoes.splice(i, 1)
      return removidos
    },
  }
}
