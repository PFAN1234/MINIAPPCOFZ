/**
 * Repositório do site de administração no Supabase: sessão própria do site (persistida no
 * navegador, chave separada da do Mini App), Edge Function `admin-sessao` para entrar e
 * RPCs `admin_*` para os dados.
 */
import { criarAcessosAdminSupabase } from '@modules/acessos/infra/AcessosAdminSupabaseAdapter.ts'
import { criarSessaoAdminSupabase } from '@modules/acessos/infra/SessaoAdminSupabaseAdapter.ts'
import { criarEtapasAdminSupabase } from '@modules/obras/infra/EtapasAdminSupabaseAdapter.ts'
import { criarObrasAdminSupabase } from '@modules/obras/infra/ObrasAdminSupabaseAdapter.ts'
import { criarOrganizacaoAdminSupabase } from '@modules/obras/infra/OrganizacaoAdminSupabaseAdapter.ts'
import { MENSAGEM_REDE } from '@modules/obras/infra/validacao.ts'
import { criarDocumentosSupabase } from '@modules/documentos/infra/DocumentosSupabaseAdapter.ts'
import { criarModelosSupabase } from '@modules/modelos/infra/ModelosSupabaseAdapter.ts'
import { criarTelemetriaSupabase } from '@modules/operacao/infra/TelemetriaSupabaseAdapter.ts'
import { criarPlantasSupabase } from '@modules/plantas/infra/PlantasSupabaseAdapter.ts'
import { criarRaSupabase } from '@modules/ra/infra/RaSupabaseAdapter.ts'
import { criarBoletinsAdminSupabase } from '@modules/relatorios/infra/BoletinsAdminSupabaseAdapter.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { criarClienteSupabase } from '../../dados/supabase.ts'
import { configurarEnvioErros } from '../../shared/infra/erros.ts'
import type { RepositorioAdmin } from './repositorio.ts'
import { ErroAdmin } from './tipos.ts'

export const CHAVE_SESSAO_ADMIN = 'miniappcofz-admin-auth'

export function criarClienteAdmin(): SupabaseClient {
  return criarClienteSupabase({
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // O hash `#entrar=` é nosso; nada de sessão vinda da URL.
      detectSessionInUrl: false,
      storageKey: CHAVE_SESSAO_ADMIN,
    },
  })
}

interface ErroBruto {
  message?: unknown
  code?: unknown
}

function erroDaRpc(e: unknown): ErroAdmin {
  if (e instanceof ErroAdmin) return e
  if (e instanceof TypeError) return new ErroAdmin(MENSAGEM_REDE, { cause: e })
  const b = (typeof e === 'object' && e !== null ? e : {}) as ErroBruto
  const msg = typeof b.message === 'string' ? b.message : ''
  if (b.code === '42501') return new ErroAdmin('Acesso negado: apenas admins do Mini App.', { cause: e })
  if (b.code === '40001') return new ErroAdmin(msg || 'Os dados mudaram. Recarregue a página.', { cause: e })
  if (b.code === '28000' || /jwt/i.test(msg)) {
    return new ErroAdmin('Sua sessão expirou. Entre de novo.', { cause: e })
  }
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return new ErroAdmin(MENSAGEM_REDE, { cause: e })
  return new ErroAdmin(msg || 'Não foi possível concluir a operação.', { cause: e })
}

