import type { AcessosRepositorio } from '@modules/acessos/application/ports/AcessosRepositorio.port.ts'
import type { EquipeServicoRepositorio } from '@modules/acessos/application/ports/EquipeServicoRepositorio.port.ts'
import type { SessaoRepositorio } from '@modules/acessos/application/ports/SessaoRepositorio.port.ts'
import type { PublicacoesRepositorio } from '@modules/fiscalizacao/application/ports/PublicacoesRepositorio.port.ts'
import type { RegistrosRepositorio } from '@modules/fiscalizacao/application/ports/RegistrosRepositorio.port.ts'
import type { ModelosRepositorio } from '@modules/modelos/application/ports/ModelosRepositorio.port.ts'
import type { EtapasInicioRepositorio } from '@modules/obras/application/ports/EtapasInicioRepositorio.port.ts'
import type { ObrasRepositorio } from '@modules/obras/application/ports/ObrasRepositorio.port.ts'
import type { OrganizacaoRepositorio } from '@modules/obras/application/ports/OrganizacaoRepositorio.port.ts'
import type { RaRepositorio } from '@modules/ra/application/ports/RaRepositorio.port.ts'
import type { ObservacoesRepositorio } from '@modules/relatorios/application/ports/ObservacoesRepositorio.port.ts'
import type { RelatoriosRepositorio } from '@modules/relatorios/application/ports/RelatoriosRepositorio.port.ts'

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
    RelatoriosRepositorio,
    ObservacoesRepositorio,
    Pick<ModelosRepositorio, 'listarModelos' | 'baixarModelo'> {}

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
