import type { AcessosAdminRepositorio } from '@modules/acessos/application/ports/AcessosAdminRepositorio.port.ts'
import type { AcessosRepositorio } from '@modules/acessos/application/ports/AcessosRepositorio.port.ts'
import type { SessaoAdminRepositorio } from '@modules/acessos/application/ports/SessaoAdminRepositorio.port.ts'
import type { EtapasAdminRepositorio } from '@modules/obras/application/ports/EtapasAdminRepositorio.port.ts'
import type { ObrasAdminRepositorio } from '@modules/obras/application/ports/ObrasAdminRepositorio.port.ts'
import type { OrganizacaoAdminRepositorio } from '@modules/obras/application/ports/OrganizacaoAdminRepositorio.port.ts'
import type { ModelosRepositorio } from '@modules/modelos/application/ports/ModelosRepositorio.port.ts'
import type { PlantasRepositorio } from '@modules/plantas/application/ports/PlantasRepositorio.port.ts'
import type { RaRepositorio } from '@modules/ra/application/ports/RaRepositorio.port.ts'
import type { BoletinsAdminRepositorio } from '@modules/relatorios/application/ports/BoletinsAdminRepositorio.port.ts'
import type { TelemetriaRepositorio } from '@modules/operacao/application/ports/TelemetriaRepositorio.port.ts'

export interface RepositorioAdmin
  extends SessaoAdminRepositorio,
    AcessosAdminRepositorio,
    Pick<AcessosRepositorio, 'definirAcesso'>,
    Pick<RaRepositorio, 'listarRA' | 'definirQr' | 'removerQr'>,
    EtapasAdminRepositorio,
    OrganizacaoAdminRepositorio,
    ObrasAdminRepositorio,
    BoletinsAdminRepositorio,
    TelemetriaRepositorio,
    Pick<ModelosRepositorio, 'listarModelosAdmin' | 'listarObrasCentral' | 'registrarModelo' | 'retirarModelo'>,
    Pick<PlantasRepositorio, 'obterEditorPlanta' | 'listarPublicacoes' | 'enviarArquivo' | 'baixarOriginal' | 'publicarRevisao'> {}

/** Como no app: a fixture só entra no build com `VITE_DADOS=fixture`. */
export async function criarRepositorioAdmin(): Promise<RepositorioAdmin> {
  if (import.meta.env.VITE_DADOS === 'fixture') {
    const { criarRepositorioAdminFixture } = await import('./fixture.ts')
    // `localStorage['fixture-admin'] = 'nao'` simula um usuário que não é admin.
    let admin = true
    try {
      admin = localStorage.getItem('fixture-admin') !== 'nao'
    } catch {
      // sem localStorage: admin
    }
    return criarRepositorioAdminFixture({ admin })
  }
  const { criarRepositorioAdminSupabase } = await import('./supabase.ts')
  return criarRepositorioAdminSupabase()
}
