import { describe, expect, it, vi } from 'vitest'
import type { Documento } from '../../domain/documentos.ts'
import { enviarDocumento, type DepsDocumento } from './enviarDocumento.ts'

const SHA = 'a'.repeat(64)
const SERIE = '11111111-1111-4111-8111-111111111111'

function deps() {
  return {
    enviarArquivo: vi.fn<DepsDocumento['enviarArquivo']>(async () => {}),
    registrarDocumento: vi.fn<DepsDocumento['registrarDocumento']>(async () => ({ id: 'd1' }) as Documento),
    sha256: vi.fn(async () => SHA),
    novaSerie: () => SERIE,
  }
}

const novo = {
  titulo: ' Planta ',
  tipo: 'prancha' as const,
  codigo: '',
  disciplina: 'ARQ',
  revisao: 'R06',
  arquivoNome: 'planta.PDF',
  mime: 'application/pdf',
  bytes: new Uint8Array([1, 2, 3]),
}
const obra = { id: 'obra-1', slug: 'hto' }

describe('enviarDocumento', () => {
  it('envia ao bucket documentos e registra com a série nova', async () => {
    const d = deps()
    await enviarDocumento({ deps: d, obra, documento: novo })
    expect(d.enviarArquivo).toHaveBeenCalledWith('documentos', `obra-1/${SERIE}/${SHA}.pdf`, expect.any(Blob), 'application/pdf')
    expect(d.registrarDocumento).toHaveBeenCalledWith('hto', {
      serie: SERIE,
      codigo: null,
      titulo: 'Planta',
      tipo: 'prancha',
      disciplina: 'ARQ',
      revisao: 'R06',
      caminho: `obra-1/${SERIE}/${SHA}.pdf`,
      arquivoNome: 'planta.PDF',
      mime: 'application/pdf',
      bytes: 3,
      sha256: SHA,
    })
  })

  it('usa a série informada (nova revisão)', async () => {
    const d = deps()
    const outra = '22222222-2222-4222-8222-222222222222'
    await enviarDocumento({ deps: d, obra, serie: outra, documento: novo })
    expect(d.registrarDocumento.mock.calls[0][1].serie).toBe(outra)
  })

  it('lança a mensagem do problema, sem enviar nada', async () => {
    const d = deps()
    await expect(enviarDocumento({ deps: d, obra, documento: { ...novo, revisao: '' } })).rejects.toThrow(/Revisão/)
    expect(d.enviarArquivo).not.toHaveBeenCalled()
  })

  it('não registra se o envio falhar', async () => {
    const d = deps()
    d.enviarArquivo.mockRejectedValueOnce(new Error('rede'))
    await expect(enviarDocumento({ deps: d, obra, documento: novo })).rejects.toThrow('rede')
    expect(d.registrarDocumento).not.toHaveBeenCalled()
  })
})
