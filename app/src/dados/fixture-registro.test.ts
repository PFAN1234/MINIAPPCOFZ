import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enviarRegistro, criarRascunho } from './envio.ts'
import { criarRepositorioFixture } from './fixture.ts'
import type { NovoRegistro } from './tipos.ts'

const OBRA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const AMB_ID = async (repo: ReturnType<typeof criarRepositorioFixture>) =>
  (await repo.obterAmbiente('hto', 'terreo-apto-101')).ambiente.id

function jpeg(): Blob {
  return new Blob(['jpeg'], { type: 'image/jpeg' })
}

async function dadosValidos(repo: ReturnType<typeof criarRepositorioFixture>, n = 1) {
  const id = crypto.randomUUID()
  const fotos = Array.from({ length: n }, () => ({
    id: crypto.randomUUID(),
    largura: 100,
    altura: 80,
    bytes: 4,
  }))
  const dados: NovoRegistro = {
    id,
    ambienteId: await AMB_ID(repo),
    tipo: 'pendencia',
    legenda: '  Legenda de teste  ',
    capturadoEm: new Date().toISOString(),
    fotos,
  }
  return dados
}

async function subir(repo: ReturnType<typeof criarRepositorioFixture>, d: NovoRegistro) {
  for (const f of d.fotos) {
    await repo.enviarFoto({ obraId: OBRA, registroId: d.id, fotoId: f.id }, jpeg())
  }
}

describe('fixture: novo registro', () => {
  let repo: ReturnType<typeof criarRepositorioFixture>
  beforeEach(() => {
    repo = criarRepositorioFixture()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:teste' }))
  })

  it('registros de exemplo trazem fotos e publicação', async () => {
    const lista = await repo.listarRegistros({})
    expect(lista.every((r) => r.fotos.length >= 1 && r.publicacao !== null)).toBe(true)
    const urls = await repo.urlsImagens(lista[0].fotos.map((f) => f.path), 'fotos')
    expect(Object.values(urls)[0]).toMatch(/^\/__plantas\//)
  })

  it('conclui, aparece primeiro no histórico, com autor fixo e foto em blob', async () => {
    const d = await dadosValidos(repo, 2)
    await subir(repo, d)
    expect(await repo.concluirRegistro(d)).toEqual({ id: d.id })
    const [novo] = await repo.listarRegistros({ ambienteId: d.ambienteId })
    expect(novo).toMatchObject({
      id: d.id,
      autor: 'Você (teste)',
      legenda: 'Legenda de teste',
      situacao: 'aberta',
      publicacao: 'pendente',
    })
    expect(novo.fotos.map((f) => f.id)).toEqual(d.fotos.map((f) => f.id))
    const urls = await repo.urlsImagens([novo.fotos[0].path], 'fotos')
    expect(urls[novo.fotos[0].path]).toBe('blob:teste')
    const amb = await repo.obterAmbiente('hto', 'terreo-apto-101')
    expect(amb.ambiente.pendencias_abertas).toBe(2)
  })

  it('é idempotente pelo id', async () => {
    const d = await dadosValidos(repo)
    await subir(repo, d)
    await repo.concluirRegistro(d)
    await repo.concluirRegistro(d)
    expect((await repo.listarRegistros({})).filter((r) => r.id === d.id)).toHaveLength(1)
    const outro = (await repo.obterAmbiente('hto', 'terreo-apto-102')).ambiente.id
    await expect(repo.concluirRegistro({ ...d, ambienteId: outro })).rejects.toMatchObject({
      tipo: 'conflito',
    })
  })

  it('rejeita se alguma foto não foi enviada antes', async () => {
    const d = await dadosValidos(repo, 2)
    await repo.enviarFoto({ obraId: OBRA, registroId: d.id, fotoId: d.fotos[0].id }, jpeg())
    await expect(repo.concluirRegistro(d)).rejects.toMatchObject({ tipo: 'validacao' })
  })

  it('aplica as validações da RPC', async () => {
    const d = await dadosValidos(repo)
    await subir(repo, d)
    const casos: [Partial<NovoRegistro>, string][] = [
      [{ tipo: 'outro' as never }, 'validacao'],
      [{ legenda: ' \n\t ' }, 'validacao'],
      [{ legenda: 'x'.repeat(1001) }, 'validacao'],
      [{ fotos: [] }, 'validacao'],
      [{ fotos: Array(11).fill(d.fotos[0]) }, 'validacao'],
      [{ fotos: [d.fotos[0], d.fotos[0]] }, 'validacao'],
      [{ fotos: [{ ...d.fotos[0], bytes: 0 }] }, 'validacao'],
      [{ capturadoEm: new Date(Date.now() + 10 * 60_000).toISOString() }, 'validacao'],
      [{ ambienteId: crypto.randomUUID() }, 'nao_encontrado'],
    ]
    for (const [mudanca, tipo] of casos) {
      await expect(repo.concluirRegistro({ ...d, ...mudanca })).rejects.toMatchObject({ tipo })
    }
    expect(await repo.concluirRegistro(d)).toEqual({ id: d.id })
  })

  it('foto já vinculada não pode ser reenviada (permissão) e o orquestrador retoma', async () => {
    const d = await dadosValidos(repo)
    await subir(repo, d)
    await repo.concluirRegistro(d)
    await expect(
      repo.enviarFoto({ obraId: OBRA, registroId: d.id, fotoId: d.fotos[0].id }, jpeg()),
    ).rejects.toMatchObject({ tipo: 'permissao' })

    const r = criarRascunho({
      obraId: OBRA,
      ambienteId: d.ambienteId,
      tipo: d.tipo,
      legenda: d.legenda,
      capturadoEm: d.capturadoEm,
      fotos: [],
    })
    // Rascunho com o mesmo id do registro já concluído: reenvio completo não duplica.
    Object.assign(r, { id: d.id, fotos: d.fotos.map((f) => ({ ...f, blob: jpeg() })) })
    await enviarRegistro(repo, r)
    expect((await repo.listarRegistros({})).filter((x) => x.id === d.id)).toHaveLength(1)
  })
})
