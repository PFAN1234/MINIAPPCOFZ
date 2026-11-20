import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegistrosRepositorio } from '@modules/fiscalizacao/application/ports/RegistrosRepositorio.port.ts'
import type {
  EstadoPublicacao,
  FiltroRegistros,
  FotoRegistro,
  NovoEncerramento,
  NovoRegistro,
  PendenciaDetalhe,
  RegistroLocalizado,
  RegistroResumo,
} from '@modules/fiscalizacao/domain/tipos.ts'
import type { ObraResumo } from '@modules/obras/domain/tipos.ts'
import { ErroEnvio, erroDoSupabase } from '../../../dados/erros.ts'
import { nomeMostrado } from '../../../dados/nome.ts'
import { limitesPeriodo } from '@shared/kernel/periodo.ts'

const SEGUNDOS_URL_ASSINADA = 3600
const LOTE_IN = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MENSAGEM_JA_ENCERRADA = 'Esta pendência já foi encerrada.'
const COLUNAS_REGISTRO =
  'id, tipo, situacao, legenda, capturado_em, recebido_em, autor:usuario(nome, nome_exibicao), '

type Linha = Record<string, unknown>

function exigirUuid(valor: string, nome: string): string {
  if (!UUID.test(valor)) throw new ErroEnvio('validacao', `Identificador inválido (${nome}).`)
  return valor
}

function checar<T>(resposta: { data: T | null; error: { message: string } | null }): T {
  if (resposta.error) throw new Error(resposta.error.message)
  return resposta.data as T
}

function lotes<T>(itens: T[]): T[][] {
  const saida: T[][] = []
  for (let i = 0; i < itens.length; i += LOTE_IN) saida.push(itens.slice(i, i + LOTE_IN))
  return saida
}

export function criarRegistrosSupabase(cliente: SupabaseClient): RegistrosRepositorio {
  async function chamar(nome: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const { data, error } = await cliente.rpc(nome, args)
      if (error) throw error
      return data
    } catch (e) {
      throw erroDoSupabase(e)
    }
  }

  /** Consultas separadas (sem embed) para evitar ambiguidade de relacionamento no PostgREST. */
  async function fotosDosRegistros(ids: string[]): Promise<Map<string, FotoRegistro[]>> {
    const mapa = new Map<string, FotoRegistro[]>()
    for (const lote of lotes(ids)) {
      const linhas = checar(
        await cliente.from('foto').select('*').in('registro_id', lote).order('ordem'),
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
      await cliente.from('foto').select('*').eq('encerramento_id', encerramentoId).order('ordem'),
    ) as Linha[]
    return linhas.map((f) => ({
      id: String(f.id),
      path: String(f.storage_path),
      largura: Number(f.largura),
      altura: Number(f.altura),
    }))
  }

  async function publicacoesDosRegistros(ids: string[]): Promise<Map<string, EstadoPublicacao>> {
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

  return {
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
  }
}
