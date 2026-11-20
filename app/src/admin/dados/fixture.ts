/**
 * Repositório de teste do site de administração (VITE_DADOS=fixture): HTO e COFZ com a
 * configuração real de `data/<slug>/obra.json`, na etapa "2ª ETAPA", mais a "3ª ETAPA" vazia e a
 * organização "CO-FZ" sem logo, tudo em memória. Reproduz as regras das RPCs (slug, pavimento com
 * ambientes, último admin, etapas). Nunca entra no build de produção.
 */
import { criarAcessosAdminFixture } from '@modules/acessos/infra/AcessosAdminFixtureAdapter.ts'
import { criarSessaoAdminFixture } from '@modules/acessos/infra/SessaoAdminFixtureAdapter.ts'
import { criarEtapasAdminFixture, type EtapaMemoria } from '@modules/obras/infra/EtapasAdminFixtureAdapter.ts'
import { criarObrasAdminFixture, type ObraMemoria } from '@modules/obras/infra/ObrasAdminFixtureAdapter.ts'
import { criarOrganizacaoAdminFixture } from '@modules/obras/infra/OrganizacaoAdminFixtureAdapter.ts'
import { criarModelosFixture } from '@modules/modelos/infra/ModelosFixtureAdapter.ts'
import { CAMPOS_VAZIOS } from '@modules/obras/infra/camposEtapa.ts'
import { criarTelemetriaFixture } from '@modules/operacao/infra/TelemetriaFixtureAdapter.ts'
import { criarPlantasFixture, type AmbientesJson } from '@modules/plantas/infra/PlantasFixtureAdapter.ts'
import { criarRaFixture } from '@modules/ra/infra/RaFixtureAdapter.ts'
import {
  criarBoletinsAdminFixture,
  snapshotFixture,
  type BoletimMemoria,
  type PedidoMemoria,
} from '@modules/relatorios/infra/BoletinsAdminFixtureAdapter.ts'
import { somarDias } from '@shared/kernel/periodo.ts'
import ambientesCofz from '../../../../data/cofz/ambientes.json'
import obraCofz from '../../../../data/cofz/obra.json'
import ambientesHto from '../../../../data/hto/ambientes.json'
import obraHto from '../../../../data/hto/obra.json'
import { hojeNoFuso, numeroBoletim } from '../formato.ts'
import type { RepositorioAdmin } from './repositorio.ts'
import type { ConfigObra } from '@modules/plantas/domain/tipos.ts'
import { ErroAdmin } from './tipos.ts'
import type { UsuarioApp } from '@modules/acessos/domain/tipos.ts'

interface ObraJson {
  slug: string
  nome: string
  pavimentos: { codigo: string; nome: string; ordem: number; pdf?: string; pagina?: number }[]
  [chave: string]: unknown
}

/** Grupo do Telegram da 2ª ETAPA na fixture. */
const GRUPO_2A = -1001234567890

const VOCE: UsuarioApp = { id: 'usuario-teste', nome: 'Você (teste)', username: 'voce', telegram_id: 1, eh_admin: true }
const USUARIOS_BASE: Omit<UsuarioApp, 'eh_admin'>[] = [
  { id: VOCE.id, nome: VOCE.nome, username: VOCE.username, telegram_id: VOCE.telegram_id },
  { id: 'usuario-patricio', nome: 'Patrício Ferreira', username: null, telegram_id: 1362893349 },
  { id: 'usuario-eduardo', nome: 'Eduardo Lima', username: null, telegram_id: 669804829 },
  { id: 'usuario-maria', nome: 'Maria Souza', username: 'maria', telegram_id: 4242 },
]

function obraDoJson(
  id: string,
  ordem: number,
  json: ObraJson,
  ambientes: AmbientesJson,
  etapaId: string,
  chat: number | null,
): ObraMemoria {
  const { slug, nome, pavimentos, ...resto } = json
  return {
    id,
    slug,
    nome,
    ordem,
    pavimentos: pavimentos.map((p) => ({
      id: `${slug}-${p.codigo}`,
      codigo: p.codigo,
      nome: p.nome,
      ordem: p.ordem,
      ambientes: ambientes.ambientes.filter((a) => a.pavimento === p.codigo).length,
    })),
    config: {
      ...resto,
      pavimentos: pavimentos.map(({ codigo, pdf, pagina }) => ({ codigo, pdf, pagina })),
    } as ConfigObra,
    config_atualizada_em: '2026-11-11T12:00:00Z',
    config_atualizada_por: null,
    arquivada_em: null,
    etapa_id: etapaId,
    telegram_chat_id: chat,
  }
}

