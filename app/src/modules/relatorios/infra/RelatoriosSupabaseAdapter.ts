import type { SupabaseClient } from '@supabase/supabase-js'
import type { RelatoriosRepositorio } from '@modules/relatorios/application/ports/RelatoriosRepositorio.port.ts'
import type { PainelRelatorios, Relatorios, ResultadoExclusaoBoletim } from '@modules/relatorios/domain/tipos.ts'
import { ErroEnvio, erroDoSupabase } from '../../../dados/erros.ts'

type Linha = Record<string, unknown>

export function criarRelatoriosSupabase(cliente: SupabaseClient): RelatoriosRepositorio {
  async function chamar(nome: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const { data, error } = await cliente.rpc(nome, args)
      if (error) throw error
      return data
    } catch (e) {
      throw erroDoSupabase(e)
    }
  }

  return {
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
              ? {
                  id: String(b.id),
                  numero: String(b.numero),
                  revisao: Number(b.revisao ?? 0),
                  emitido_em: String(b.emitido_em),
                }
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
        obras: ((d?.obras as Linha[] | null) ?? []).map((o) => ({
          id: String(o.id),
          slug: String(o.slug),
          nome: String(o.nome),
        })),
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
        throw (
          falhas[resposta.status] ??
          new ErroEnvio('desconhecido', texto ?? 'Não foi possível excluir. Tente de novo.')
        )
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
  }
}
