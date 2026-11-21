import type { RegistroDocumento } from '../domain/documentos.ts'

/** PDF mínimo válido de 1 página (A4, com o texto na tela), com a tabela xref calculada. */
export function pdfMinimo(texto: string): Uint8Array {
  const limpo = texto.replace(/[()\\]/g, ' ').replace(/[^\x20-\x7e]/g, '?')
  const fluxo = `BT /F1 24 Tf 72 760 Td (${limpo}) Tj ET`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posicoes: number[] = []
  objetos.forEach((o, i) => {
    posicoes.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const p of posicoes) pdf += `${String(p).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

/** Documento de semente da fixture: o registro sem caminho e tamanho (saem do conteúdo). */
export interface SementeDocumento extends Omit<RegistroDocumento, 'caminho' | 'bytes'> {
  /** Obra pelo slug. */
  slug: string
  enviadoEm: string
  conteudo: Uint8Array
}

/** Prancha PDF de ARQ e um DWG para a obra `hto`, para a interface ter o que mostrar. */
export function sementeHto(): SementeDocumento[] {
  return [
    {
      slug: 'hto',
      serie: '5e3c1a10-0000-4000-8000-000000000001',
      codigo: 'CE01-14PE01-ARQ-PR-001',
      titulo: 'Planta baixa do pavimento tipo',
      tipo: 'prancha',
      disciplina: 'ARQ',
      revisao: 'R06',
      arquivoNome: 'CE01-14PE01-ARQ-PR-001-R06.pdf',
      mime: 'application/pdf',
      sha256: '1'.repeat(64),
      enviadoEm: '2026-11-10T12:00:00.000Z',
      conteudo: pdfMinimo('Planta baixa do pavimento tipo - R06'),
    },
    {
      slug: 'hto',
      serie: '5e3c1a10-0000-4000-8000-000000000002',
      codigo: 'CE01-14PE01-ARQ-DW-001',
      titulo: 'Implantação (DWG)',
      tipo: 'desenho',
      disciplina: 'ARQ',
      revisao: 'R02',
      arquivoNome: 'CE01-14PE01-ARQ-DW-001-R02.dwg',
      mime: 'application/octet-stream',
      sha256: '2'.repeat(64),
      enviadoEm: '2026-11-11T12:00:00.000Z',
      conteudo: new TextEncoder().encode('AC1032 arquivo DWG de exemplo'),
    },
  ]
}