export function criarRepositorioAdminFixture(opcoes: { admin?: boolean; sessao?: boolean } = {}): RepositorioAdmin {
  const etapas: EtapaMemoria[] = [
    {
      id: 'etapa-2a',
      slug: '2a-etapa',
      nome: '2ª ETAPA',
      ordem: 2,
      telegram_chat_id: GRUPO_2A,
      telegram_chat_titulo: 'Fiscalização 2ª ETAPA',
      arquivada_em: null,
      ...CAMPOS_VAZIOS,
      sigla: '2',
      endereco: 'Av. Santos Dumont, 1500 - Aldeota, Fortaleza - CE',
      latitude: -3.761,
      longitude: -38.5297,
      fuso: 'America/Fortaleza',
      estacao: '8836',
      estacao_reserva: '9281',
      objeto: 'CONSTRUÇÃO DO HOTEL DE TRÂNSITO DE OFICIAIS (HTO) E DA SEDE DA COMISSÃO DE OBRAS',
      local: 'CAMPUS DO COMANDO\nFORTALEZA - CE',
      contratante: 'SECRETARIA DE OBRAS PÚBLICAS',
      contrato: '120/2025 - SOP',
      contratada: 'CONSTRUTORA EXEMPLO LTDA',
      contratada_cnpj: '12.345.678/0001-95',
      os_numero: '120/2025',
      os_data: '2025-06-02',
      vigencia_meses: 24,
      valor_original: 79499000,
      area_construida_m2: 86102.17,
      aditivos: [
        { id: 'aditivo-1', etapa_id: 'etapa-2a', numero: '1º TA', data: '2026-03-10', prazo_dias: 90, valor: 1250000, descricao: 'Reprogramação de fundações' },
      ],
      responsaveis: [{ usuario_id: 'usuario-patricio', funcao: 'Fiscal' }],
    },
    {
      id: 'etapa-3a',
      slug: '3a-etapa',
      nome: '3ª ETAPA',
      ordem: 3,
      telegram_chat_id: null,
      telegram_chat_titulo: null,
      arquivada_em: null,
      ...CAMPOS_VAZIOS,
      aditivos: [],
      responsaveis: [],
    },
  ]
  /** Boletins e pedidos de emissão da 2ª etapa (datas relativas a hoje, no fuso da etapa). */
  const hoje2a = hojeNoFuso('America/Fortaleza')
  const dia = (n: number) => somarDias(hoje2a, n)
  const boletimFixture = (
    etapaId: string,
    sigla: string,
    data: string,
    revisao: number,
    por: string | null,
    publicado: boolean,
  ): BoletimMemoria => {
    const numero = numeroBoletim(sigla, data, 'CO-FZ') + (revisao > 0 ? `-R${revisao}` : '')
    return {
      id: `boletim-${etapaId === 'etapa-2a' ? '' : '3a-'}${data}-${revisao}`,
      etapa_id: etapaId,
      data,
      revisao,
      numero,
      emitido_em: `${revisao > 0 ? dia(-1) : data}T${revisao > 0 ? '13:05' : '23:30'}:00-03:00`,
      emitido_por_nome: por,
      pdf_path: `${etapaId}/${numero.replace(/\//g, '')}.pdf`,
      publicado,
      publicacao_estado: publicado ? 'publicado' : 'pendente',
      publicacao_erro: null,
      publicacao_tentativas: 0,
      base_numero: null,
      edicao: null,
      rascunho: null,
      snapshot: snapshotFixture(data),
    }
  }
  const b2aAntigo = boletimFixture('etapa-2a', '2', dia(-45), 0, null, true)
  const b2aOriginal = boletimFixture('etapa-2a', '2', dia(-2), 0, null, true)
  // Retificação editada: nasceu da edição do boletim original do dia.
  const b2aEditado: BoletimMemoria = {
    ...boletimFixture('etapa-2a', '2', dia(-2), 1, 'CP PATRICIO', true),
    base_numero: b2aOriginal.numero,
    edicao: { textos: { [`servico:srv-${dia(-2)}-1`]: 'Concretagem da laje do térreo concluída' }, ocultos: [`servico:srv-${dia(-2)}-2`] },
  }
  // Boletim ainda não publicado, com um rascunho salvo.
  const b2aRascunho: BoletimMemoria = {
    ...boletimFixture('etapa-2a', '2', dia(-1), 0, null, false),
    rascunho: {
      edicao: { ocultos: [`aberta:pen-${dia(-1)}-1`], fotos_ocultas: [`etapa/fotos/${dia(-1)}-a.jpg`] },
      atualizado_em: `${dia(-1)}T15:20:00-03:00`,
      atualizado_por_nome: 'CP PATRICIO',
    },
  }
  const b3a = boletimFixture('etapa-3a', '3', dia(-1), 0, null, true)
  const boletins: BoletimMemoria[] = [b2aAntigo, b2aOriginal, b2aEditado, b2aRascunho, b3a]
  const pedidos: PedidoMemoria[] = [
    {
      id: 1,
      etapa_id: 'etapa-2a',
      data: dia(-3),
      revisao: 0,
      estado: 'falhou',
      tentativas: 8,
      erro: 'Tempo esgotado ao gerar o PDF',
      atualizado_em: `${dia(-2)}T03:10:00-03:00`,
    },
  ]
  const obras: ObraMemoria[] = [
    obraDoJson('obra-hto', 0, obraHto as unknown as ObraJson, ambientesHto as unknown as AmbientesJson, 'etapa-2a', GRUPO_2A),
    obraDoJson('obra-cofz', 1, obraCofz as unknown as ObraJson, ambientesCofz as unknown as AmbientesJson, 'etapa-2a', null),
  ]
  let sequencia = 0
  function exigirAdmin(): void {
    if (!sessaoAdm.temSessaoAtiva()) throw new ErroAdmin('Sua sessão expirou. Entre de novo.')
    if (!acessosAdm.ehAdmin()) throw new ErroAdmin('Acesso negado: apenas admins do Mini App.')
  }

  function obraPorSlug(slug: string): ObraMemoria {
    const o = obras.find((x) => x.slug === slug)
    if (!o) throw new ErroAdmin('Obra não encontrada')
    return o
  }
  const etapaDe = (o: ObraMemoria): EtapaMemoria => etapas.find((e) => e.id === o.etapa_id)!

  const acessosAdm = criarAcessosAdminFixture({
    admin: opcoes.admin !== false,
    voce: VOCE,
    usuarios: USUARIOS_BASE,
    obras: () => obras.map((o) => ({ id: o.id, slug: o.slug, nome: o.nome, etapaNome: etapaDe(o).nome })),
    exigirAdmin,
  })
  const sessaoAdm = criarSessaoAdminFixture({
    sessaoInicial: opcoes.sessao !== false,
    voce: VOCE,
    ehAdmin: acessosAdm.ehAdmin,
  })
  const ra = criarRaFixture({ exigirAdmin })
  const plantas = criarPlantasFixture({
    exigirAdmin,
    obraPorSlug,
    obraExiste: (id) => obras.some((o) => o.id === id),
    proximoId: () => ++sequencia,
    nomeUsuario: VOCE.nome,
  })
  const modelos = criarModelosFixture({
    exigirAdmin,
    obras: () => obras,
    obraPorSlug,
    tamanhoArquivo: (caminho) => plantas.tamanhoArquivo(`modelos/${caminho}`),
    proximoId: () => ++sequencia,
    nomeUsuario: VOCE.nome,
  })

  const obrasAdm = criarObrasAdminFixture({
    obras,
    etapas,
    exigirAdmin,
    proximoId: () => ++sequencia,
    nomeUsuario: VOCE.nome,
    contagens: (o) => ({
      ambientes: plantas.quantidadeAmbientes(o.id),
      plantas: plantas.quantidadePlantas(o.id),
      modelos: modelos.quantidade(o.id),
      arquivos: plantas.contarArquivos(o.id),
    }),
    removerArquivos: (o) => {
      modelos.removerObra(o.id)
      return plantas.removerObra(o.id)
    },
  })
  const etapasAdm = criarEtapasAdminFixture({
    etapas,
    obras,
    usuarios: USUARIOS_BASE,
    nomeExibicao: acessosAdm.nomeExibicao,
    exigirAdmin,
    proximoId: () => ++sequencia,
    resumoObra: obrasAdm.resumoDe,
    removerObra: obrasAdm.removerObra,
    aoExcluirEtapa: (etapaId) => {
      for (const lista of [boletins, pedidos] as { etapa_id: string }[][]) {
        for (let i = lista.length - 1; i >= 0; i--) if (lista[i].etapa_id === etapaId) lista.splice(i, 1)
      }
    },
  })
  const organizacaoAdm = criarOrganizacaoAdminFixture({ exigirAdmin })
  const boletinsAdm = criarBoletinsAdminFixture({
    boletins,
    pedidos,
    etapas,
    nomeOrganizacao: async () => (await organizacaoAdm.obterOrganizacao()).nome,
    nomeUsuario: VOCE.nome,
    exigirAdmin,
  })
  const telemetriaAdm = criarTelemetriaFixture({ exigirAdmin })

  return {
    listarRA: ra.listarRA,
    definirQr: ra.definirQr,
    removerQr: ra.removerQr,
    estadoSessao: sessaoAdm.estadoSessao,
    entrarComToken: sessaoAdm.entrarComToken,
    entrarComWidget: sessaoAdm.entrarComWidget,
    entrarModoTeste: sessaoAdm.entrarModoTeste,
    sair: sessaoAdm.sair,
    meuId: sessaoAdm.meuId,
    listarPessoas: acessosAdm.listarPessoas,
    definirNomeExibicao: acessosAdm.definirNomeExibicao,
    matrizAcessos: acessosAdm.matrizAcessos,
    definirAcesso: acessosAdm.definirAcesso,
    listarAdmins: acessosAdm.listarAdmins,
    incluirAdmin: acessosAdm.incluirAdmin,
    removerAdmin: acessosAdm.removerAdmin,
    listarUsuarios: acessosAdm.listarUsuarios,

    listarEtapas: etapasAdm.listarEtapas,
    salvarEtapa: etapasAdm.salvarEtapa,
    obterEtapa: etapasAdm.obterEtapa,
    salvarAditivo: etapasAdm.salvarAditivo,
    removerAditivo: etapasAdm.removerAditivo,
    definirResponsaveis: etapasAdm.definirResponsaveis,
    arquivarEtapa: etapasAdm.arquivarEtapa,
    desvincularEtapa: etapasAdm.desvincularEtapa,
    resumoEtapa: etapasAdm.resumoEtapa,
    excluirEtapa: etapasAdm.excluirEtapa,
    obterOrganizacao: organizacaoAdm.obterOrganizacao,
    salvarOrganizacao: organizacaoAdm.salvarOrganizacao,
    enviarLogo: organizacaoAdm.enviarLogo,
    listarObras: obrasAdm.listarObras,
    obterObra: obrasAdm.obterObra,
    salvarObra: obrasAdm.salvarObra,
    salvarPavimentos: obrasAdm.salvarPavimentos,
    salvarConfig: obrasAdm.salvarConfig,
    exportarObra: obrasAdm.exportarObra,
    arquivarObra: obrasAdm.arquivarObra,
    resumoObra: obrasAdm.resumoObra,
    excluirObra: obrasAdm.excluirObra,
    listarExclusoes: obrasAdm.listarExclusoes,
    limparExclusao: obrasAdm.limparExclusao,

    listarBoletins: boletinsAdm.listarBoletins,
    pedirEmissao: boletinsAdm.pedirEmissao,
    reenviarBoletim: boletinsAdm.reenviarBoletim,
    excluirBoletim: boletinsAdm.excluirBoletim,
    urlPdfBoletim: boletinsAdm.urlPdfBoletim,
    previaBoletim: boletinsAdm.previaBoletim,
    listarTodosBoletins: boletinsAdm.listarTodosBoletins,
    boletim: boletinsAdm.boletim,
    salvarRascunhoBoletim: boletinsAdm.salvarRascunhoBoletim,
    retificarBoletim: boletinsAdm.retificarBoletim,
    previaBoletimEditado: boletinsAdm.previaBoletimEditado,
    urlsFotos: boletinsAdm.urlsFotos,

    obterEditorPlanta: plantas.obterEditorPlanta,
    listarPublicacoes: plantas.listarPublicacoes,
    enviarArquivo: plantas.enviarArquivo,
    baixarOriginal: plantas.baixarOriginal,
    publicarRevisao: plantas.publicarRevisao,
    listarModelosAdmin: modelos.listarModelosAdmin,
    listarObrasCentral: modelos.listarObrasCentral,
    registrarModelo: modelos.registrarModelo,
    retirarModelo: modelos.retirarModelo,
    listarErrosCliente: telemetriaAdm.listarErrosCliente,
    resumoOrfaos: telemetriaAdm.resumoOrfaos,
  }
}
