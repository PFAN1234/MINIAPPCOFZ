import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js'
import { criarAcessosSupabase } from '@modules/acessos/infra/AcessosSupabaseAdapter.ts'
import { criarEquipeServicoSupabase } from '@modules/acessos/infra/EquipeServicoSupabaseAdapter.ts'
import { criarSessaoSupabase } from '@modules/acessos/infra/SessaoSupabaseAdapter.ts'
import { criarModelosSupabase } from '@modules/modelos/infra/ModelosSupabaseAdapter.ts'
import { criarRaSupabase } from '@modules/ra/infra/RaSupabaseAdapter.ts'
import { ErroEnvio, erroDoSupabase } from './erros.ts'
import { configurarEnvioErros } from '../shared/infra/erros.ts'
import { limitesPeriodo } from '../util/periodo.ts'
import { nomeMostrado } from './nome.ts'
import { FUSO_PADRAO, dataNoFuso } from '../shared/kernel/fuso.ts'
import type { Repositorio } from './repositorio.ts'
import type { Ambiente, AmbienteDetalhe, DetalhePlanta, EstadoPublicacao, EtapaInicio, FiltroRegistros, FotoRegistro, ImagemPlanta, Marcador, NovaObservacao, NovoEncerramento, NovoRegistro, Etapa, Observacao, ObservacoesDoDia, ObraDaLista, ObraDetalhe, ObraResumo, Organizacao, ResumoObra, Pavimento, PendenciaDetalhe, Planta, PublicacaoProblema, RecortePt, RegistroLocalizado, RegistroResumo, PainelRelatorios, Relatorios, ResultadoExclusaoBoletim } from './tipos.ts'

const SEGUNDOS_URL_ASSINADA = 3600
const LOTE_IN = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function exigirUuid(valor: string, nome: string): string {
  if (!UUID.test(valor)) throw new ErroEnvio('validacao', `Identificador inválido (${nome}).`)
  return valor
}

/** Cliente só com a URL e a chave publicável; o acesso é protegido por RLS. */
export function criarClienteSupabase(opcoes?: SupabaseClientOptions<'public'>): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL
  const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !chave) {
    throw new Error(
      'Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY (ou use VITE_DADOS=fixture).',
    )
  }
  return createClient(url, chave, opcoes)
}

/** URL pública do logo no bucket (público) `organizacao`. */
export function urlPublicaLogo(logoPath: string): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const caminho = logoPath.split('/').map(encodeURIComponent).join('/')
  return `${base}/storage/v1/object/public/organizacao/${caminho}`
}

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

type Linha = Record<string, unknown>

