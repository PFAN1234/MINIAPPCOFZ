import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Repositorio } from './repositorio.ts'
import type {
  Ambiente,
  AmbienteDetalhe,
  DetalhePlanta,
  FiltroRegistros,
  ImagemPlanta,
  Marcador,
  ObraDetalhe,
  ObraResumo,
  Pavimento,
  Planta,
  RecortePt,
  RegistroResumo,
} from './tipos.ts'

const SEGUNDOS_URL_ASSINADA = 3600

/** Cliente só com a URL e a chave publicável; o acesso é protegido por RLS. */
export function criarClienteSupabase(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL
  const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !chave) {
    throw new Error(
      'Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY (ou use VITE_DADOS=fixture).',
    )
  }
  return createClient(url, chave)
}

function checar<T>(resposta: { data: T | null; error: { message: string } | null }): T {
  if (resposta.error) throw new Error(resposta.error.message)
  return resposta.data as T
}

type Linha = Record<string, unknown>

function imagem(path: unknown, largura: unknown, altura: unknown): ImagemPlanta {
  return { path: String(path), largura: Number(largura), altura: Number(altura) }
}

function numeros(valor: unknown): number[] {
  return (valor as unknown[]).map(Number)
}

function mapearPlanta(l: Linha): Planta {
  return {
    id: String(l.id),
    revisao: String(l.revisao),
    pagina_pt: [Number(l.pagina_largura_pt), Number(l.pagina_altura_pt)],
    recorte_pt: numeros(l.recorte_pt) as RecortePt,
    imagem: imagem(l.imagem_path, l.imagem_largura, l.imagem_altura),
    imagem_hd: l.imagem_hd_path
      ? imagem(l.imagem_hd_path, l.imagem_hd_largura, l.imagem_hd_altura)
      : null,
  }
}

function mapearPavimentos(pavs: Linha[], plantas: Linha[]): Pavimento[] {
  return pavs.map((p) => {
    const planta = plantas.find((x) => x.pavimento_id === p.id)
    return {
      id: String(p.id),
      codigo: String(p.codigo),
      nome: String(p.nome),
      ordem: Number(p.ordem),
      planta: planta ? mapearPlanta(planta) : null,
    }
  })
}

function mapearAmbiente(
  l: Linha,
  codigoPavimento: Map<string, string>,
  pendencias: Map<string, number>,
): Ambiente {
  return {
    id: String(l.id),
    codigo: String(l.codigo),
    pavimento_codigo: codigoPavimento.get(String(l.pavimento_id)) ?? '',
    nome_operacional: String(l.nome_operacional),
    nome_planta: String(l.nome_planta),
    categoria: String(l.categoria),
    area_m2: l.area_m2 == null ? null : Number(l.area_m2),
    marcadores: (l.marcadores as Marcador[] | null) ?? [],
    pendencias_abertas: pendencias.get(String(l.id)) ?? 0,
  }
}

const COLUNAS_AMBIENTE =
  'id, codigo, pavimento_id, nome_operacional, nome_planta, categoria, area_m2, marcadores'

