/** Dados de exemplo do relatório de pendências (testes e PDF local). */
import type { PendenciaRelatorio, RelatorioPendencias } from './tipos.js'

const foto = (n: string) => ({ path: `e/o/${n}.jpg`, largura: 1600, altura: 1200 })

const pend = (i: number, extra: Partial<PendenciaRelatorio>): PendenciaRelatorio => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  obra: 'HTO',
  pavimento: 'Térreo',
  ambiente: `Sala 0${i}`,
  situacao: 'aberta',
  aberta_em: '2026-11-10T12:00:00Z',
  autor: 'João Felipe',
  legenda: `Rachadura na parede <${i}> & infiltração\nverificar`,
  dias: 3,
  fotos: [foto(`a${i}`), foto(`b${i}`)],
  encerramento: null,
  ...extra,
})

export function relatorioExemplo(extra: Partial<RelatorioPendencias> = {}): RelatorioPendencias {
  return {
    gerado_em: '2026-11-13T15:04:00Z',
    fuso: 'America/Fortaleza',
    organizacao: {
      nome: 'COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)',
      logo_path: 'logo.png',
      cabecalho: ['MINISTÉRIO DA DEFESA', 'COMANDO DA AERONÁUTICA', 'COMISSÃO DE OBRAS DE FORTALEZA'],
    },
    etapa: {
      id: '11111111-1111-4111-8111-111111111111',
      slug: '2a-etapa',
      nome: '2ª ETAPA',
      sigla: 'E2',
      objeto: 'Construção do Hotel de Trânsito de Oficiais (HTO) - 2ª etapa',
      local: 'Base Aérea de Fortaleza',
      endereco: null,
    },
    responsaveis: [{ nome: 'Patrício' }, { nome: 'Fulano' }],
    obra: null,
    pendencias: [
      pend(1, {}),
      pend(2, { obra: 'Bloco B', dias: 7, fotos: [foto('a2')] }),
      pend(3, {
        situacao: 'resolvida',
        dias: 2,
        encerramento: { em: '2026-11-12T12:00:00Z', autor: 'Patrício', observacao: 'Reparo feito.', fotos: [foto('c3')] },
      }),
    ],
    ...extra,
  }
}
