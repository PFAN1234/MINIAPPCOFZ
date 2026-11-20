import type { NovaObservacao, Observacao, ObservacoesDoDia, PainelRelatorios, Relatorios, ResultadoExclusaoBoletim } from './tipos.ts'
import type { AcessosRepositorio } from '@modules/acessos/application/ports/AcessosRepositorio.port.ts'
import type { EquipeServicoRepositorio } from '@modules/acessos/application/ports/EquipeServicoRepositorio.port.ts'
import type { SessaoRepositorio } from '@modules/acessos/application/ports/SessaoRepositorio.port.ts'
import type { PublicacoesRepositorio } from '@modules/fiscalizacao/application/ports/PublicacoesRepositorio.port.ts'
import type { RegistrosRepositorio } from '@modules/fiscalizacao/application/ports/RegistrosRepositorio.port.ts'
import type { EtapasInicioRepositorio } from '@modules/obras/application/ports/EtapasInicioRepositorio.port.ts'
import type { ObrasRepositorio } from '@modules/obras/application/ports/ObrasRepositorio.port.ts'
import type { OrganizacaoRepositorio } from '@modules/obras/application/ports/OrganizacaoRepositorio.port.ts'
import type { ModelosRepositorio } from '@modules/modelos/application/ports/ModelosRepositorio.port.ts'
import type { RaRepositorio } from '@modules/ra/application/ports/RaRepositorio.port.ts'

export interface Repositorio
  extends Pick<RaRepositorio, 'obterGeometria'>,
    SessaoRepositorio,
    EquipeServicoRepositorio,
    AcessosRepositorio,
    ObrasRepositorio,
    OrganizacaoRepositorio,
    EtapasInicioRepositorio,
    RegistrosRepositorio,
    PublicacoesRepositorio,
    Pick<ModelosRepositorio, 'listarModelos' | 'baixarModelo'> {
  /** Aba Relatórios: situação de hoje por etapa e boletins emitidos. */
  relatorios(): Promise<Relatorios>
  /** Painel da aba Relatórios: movimento por obra e dia da etapa, até hoje. */
  painelRelatorios(etapaId: string): Promise<PainelRelatorios>
  /** Gera o PDF de pendências (etapa inteira ou uma obra) e devolve a URL assinada. */
  exportarPendencias(etapaId: string, obraId: string | null): Promise<string>
  /** URL assinada (5 min) do PDF de um boletim. */
  urlPdfBoletim(caminho: string): Promise<string>
  /** Admin: pede a emissão agora (nova revisão se já houver boletim no dia). Falhas sobem como `ErroEnvio`. */
  emitirBoletim(slug: string, data: string): Promise<void>
  /** Admin: exclui o dia inteiro do boletim (revisões, PDFs e mensagem no grupo). */
  excluirBoletim(id: string): Promise<ResultadoExclusaoBoletim>
  /** Observações de hoje na obra (dia no fuso da etapa), com o estado de travada do dia. */
  observacoesDoDia(obraId: string): Promise<ObservacoesDoDia>
  /** Cria (id novo) ou edita o texto (id existente). Idempotente. Falhas sobem como `ErroEnvio`. */
  salvarObservacao(dados: NovaObservacao): Promise<Observacao>
  /** Só o autor e antes da emissão do boletim; id inexistente não é erro. Falhas sobem como `ErroEnvio`. */
  excluirObservacao(id: string): Promise<void>
}

/**
 * Ponto único de criação. A fixture entra por `import()` dinâmico atrás de uma
 * condição constante em tempo de build: sem `VITE_DADOS=fixture` o bundler
 * descarta o ramo e os dados de teste não vão para o `dist/`.
 */
export async function criarRepositorio(): Promise<Repositorio> {
  if (import.meta.env.VITE_DADOS === 'fixture') {
    const { criarRepositorioFixture } = await import('./fixture.ts')
    // `localStorage['fixture-admin'] = 'nao'` esconde o botão Administração;
    // `localStorage['fixture-logo'] = <url>` dá um logo à organização (capturas de tela);
    // `localStorage['fixture-boletim'] = 'emitido'` simula o boletim de hoje já emitido.
    return criarRepositorioFixture({
      persistencia: localStorage,
      admin: localStorage.getItem('fixture-admin') !== 'nao',
      logo: localStorage.getItem('fixture-logo'),
      boletimEmitido: localStorage.getItem('fixture-boletim') === 'emitido',
    })
  }
  const { criarRepositorioSupabase } = await import('./supabase.ts')
  return criarRepositorioSupabase()
}
