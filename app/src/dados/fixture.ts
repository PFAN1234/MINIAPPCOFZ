/**
 * Repositório de teste (VITE_DADOS=fixture). Usa os JSON reais da HTO e serve
 * as imagens por `/__plantas/` (plugin em `vite.config.ts`).
 * Nunca deve entrar no build de produção.
 */
import ambientesJson from '../../../data/hto/ambientes.json'
import plantasJson from '../../../data/hto/plantas.json'
import { ErroEnvio } from './erros.ts'
import type { Repositorio } from './repositorio.ts'
import type {
  Ambiente,
  AmbienteDetalhe,
  DetalhePlanta,
  EstadoPublicacao,
  FiltroRegistros,
  FotoRegistro,
  ImagemPlanta,
  NovoRegistro,
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
  publicacao: EstadoPublicacao,
  nFotos = 1,
): RegistroResumo {
  const a = AMBIENTES_BASE.find((x) => x.codigo === amb)!
  const id = `00000000-0000-4000-8000-00000000010${n}`
  // Fotos de exemplo: recortes da planta, servidos por /__plantas/.
  const base = detalhePlanta(a.pavimento_codigo, a.codigo)?.imagem
  const pav = pavsJson.find((x) => x.id === a.pavimento_codigo)!
  const modelo = base ?? imagem(caminho(pav.revisao, pav.id, 'planta.webp'), pav.imagens.planta)
  const fotos: FotoRegistro[] = Array.from({ length: nFotos }, (_, k) => ({
    id: `00000000-0000-4000-8000-0000000002${n}${k}`,
    path: modelo.path,
    largura: modelo.largura,
    altura: modelo.altura,
  }))
  return {
    id,
    tipo,
    situacao,
    legenda,
    autor,
    capturado_em: capturado,
    recebido_em: new Date(Date.parse(capturado) + 90_000).toISOString(),
    ambiente: { id: a.id, codigo: a.codigo, nome: a.nome_operacional },
    obra: { id: ID_HTO, slug: 'hto', nome: 'HTO' },
    fotos,
    publicacao,
  }
}

const REGISTROS: RegistroResumo[] = [
  r(1, 'pendencia', 'aberta', 'terreo-apto-101', 'Marcos Teixeira', '2026-11-09T13:20:00Z', 'Tomada da sala sem espelho; refazer o acabamento.', 'publicado', 2),
  r(2, 'servico', null, 'terreo-apto-101', 'Juliana Prado', '2026-11-06T17:05:00Z', 'Contrapiso do quarto concluído e curado.', 'publicado', 1),
  r(3, 'pendencia', 'aberta', 'terreo-apto-102', 'Marcos Teixeira', '2026-11-08T11:40:00Z', 'Mancha de infiltração na parede do banheiro.', 'pendente', 1),
  r(4, 'servico', null, 'terreo-administracao', 'Juliana Prado', '2026-11-07T14:10:00Z', 'Instalação do forro de gesso finalizada.', 'publicado', 3),
  r(5, 'pendencia', 'aberta', '1pav-circulacao', 'Rafael Nogueira', '2026-11-05T09:30:00Z', 'Guarda-corpo com fixação folgada.', 'falhou', 1),
  r(6, 'pendencia', 'resolvida', 'terreo-circulacao-sul', 'Rafael Nogueira', '2026-11-03T15:45:00Z', 'Rejunte irregular no piso, já refeito.', 'publicado', 1),
]

function porRecente(a: RegistroResumo, b: RegistroResumo): number {
  return b.recebido_em.localeCompare(a.recebido_em)
}

function contarAbertas(registros: RegistroResumo[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const x of registros) {
    if (x.tipo === 'pendencia' && x.situacao === 'aberta') {
      m.set(x.ambiente.id, (m.get(x.ambiente.id) ?? 0) + 1)
    }
  }
  return m
}

