/** Rótulos e obras sintéticos para os testes (os mesmos de tests/test_revisoes.py e tests/test_ambientes.py). */
import type { ObraConfig, PaginaLida, Span } from './tipos.ts'

export function rotulo(nome: string, area: string, x: number, y: number, extras: Span[] = []): Span[] {
  const largura = 4 * nome.length
  return [
    { text: nome, bbox: [x - largura / 2, y, x + largura / 2, y + 6.6], size: 5.5, direction: [1, 0] },
    { text: `A=${area} m²`, bbox: [x - 15, y + 7.7, x + 15, y + 14.3], size: 5.5, direction: [1, 0] },
    ...extras,
  ]
}

export function paginas(...rotulos: [string, string, number, number][]): Record<string, PaginaLida> {
  return { terreo: { largura: 1000, altura: 500, spans: rotulos.flatMap((r) => rotulo(...r)) } }
}

export function paginaDeSpans(spans: Span[]): Record<string, PaginaLida> {
  return { terreo: { largura: 1000, altura: 500, spans } }
}

export function obraSintetica(revisao = 'R01', extra: Partial<ObraConfig> = {}): ObraConfig {
  return {
    slug: 'teste',
    nome: 'Teste',
    status: 'aguardando_revisao_humana',
    revisao,
    pasta_pdf: 'DOCS TESTE/PDF',
    pavimentos: [{ codigo: 'terreo', nome: 'Térreo', ordem: 1, pdf: `X-${revisao}.pdf`, pagina: 1 }],
    prancha: { recorte_edificio: [0, 0, 1, 1], mascaras: [] },
    nomes_fixos: {},
    categorias: {},
    renomear: [],
    revisao_humana: null,
    ...extra,
  }
}

// Revisão R01: copa, DML e recepção. R02: a copa vira "COZINHA" no mesmo lugar, o DML some,
// entra uma sala longe dali e a recepção muda de área.
export const R01 = paginas(['COPA', '15.16', 240, 300], ['DML', '2.90', 600, 300], ['RECEPÇÃO', '20.49', 800, 100])
export const R02 = paginas(['COZINHA', '15.16', 240, 300], ['SALA NOVA', '9.00', 100, 50], ['RECEPÇÃO', '21.00', 800, 100])
