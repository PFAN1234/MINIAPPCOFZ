/**
 * Repositório de teste (VITE_DADOS=fixture). Usa os JSON reais da HTO e serve
 * as imagens por `/__plantas/` (plugin em `vite.config.ts`).
 * Nunca deve entrar no build de produção.
 */
import ambientesJson from '../../../data/hto/ambientes.json'
import plantasJson from '../../../data/hto/plantas.json'
import type { Repositorio } from './repositorio.ts'
import type {
  Ambiente,
  AmbienteDetalhe,
  DetalhePlanta,
  FiltroRegistros,
  ImagemPlanta,
  ObraDetalhe,
  ObraResumo,
  Pavimento,
  Planta,
  RecortePt,
  RegistroResumo,
} from './tipos.ts'

const ID_HTO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const ID_AURORA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e02'

const OBRAS: ObraResumo[] = [
  { id: ID_HTO, slug: 'hto', nome: 'HTO' },
  { id: ID_AURORA, slug: 'aurora', nome: 'Residencial Aurora' },
]

interface DetalheJson {
  arquivo: string
  recorte_pt: number[]
  largura: number
  altura: number
}
interface ImagemJson {
  largura: number
  altura: number
}
interface PavimentoJson {
  id: string
  nome: string
  revisao: string
  pagina_pt: number[]
  recorte_pt: number[]
  imagens: { planta: ImagemJson; 'planta-hd': ImagemJson }
  detalhes: Record<string, DetalheJson>
}

function caminho(rev: string, pav: string, resto: string): string {
  return `${ID_HTO}/${rev}/${pav}/${resto}`
}

function imagem(path: string, i: ImagemJson): ImagemPlanta {
  return { path, largura: i.largura, altura: i.altura }
}

const pavsJson = plantasJson.pavimentos as unknown as PavimentoJson[]

const plantasPorPavimento = new Map<string, Planta>(
  pavsJson.map((p) => [
    p.id,
    {
      id: `planta-${p.id}-${p.revisao}`,
      revisao: p.revisao,
      pagina_pt: p.pagina_pt as [number, number],
      recorte_pt: p.recorte_pt as RecortePt,
      imagem: imagem(caminho(p.revisao, p.id, 'planta.webp'), p.imagens.planta),
      imagem_hd: imagem(caminho(p.revisao, p.id, 'planta-hd.webp'), p.imagens['planta-hd']),
    },
  ]),
)

const PAVIMENTOS: Pavimento[] = ambientesJson.pavimentos.map((p, i) => ({
  id: p.id,
  codigo: p.id,
  nome: p.nome,
  ordem: i,
  planta: plantasPorPavimento.get(p.id) ?? null,
}))

const AMBIENTES_BASE = ambientesJson.ambientes.map((a) => ({
  id: a.id,
  codigo: a.id,
  pavimento_codigo: a.pavimento,
  nome_operacional: a.nome_operacional,
  nome_planta: a.nome_planta,
  categoria: a.categoria,
  area_m2: a.area_m2 ?? null,
  marcadores: a.marcadores.map((m) => ({ x: m.x, y: m.y })),
}))

function detalhePlanta(pav: string, codigo: string): DetalhePlanta | null {
  const p = pavsJson.find((x) => x.id === pav)
  const d = p?.detalhes[codigo]
  if (!p || !d) return null
  return {
    imagem: {
      path: caminho(p.revisao, pav, `ambientes/${codigo}.webp`),
      largura: d.largura,
      altura: d.altura,
    },
    recorte_pt: d.recorte_pt as RecortePt,
  }
}

function r(
  n: number,
  tipo: RegistroResumo['tipo'],
  situacao: RegistroResumo['situacao'],
  amb: string,
  autor: string,
  capturado: string,
  legenda: string,
): RegistroResumo {
  const a = AMBIENTES_BASE.find((x) => x.codigo === amb)!
  return {
    id: `00000000-0000-4000-8000-00000000010${n}`,
    tipo,
    situacao,
    legenda,
    autor,
    capturado_em: capturado,
    recebido_em: new Date(Date.parse(capturado) + 90_000).toISOString(),
    ambiente: { id: a.id, codigo: a.codigo, nome: a.nome_operacional },
    obra: { id: ID_HTO, slug: 'hto', nome: 'HTO' },
  }
}

