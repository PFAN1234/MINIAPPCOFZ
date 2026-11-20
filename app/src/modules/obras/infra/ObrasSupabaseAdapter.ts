import type { SupabaseClient } from '@supabase/supabase-js'
import { erroDoSupabase } from '../../../dados/erros.ts'
import type { RecortePt, Marcador } from '@shared/kernel/tipos.ts'
import type { Ambiente, AmbienteDetalhe, DetalhePlanta, Etapa, ImagemPlanta, ObraDaLista, ObraDetalhe, ObraResumo, Pavimento, Planta, ResumoObra } from '../domain/tipos.ts'
import type { ObrasRepositorio } from '../application/ports/ObrasRepositorio.port.ts'
import type { Linha } from './validacao.ts'

function mapearEtapa(l: Linha | null | undefined): Etapa {
  return {
    id: String(l?.id ?? ''),
    slug: String(l?.slug ?? ''),
    nome: String(l?.nome ?? ''),
    ordem: Number(l?.ordem ?? 0),
  }
}

function checar<T>(resposta: { data: T | null; error: { message: string } | null }): T {
  if (resposta.error) throw new Error(resposta.error.message)
  return resposta.data as T
}

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
    nome_planta: l.nome_planta == null ? null : String(l.nome_planta),
    categoria: String(l.categoria),
    area_m2: l.area_m2 == null ? null : Number(l.area_m2),
    marcadores: (l.marcadores as Marcador[] | null) ?? [],
    pendencias_abertas: pendencias.get(String(l.id)) ?? 0,
    ativo: l.ativo !== false,
  }
}

const COLUNAS_AMBIENTE =
  'id, codigo, pavimento_id, nome_operacional, nome_planta, categoria, area_m2, marcadores, ativo'

export function criarObrasSupabase(cliente: SupabaseClient): ObrasRepositorio {
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
  async resumoObras() {
    try {
      const { data, error } = await cliente.rpc('resumo_obras')
      if (error) throw error
      return ((data ?? []) as Linha[]).map(
        (l): ResumoObra => ({
          obra_id: String(l.obra_id),
          papel: l.papel === 'gestor' || l.papel === 'equipe' ? l.papel : null,
          servicos: Number(l.servicos ?? 0),
          abertas: Number(l.abertas ?? 0),
          resolvidas: Number(l.resolvidas ?? 0),
        }),
      )
    } catch (e) {
      throw erroDoSupabase(e)
    }
  },

  async listarObras() {
    const linhas = checar(
      await cliente
        .from('obra')
        .select('id, slug, nome, etapa(id, slug, nome, ordem)')
        .order('ordem')
        .order('nome'),
    ) as Linha[]
    return linhas.map(
      (l): ObraDaLista => ({
        id: String(l.id),
        slug: String(l.slug),
        nome: String(l.nome),
        etapa: mapearEtapa(l.etapa as Linha | null),
      }),
    )
  },

  async obterObra(slug): Promise<ObraDetalhe> {
    const obra = await obraPorSlug(slug)
    const { data: sessao } = await cliente.auth.getSession()
    const [pavs, plantas, ambs, abertas, partic] = await Promise.all([
      cliente.from('pavimento').select('*').eq('obra_id', obra.id).order('ordem'),
      plantasAtivas(obra.id),
      cliente.from('ambiente').select(COLUNAS_AMBIENTE).eq('obra_id', obra.id).order('ordem'),
      cliente
        .from('registro')
        .select('ambiente_id')
        .eq('obra_id', obra.id)
        .eq('tipo', 'pendencia')
        .eq('situacao', 'aberta'),
      cliente
        .from('participacao')
        .select('papel')
        .eq('obra_id', obra.id)
        .eq('usuario_id', sessao.session?.user.id ?? '')
        .maybeSingle(),
    ])
    const papel = (checar(partic) as Linha | null)?.papel === 'gestor' ? 'gestor' : 'equipe'
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
    return { obra, papel, pavimentos, ambientes }
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
  }
}