function ambientesComContagem(registros: RegistroResumo[]): Ambiente[] {
  const abertas = contarAbertas(registros)
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMITE_BLOB = 10 * 1024 * 1024
const AUTOR_FIXTURE = 'Você (teste)'

function falhaValidacao(msg: string): never {
  throw new ErroEnvio('validacao', msg)
}

function inteiroPositivo(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999_999_999
}

export function criarRepositorioFixture(): Repositorio {
  const novos: RegistroResumo[] = []
  /** Objetos "enviados ao Storage": caminho no bucket `fotos` -> blob. */
  const blobs = new Map<string, Blob>()
  const urlsDosBlobs = new Map<string, string>()
  const todos = () => [...REGISTROS, ...novos]

  function vinculada(path: string): boolean {
    return novos.some((n) => n.fotos.some((f) => f.path === path))
  }

  return {
    async listarObras() {
      return OBRAS.map((o) => ({ ...o }))
    },

    async obterObra(slug): Promise<ObraDetalhe> {
      const obra = obraPorSlug(slug)
      if (obra.id !== ID_HTO) return { obra, pavimentos: [], ambientes: [] }
      return { obra, pavimentos: PAVIMENTOS, ambientes: ambientesComContagem(todos()) }
    },

    async obterAmbiente(slug, codigo): Promise<AmbienteDetalhe> {
      const obra = obraPorSlug(slug)
      const ambiente = ambientesComContagem(todos()).find((a) => a.codigo === codigo)
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
      let lista = todos()
        .filter(
          (x) =>
            (!filtro.obraId || x.obra.id === filtro.obraId) &&
            (!filtro.ambienteId || x.ambiente.id === filtro.ambienteId) &&
            (!filtro.tipo || x.tipo === filtro.tipo) &&
            (!filtro.situacao || x.situacao === filtro.situacao),
        )
        .sort(porRecente)
      if (filtro.limite) lista = lista.slice(0, filtro.limite)
      return lista.map((x) => ({ ...x, fotos: x.fotos.map((f) => ({ ...f })) }))
    },

    async urlsImagens(paths, bucket = 'plantas') {
      return Object.fromEntries(
        paths.map((p) => {
          const blob = bucket === 'fotos' ? blobs.get(p) : undefined
          if (!blob) return [p, urlLocalDaImagem(p)]
          let url = urlsDosBlobs.get(p)
          if (!url) {
            url = URL.createObjectURL(blob)
            urlsDosBlobs.set(p, url)
          }
          return [p, url]
        }),
      )
    },

    async enviarFoto({ obraId, registroId, fotoId }, blob) {
      for (const [v, nome] of [[obraId, 'obra'], [registroId, 'registro'], [fotoId, 'foto']] as const) {
        if (!UUID.test(v)) falhaValidacao(`Identificador inválido (${nome}).`)
      }
      if (blob.type !== '' && blob.type !== 'image/jpeg') falhaValidacao('A foto deve ser JPEG.')
      if (blob.size > LIMITE_BLOB) falhaValidacao('A foto é grande demais para ser enviada.')
      const path = `${obraId}/${registroId}/${fotoId}.jpg`
      // Como a política fotos_update: foto já vinculada não pode ser sobrescrita.
      if (vinculada(path)) {
        throw new ErroEnvio('permissao', 'Sem permissão para enviar esta foto.')
      }
      blobs.set(path, blob)
    },

    async concluirRegistro(d: NovoRegistro) {
      const amb = AMBIENTES_BASE.find((a) => a.id === d.ambienteId)
      if (!UUID.test(d.id) || !d.ambienteId) falhaValidacao('Identificadores obrigatórios')
      if (!amb) throw new ErroEnvio('nao_encontrado', 'Ambiente não encontrado')

      const existente = novos.find((n) => n.id === d.id)
      if (existente) {
        if (existente.ambiente.id === d.ambienteId) return { id: existente.id }
        throw new ErroEnvio('conflito', 'registro_id em uso')
      }

      if (d.tipo !== 'servico' && d.tipo !== 'pendencia') falhaValidacao('Tipo de registro inválido')
      const legenda = (d.legenda ?? '').replace(/^\s+|\s+$/g, '')
      if (legenda.length < 1 || legenda.length > 1000) {
        falhaValidacao('A legenda deve ter de 1 a 1000 caracteres')
      }
      const capturado = Date.parse(d.capturadoEm)
      if (Number.isNaN(capturado) || capturado > Date.now() + 5 * 60_000) {
        falhaValidacao('Data de captura inválida')
      }

      if (!Array.isArray(d.fotos) || d.fotos.length < 1 || d.fotos.length > 10) {
        falhaValidacao('Envie de 1 a 10 fotos')
      }
      const vistos = new Set<string>()
      d.fotos.forEach((f, i) => {
        if (typeof f.id !== 'string' || !UUID.test(f.id)) {
          falhaValidacao(`Foto ${i + 1} com identificador inválido`)
        }
        const chave = f.id.toLowerCase()
        if (vistos.has(chave)) falhaValidacao('Identificador de foto repetido')
        vistos.add(chave)
        for (const campo of ['largura', 'altura', 'bytes'] as const) {
          if (!inteiroPositivo(f[campo])) {
            falhaValidacao(`Foto ${i + 1}: ${campo} deve ser um inteiro positivo`)
          }
        }
      })
      const fotos: FotoRegistro[] = d.fotos.map((f) => ({
        id: f.id,
        path: `${ID_HTO}/${d.id}/${f.id}.jpg`,
        largura: f.largura,
        altura: f.altura,
      }))
      for (const f of fotos) {
        if (!blobs.has(f.path)) {
          falhaValidacao(`Foto ${f.id} ainda não foi enviada ao armazenamento`)
        }
      }

      const agora = new Date().toISOString()
      novos.push({
        id: d.id,
        tipo: d.tipo,
        situacao: d.tipo === 'pendencia' ? 'aberta' : null,
        legenda,
        autor: AUTOR_FIXTURE,
        capturado_em: new Date(capturado).toISOString(),
        recebido_em: agora,
        ambiente: { id: amb.id, codigo: amb.codigo, nome: amb.nome_operacional },
        obra: { id: ID_HTO, slug: 'hto', nome: 'HTO' },
        fotos,
        publicacao: 'pendente',
      })
      return { id: d.id }
    },
  }
}
