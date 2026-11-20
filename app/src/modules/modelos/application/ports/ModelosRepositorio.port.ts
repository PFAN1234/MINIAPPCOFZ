import type { ModeloFrag } from '../../domain/modelos.ts'
import type { DadosModelos, ModeloAdmin, RegistroModelo } from '../../domain/tipos.ts'

/** Porta de dados dos modelos 3D (visualizador do campo e publicação no admin). */
export interface ModelosRepositorio {
  /** Modelos (`.frag`) publicados da obra. */
  listarModelos(slug: string): Promise<ModeloFrag[]>
  /** Baixa o `.frag`. O cache por hash fica a cargo de quem chama (`modeloComCache`). */
  baixarModelo(slug: string, modelo: ModeloFrag): Promise<ArrayBuffer>
  /** Modelo 3D (fase 3): modelos publicados e histórico (`admin_listar_modelos`). */
  listarModelosAdmin(slug: string): Promise<DadosModelos>
  /** RPC `admin_registrar_modelo`, depois de enviar o `.frag` ao bucket `modelos`. */
  registrarModelo(slug: string, registro: RegistroModelo): Promise<ModeloAdmin>
  /** RPC `admin_retirar_modelo`: tira a disciplina do visualizador (o arquivo fica guardado). */
  retirarModelo(slug: string, sigla: string): Promise<void>
}
