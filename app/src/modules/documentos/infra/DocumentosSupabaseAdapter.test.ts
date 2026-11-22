import type { SupabaseClient } from '@supabase/supabase-js'
import type { Armazenamento } from '@modules/armazenamento/application/ports/Armazenamento.port.ts'
import { describe, expect, it, vi } from 'vitest'
import { criarRepositorioAdminSupabase } from '../../../admin/dados/supabase.ts'
import { ErroAdmin } from '../../../admin/dados/tipos.ts'
import type { RegistroDocumento } from '../domain/documentos.ts'
import { criarDocumentosSupabase } from './DocumentosSupabaseAdapter.ts'

const LINHA = {
  id: 'd1', serie: 's1', codigo: 'ARQ-01', titulo: 'Planta', tipo: 'projeto', disciplina: null, revisao: 'R01',
  caminho: 'o/s1/abc.pdf', arquivo_nome: 'planta.pdf', mime: 'application/pdf', bytes: '1234', sha256: 'a'.repeat(64),
  enviado_em: '2026-11-20T10:00:00Z', enviado_por_nome: 'Ana', revisoes: 2,
  vinculos: [
    { tipo: 'pavimento', sigla: 'T', global_id: 'gp', classe: null, nome: null },
    { tipo: 'x', sigla: 'T', global_id: 'ge', classe: 'IfcWall', nome: 'P1' },
  ],
}

function montar(resposta: unknown = null, baixar: () => Promise<Blob> = async () => new Blob(['x'])) {
  const rpc = vi.fn(async () => resposta)
  const armazenamento = { baixar: vi.fn(baixar) } as unknown as Armazenamento
  return { rpc, armazenamento, repo: criarDocumentosSupabase(armazenamento, rpc as never) }
}

const REGISTRO: RegistroDocumento = {
  serie: 's1', codigo: null, titulo: 'Planta', tipo: 'projeto' as never, disciplina: null, revisao: 'R01',
  caminho: 'o/s1/abc.pdf', arquivoNome: 'planta.pdf', mime: 'application/pdf', bytes: 10, sha256: 'a'.repeat(64),
}

describe('DocumentosSupabaseAdapter', () => {
  it('listarDocumentos chama a RPC e converte as linhas', async () => {
    const { repo, rpc } = montar({ documentos: [LINHA] })
    const [d] = await repo.listarDocumentos('hto')
    expect(rpc).toHaveBeenCalledWith('admin_listar_documentos', { p_slug: 'hto' })
    expect(d).toMatchObject({ id: 'd1', codigo: 'ARQ-01', disciplina: null, arquivoNome: 'planta.pdf', bytes: 1234, enviadoPorNome: 'Ana', revisoes: 2 })
    expect(d.vinculos).toEqual([
      { tipo: 'pavimento', sigla: 'T', globalId: 'gp', classe: null, nome: null },
      { tipo: 'elemento', sigla: 'T', globalId: 'ge', classe: 'IfcWall', nome: 'P1' },
    ])
  })

  it('listar sem resultado devolve lista vazia; revisões e vínculos têm padrão', async () => {
    expect(await montar(null).repo.listarDocumentos('hto')).toEqual([])
    const sem: Record<string, unknown> = { ...LINHA }
    delete sem.revisoes
    delete sem.vinculos
    const [d] = await montar({ documentos: [sem] }).repo.listarDocumentos('hto')
    expect(d).toMatchObject({ revisoes: 1, vinculos: [] })
  })

  it('historicoDocumento envia p_serie e traz os dados de retirada', async () => {
    const { repo, rpc } = montar([{ ...LINHA, retirado_em: '2026-11-21T00:00:00Z', retirado_por_nome: 'Bia' }, LINHA])
    const h = await repo.historicoDocumento('s1')
    expect(rpc).toHaveBeenCalledWith('admin_historico_documento', { p_serie: 's1' })
    expect(h[0]).toMatchObject({ retiradoEm: '2026-11-21T00:00:00Z', retiradoPorNome: 'Bia' })
    expect(h[1]).toMatchObject({ retiradoEm: null, retiradoPorNome: null })
    expect(await montar(null).repo.historicoDocumento('s1')).toEqual([])
  })

  it('registrarDocumento envia o JSON em snake_case e devolve o documento', async () => {
    const { repo, rpc } = montar(LINHA)
    const d = await repo.registrarDocumento('hto', REGISTRO)
    expect(rpc).toHaveBeenCalledWith('admin_registrar_documento', {
      p_slug: 'hto',
      p: { serie: 's1', codigo: null, titulo: 'Planta', tipo: 'projeto', disciplina: null, revisao: 'R01', caminho: 'o/s1/abc.pdf', arquivo_nome: 'planta.pdf', mime: 'application/pdf', bytes: 10, sha256: 'a'.repeat(64) },
    })
    expect(d.id).toBe('d1')
  })

  it('retirarDocumento e vincularDocumento chamam as RPCs certas', async () => {
    const m = montar(null)
    await m.repo.retirarDocumento('d1')
    expect(m.rpc).toHaveBeenLastCalledWith('admin_retirar_documento', { p_id: 'd1' })
    const v = montar([{ tipo: 'elemento', sigla: 'T', global_id: 'ge', classe: null, nome: null }])
    const r = await v.repo.vincularDocumento('d1', [
      { tipo: 'elemento', sigla: 'T', globalId: 'ge' },
      { tipo: 'pavimento', sigla: 'T', globalId: 'gp', classe: 'C', nome: 'N' },
    ])
    expect(v.rpc).toHaveBeenCalledWith('admin_vincular_documento', {
      p_id: 'd1',
      p_vinculos: [
        { tipo: 'elemento', sigla: 'T', global_id: 'ge', classe: null, nome: null },
        { tipo: 'pavimento', sigla: 'T', global_id: 'gp', classe: 'C', nome: 'N' },
      ],
    })
    expect(r).toEqual([{ tipo: 'elemento', sigla: 'T', globalId: 'ge', classe: null, nome: null }])
  })

  it('baixarDocumento usa o bucket documentos e traduz a falha', async () => {
    const ok = montar()
    await ok.repo.baixarDocumento('o/s1/abc.pdf')
    expect(ok.armazenamento.baixar).toHaveBeenCalledWith('documentos', 'o/s1/abc.pdf')
    const ruim = montar(null, async () => {
      throw new Error('r2')
    })
    await expect(ruim.repo.baixarDocumento('x')).rejects.toThrow('Não foi possível baixar o documento guardado.')
  })

  it('erro do banco vira ErroAdmin com a mensagem (repositório admin)', async () => {
    const cliente = {
      rpc: vi.fn(async () => ({ data: null, error: { message: 'Esta revisão já existe para o documento.', code: 'P0001' } })),
      auth: { getSession: vi.fn() },
    } as unknown as SupabaseClient
    const repo = criarRepositorioAdminSupabase(cliente, { baixar: vi.fn(), urls: vi.fn() } as unknown as Armazenamento)
    const e = await repo.registrarDocumento('hto', REGISTRO).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ErroAdmin)
    expect((e as Error).message).toContain('já existe')
  })
})