export function criarRepositorioAdminSupabase(cliente: SupabaseClient = criarClienteAdmin()): RepositorioAdmin {
  configurarEnvioErros(cliente, 'admin')
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  const chave = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '')

  async function rpc<T>(nome: string, args?: Record<string, unknown>): Promise<T> {
    try {
      const { data, error } = await cliente.rpc(nome, args)
      if (error) throw error
      return data as T
    } catch (e) {
      throw erroDaRpc(e)
    }
  }

  /** Chama a Edge Function `admin-excluir-obra` com a sessão do admin; devolve o JSON da resposta. */
  async function funcaoExcluir(corpo: Record<string, unknown>, naoEncontrado: string): Promise<Record<string, unknown>> {
    const { data } = await cliente.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new ErroAdmin('Sua sessão expirou. Entre de novo.')
    let resposta: Response
    try {
      resposta = await fetch(`${base}/functions/v1/admin-excluir-obra`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: chave, Authorization: `Bearer ${token}` },
        body: JSON.stringify(corpo),
      })
    } catch (e) {
      throw new ErroAdmin(MENSAGEM_REDE, { cause: e })
    }
    const json = (await resposta.json().catch(() => null)) as Record<string, unknown> | null
    if (resposta.status !== 200 || !json) {
      const texto = [json?.erro, json?.mensagem, json?.error].find((v) => typeof v === 'string') as string | undefined
      const padrao: Record<number, string> = {
        401: 'Sua sessão expirou. Entre de novo.',
        403: 'Acesso negado: apenas admins do Mini App.',
        404: naoEncontrado,
      }
      throw new ErroAdmin(texto ?? padrao[resposta.status] ?? 'Não foi possível excluir. Tente de novo.')
    }
    return json
  }

  const ra = criarRaSupabase(cliente, rpc)
  const modelos = criarModelosSupabase(cliente, rpc)
  const plantas = criarPlantasSupabase(cliente, rpc)
  const documentos = criarDocumentosSupabase(cliente, rpc)
  const sessao = criarSessaoAdminSupabase(cliente, erroDaRpc)
  const acessos = criarAcessosAdminSupabase(rpc)
  const etapas = criarEtapasAdminSupabase(rpc, funcaoExcluir)
  const organizacao = criarOrganizacaoAdminSupabase(cliente, rpc, base)
  const obras = criarObrasAdminSupabase(rpc, funcaoExcluir)
  const boletins = criarBoletinsAdminSupabase(cliente, rpc, funcaoExcluir, erroDaRpc)
  const telemetria = criarTelemetriaSupabase(rpc)

  return {
    listarRA: ra.listarRA,
    definirQr: ra.definirQr,
    removerQr: ra.removerQr,
    estadoSessao: sessao.estadoSessao,
    entrarComToken: sessao.entrarComToken,
    entrarComWidget: sessao.entrarComWidget,
    sair: sessao.sair,
    meuId: sessao.meuId,
    listarPessoas: acessos.listarPessoas,
    definirNomeExibicao: acessos.definirNomeExibicao,
    matrizAcessos: acessos.matrizAcessos,
    definirAcesso: acessos.definirAcesso,
    listarAdmins: acessos.listarAdmins,
    incluirAdmin: acessos.incluirAdmin,
    removerAdmin: acessos.removerAdmin,
    listarUsuarios: acessos.listarUsuarios,
    listarBoletins: boletins.listarBoletins,
    pedirEmissao: boletins.pedirEmissao,
    reenviarBoletim: boletins.reenviarBoletim,
    excluirBoletim: boletins.excluirBoletim,
    urlPdfBoletim: boletins.urlPdfBoletim,
    previaBoletim: boletins.previaBoletim,
    previaBoletimEditado: boletins.previaBoletimEditado,
    listarTodosBoletins: boletins.listarTodosBoletins,
    boletim: boletins.boletim,
    salvarRascunhoBoletim: boletins.salvarRascunhoBoletim,
    retificarBoletim: boletins.retificarBoletim,
    urlsFotos: boletins.urlsFotos,

    listarEtapas: etapas.listarEtapas,
    salvarEtapa: etapas.salvarEtapa,
    obterEtapa: etapas.obterEtapa,
    salvarAditivo: etapas.salvarAditivo,
    removerAditivo: etapas.removerAditivo,
    definirResponsaveis: etapas.definirResponsaveis,
    arquivarEtapa: etapas.arquivarEtapa,
    desvincularEtapa: etapas.desvincularEtapa,
    resumoEtapa: etapas.resumoEtapa,
    excluirEtapa: etapas.excluirEtapa,
    obterOrganizacao: organizacao.obterOrganizacao,
    salvarOrganizacao: organizacao.salvarOrganizacao,
    enviarLogo: organizacao.enviarLogo,
    listarObras: obras.listarObras,
    obterObra: obras.obterObra,
    salvarObra: obras.salvarObra,
    salvarPavimentos: obras.salvarPavimentos,
    salvarConfig: obras.salvarConfig,
    exportarObra: obras.exportarObra,
    arquivarObra: obras.arquivarObra,
    resumoObra: obras.resumoObra,
    excluirObra: obras.excluirObra,
    listarExclusoes: obras.listarExclusoes,
    limparExclusao: obras.limparExclusao,

    obterEditorPlanta: plantas.obterEditorPlanta,
    listarPublicacoes: plantas.listarPublicacoes,
    enviarArquivo: plantas.enviarArquivo,
    baixarOriginal: plantas.baixarOriginal,
    publicarRevisao: plantas.publicarRevisao,
    listarModelos: modelos.listarModelos,
    baixarModelo: modelos.baixarModelo,
    listarModelosAdmin: modelos.listarModelosAdmin,
    listarObrasCentral: modelos.listarObrasCentral,
    registrarModelo: modelos.registrarModelo,
    retirarModelo: modelos.retirarModelo,
    listarDocumentos: documentos.listarDocumentos,
    historicoDocumento: documentos.historicoDocumento,
    registrarDocumento: documentos.registrarDocumento,
    retirarDocumento: documentos.retirarDocumento,
    vincularDocumento: documentos.vincularDocumento,
    baixarDocumento: documentos.baixarDocumento,
    listarErrosCliente: telemetria.listarErrosCliente,
    resumoOrfaos: telemetria.resumoOrfaos,
  }
}
