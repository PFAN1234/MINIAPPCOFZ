import { describe, expect, it } from 'vitest'
import { criarRascunho, enviarRegistro, type Rascunho } from './envio.ts'
import { ErroEnvio } from './erros.ts'
import type { Repositorio } from './repositorio.ts'
import type { CaminhoFoto, NovoRegistro } from './tipos.ts'

const OBRA = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e01'
const AMB = '5d0c0c4e-8a47-4c1f-9d55-0a1b2c3d4e99'

function rascunho(n = 3): Rascunho {
  return criarRascunho({
    obraId: OBRA,
    ambienteId: AMB,
    tipo: 'servico',
    legenda: 'Teste',
    capturadoEm: '2026-11-09T10:00:00.000Z',
    fotos: Array.from({ length: n }, (_, i) => ({
      id: crypto.randomUUID(),
      blob: new Blob([`f${i}`], { type: 'image/jpeg' }),
      largura: 10,
      altura: 10,
      bytes: 2,
    })),
  })
}

interface Falso extends Repositorio {
  eventos: string[]
  registros: Map<string, NovoRegistro>
  objetos: Set<string>
  simultaneos: { atual: number; maximo: number }
}

function repoFalso(opcoes: {
  enviarFoto?: (c: CaminhoFoto, tentativa: number) => Promise<void> | void
  concluir?: () => Promise<void> | void
} = {}): Falso {
  const eventos: string[] = []
  const registros = new Map<string, NovoRegistro>()
  const objetos = new Set<string>()
  const simultaneos = { atual: 0, maximo: 0 }
  const tentativas = new Map<string, number>()
  const repo: Pick<Repositorio, 'enviarFoto' | 'concluirRegistro'> = {
    async enviarFoto(c) {
      const t = (tentativas.get(c.fotoId) ?? 0) + 1
      tentativas.set(c.fotoId, t)
      simultaneos.atual++
      simultaneos.maximo = Math.max(simultaneos.maximo, simultaneos.atual)
      try {
        await new Promise((r) => setTimeout(r, 5))
        await opcoes.enviarFoto?.(c, t)
        objetos.add(c.fotoId)
        eventos.push(`foto:${c.fotoId}`)
      } finally {
        simultaneos.atual--
      }
    },
    async concluirRegistro(d) {
      await opcoes.concluir?.()
      eventos.push('concluir')
      registros.set(d.id, d)
      return { id: d.id }
    },
  }
  return Object.assign(repo, { eventos, registros, objetos, simultaneos }) as unknown as Falso
}

describe('enviarRegistro', () => {
  it('envia as fotos antes de concluir, com progresso e no máximo 2 simultâneas', async () => {
    const repo = repoFalso()
    const r = rascunho(5)
    const progresso: number[] = []
    await enviarRegistro(repo, r, (p) => {
      expect(p.total).toBe(5)
      progresso.push(p.enviadas)
    })
    expect(repo.eventos.at(-1)).toBe('concluir')
    expect(repo.eventos.filter((e) => e.startsWith('foto:'))).toHaveLength(5)
    expect(progresso).toEqual([0, 1, 2, 3, 4, 5])
    expect(repo.simultaneos.maximo).toBe(2)
    const dados = repo.registros.get(r.id)!
    expect(dados.fotos.map((f) => f.id)).toEqual(r.fotos.map((f) => f.id))
    expect(dados).toMatchObject({ ambienteId: AMB, tipo: 'servico', capturadoEm: r.capturadoEm })
  })

  it('retomada: erro de permissão no upload segue para concluirRegistro', async () => {
    const repo = repoFalso({
      enviarFoto: () => {
        throw new ErroEnvio('permissao', 'rls')
      },
    })
    const r = rascunho(2)
    await enviarRegistro(repo, r)
    expect(repo.eventos).toEqual(['concluir'])
  })

  it('retomada: se a RPC falhar depois da permissão, propaga o erro da RPC', async () => {
    const repo = repoFalso({
      enviarFoto: () => {
        throw new ErroEnvio('permissao', 'rls')
      },
      concluir: () => {
        throw new ErroEnvio('nao_encontrado', 'Foto ainda não foi enviada')
      },
    })
    await expect(enviarRegistro(repo, rascunho(1))).rejects.toMatchObject({
      tipo: 'nao_encontrado',
    })
  })

  it('repetir o envio com o mesmo rascunho não duplica o registro', async () => {
    const repo = repoFalso()
    const r = rascunho(2)
    await enviarRegistro(repo, r)
    await enviarRegistro(repo, r)
    expect(repo.registros.size).toBe(1)
    expect([...repo.registros.keys()]).toEqual([r.id])
  })

  it('erro de rede interrompe, não conclui e preserva os ids para tentar de novo', async () => {
    const repo = repoFalso({
      enviarFoto: (c, t) => {
        if (t === 1 && c.fotoId === falha) throw new ErroEnvio('rede', 'sem rede')
      },
    })
    const r = rascunho(3)
    const falha = r.fotos[1].id
    const idsAntes = [r.id, ...r.fotos.map((f) => f.id)]
    await expect(enviarRegistro(repo, r)).rejects.toMatchObject({ tipo: 'rede' })
    expect(repo.eventos).not.toContain('concluir')
    await enviarRegistro(repo, r)
    expect([r.id, ...r.fotos.map((f) => f.id)]).toEqual(idsAntes)
    expect(repo.registros.size).toBe(1)
    expect(repo.eventos.at(-1)).toBe('concluir')
  })
})

describe('fotos da realidade aumentada', () => {
  it('leva origem e dados do alinhamento só nas fotos da RA', async () => {
    const r = rascunho(3)
    const ra = {
      par: r.fotos[2].id,
      modelos: [{ sigla: 'ELT', revisao: 'R01', hash: 'abc' }],
      alinhamento: 'cantos' as const,
      pose: { posicao: [1, 2, 3] as [number, number, number], rumo: 0.5, fov: 60 },
    }
    r.fotos[1] = { ...r.fotos[1], origem: 'ra_limpa', ra }
    r.fotos[2] = { ...r.fotos[2], origem: 'ra_modelo', ra: { ...ra, par: r.fotos[1].id } }
    const repo = repoFalso()
    await enviarRegistro(repo, r)
    const enviado = repo.registros.get(r.id)!
    expect(enviado.fotos[0]).toEqual({ id: r.fotos[0].id, largura: 10, altura: 10, bytes: 2 })
    expect(enviado.fotos[1]).toMatchObject({ origem: 'ra_limpa', ra: { par: r.fotos[2].id, alinhamento: 'cantos' } })
    expect(enviado.fotos[2]).toMatchObject({ origem: 'ra_modelo', ra: { par: r.fotos[1].id } })
  })
})
