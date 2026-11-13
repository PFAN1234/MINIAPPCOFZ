import { describe, expect, it } from 'vitest'
import { ErroEnvio } from './erros.ts'
import { criarRepositorioFixture } from './fixture.ts'

const OBRA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const PEND = '00000000-0000-4000-8000-000000000101'
const RESOLVIDA = '00000000-0000-4000-8000-000000000106'
const FOTO = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4b01'
const ENC = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4c01'

function memoria(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  }
}

const dados = (id = ENC, fotoId = FOTO) => ({
  id,
  registroId: PEND,
  obraId: OBRA,
  observacao: 'Espelho trocado',
  fotos: [{ id: fotoId, largura: 100, altura: 80, bytes: 4 }],
})

describe('fixture: pendências e encerramento', () => {
  it('obterPendencia traz pavimento, papel e o encerramento da resolvida', async () => {
    const repo = criarRepositorioFixture()
    const aberta = await repo.obterPendencia(PEND)
    expect(aberta).toMatchObject({ papel: 'gestor', pavimento: { nome: 'Térreo' }, encerramento: null })
    expect(aberta?.registro.situacao).toBe('aberta')
    const resolvida = await repo.obterPendencia(RESOLVIDA)
    expect(resolvida?.encerramento).toMatchObject({ gestor: 'Juliana Prado', publicacao: 'publicado' })
    expect(resolvida?.encerramento?.fotos).toHaveLength(1)
    expect(await repo.obterPendencia('00000000-0000-4000-8000-0000000009ff')).toBeNull()
    // Serviço não é pendência.
    expect(await repo.obterPendencia('00000000-0000-4000-8000-000000000102')).toBeNull()
  })

  it('encerrar exige a foto no armazenamento, é idempotente e resolve a pendência', async () => {
    const persistencia = memoria()
    const repo = criarRepositorioFixture({ persistencia })
    await expect(repo.encerrarPendencia(dados())).rejects.toMatchObject({ tipo: 'validacao' })
    await repo.enviarFoto({ obraId: OBRA, registroId: PEND, fotoId: FOTO }, new Blob(['x'], { type: 'image/jpeg' }))
    await expect(repo.encerrarPendencia({ ...dados(), fotos: [] })).rejects.toMatchObject({ tipo: 'validacao' })
    expect(await repo.encerrarPendencia(dados())).toEqual({ id: ENC })
    expect(await repo.encerrarPendencia(dados())).toEqual({ id: ENC })

    const depois = await repo.obterPendencia(PEND)
    expect(depois?.registro.situacao).toBe('resolvida')
    expect(depois?.encerramento).toMatchObject({ observacao: 'Espelho trocado', publicacao: 'pendente' })
    expect((await repo.listarRegistros({ tipo: 'pendencia', situacao: 'aberta' })).map((r) => r.id)).not.toContain(PEND)
    expect((await repo.obterObra('hto')).ambientes.find((a) => a.codigo === 'terreo-apto-101')?.pendencias_abertas).toBe(0)

    // Outro encerramento da mesma pendência: conflito definitivo.
    const erro = await repo
      .encerrarPendencia(dados('5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4c02'))
      .catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(ErroEnvio)
    expect(erro).toMatchObject({ tipo: 'conflito', message: 'Esta pendência já foi encerrada.' })

    // O "servidor" persiste entre aberturas.
    const outro = criarRepositorioFixture({ persistencia })
    expect((await outro.obterPendencia(PEND))?.encerramento?.id).toBe(ENC)
  })

  it('a foto do encerramento fica vinculada e não pode ser sobrescrita', async () => {
    const repo = criarRepositorioFixture()
    const foto = { obraId: OBRA, registroId: PEND, fotoId: FOTO }
    await repo.enviarFoto(foto, new Blob(['x'], { type: 'image/jpeg' }))
    await repo.encerrarPendencia(dados())
    await expect(repo.enviarFoto(foto, new Blob(['y'], { type: 'image/jpeg' }))).rejects.toMatchObject({
      tipo: 'permissao',
    })
  })

  it('filtra registros por obraSlug e ambienteCodigo', async () => {
    const repo = criarRepositorioFixture()
    expect(await repo.listarRegistros({ obraSlug: 'aurora' })).toEqual([])
    const lista = await repo.listarRegistros({ obraSlug: 'hto', ambienteCodigo: 'terreo-apto-101' })
    expect(lista.map((r) => r.ambiente.codigo)).toEqual(['terreo-apto-101', 'terreo-apto-101'])
    expect(lista[0].ambiente.pavimento).toBe('Térreo')
  })
})

describe('fixture: gestão', () => {
  it('lista participantes com gestores primeiro e só para gestor (pelo nome mostrado)', async () => {
    const repo = criarRepositorioFixture()
    const lista = await repo.listarParticipantes(OBRA)
    expect(lista.map((p) => [p.nome, p.papel])).toEqual([
      ['Você (teste)', 'gestor'],
      // Nome de exibição definido pelo admin (o do Telegram é "Patricio Ferreira").
      ['CP PATRICIO', 'equipe'],
      ['João Lima', 'equipe'],
      ['Marcos Teixeira', 'equipe'],
    ])
    await expect(repo.listarParticipantes('outra')).rejects.toMatchObject({ tipo: 'permissao' })
  })

  it('definirPapel e removerParticipante protegem o último gestor e persistem', async () => {
    const persistencia = memoria()
    const repo = criarRepositorioFixture({ persistencia })
    const eu = 'usuario-teste'
    const marcos = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4a02'
    await expect(repo.definirPapel(OBRA, eu, 'equipe')).rejects.toMatchObject({
      tipo: 'validacao',
      message: 'A obra precisa de pelo menos um gestor.',
    })
    await expect(repo.removerParticipante(OBRA, eu)).rejects.toMatchObject({ tipo: 'validacao' })
    await repo.definirPapel(OBRA, marcos, 'gestor')
    await repo.definirPapel(OBRA, eu, 'equipe')
    // Sem o papel de gestor, ele perde o acesso à gestão.
    expect((await repo.obterObra('hto')).papel).toBe('equipe')
    await expect(repo.listarParticipantes(OBRA)).rejects.toMatchObject({ tipo: 'permissao' })

    const outro = criarRepositorioFixture({ persistencia })
    expect((await outro.obterObra('hto')).papel).toBe('equipe')
  })

  it('publicações com problema: reenviar e marcar como publicada só a partir de incerto/falhou', async () => {
    const repo = criarRepositorioFixture()
    const lista = await repo.listarPublicacoesProblema(OBRA)
    expect(lista.map((p) => [p.id, p.estado])).toEqual([
      [2, 'incerto'],
      [1, 'falhou'],
    ])
    await repo.republicar(1)
    await repo.marcarPublicada(2)
    expect(await repo.listarPublicacoesProblema(OBRA)).toEqual([])
    await expect(repo.republicar(1)).rejects.toMatchObject({ tipo: 'validacao' })
    await expect(repo.marcarPublicada(2)).rejects.toMatchObject({ tipo: 'validacao' })
    const registros = await repo.listarRegistros({})
    expect(registros.find((r) => r.id === '00000000-0000-4000-8000-000000000105')?.publicacao).toBe('pendente')
    expect(registros.find((r) => r.id === '00000000-0000-4000-8000-000000000104')?.publicacao).toBe('publicado')
  })
})
