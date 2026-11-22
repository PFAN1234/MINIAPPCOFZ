import type { Vista } from '../../modelos/domain/central.ts'
import type { Issue } from '../domain/issues.ts'

const VISTA_PADRAO: Vista = {
  camera: { posicao: [12, 8, 14], alvo: [0, 1.5, 0], projecao: 'perspectiva', campo: 50 },
  cortes: [],
  selecionados: [],
  ocultos: [],
  isolados: null,
}

/** Três issues da obra `hto` em status diferentes; a nº 1 tem uma vista (sem imagem) e um comentário. */
export function sementeIssuesHto(): Issue[] {
  const base = { descricao: null, responsavelId: null, responsavelNome: null, criadoPor: null, criadoPorNome: 'Patrício Ferreira' }
  return [
    {
      ...base,
      id: 'issue-semente-1',
      numero: 1,
      guid: '7a1e0000-0000-4000-8000-000000000001',
      titulo: 'Viga colidindo com a tubulação de esgoto',
      descricao: 'No pavimento tipo, a viga V12 cruza o tubo de 100 mm do shaft.',
      tipo: 'conflito',
      prioridade: 'alta',
      status: 'aberta',
      prazo: '2026-12-05',
      criadoEm: '2026-11-12T13:00:00.000Z',
      atualizadoEm: '2026-11-13T09:30:00.000Z',
      vistas: [
        {
          id: '7a1e0000-0000-4000-8000-0000000000a1',
          guid: '7a1e0000-0000-4000-8000-0000000000b1',
          vista: VISTA_PADRAO,
          imagemPath: null,
          criadoEm: '2026-11-12T13:00:00.000Z',
        },
      ],
      comentarios: [
        {
          id: '7a1e0000-0000-4000-8000-0000000000c1',
          guid: '7a1e0000-0000-4000-8000-0000000000d1',
          autorId: null,
          autorNome: 'Eduardo Lima',
          texto: 'Projetista de hidráulica avisado; aguardando nova revisão.',
          vistaId: '7a1e0000-0000-4000-8000-0000000000a1',
          criadoEm: '2026-11-13T09:30:00.000Z',
        },
      ],
    },
    {
      ...base,
      id: 'issue-semente-2',
      numero: 2,
      guid: '7a1e0000-0000-4000-8000-000000000002',
      titulo: 'Confirmar altura do peitoril das janelas',
      tipo: 'duvida',
      prioridade: 'normal',
      status: 'em_andamento',
      criadoEm: '2026-11-14T10:00:00.000Z',
      atualizadoEm: '2026-11-14T10:00:00.000Z',
      prazo: null,
      vistas: [],
      comentarios: [],
    },
    {
      ...base,
      id: 'issue-semente-3',
      numero: 3,
      guid: '7a1e0000-0000-4000-8000-000000000003',
      titulo: 'Pendência: guarda-corpo da escada sem detalhe',
      tipo: 'pendencia',
      prioridade: 'baixa',
      status: 'resolvida',
      prazo: '2026-11-20',
      criadoEm: '2026-11-08T15:00:00.000Z',
      atualizadoEm: '2026-11-18T11:00:00.000Z',
      vistas: [],
      comentarios: [],
    },
  ]
}