function lotes<T>(itens: T[]): T[][] {
  const saida: T[][] = []
  for (let i = 0; i < itens.length; i += LOTE_IN) saida.push(itens.slice(i, i + LOTE_IN))
  return saida
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

const MENSAGEM_JA_ENCERRADA = 'Esta pendência já foi encerrada.'

/** Linha de `observacoes_do_dia` (ou o retorno de `salvar_observacao`) no tipo do app. */
function mapearObservacao(l: Linha, padrao: { minha: boolean; travada: boolean }): Observacao {
  const autor = (l.autor as Linha | null) ?? {}
  return {
    id: String(l.id),
    data: String(l.data),
    texto: String(l.texto),
    escrito_em: String(l.escrito_em),
    editado_em: l.editado_em ? String(l.editado_em) : null,
    autor: { id: String(autor.id ?? ''), nome: nomeMostrado(autor) ?? 'Autor desconhecido' },
    minha: typeof l.minha === 'boolean' ? l.minha : padrao.minha,
    travada: typeof l.travada === 'boolean' ? l.travada : padrao.travada,
  }
}

const COLUNAS_REGISTRO =
  'id, tipo, situacao, legenda, capturado_em, recebido_em, autor:usuario(nome, nome_exibicao), '

const COLUNAS_AMBIENTE =
  'id, codigo, pavimento_id, nome_operacional, nome_planta, categoria, area_m2, marcadores, ativo'

export function criarRepositorioSupabase(
  cliente: SupabaseClient = criarClienteSupabase(),
): Repositorio {
  configurarEnvioErros(cliente, 'miniapp')
  const ra = criarRaSupabase(cliente)
  const modelos = criarModelosSupabase(cliente)
  const acessos = criarAcessosSupabase(cliente)
  const sessao = criarSessaoSupabase(cliente)
  const equipe = criarEquipeServicoSupabase(cliente)
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

  /** Consultas separadas (sem embed) para evitar ambiguidade de relacionamento no PostgREST. */
  async function fotosDosRegistros(ids: string[]): Promise<Map<string, FotoRegistro[]>> {
    const mapa = new Map<string, FotoRegistro[]>()
    for (const lote of lotes(ids)) {
      const linhas = checar(
        await cliente
          .from('foto')
          .select('*')
          .in('registro_id', lote)
          .order('ordem'),
      ) as Linha[]
      for (const f of linhas) {
        const chave = String(f.registro_id)
        const lista = mapa.get(chave) ?? []
        lista.push({
          id: String(f.id),
          path: String(f.storage_path),
          largura: Number(f.largura),
          altura: Number(f.altura),
          // A coluna só existe depois da migration da RA.
          ...(f.origem === 'ra_limpa' || f.origem === 'ra_modelo' ? { origem: f.origem } : {}),
        })
        mapa.set(chave, lista)
      }
    }
    return mapa
  }

  async function fotosDoEncerramento(encerramentoId: string): Promise<FotoRegistro[]> {
    const linhas = checar(
      await cliente
        .from('foto')
        .select('*')
        .eq('encerramento_id', encerramentoId)
        .order('ordem'),
    ) as Linha[]
    return linhas.map((f) => ({
      id: String(f.id),
      path: String(f.storage_path),
      largura: Number(f.largura),
      altura: Number(f.altura),
    }))
  }

  /** Converte as linhas de `registro` (com ambiente e obra embutidos) em resumos, com fotos e publicação. */
  async function resumirRegistros(linhas: Linha[]): Promise<RegistroResumo[]> {
    const ids = linhas.map((l) => String(l.id))
    const [fotos, publicacoes] = await Promise.all([
      fotosDosRegistros(ids),
      publicacoesDosRegistros(ids),
    ])
    return linhas.map((l) => {
      const amb = l.ambiente as Linha
      return {
        id: String(l.id),
        tipo: l.tipo as RegistroResumo['tipo'],
        situacao: (l.situacao as RegistroResumo['situacao']) ?? null,
        legenda: String(l.legenda),
        autor: nomeMostrado(l.autor as Linha | null) ?? 'Autor desconhecido',
        capturado_em: String(l.capturado_em),
        recebido_em: String(l.recebido_em),
        ambiente: {
          id: String(amb.id),
          codigo: String(amb.codigo),
          nome: String(amb.nome_operacional),
          pavimento: (amb.pavimento as Linha | null)?.nome
            ? String((amb.pavimento as Linha).nome)
            : undefined,
        },
        obra: l.obra as RegistroResumo['obra'],
        fotos: fotos.get(String(l.id)) ?? [],
        publicacao: publicacoes.get(String(l.id)) ?? null,
      }
    })
  }

  /** Chama uma RPC e converte a falha em `ErroEnvio`. */
  async function chamar(nome: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const { data, error } = await cliente.rpc(nome, args)
      if (error) throw error
      return data
    } catch (e) {
      throw erroDoSupabase(e)
    }
  }

  async function publicacoesDosRegistros(
    ids: string[],
  ): Promise<Map<string, EstadoPublicacao>> {
    const mapa = new Map<string, EstadoPublicacao>()
    for (const lote of lotes(ids)) {
      const linhas = checar(
        await cliente
          .from('publicacao_telegram')
          .select('registro_id, estado')
          .in('registro_id', lote)
          .order('id'),
      ) as Linha[]
      for (const p of linhas) mapa.set(String(p.registro_id), p.estado as EstadoPublicacao)
    }
    return mapa
  }

  return {
    obterGeometria: ra.obterGeometria,
    temSessao: sessao.temSessao,
    idUsuario: sessao.idUsuario,
    souAdmin: sessao.souAdmin,
    criarLinkAdmin: sessao.criarLinkAdmin,
    equipeServico: equipe.equipeServico,
    fazerCheckin: equipe.fazerCheckin,
    fazerCheckout: equipe.fazerCheckout,
    obrasDisponiveis: acessos.obrasDisponiveis,
    solicitarAcesso: acessos.solicitarAcesso,
    listarSolicitacoes: acessos.listarSolicitacoes,
    decidirSolicitacao: acessos.decidirSolicitacao,
    matrizAcessos: acessos.matrizAcessos,
    definirAcesso: acessos.definirAcesso,
    listarParticipantes: acessos.listarParticipantes,
    definirPapel: acessos.definirPapel,
    removerParticipante: acessos.removerParticipante,

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

    async etapasInicio() {
      try {
        const { data, error } = await cliente.rpc('etapas_inicio')
        if (error) throw error
        return ((data ?? []) as Linha[]).map(
          (l): EtapaInicio => ({
            id: String(l.id),
            slug: String(l.slug ?? ''),
            nome: String(l.nome),
            ordem: Number(l.ordem ?? 0),
            participa: l.participa === true,
          }),
        )
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async relatorios(): Promise<Relatorios> {
      const d = (await chamar('listar_relatorios', {})) as Linha | null
      const texto = (v: unknown) => (v == null ? null : String(v))
      return {
        admin: d?.admin === true,
        etapas: ((d?.etapas as Linha[] | null) ?? []).map((e) => {
          const b = e.boletim_hoje as Linha | null
          const p = e.pedido_hoje as Linha | null
          return {
            id: String(e.id),
            slug: String(e.slug),
            nome: String(e.nome),
            sigla: texto(e.sigla),
            horario: String(e.horario ?? '').slice(0, 5),
            hoje: String(e.hoje),
            registros_hoje: Number(e.registros_hoje ?? 0),
            boletim_hoje: b
              ? { id: String(b.id), numero: String(b.numero), revisao: Number(b.revisao ?? 0), emitido_em: String(b.emitido_em) }
              : null,
            pedido_hoje: p ? { estado: String(p.estado), erro: texto(p.erro) } : null,
          }
        }),
        boletins: ((d?.boletins as Linha[] | null) ?? []).map((b) => ({
          id: String(b.id),
          etapa_id: String(b.etapa_id),
          etapa_slug: String(b.etapa_slug),
          etapa_nome: String(b.etapa_nome),
          data: String(b.data),
          revisao: Number(b.revisao ?? 0),
          numero: String(b.numero),
          emitido_em: String(b.emitido_em),
          pdf_path: texto(b.pdf_path),
          publicado: b.publicado === true,
          ultima_revisao: b.ultima_revisao === true,
        })),
      }
    },

    async painelRelatorios(etapaId): Promise<PainelRelatorios> {
      const d = (await chamar('painel_relatorios', { p_etapa: etapaId })) as Linha | null
      const e = (d?.etapa ?? {}) as Linha
      return {
        etapa: { id: String(e.id), slug: String(e.slug), nome: String(e.nome), hoje: String(e.hoje) },
        obras: ((d?.obras as Linha[] | null) ?? []).map((o) => ({ id: String(o.id), slug: String(o.slug), nome: String(o.nome) })),
        dias: ((d?.dias as Linha[] | null) ?? []).map((x) => ({
          obra_id: String(x.obra_id),
          dia: String(x.dia),
          servicos: Number(x.servicos ?? 0),
          pendencias: Number(x.pendencias ?? 0),
          resolvidas: Number(x.resolvidas ?? 0),
        })),
      }
    },

    async exportarPendencias(etapaId, obraId): Promise<string> {
      const { data } = await cliente.auth.getSession()
      const jwt = data.session?.access_token
      if (!jwt) throw new ErroEnvio('sessao', 'Sua sessão expirou. Abra o app novamente pelo Telegram.')
      const padrao = 'Não foi possível gerar o relatório. Tente de novo.'
      let resposta: Response
      try {
        resposta = await fetch('/api/relatorio-pendencias', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ etapa_id: etapaId, obra_id: obraId }),
        })
      } catch (e) {
        throw erroDoSupabase(e)
      }
      const json = (await resposta.json().catch(() => null)) as Linha | null
      if (!resposta.ok) {
        throw new Error(typeof json?.erro === 'string' && json.erro ? json.erro : padrao)
      }
      if (typeof json?.url !== 'string' || !json.url) throw new Error(padrao)
      return json.url
    },

    async urlPdfBoletim(caminho) {
      try {
        const { data, error } = await cliente.storage.from('boletins').createSignedUrl(caminho, 300)
        if (error) throw error
        return data.signedUrl
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async emitirBoletim(slug, data) {
      try {
        const { error } = await cliente.rpc('admin_pedir_emissao', { p_slug: slug, p_data: data })
        if (error) throw error
      } catch (e) {
        const codigo = (e as { code?: unknown } | null)?.code
        if (codigo === '23505') {
          throw new ErroEnvio('conflito', 'Já existe uma emissão em andamento para esta data.', { cause: e })
        }
        throw erroDoSupabase(e)
      }
    },

    async excluirBoletim(id): Promise<ResultadoExclusaoBoletim> {
      const { data } = await cliente.auth.getSession()
      const jwt = data.session?.access_token
      if (!jwt) throw new ErroEnvio('sessao', 'Sua sessão expirou. Abra o app novamente pelo Telegram.')
      const base = String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, '')
      let resposta: Response
      try {
        resposta = await fetch(`${base}/functions/v1/admin-excluir-obra`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({ acao: 'excluir_boletim', boletim_id: id }),
        })
      } catch (e) {
        throw erroDoSupabase(e)
      }
      const json = (await resposta.json().catch(() => null)) as Linha | null
      if (resposta.status !== 200 || !json) {
        const falhas: Record<number, ErroEnvio> = {
          401: new ErroEnvio('sessao', 'Sua sessão expirou. Abra o app novamente pelo Telegram.'),
          403: new ErroEnvio('permissao', 'Apenas admins do Mini App podem excluir boletins.'),
          404: new ErroEnvio('nao_encontrado', 'Boletim não encontrado.'),
          409: new ErroEnvio('conflito', 'O boletim está sendo gerado ou enviado. Tente de novo em alguns minutos.'),
        }
        const texto = typeof json?.erro === 'string' ? json.erro : null
        throw falhas[resposta.status] ?? new ErroEnvio('desconhecido', texto ?? 'Não foi possível excluir. Tente de novo.')
      }
      const m = (json.mensagens ?? {}) as { apagadas?: unknown; falhas?: unknown }
      return {
        numero: String(json.numero),
        data: String(json.data),
        revisoes: Number(json.revisoes ?? 0),
        mensagens: { apagadas: Number(m.apagadas ?? 0), falhas: Number(m.falhas ?? 0) },
        arquivos_erro: typeof json.arquivos_erro === 'string' ? json.arquivos_erro : null,
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

    async organizacao(): Promise<Organizacao> {
      try {
        const { data, error } = await cliente.rpc('organizacao')
        if (error) throw error
        const l = (Array.isArray(data) ? data[0] : data) as Linha | null
        const logo = typeof l?.logo_path === 'string' && l.logo_path ? l.logo_path : null
        return {
          nome: typeof l?.nome === 'string' ? l.nome : '',
          logo_url: logo ? urlPublicaLogo(logo) : null,
        }
      } catch (e) {
        throw erroDoSupabase(e)
      }
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

    async listarRegistros(filtro: FiltroRegistros): Promise<RegistroResumo[]> {
      // `!inner` faz o filtro pelo ambiente/obra descartar os registros, e não só o embed.
      const ambInner = filtro.ambienteCodigo ? '!inner' : ''
      const obraInner = filtro.obraSlug || filtro.etapaId ? '!inner' : ''
      const colunasObra = filtro.etapaId ? 'id, slug, nome, etapa_id' : 'id, slug, nome'
      let q = cliente
        .from('registro')
        .select(
          COLUNAS_REGISTRO +
            `ambiente${ambInner}(id, codigo, nome_operacional, pavimento(nome)), obra${obraInner}(${colunasObra})`,
        )
        .order('recebido_em', { ascending: false })
      if (filtro.obraId) q = q.eq('obra_id', filtro.obraId)
      if (filtro.obraSlug) q = q.eq('obra.slug', filtro.obraSlug)
      if (filtro.ambienteId) q = q.eq('ambiente_id', filtro.ambienteId)
      if (filtro.ambienteCodigo) q = q.eq('ambiente.codigo', filtro.ambienteCodigo)
      if (filtro.tipo) q = q.eq('tipo', filtro.tipo)
      if (filtro.situacao) q = q.eq('situacao', filtro.situacao)
      if (filtro.etapaId) q = q.eq('obra.etapa_id', filtro.etapaId)
      if (filtro.autorId) q = q.eq('autor_id', filtro.autorId)
      const { desde, antes } = limitesPeriodo(filtro.de, filtro.ate)
      if (desde) q = q.gte('capturado_em', desde)
      if (antes) q = q.lt('capturado_em', antes)
      if (filtro.limite) q = q.limit(filtro.limite)
      return resumirRegistros(checar(await q) as unknown as Linha[])
    },

    async autoresRegistros() {
      const { data, error } = await cliente.rpc('autores_registros')
      if (error) throw error
      return ((data ?? []) as Linha[]).map((l) => ({
        id: String(l.id),
        nome: nomeMostrado(l) ?? 'Autor desconhecido',
      }))
    },

    async obterPendencia(id): Promise<PendenciaDetalhe | null> {
      if (!UUID.test(id)) return null
      const linha = checar(
        await cliente
          .from('registro')
          .select(
            COLUNAS_REGISTRO +
              'ambiente(id, codigo, nome_operacional, pavimento_id, pavimento(nome)), obra(id, slug, nome)',
          )
          .eq('id', id)
          .eq('tipo', 'pendencia')
          .maybeSingle(),
      ) as unknown as Linha | null
      if (!linha) return null
      const obra = linha.obra as ObraResumo
      const { data: sessao } = await cliente.auth.getSession()
      const [resumos, pav, partic, enc] = await Promise.all([
        resumirRegistros([linha]),
        cliente
          .from('pavimento')
          .select('codigo, nome')
          .eq('id', (linha.ambiente as Linha).pavimento_id as string)
          .single(),
        cliente
          .from('participacao')
          .select('papel')
          .eq('obra_id', obra.id)
          .eq('usuario_id', sessao.session?.user.id ?? '')
          .maybeSingle(),
        cliente
          .from('encerramento')
          .select('id, observacao, encerrado_em, gestor:usuario(nome, nome_exibicao)')
          .eq('registro_id', id)
          .maybeSingle(),
      ])
      const pavLinha = checar(pav) as Linha
      const encLinha = checar(enc) as unknown as Linha | null
      let encerramento: PendenciaDetalhe['encerramento'] = null
      if (encLinha) {
        const encId = String(encLinha.id)
        const [fotos, pub] = await Promise.all([
          fotosDoEncerramento(encId),
          cliente
            .from('publicacao_telegram')
            .select('estado')
            .eq('encerramento_id', encId)
            .maybeSingle(),
        ])
        encerramento = {
          id: encId,
          observacao: encLinha.observacao ? String(encLinha.observacao) : null,
          encerrado_em: String(encLinha.encerrado_em),
          gestor: nomeMostrado(encLinha.gestor as Linha | null) ?? 'Gestor desconhecido',
          fotos,
          publicacao: ((checar(pub) as Linha | null)?.estado as EstadoPublicacao) ?? null,
        }
      }
      return {
        registro: resumos[0],
        pavimento: { codigo: String(pavLinha.codigo), nome: String(pavLinha.nome) },
        papel: (checar(partic) as Linha | null)?.papel === 'gestor' ? 'gestor' : 'equipe',
        encerramento,
      }
    },

    async encerrarPendencia(d: NovoEncerramento) {
      try {
        await chamar('encerrar_pendencia', {
          p_id: exigirUuid(d.id, 'encerramento'),
          p_registro_id: exigirUuid(d.registroId, 'registro'),
          p_observacao: d.observacao,
          p_fotos: d.fotos,
        })
        return { id: d.id }
      } catch (e) {
        const erro = erroDoSupabase(e)
        if (erro.tipo === 'conflito' && /encerrada/i.test(erro.message)) {
          throw new ErroEnvio('conflito', MENSAGEM_JA_ENCERRADA, { cause: e })
        }
        throw erro
      }
    },

    async listarPublicacoesProblema(obraId) {
      const dados = await chamar('listar_publicacoes_problema', {
        p_obra: exigirUuid(obraId, 'obra'),
      })
      return ((dados ?? []) as Linha[]).map(
        (l): PublicacaoProblema => ({
          id: Number(l.id),
          estado: l.estado as EstadoPublicacao,
          erro: l.erro ? String(l.erro) : null,
          tentativas: Number(l.tentativas),
          atualizado_em: String(l.atualizado_em),
          registro_id: String(l.registro_id),
          encerramento_id: l.encerramento_id ? String(l.encerramento_id) : null,
          tipo: l.tipo as PublicacaoProblema['tipo'],
          legenda: String(l.legenda ?? ''),
          ambiente: String(l.ambiente ?? ''),
        }),
      )
    },

    async republicar(id) {
      await chamar('republicar', { p_id: id })
    },

    async marcarPublicada(id) {
      await chamar('marcar_publicada', { p_id: id })
    },

    listarModelos: modelos.listarModelos,
    baixarModelo: modelos.baixarModelo,

    async urlsImagens(paths, bucket = 'plantas') {
      const unicos = [...new Set(paths)]
      if (unicos.length === 0) return {}
      const dados = checar(
        await cliente.storage.from(bucket).createSignedUrls(unicos, SEGUNDOS_URL_ASSINADA),
      )
      const mapa: Record<string, string> = {}
      for (const item of dados) {
        if (item.path && item.signedUrl) mapa[item.path] = item.signedUrl
      }
      return mapa
    },

    async enviarFoto({ obraId, registroId, fotoId }, blob) {
      const caminho = `${exigirUuid(obraId, 'obra')}/${exigirUuid(registroId, 'registro')}/${exigirUuid(fotoId, 'foto')}.jpg`
      try {
        const { error } = await cliente.storage
          .from('fotos')
          .upload(caminho, blob, { upsert: true, contentType: 'image/jpeg' })
        if (error) throw error
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async localizarRegistro(id): Promise<RegistroLocalizado | null> {
      if (!UUID.test(id)) return null
      const linha = checar(
        await cliente
          .from('registro')
          .select('tipo, ambiente(codigo), obra(slug)')
          .eq('id', id)
          .maybeSingle(),
      ) as unknown as { tipo: RegistroLocalizado['tipo']; ambiente: { codigo: string }; obra: { slug: string } } | null
      if (!linha) return null
      return { slug: linha.obra.slug, codigo: linha.ambiente.codigo, tipo: linha.tipo }
    },

    async observacoesDoDia(obraId): Promise<ObservacoesDoDia> {
      const [dados, obraLinha] = await Promise.all([
        chamar('observacoes_do_dia', { p_obra: exigirUuid(obraId, 'obra') }),
        cliente.from('obra').select('etapa_id, etapa(fuso)').eq('id', obraId).maybeSingle(),
      ])
      const observacoes = ((dados ?? []) as Linha[]).map((l) =>
        mapearObservacao(l, { minha: false, travada: false }),
      )
      const obra = (obraLinha.error ? null : obraLinha.data) as Linha | null
      const fusoEtapa = (obra?.etapa as Linha | null)?.fuso
      const fuso = typeof fusoEtapa === 'string' && fusoEtapa ? fusoEtapa : FUSO_PADRAO
      const data = observacoes[0]?.data ?? dataNoFuso(new Date(), fuso)
      let travada = observacoes[0]?.travada ?? false
      // Sem observações a RPC não diz se o dia travou: confere se já há boletim da etapa no dia.
      if (observacoes.length === 0 && obra?.etapa_id) {
        const { count, error } = await cliente
          .from('boletim')
          .select('id', { count: 'exact', head: true })
          .eq('etapa_id', String(obra.etapa_id))
          .eq('data', data)
        travada = !error && (count ?? 0) > 0
      }
      return { data, fuso, travada, observacoes }
    },

    async salvarObservacao(d: NovaObservacao) {
      const dados = await chamar('salvar_observacao', {
        p: {
          id: exigirUuid(d.id, 'observação'),
          obra_id: exigirUuid(d.obraId, 'obra'),
          texto: d.texto,
          escrito_em: d.escritoEm,
        },
      })
      return mapearObservacao(dados as Linha, { minha: true, travada: false })
    },

    async excluirObservacao(id) {
      await chamar('excluir_observacao', { p_id: exigirUuid(id, 'observação') })
    },

    async concluirRegistro(d: NovoRegistro) {
      try {
        const { data, error } = await cliente.rpc('concluir_registro', {
          p_id: d.id,
          p_ambiente_id: d.ambienteId,
          p_tipo: d.tipo,
          p_legenda: d.legenda,
          p_capturado_em: d.capturadoEm,
          p_fotos: d.fotos,
        })
        if (error) throw error
        const linha = (Array.isArray(data) ? data[0] : data) as Linha | null
        return { id: String(linha?.id ?? d.id) }
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },
  }
}
