import { describe, expect, it } from 'vitest'
import {
  documentosDoPavimento,
  documentosVinculados,
  juntarVinculos,
  orfaos,
  semVinculo,
  todosVinculos,
  vinculosDe,
  type Documento,
  type VinculoDocumento,
  caminhoDocumento,
  extensaoArquivo,
  LIMITE_BYTES,
  mimeDoArquivo,
  problemaDocumento,
  sugerirProximaRevisao,
  temPrevia,
  tipoSugerido,
} from './documentos.ts'

const ok = {
  titulo: 'Planta baixa',
  tipo: 'prancha',
  revisao: 'R06',
  codigo: 'CE01-14PE01-ARQ-PR-012',
  disciplina: 'ARQ',
  arquivoNome: 'planta.pdf',
  bytes: 1000,
  mime: 'application/pdf',
}

describe('extensaoArquivo', () => {
  it('normaliza maiúsculas e jpeg', () => {
    expect(extensaoArquivo('A.PDF')).toBe('pdf')
    expect(extensaoArquivo('foto.JPEG')).toBe('jpg')
    expect(extensaoArquivo('sem-extensao')).toBe('')
  })
})

describe('mimeDoArquivo', () => {
  it('usa o do navegador quando permitido', () => {
    expect(mimeDoArquivo('a.png', 'image/png')).toBe('image/png')
  })
  it('infere pela extensão quando o do navegador falta ou não é permitido', () => {
    expect(mimeDoArquivo('a.pdf', '')).toBe('application/pdf')
    expect(mimeDoArquivo('a.pdf', 'text/plain')).toBe('application/pdf')
    expect(mimeDoArquivo('a.jpeg', '')).toBe('image/jpeg')
    expect(mimeDoArquivo('a.xlsx', 'application/octet-stream')).toContain('spreadsheetml')
  })
  it('DWG sem mime vira octet-stream', () => {
    expect(mimeDoArquivo('a.dwg', '')).toBe('application/octet-stream')
  })
})

describe('problemaDocumento', () => {
  it('aceita um envio correto', () => expect(problemaDocumento(ok)).toBeNull())
  it('aceita código e disciplina vazios', () => {
    expect(problemaDocumento({ ...ok, codigo: null, disciplina: null })).toBeNull()
  })
  it('rejeita título, tipo, revisão, disciplina e código inválidos', () => {
    expect(problemaDocumento({ ...ok, titulo: '  ' })).toMatch(/título/)
    expect(problemaDocumento({ ...ok, titulo: 'x'.repeat(201) })).toMatch(/título/)
    expect(problemaDocumento({ ...ok, tipo: 'foo' })).toMatch(/tipo/)
    expect(problemaDocumento({ ...ok, revisao: '' })).toMatch(/Revisão/)
    expect(problemaDocumento({ ...ok, revisao: '-R1' })).toMatch(/Revisão/)
    expect(problemaDocumento({ ...ok, disciplina: 'arq' })).toMatch(/disciplina/)
    expect(problemaDocumento({ ...ok, codigo: 'x'.repeat(61) })).toMatch(/código/)
  })
  it('rejeita arquivo com extensão, tamanho ou mime inválidos', () => {
    expect(problemaDocumento({ ...ok, arquivoNome: 'a.exe' })).toMatch(/não aceito/)
    expect(problemaDocumento({ ...ok, bytes: 0 })).toMatch(/vazio/)
    expect(problemaDocumento({ ...ok, bytes: LIMITE_BYTES + 1 })).toMatch(/100 MB/)
    expect(problemaDocumento({ ...ok, mime: 'text/html' })).toMatch(/Tipo de arquivo/)
  })
})

describe('caminhoDocumento', () => {
  it('monta obra/serie/sha.ext e normaliza jpeg', () => {
    expect(caminhoDocumento('o', 's', 'h', 'PDF')).toBe('o/s/h.pdf')
    expect(caminhoDocumento('o', 's', 'h', 'jpeg')).toBe('o/s/h.jpg')
  })
})

