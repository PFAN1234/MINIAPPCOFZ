import type {
  MatrizAcessos,
  ObraDisponivel,
  PapelAcesso,
  PapelObra,
  Participante,
  SolicitacaoAcesso,
} from '../../domain/tipos.ts'

/** Pedidos de acesso, lista de acessos e participantes das obras (usado pelo Mini App; `definirAcesso` também pelo site admin). */
export interface AcessosRepositorio {
  obrasDisponiveis(): Promise<ObraDisponivel[]>
  solicitarAcesso(obraId: string): Promise<void>
  listarSolicitacoes(obraId: string): Promise<SolicitacaoAcesso[]>
  decidirSolicitacao(id: string, aprovar: boolean): Promise<void>
  matrizAcessos(): Promise<MatrizAcessos>
  definirAcesso(obraId: string, usuarioId: string, papel: PapelAcesso): Promise<void>
  listarParticipantes(obraId: string): Promise<Participante[]>
  definirPapel(obraId: string, usuarioId: string, papel: PapelObra): Promise<void>
  removerParticipante(obraId: string, usuarioId: string): Promise<void>
}
