import type { TelemetriaRepositorio } from '@modules/operacao/application/ports/TelemetriaRepositorio.port.ts'
import type { ErroCliente, ResumoOrfaos } from '@modules/operacao/domain/tipos.ts'
import { textoOuNulo, type Linha } from '@modules/obras/infra/validacao.ts'

export type ChamarRpcAdmin = <T>(nome: string, args?: Record<string, unknown>) => Promise<T>

export function criarTelemetriaSupabase(rpc: ChamarRpcAdmin): TelemetriaRepositorio {
  return {
    async listarErrosCliente(limite = 200) {
      return ((await rpc<Linha[]>('admin_listar_erros_cliente', { p_limite: limite })) ?? []).map(
        (l): ErroCliente => ({
          id: Number(l.id),
          criado_em: String(l.criado_em),
          usuario_id: l.usuario_id == null ? null : String(l.usuario_id),
          usuario_nome: l.usuario_nome == null ? null : String(l.usuario_nome),
          app: l.app === 'admin' ? 'admin' : 'miniapp',
          versao: l.versao == null ? null : String(l.versao),
          rota: l.rota == null ? null : String(l.rota),
          mensagem: String(l.mensagem),
          pilha: l.pilha == null ? null : String(l.pilha),
          agente: l.agente == null ? null : String(l.agente),
          contexto: (l.contexto ?? null) as Record<string, unknown> | null,
        }),
      )
    },

    async resumoOrfaos() {
      const r = (await rpc<Linha>('admin_resumo_orfaos')) ?? {}
      const lista = (v: unknown) => (Array.isArray(v) ? (v as Linha[]) : [])
      const numeroOuNulo = (v: unknown) => (v == null ? null : Number(v))
      return {
        buckets: lista(r.buckets).map((b) => ({
          bucket: String(b.bucket),
          quantidade: Number(b.quantidade),
          bytes: Number(b.bytes),
        })),
        maiores: lista(r.maiores).map((m) => ({
          bucket: String(m.bucket),
          caminho: String(m.caminho),
          tamanho: numeroOuNulo(m.tamanho),
          criado_em: textoOuNulo(m.criado_em),
          detectado_em: String(m.detectado_em),
        })),
      } satisfies ResumoOrfaos
    },
  }
}
