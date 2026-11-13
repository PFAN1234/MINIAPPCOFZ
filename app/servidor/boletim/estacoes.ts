/**
 * Estações do Observatório de Riscos Climáticos de Fortaleza (a mesma lista fixa do site de
 * administração, `ESTACOES_OBSERVATORIO` em src/admin/dados/tipos.ts).
 */
export const ESTACOES: Record<string, string> = {
  '3318': 'Dom Lustosa',
  '8642': 'Centro',
  '8836': 'Montese',
  '8869': 'Vila Velha',
  '9134': 'Conjunto Esperança',
  '9137': 'Mucuripe',
  '9169': 'Messejana',
  '9242': 'Guararapes',
  '9249': 'Jangurussu',
  '9281': 'Benfica',
  '9282': 'Granja Lisboa',
}

export const URL_OBSERVATORIO = 'https://observatorio.fortaleza.ce.gov.br/riscos-climaticos/estacoes-meteorologicas'
export const FONTE_CLIMA = 'Observatório de Riscos Climáticos de Fortaleza (Prefeitura de Fortaleza)'
export const FUSO_OBSERVATORIO = 'America/Fortaleza'