export function criarRepositorioSupabase(
  cliente: SupabaseClient = criarClienteSupabase(),
): Repositorio {
  async function obraPorSlug(slug: string): Promise<ObraResumo> {
    const linha = checar(
      await cliente.from('obra').select('id, slug, nome').eq('slug', slug).maybeSingle(),
    ) as ObraResumo | null
    if (!linha) throw new Error('Obra não encontrada.')
    return linha
  }

  async function plantasAtivas(obraId: string): Promise<Linha[]> {
    return checar(
      await cliente.from('planta').select('*').eq('obra_id', obraId).eq('ativa', true),
    ) as Linha[]
  }

  return {
    async temSessao() {
      const { data } = await cliente.auth.getSession()
      return data.session !== null
    },

    async listarObras() {
      return checar(
        await cliente.from('obra').select('id, slug, nome').order('ordem').order('nome'),
      ) as ObraResumo[]
    },

    async obterObra(slug): Promise<ObraDetalhe> {
      const obra = await obraPorSlug(slug)
      const [pavs, plantas, ambs, abertas] = await Promise.all([
        cliente.from('pavimento').select('*').eq('obra_id', obra.id).order('ordem'),
        plantasAtivas(obra.id),
        cliente.from('ambiente').select(COLUNAS_AMBIENTE).eq('obra_id', obra.id).order('ordem'),
        cliente
          .from('registro')
          .select('ambiente_id')
          .eq('obra_id', obra.id)
          .eq('tipo', 'pendencia')
          .eq('situacao', 'aberta'),
      ])
      const pavimentos = mapearPavimentos(checar(pavs) as Linha[], plantas)
      const codigos = new Map(pavimentos.map((p) => [p.id, p.codigo]))
      const contagem = new Map<string, number>()
      for (const r of checar(abertas) as Linha[]) {
        const id = String(r.ambiente_id)
        contagem.set(id, (contagem.get(id) ?? 0) + 1)
      }
      const ambientes = (checar(ambs) as Linha[]).map((a) =>
        mapearAmbiente(a, codigos, contagem),
      )
      return { obra, pavimentos, ambientes }
    },

    async obterAmbiente(slug, codigo): Promise<AmbienteDetalhe> {
      const obra = await obraPorSlug(slug)
      const linha = checar(
        await cliente
          .from('ambiente')
          .select(COLUNAS_AMBIENTE)
          .eq('obra_id', obra.id)
          .eq('codigo', codigo)
          .maybeSingle(),
      ) as Linha | null
      if (!linha) throw new Error('Ambiente não encontrado.')
      const [pav, plantas, abertas] = await Promise.all([
        cliente.from('pavimento').select('*').eq('id', linha.pavimento_id).single(),
        cliente
          .from('planta')
          .select('*')
          .eq('pavimento_id', linha.pavimento_id)
          .eq('ativa', true),
        cliente
          .from('registro')
          .select('id', { count: 'exact', head: true })
          .eq('ambiente_id', linha.id)
          .eq('tipo', 'pendencia')
          .eq('situacao', 'aberta'),
      ])
      const pavLinha = checar(pav) as Linha
      const plantaLinhas = checar(plantas) as Linha[]
      const pavimento = mapearPavimentos([pavLinha], plantaLinhas)[0]
      const ambiente = mapearAmbiente(
        linha,
        new Map([[pavimento.id, pavimento.codigo]]),
        new Map([[String(linha.id), abertas.count ?? 0]]),
      )
      let detalhe: DetalhePlanta | null = null
      if (pavimento.planta) {
        const d = checar(
          await cliente
            .from('planta_detalhe')
            .select('imagem_path, recorte_pt, largura, altura')
            .eq('planta_id', pavimento.planta.id)
            .eq('ambiente_id', linha.id)
            .maybeSingle(),
        ) as Linha | null
        if (d) {
          detalhe = {
            imagem: imagem(d.imagem_path, d.largura, d.altura),
            recorte_pt: numeros(d.recorte_pt) as RecortePt,
          }
        }
      }
      return { obra, ambiente, pavimento, planta: pavimento.planta, detalhe }
    },

    async listarRegistros(filtro: FiltroRegistros): Promise<RegistroResumo[]> {
      let q = cliente
        .from('registro')
        .select(
          'id, tipo, situacao, legenda, capturado_em, recebido_em, ' +
            'autor:usuario(nome), ambiente(id, codigo, nome_operacional), obra(id, slug, nome)',
        )
        .order('recebido_em', { ascending: false })
      if (filtro.obraId) q = q.eq('obra_id', filtro.obraId)
      if (filtro.ambienteId) q = q.eq('ambiente_id', filtro.ambienteId)
      if (filtro.tipo) q = q.eq('tipo', filtro.tipo)
      if (filtro.situacao) q = q.eq('situacao', filtro.situacao)
      if (filtro.limite) q = q.limit(filtro.limite)
      const linhas = checar(await q) as unknown as Linha[]
      return linhas.map((l) => {
        const amb = l.ambiente as Linha
        return {
          id: String(l.id),
          tipo: l.tipo as RegistroResumo['tipo'],
          situacao: (l.situacao as RegistroResumo['situacao']) ?? null,
          legenda: String(l.legenda),
          autor: String((l.autor as Linha | null)?.nome ?? 'Autor desconhecido'),
          capturado_em: String(l.capturado_em),
          recebido_em: String(l.recebido_em),
          ambiente: {
            id: String(amb.id),
            codigo: String(amb.codigo),
            nome: String(amb.nome_operacional),
          },
          obra: l.obra as RegistroResumo['obra'],
        }
      })
    },

    async urlsImagens(paths) {
      const unicos = [...new Set(paths)]
      if (unicos.length === 0) return {}
      const dados = checar(
        await cliente.storage.from('plantas').createSignedUrls(unicos, SEGUNDOS_URL_ASSINADA),
      )
      const mapa: Record<string, string> = {}
      for (const item of dados) {
        if (item.path && item.signedUrl) mapa[item.path] = item.signedUrl
      }
      return mapa
    },
  }
}