const REGISTROS: RegistroResumo[] = [
  r(1, 'pendencia', 'aberta', 'terreo-apto-101', 'Marcos Teixeira', '2026-11-09T13:20:00Z', 'Tomada da sala sem espelho; refazer o acabamento.'),
  r(2, 'servico', null, 'terreo-apto-101', 'Juliana Prado', '2026-11-06T17:05:00Z', 'Contrapiso do quarto concluído e curado.'),
  r(3, 'pendencia', 'aberta', 'terreo-apto-102', 'Marcos Teixeira', '2026-11-08T11:40:00Z', 'Mancha de infiltração na parede do banheiro.'),
  r(4, 'servico', null, 'terreo-administracao', 'Juliana Prado', '2026-11-07T14:10:00Z', 'Instalação do forro de gesso finalizada.'),
  r(5, 'pendencia', 'aberta', '1pav-circulacao', 'Rafael Nogueira', '2026-11-05T09:30:00Z', 'Guarda-corpo com fixação folgada.'),
  r(6, 'pendencia', 'resolvida', 'terreo-circulacao-sul', 'Rafael Nogueira', '2026-11-03T15:45:00Z', 'Rejunte irregular no piso, já refeito.'),
]

function porRecente(a: RegistroResumo, b: RegistroResumo): number {
  return b.recebido_em.localeCompare(a.recebido_em)
}

function contarAbertas(): Map<string, number> {
  const m = new Map<string, number>()
  for (const x of REGISTROS) {
    if (x.tipo === 'pendencia' && x.situacao === 'aberta') {
      m.set(x.ambiente.id, (m.get(x.ambiente.id) ?? 0) + 1)
    }
  }
  return m
}

function ambientesComContagem(): Ambiente[] {
  const abertas = contarAbertas()
  return AMBIENTES_BASE.map((a) => ({ ...a, pendencias_abertas: abertas.get(a.id) ?? 0 }))
}

function obraPorSlug(slug: string): ObraResumo {
  const obra = OBRAS.find((o) => o.slug === slug)
  if (!obra) throw new Error('Obra não encontrada.')
  return obra
}

/** `<obra_id>/<revisao>/<pavimento>/...` vira `/__plantas/<revisao>/<pavimento>/...`. */
export function urlLocalDaImagem(path: string): string {
  const [, ...resto] = path.split('/')
  return `/__plantas/${resto.join('/')}`
}

export function criarRepositorioFixture(): Repositorio {
  return {
    async listarObras() {
      return OBRAS.map((o) => ({ ...o }))
    },

    async obterObra(slug): Promise<ObraDetalhe> {
      const obra = obraPorSlug(slug)
      if (obra.id !== ID_HTO) return { obra, pavimentos: [], ambientes: [] }
      return { obra, pavimentos: PAVIMENTOS, ambientes: ambientesComContagem() }
    },

    async obterAmbiente(slug, codigo): Promise<AmbienteDetalhe> {
      const obra = obraPorSlug(slug)
      const ambiente = ambientesComContagem().find((a) => a.codigo === codigo)
      if (obra.id !== ID_HTO || !ambiente) throw new Error('Ambiente não encontrado.')
      const pavimento = PAVIMENTOS.find((p) => p.codigo === ambiente.pavimento_codigo)!
      return {
        obra,
        ambiente,
        pavimento,
        planta: pavimento.planta,
        detalhe: detalhePlanta(pavimento.codigo, ambiente.codigo),
      }
    },

    async listarRegistros(filtro: FiltroRegistros) {
      let lista = REGISTROS.filter(
        (x) =>
          (!filtro.obraId || x.obra.id === filtro.obraId) &&
          (!filtro.ambienteId || x.ambiente.id === filtro.ambienteId) &&
          (!filtro.tipo || x.tipo === filtro.tipo) &&
          (!filtro.situacao || x.situacao === filtro.situacao),
      ).sort(porRecente)
      if (filtro.limite) lista = lista.slice(0, filtro.limite)
      return lista.map((x) => ({ ...x }))
    },

    async urlsImagens(paths) {
      return Object.fromEntries(paths.map((p) => [p, urlLocalDaImagem(p)]))
    },
  }
}
