import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js'
import { criarAcessosSupabase } from '@modules/acessos/infra/AcessosSupabaseAdapter.ts'
import { criarEquipeServicoSupabase } from '@modules/acessos/infra/EquipeServicoSupabaseAdapter.ts'
import { criarSessaoSupabase } from '@modules/acessos/infra/SessaoSupabaseAdapter.ts'
import { criarPublicacoesSupabase } from '@modules/fiscalizacao/infra/PublicacoesSupabaseAdapter.ts'
import { criarRegistrosSupabase } from '@modules/fiscalizacao/infra/RegistrosSupabaseAdapter.ts'
import { criarEtapasInicioSupabase } from '@modules/obras/infra/EtapasInicioSupabaseAdapter.ts'
import { criarObrasSupabase } from '@modules/obras/infra/ObrasSupabaseAdapter.ts'
import { criarOrganizacaoSupabase } from '@modules/obras/infra/OrganizacaoSupabaseAdapter.ts'
import { criarModelosSupabase } from '@modules/modelos/infra/ModelosSupabaseAdapter.ts'
import { criarRaSupabase } from '@modules/ra/infra/RaSupabaseAdapter.ts'
import { ErroEnvio, erroDoSupabase } from './erros.ts'
import { configurarEnvioErros } from '../shared/infra/erros.ts'
import { nomeMostrado } from './nome.ts'
import { FUSO_PADRAO, dataNoFuso } from '../shared/kernel/fuso.ts'
import type { Repositorio } from './repositorio.ts'
import type { NovaObservacao, Observacao, ObservacoesDoDia, PainelRelatorios, Relatorios, ResultadoExclusaoBoletim } from './tipos.ts'

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

type Linha = Record<string, unknown>

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

export function criarRepositorioSupabase(
  cliente: SupabaseClient = criarClienteSupabase(),
): Repositorio {
  configurarEnvioErros(cliente, 'miniapp')
  const ra = criarRaSupabase(cliente)
  const modelos = criarModelosSupabase(cliente)
  const acessos = criarAcessosSupabase(cliente)
  const sessao = criarSessaoSupabase(cliente)
  const equipe = criarEquipeServicoSupabase(cliente)
  const obras = criarObrasSupabase(cliente)
  const organizacao = criarOrganizacaoSupabase(cliente)
  const etapasInicio = criarEtapasInicioSupabase(cliente)
  const registros = criarRegistrosSupabase(cliente)
  const publicacoes = criarPublicacoesSupabase(cliente)

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

  return {
    obterGeometria: ra.obterGeometria,
    temSessao: sessao.temSessao,
    idUsuario: sessao.idUsuario,
    souAdmin: sessao.souAdmin,
    criarLinkAdmin: sessao.criarLinkAdmin,
    equipeServico: equipe.equipeServico,
    fazerCheckin: equipe.fazerCheckin,
    fazerCheckout: equipe.fazerCheckout,
    listarObras: obras.listarObras,
    resumoObras: obras.resumoObras,
    obterObra: obras.obterObra,
    obterAmbiente: obras.obterAmbiente,
    organizacao: organizacao.organizacao,
    etapasInicio: etapasInicio.etapasInicio,
    obrasDisponiveis: acessos.obrasDisponiveis,
    solicitarAcesso: acessos.solicitarAcesso,
    listarSolicitacoes: acessos.listarSolicitacoes,
    decidirSolicitacao: acessos.decidirSolicitacao,
    matrizAcessos: acessos.matrizAcessos,
    definirAcesso: acessos.definirAcesso,
    listarParticipantes: acessos.listarParticipantes,
    definirPapel: acessos.definirPapel,
    removerParticipante: acessos.removerParticipante,
    listarRegistros: registros.listarRegistros,
    autoresRegistros: registros.autoresRegistros,
    urlsImagens: registros.urlsImagens,
    enviarFoto: registros.enviarFoto,
    concluirRegistro: registros.concluirRegistro,
    obterPendencia: registros.obterPendencia,
    encerrarPendencia: registros.encerrarPendencia,
    localizarRegistro: registros.localizarRegistro,
    listarPublicacoesProblema: publicacoes.listarPublicacoesProblema,
    republicar: publicacoes.republicar,
    marcarPublicada: publicacoes.marcarPublicada,
    listarModelos: modelos.listarModelos,
    baixarModelo: modelos.baixarModelo,

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
  }
}
