import type { TelemetriaRepositorio } from '@modules/operacao/application/ports/TelemetriaRepositorio.port.ts'
import type { ErroCliente, ResumoOrfaos } from '@modules/operacao/domain/tipos.ts'

const ORFAOS_BASE: ResumoOrfaos = {
  buckets: [
    { bucket: 'fotos', quantidade: 2, bytes: 3_145_728 },
    { bucket: 'modelos', quantidade: 1, bytes: 52_428_800 },
  ],
  maiores: [
    {
      bucket: 'modelos',
      caminho: 'obra-x/ARQ/0123456789abcdef.frag',
      tamanho: 52_428_800,
      criado_em: '2026-10-01T10:00:00Z',
      detectado_em: '2026-11-17T03:17:00Z',
    },
    {
      bucket: 'fotos',
      caminho: 'obra-x/registro-1/foto-1.jpg',
      tamanho: 2_097_152,
      criado_em: '2026-10-02T10:00:00Z',
      detectado_em: '2026-11-17T03:17:00Z',
    },
    {
      bucket: 'fotos',
      caminho: 'obra-x/registro-1/foto-2.jpg',
      tamanho: 1_048_576,
      criado_em: '2026-10-02T10:00:00Z',
      detectado_em: '2026-11-17T03:17:00Z',
    },
  ],
}

const ERROS_CLIENTE_BASE: ErroCliente[] = [
  {
    id: 2,
    criado_em: '2026-11-18T14:32:00Z',
    usuario_id: 'usuario-maria',
    usuario_nome: 'Maria Souza',
    app: 'miniapp',
    versao: 'v54.261118.abc1234',
    rota: '/obras/hto-bloco-a',
    mensagem: "Cannot read properties of undefined (reading 'nome')",
    pilha: "TypeError: Cannot read properties of undefined (reading 'nome')\n    at Obra (obra.tsx:42:10)",
    agente: 'Mozilla/5.0 (Linux; Android 14) Telegram',
    contexto: { componentStack: '\n    at Obra\n    at App' },
  },
  {
    id: 1,
    criado_em: '2026-11-17T09:05:00Z',
    usuario_id: null,
    usuario_nome: null,
    app: 'admin',
    versao: 'v54.261118.abc1234',
    rota: '/admin/boletins',
    mensagem: 'Failed to fetch',
    pilha: null,
    agente: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130',
    contexto: null,
  },
]

export function criarTelemetriaFixture(deps: { exigirAdmin: () => void }): TelemetriaRepositorio {
  const { exigirAdmin } = deps
  return {
    async listarErrosCliente(limite = 200): Promise<ErroCliente[]> {
      exigirAdmin()
      return ERROS_CLIENTE_BASE.slice(0, limite)
    },

    async resumoOrfaos(): Promise<ResumoOrfaos> {
      exigirAdmin()
      return JSON.parse(JSON.stringify(ORFAOS_BASE)) as ResumoOrfaos
    },
  }
}
