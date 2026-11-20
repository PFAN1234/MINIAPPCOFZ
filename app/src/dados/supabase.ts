import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js'
import { criarAcessosSupabase } from '@modules/acessos/infra/AcessosSupabaseAdapter.ts'
import { criarEquipeServicoSupabase } from '@modules/acessos/infra/EquipeServicoSupabaseAdapter.ts'
import { criarSessaoSupabase } from '@modules/acessos/infra/SessaoSupabaseAdapter.ts'
import { criarPublicacoesSupabase } from '@modules/fiscalizacao/infra/PublicacoesSupabaseAdapter.ts'
import { criarRegistrosSupabase } from '@modules/fiscalizacao/infra/RegistrosSupabaseAdapter.ts'
import { criarModelosSupabase } from '@modules/modelos/infra/ModelosSupabaseAdapter.ts'
import { criarEtapasInicioSupabase } from '@modules/obras/infra/EtapasInicioSupabaseAdapter.ts'
import { criarObrasSupabase } from '@modules/obras/infra/ObrasSupabaseAdapter.ts'
import { criarOrganizacaoSupabase } from '@modules/obras/infra/OrganizacaoSupabaseAdapter.ts'
import { criarRaSupabase } from '@modules/ra/infra/RaSupabaseAdapter.ts'
import { criarObservacoesSupabase } from '@modules/relatorios/infra/ObservacoesSupabaseAdapter.ts'
import { criarRelatoriosSupabase } from '@modules/relatorios/infra/RelatoriosSupabaseAdapter.ts'
import { configurarEnvioErros } from '../shared/infra/erros.ts'
import type { Repositorio } from './repositorio.ts'

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
  const relatorios = criarRelatoriosSupabase(cliente)
  const observacoes = criarObservacoesSupabase(cliente)

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
    relatorios: relatorios.relatorios,
    painelRelatorios: relatorios.painelRelatorios,
    exportarPendencias: relatorios.exportarPendencias,
    urlPdfBoletim: relatorios.urlPdfBoletim,
    emitirBoletim: relatorios.emitirBoletim,
    excluirBoletim: relatorios.excluirBoletim,
    observacoesDoDia: observacoes.observacoesDoDia,
    salvarObservacao: observacoes.salvarObservacao,
    excluirObservacao: observacoes.excluirObservacao,
    listarModelos: modelos.listarModelos,
    baixarModelo: modelos.baixarModelo,
  }
}