describe('temPrevia', () => {
  it('só PDF', () => {
    expect(temPrevia({ mime: 'application/pdf', arquivoNome: 'a.pdf' })).toBe(true)
    expect(temPrevia({ mime: 'image/png', arquivoNome: 'a.png' })).toBe(false)
  })
})

describe('sugerirProximaRevisao', () => {
  it('incrementa número, com prefixo e zeros', () => {
    expect(sugerirProximaRevisao('R06')).toBe('R07')
    expect(sugerirProximaRevisao('R09')).toBe('R10')
    expect(sugerirProximaRevisao('2')).toBe('3')
  })
  it('avança a letra', () => expect(sugerirProximaRevisao('A')).toBe('B'))
  it('sem padrão, vazio', () => {
    expect(sugerirProximaRevisao('final')).toBe('')
    expect(sugerirProximaRevisao('Z')).toBe('')
    expect(sugerirProximaRevisao('')).toBe('')
  })
})

describe('tipoSugerido', () => {
  it('pela extensão', () => {
    expect(tipoSugerido('pdf')).toBe('prancha')
    expect(tipoSugerido('dwg')).toBe('desenho')
    expect(tipoSugerido('dxf')).toBe('desenho')
    expect(tipoSugerido('xlsx')).toBe('planilha')
    expect(tipoSugerido('docx')).toBe('memorial')
    expect(tipoSugerido('png')).toBe('imagem')
    expect(tipoSugerido('zip')).toBe('outro')
  })
})

describe('vínculos de documentos', () => {
  const a = { tipo: 'elemento' as const, sigla: 'ARQ', globalId: 'g1', classe: 'IFCWALL', nome: 'Parede' }
  const p = { tipo: 'pavimento' as const, sigla: 'ARQ', globalId: 'gp', classe: 'IFCBUILDINGSTOREY', nome: 'Térreo' }
  const doc = (id: string, vinculos: VinculoDocumento[]) => ({ id, titulo: id, vinculos }) as unknown as Documento

  it('vinculosDe converte refs no tipo pedido', () => {
    expect(vinculosDe([{ sigla: 'ARQ', globalId: 'g1', classe: 'IFCWALL', nome: 'Parede' }], 'elemento')).toEqual([a])
    expect(vinculosDe([{ sigla: 'EST', globalId: 'g2' }], 'pavimento')).toEqual([
      { tipo: 'pavimento', sigla: 'EST', globalId: 'g2', classe: null, nome: null },
    ])
  })

  it('juntarVinculos não duplica por sigla + GlobalId e semVinculo remove', () => {
    const outraSigla = { ...a, sigla: 'EST' }
    expect(juntarVinculos([a], [{ ...a, nome: 'Outro' }, outraSigla, outraSigla])).toEqual([a, outraSigla])
    expect(semVinculo([a, outraSigla], a)).toEqual([outraSigla])
    expect(semVinculo([a], { sigla: 'ARQ', globalId: 'nada' })).toEqual([a])
  })

  it('documentosVinculados e documentosDoPavimento', () => {
    const docs = [doc('d1', [a]), doc('d2', [p]), doc('d3', [])]
    expect(documentosVinculados(docs, { sigla: 'ARQ', globalId: 'g1' }).map((d) => d.id)).toEqual(['d1'])
    expect(documentosVinculados(docs, { sigla: 'EST', globalId: 'g1' })).toEqual([])
    expect(documentosDoPavimento(docs, 'TÉRREO').map((d) => d.id)).toEqual(['d2'])
    expect(documentosDoPavimento(docs, 'Parede')).toEqual([])
  })

  it('orfaos devolve só os vínculos marcados false', () => {
    const docs = [doc('d1', [a, p]), doc('d2', [{ ...a, globalId: 'g9' }])]
    expect(todosVinculos(docs)).toHaveLength(3)
    const r = orfaos(docs, [true, false, null])
    expect(r).toHaveLength(1)
    expect(r[0].documento.id).toBe('d1')
    expect(r[0].vinculo.globalId).toBe('gp')
    expect(orfaos(docs, [false, false, false])).toHaveLength(3)
  })
})
