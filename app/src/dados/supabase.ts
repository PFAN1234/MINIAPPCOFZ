import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ErroEnvio, erroDoSupabase } from './erros.ts'
import { entrarComTelegram } from './login.ts'
import type { Repositorio } from './repositorio.ts'
import { dentroDoTelegram, idUsuarioTelegram, initData } from '../telegram.ts'
import type {
  Ambiente,
  AmbienteDetalhe,
  DetalhePlanta,
  EstadoPublicacao,
  FiltroRegistros,
  FotoRegistro,
  ImagemPlanta,
  Marcador,
  NovoEncerramento,
  NovoRegistro,
  ObraDetalhe,
  ObraDisponivel,
  ObraResumo,
  PapelObra,
  Participante,
  Pavimento,
  PendenciaDetalhe,
  Planta,
  PublicacaoProblema,
  RecortePt,
  RegistroLocalizado,
  RegistroResumo,
  SolicitacaoAcesso,
} from './tipos.ts'

const SEGUNDOS_URL_ASSINADA = 3600
const LOTE_IN = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function exigirUuid(valor: string, nome: string): string {
  if (!UUID.test(valor)) throw new ErroEnvio('validacao', `Identificador inválido (${nome}).`)
  return valor
}

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

const COLUNAS_REGISTRO =
  'id, tipo, situacao, legenda, capturado_em, recebido_em, autor:usuario(nome), '

const COLUNAS_AMBIENTE =
  'id, codigo, pavimento_id, nome_operacional, nome_planta, categoria, area_m2, marcadores, ativo'

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

  /** Consultas separadas (sem embed) para evitar ambiguidade de relacionamento no PostgREST. */
  async function fotosDosRegistros(ids: string[]): Promise<Map<string, FotoRegistro[]>> {
    const mapa = new Map<string, FotoRegistro[]>()
    for (const lote of lotes(ids)) {
      const linhas = checar(
        await cliente
          .from('foto')
          .select('id, registro_id, storage_path, largura, altura, ordem')
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
        .select('id, storage_path, largura, altura, ordem')
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
        autor: String((l.autor as Linha | null)?.nome ?? 'Autor desconhecido'),
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
    async temSessao() {
      return entrarComTelegram({
        cliente,
        urlSupabase: String(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, ''),
        chave: String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
        initData: dentroDoTelegram() ? initData() : '',
        idTelegram: idUsuarioTelegram(),
        online: navigator.onLine,
        fetch: (...args) => fetch(...args),
      })
    },

    async idUsuario() {
      const { data } = await cliente.auth.getSession()
      return data.session?.user.id ?? null
    },

    async listarObras() {
      return checar(
        await cliente.from('obra').select('id, slug, nome').order('ordem').order('nome'),
      ) as ObraResumo[]
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
      const obraInner = filtro.obraSlug ? '!inner' : ''
      let q = cliente
        .from('registro')
        .select(
          COLUNAS_REGISTRO +
            `ambiente${ambInner}(id, codigo, nome_operacional, pavimento(nome)), obra${obraInner}(id, slug, nome)`,
        )
        .order('recebido_em', { ascending: false })
      if (filtro.obraId) q = q.eq('obra_id', filtro.obraId)
      if (filtro.obraSlug) q = q.eq('obra.slug', filtro.obraSlug)
      if (filtro.ambienteId) q = q.eq('ambiente_id', filtro.ambienteId)
      if (filtro.ambienteCodigo) q = q.eq('ambiente.codigo', filtro.ambienteCodigo)
      if (filtro.tipo) q = q.eq('tipo', filtro.tipo)
      if (filtro.situacao) q = q.eq('situacao', filtro.situacao)
      if (filtro.limite) q = q.limit(filtro.limite)
      return resumirRegistros(checar(await q) as unknown as Linha[])
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
          .select('id, observacao, encerrado_em, gestor:usuario(nome)')
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
          gestor: String((encLinha.gestor as Linha | null)?.nome ?? 'Gestor desconhecido'),
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

    async listarParticipantes(obraId) {
      const dados = await chamar('listar_participantes', { p_obra: exigirUuid(obraId, 'obra') })
      return ((dados ?? []) as Linha[]).map(
        (l): Participante => ({
          usuario_id: String(l.usuario_id),
          nome: String(l.nome),
          username: l.username ? String(l.username) : null,
          papel: l.papel === 'gestor' ? 'gestor' : 'equipe',
          desde: String(l.desde),
        }),
      )
    },

    async definirPapel(obraId, usuarioId, papel: PapelObra) {
      await chamar('definir_papel', {
        p_obra: exigirUuid(obraId, 'obra'),
        p_usuario: exigirUuid(usuarioId, 'usuário'),
        p_papel: papel,
      })
    },

    async removerParticipante(obraId, usuarioId) {
      await chamar('remover_participante', {
        p_obra: exigirUuid(obraId, 'obra'),
        p_usuario: exigirUuid(usuarioId, 'usuário'),
      })
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

    async obrasDisponiveis() {
      try {
        const { data, error } = await cliente.rpc('obras_disponiveis')
        if (error) throw error
        return ((data ?? []) as Linha[]).map(
          (l): ObraDisponivel => ({
            id: String(l.id),
            slug: String(l.slug),
            nome: String(l.nome),
            solicitacao: l.solicitacao === 'pendente' || l.solicitacao === 'recusada' ? l.solicitacao : null,
          }),
        )
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async solicitarAcesso(obraId) {
      try {
        const { error } = await cliente.rpc('solicitar_acesso', { p_obra: exigirUuid(obraId, 'obra') })
        if (error) throw error
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async listarSolicitacoes(obraId) {
      try {
        const { data, error } = await cliente.rpc('listar_solicitacoes', {
          p_obra: exigirUuid(obraId, 'obra'),
        })
        if (error) throw error
        return ((data ?? []) as Linha[]).map(
          (l): SolicitacaoAcesso => ({
            id: String(l.id),
            usuario_id: String(l.usuario_id),
            nome: String(l.nome),
            username: l.username ? String(l.username) : null,
            criado_em: String(l.criado_em),
          }),
        )
      } catch (e) {
        throw erroDoSupabase(e)
      }
    },

    async decidirSolicitacao(id, aprovar) {
      try {
        const { error } = await cliente.rpc('decidir_solicitacao', {
          p_id: exigirUuid(id, 'solicitação'),
          p_aprovar: aprovar,
        })
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
