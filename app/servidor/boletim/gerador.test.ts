// @vitest-environment node
import sharp from 'sharp'
import type { Browser } from 'playwright-core'
import { describe, expect, it, vi } from 'vitest'
import { fotoDeTeste, lerSnapshotExemplo } from './exemplo.js'
import { prepararFotos, reduzirFoto, tipoDaImagem } from './fotos.js'
import { caminhosDoBoletim, climaCabeNoDia, processarFila, type Dependencias } from './gerador.js'
import { tratarGerar, tratarPrevia } from './http.js'
import { ErroRpc, type FonteBoletim } from './supabase.js'
import type { PedidoReivindicado, Snapshot } from './tipos.js'

describe('fotos', () => {
  it('reduz para no máximo 1000 px no lado maior, em JPEG, sem ampliar', async () => {
    const grande = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#888' } }).png().toBuffer()
    const m = await sharp(await reduzirFoto(grande)).metadata()
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 1000, 667])
    const pequena = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#888' } }).jpeg().toBuffer()
    expect((await sharp(await reduzirFoto(pequena)).metadata()).width).toBe(400)
  })

  it('foto que não baixa ou não abre vira null, sem derrubar as outras', async () => {
    const aviso = vi.fn()
    const mapa = await prepararFotos(
      ['a.jpg', 'b.jpg', 'c.jpg', 'a.jpg'],
      async (c) => {
        if (c === 'b.jpg') throw new Error('404')
        if (c === 'c.jpg') return new Uint8Array([1, 2, 3])
        return fotoDeTeste(c, 0)
      },
      { aviso },
    )
    expect(mapa.size).toBe(3)
    expect(mapa.get('a.jpg')).toMatch(/^data:image\/jpeg;base64,\/9j\//)
    expect(mapa.get('b.jpg')).toBeNull()
    expect(mapa.get('c.jpg')).toBeNull()
    expect(aviso).toHaveBeenCalledTimes(2)
  })

  it('reconhece o tipo do logo', () => {
    expect(tipoDaImagem(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(tipoDaImagem(new Uint8Array([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
  })
})

describe('regras do gerador', () => {
  it('caminhos no bucket boletins', () => {
    expect(caminhosDoBoletim('e1', 'BA2/261113/COFZ-R1')).toEqual({
      pdf: 'e1/BA2261113COFZ-R1.pdf',
      clima: 'e1/BA2261113COFZ-R1-clima.png',
    })
  })

  it('o clima só vale para o dia (ou para o anterior até as 6 h)', () => {
    const f = 'America/Fortaleza'
    expect(climaCabeNoDia('2026-11-13', new Date('2026-11-14T02:30:00Z'), f)).toBe(true) // 23:30 do dia
    expect(climaCabeNoDia('2026-11-13', new Date('2026-11-14T05:30:00Z'), f)).toBe(true) // 02:30 do dia seguinte
    expect(climaCabeNoDia('2026-11-13', new Date('2026-11-14T10:00:00Z'), f)).toBe(false) // 07:00 do dia seguinte
    expect(climaCabeNoDia('2026-11-10', new Date('2026-11-14T02:30:00Z'), f)).toBe(false)
  })
})

/** Fonte em memória (banco + Storage) e dependências sem Chromium. */
function cenario(pedidos: PedidoReivindicado[], snapshot: Snapshot) {
  const enviados = new Map<string, { bytes: Uint8Array; tipo: string }>()
  const fonte = {
    segredoInterno: vi.fn(async () => 'segredo'),
    reivindicar: vi.fn(async () => pedidos),
    snapshot: vi.fn(async (_e: string, data: string) => ({ ...structuredClone(snapshot), data })),
    snapshotDoBoletim: vi.fn<FonteBoletim["snapshotDoBoletim"]>(async () => structuredClone(snapshot)),
    concluir: vi.fn(async (...args: [number, Snapshot, string]) => ({ boletim_id: 'b1', numero: args[0] > 0 ? 'N' : '' })),
    falhar: vi.fn(async () => undefined),
    climaAnterior: vi.fn<FonteBoletim['climaAnterior']>(async () => null),
    baixar: vi.fn(async (bucket: string, caminho: string) => {
      if (bucket === 'boletins') return new Uint8Array(Buffer.from('png-anterior'))
      if (bucket === 'organizacao') return new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      return fotoDeTeste(caminho, 1)
    }),
    enviar: vi.fn(async (bucket: string, caminho: string, bytes: Uint8Array, tipo: string) => {
      enviados.set(`${bucket}/${caminho}`, { bytes, tipo })
    }),
  } satisfies FonteBoletim
  const navegador = { close: vi.fn(async () => undefined) } as unknown as Browser
  const htmls: string[] = []
  const deps: Dependencias = {
    abrirNavegador: vi.fn(async () => navegador),
    capturarClima: vi.fn(async () => ({
      clima: {
        fonte: 'Observatório',
        estacao: { codigo: '8836', nome: 'Montese' },
        leitura: '23:20',
        copiado_em: '2026-11-14T02:30:00.000Z',
        imagem_path: null,
      },
      imagem: Buffer.from('png-do-clima'),
    })),
    gerarPdf: vi.fn(async (_n: Browser, html: string) => {
      htmls.push(html)
      return Buffer.from('%PDF-falso')
    }),
    agora: () => new Date('2026-11-14T02:30:00Z'),
    log: vi.fn(),
  }
  return { fonte, deps, enviados, htmls, navegador }
}

describe('fila de emissão', async () => {
  const snapshot = await lerSnapshotExemplo()
  const pedido: PedidoReivindicado = { id: 7, etapa_id: 'e1', data: '2026-11-13', revisao: 0, numero: 'BA2/261113/COFZ', base_boletim_id: null, edicao: null }

  it('emite: envia PDF e clima ao bucket e conclui com o snapshot inteiro e o clima', async () => {
    const c = cenario([pedido], snapshot)
    const r = await processarFila(c.fonte, c.deps)
    expect(r).toEqual([{ id: 7, numero: 'BA2/261113/COFZ', ok: true }])
    expect(c.fonte.reivindicar).toHaveBeenCalledWith(2)
    expect(c.fonte.snapshot).toHaveBeenCalledWith('e1', '2026-11-13')
    expect([...c.enviados.keys()]).toEqual(['boletins/e1/BA2261113COFZ-clima.png', 'boletins/e1/BA2261113COFZ.pdf'])
    expect(c.enviados.get('boletins/e1/BA2261113COFZ.pdf')?.tipo).toBe('application/pdf')
    const [id, final, caminho] = c.fonte.concluir.mock.calls[0]
    expect([id, caminho]).toEqual([7, 'e1/BA2261113COFZ.pdf'])
    expect(final.tardios).toEqual(snapshot.tardios)
    expect(final.obras).toEqual(snapshot.obras)
    expect(final.clima).toMatchObject({ estacao: { codigo: '8836' }, imagem_path: 'e1/BA2261113COFZ-clima.png' })
    expect(c.htmls[0]).toContain('BA2/261113/COFZ')
    expect(c.htmls[0]).toContain('data:image/png;base64,')
    expect(c.fonte.baixar).toHaveBeenCalledWith('fotos', 'exemplo/foto-01.jpg')
    expect(c.fonte.baixar).toHaveBeenCalledWith('organizacao', 'logo-0123456789abcdef.png')
    expect(c.navegador.close).toHaveBeenCalledTimes(1)
  })

  it('clima indisponível: conclui sem imagem do clima', async () => {
    const c = cenario([pedido], snapshot)
    c.deps.capturarClima = vi.fn(async () => ({ clima: { indisponivel: true as const, motivo: 'fora do ar' }, imagem: null }))
    await processarFila(c.fonte, c.deps)
    expect([...c.enviados.keys()]).toEqual(['boletins/e1/BA2261113COFZ.pdf'])
    expect(c.fonte.concluir.mock.calls[0][1].clima).toEqual({ indisponivel: true, motivo: 'fora do ar' })
  })

  it('erro num pedido → falhar_emissao e segue para o próximo', async () => {
    const segundo = { ...pedido, id: 8, data: '2026-11-12', numero: 'BA2/261112/COFZ' }
    const c = cenario([pedido, segundo], snapshot)
    c.fonte.snapshot.mockRejectedValueOnce(new ErroRpc('boletim_snapshot: A etapa não tem sigla', '22023'))
    const r = await processarFila(c.fonte, c.deps)
    expect(r.map((x) => x.ok)).toEqual([false, true])
    expect(c.fonte.falhar).toHaveBeenCalledWith(7, 'boletim_snapshot: A etapa não tem sigla')
    // boletim de dia anterior: não copia o clima de hoje
    expect(c.deps.capturarClima).not.toHaveBeenCalled()
    expect(c.fonte.concluir.mock.calls[0][1].clima).toMatchObject({ indisponivel: true })
  })

  describe('dia antigo (retificação)', () => {
    const antigo: PedidoReivindicado = { id: 9, etapa_id: 'e1', data: '2026-11-10', revisao: 1, numero: 'BA2/261110/COFZ-R1', base_boletim_id: null, edicao: null }
    const anterior = {
      numero: 'BA2/261110/COFZ',
      clima: {
        fonte: 'Observatório',
        estacao: { codigo: '8836', nome: 'Montese' },
        leitura: '23:20',
        copiado_em: '2026-11-11T02:30:00.000Z',
        imagem_path: 'e1/BA2261110COFZ-clima.png',
      },
    }
    const motivoAtual = 'boletim de data anterior; o Observatório só mostra as últimas 24 horas'

    it('reaproveita o clima do boletim anterior: imagem do bucket, novo imagem_path e novo upload', async () => {
      const c = cenario([antigo], snapshot)
      c.fonte.climaAnterior.mockResolvedValueOnce(anterior)
      await processarFila(c.fonte, c.deps)
      expect(c.fonte.climaAnterior).toHaveBeenCalledWith(snapshot.etapa.id, '2026-11-10')
      expect(c.fonte.baixar).toHaveBeenCalledWith('boletins', 'e1/BA2261110COFZ-clima.png')
      expect(c.deps.capturarClima).not.toHaveBeenCalled()
      expect(c.enviados.get('boletins/e1/BA2261110COFZ-R1-clima.png')?.bytes.toString()).toBe('png-anterior')
      expect(c.fonte.concluir.mock.calls[0][1].clima).toEqual({
        ...anterior.clima,
        imagem_path: 'e1/BA2261110COFZ-R1-clima.png',
        reaproveitado_de: 'BA2/261110/COFZ',
      })
      expect(c.htmls[0]).toContain('reaproveitada do boletim BA2/261110/COFZ')
    })

    it('sem boletim anterior com clima: indisponível com o motivo novo', async () => {
      const c = cenario([antigo], snapshot)
      await processarFila(c.fonte, c.deps)
      expect(c.fonte.concluir.mock.calls[0][1].clima).toEqual({
        indisponivel: true,
        motivo: `${motivoAtual} e nenhum boletim desse dia tem o clima copiado`,
      })
    })

    it('falha no download: indisponível, registra no log e gera o PDF', async () => {
      const c = cenario([antigo], snapshot)
      c.fonte.climaAnterior.mockResolvedValueOnce(anterior)
      const base = c.fonte.baixar.getMockImplementation()!
      c.fonte.baixar.mockImplementation(async (b: string, p: string) => {
        if (b === 'boletins') throw new Error('404')
        return base(b, p)
      })
      const r = await processarFila(c.fonte, c.deps)
      expect(r[0].ok).toBe(true)
      expect(c.fonte.concluir.mock.calls[0][1].clima).toEqual({ indisponivel: true, motivo: motivoAtual })
      expect(c.deps.log).toHaveBeenCalledWith(expect.stringContaining('não reaproveitado: 404'))
      expect(c.htmls).toHaveLength(1)
    })

    it('falha na consulta: indisponível, registra no log e gera o PDF', async () => {
      const c = cenario([antigo], snapshot)
      c.fonte.climaAnterior.mockRejectedValueOnce(new Error('rpc caiu'))
      const r = await processarFila(c.fonte, c.deps)
      expect(r[0].ok).toBe(true)
      expect(c.fonte.concluir.mock.calls[0][1].clima).toEqual({ indisponivel: true, motivo: motivoAtual })
      expect(c.deps.log).toHaveBeenCalledWith(expect.stringContaining('rpc caiu'))
      expect(c.htmls).toHaveLength(1)
    })

    it('dia atual não consulta o clima anterior', async () => {
      const c = cenario([pedido], snapshot)
      await processarFila(c.fonte, c.deps)
      expect(c.fonte.climaAnterior).not.toHaveBeenCalled()
    })
  })

  describe('retificação com base e edição', () => {
    const servicos = snapshot.obras[0]!.servicos
    const comBase: PedidoReivindicado = {
      id: 11,
      etapa_id: 'e1',
      data: '2026-11-13',
      revisao: 1,
      numero: 'BA2/261113/COFZ-R1',
      base_boletim_id: 'base-1',
      edicao: { textos: { [`servico:${servicos[0]!.id}`]: '  Legenda editada  ' }, ocultos: [`servico:${servicos[1]!.id}`] },
    }

    it('usa o snapshot do boletim de base com a edição, reaproveita o clima e não lê o snapshot do dia', async () => {
      const c = cenario([comBase], snapshot)
      c.fonte.climaAnterior.mockResolvedValueOnce({
        numero: 'BA2/261113/COFZ',
        clima: { fonte: 'Observatório', estacao: { codigo: '8836', nome: 'Montese' }, leitura: '23:20', copiado_em: '2026-11-14T02:30:00.000Z', imagem_path: 'e1/BA2261113COFZ-clima.png' },
      })
      const r = await processarFila(c.fonte, c.deps)
      expect(r[0].ok).toBe(true)
      expect(c.fonte.snapshotDoBoletim).toHaveBeenCalledWith('base-1')
      expect(c.fonte.snapshot).not.toHaveBeenCalled()
      expect(c.deps.capturarClima).not.toHaveBeenCalled()
      expect(c.fonte.climaAnterior).toHaveBeenCalledWith(snapshot.etapa.id, '2026-11-13')
      const final = c.fonte.concluir.mock.calls[0][1]
      expect(final.obras[0]!.servicos[0]!.legenda).toBe('Legenda editada')
      expect(final.obras[0]!.servicos.map((x) => x.id)).not.toContain(servicos[1]!.id)
      expect(final.clima).toMatchObject({ reaproveitado_de: 'BA2/261113/COFZ', imagem_path: 'e1/BA2261113COFZ-R1-clima.png' })
    })
  })

  it('fila vazia: não abre o navegador', async () => {
    const c = cenario([], snapshot)
    expect(await processarFila(c.fonte, c.deps)).toEqual([])
    expect(c.deps.abrirNavegador).not.toHaveBeenCalled()
  })

  it('POST /api/gerar-boletim: confere o segredo interno e processa em segundo plano', async () => {
    const c = cenario([pedido], snapshot)
    const fundo: Promise<unknown>[] = []
    const ctx = { fonte: c.fonte, deps: c.deps, aoFundo: (p: Promise<unknown>) => fundo.push(p) }
    const url = 'https://exemplo/api/gerar-boletim'
    expect((await tratarGerar(new Request(url, { method: 'POST' }), ctx)).status).toBe(401)
    const errado = new Request(url, { method: 'POST', headers: { 'x-segredo-interno': 'outro' } })
    expect((await tratarGerar(errado, ctx)).status).toBe(401)
    expect((await tratarGerar(new Request(url), ctx)).status).toBe(405)
    expect(fundo).toHaveLength(0)
    const certo = await tratarGerar(new Request(url, { method: 'POST', headers: { 'x-segredo-interno': 'segredo' } }), ctx)
    expect(certo.status).toBe(202)
    expect(await certo.json()).toEqual({ aceito: true })
    await Promise.all(fundo)
    expect(c.fonte.concluir).toHaveBeenCalledTimes(1)
  })

  it('segredo ausente no banco: recusa', async () => {
    const c = cenario([pedido], snapshot)
    c.fonte.segredoInterno.mockResolvedValue(null as unknown as string)
    const req = new Request('https://exemplo/api/gerar-boletim', { method: 'POST', headers: { 'x-segredo-interno': 'segredo' } })
    expect((await tratarGerar(req, { fonte: c.fonte, deps: c.deps, aoFundo: () => undefined })).status).toBe(401)
  })

  it('GET /api/previa-boletim: só admin; devolve o PDF sem número e sem gravar nada', async () => {
    const c = cenario([], snapshot)
    const souAdmin = vi.fn(async () => true)
    const snap = vi.fn(async () => structuredClone(snapshot))
    const ctx = { fonte: c.fonte, deps: c.deps, acesso: vi.fn(() => ({ souAdmin, snapshot: snap, boletim: vi.fn() })) }
    const url = 'https://exemplo/api/previa-boletim?etapa=2a-etapa&data=2026-11-13'
    expect((await tratarPrevia(new Request(url), ctx)).status).toBe(401)
    const com = (u: string) => new Request(u, { headers: { Authorization: 'Bearer jwt' } })
    expect((await tratarPrevia(com('https://exemplo/api/previa-boletim?etapa=2a-etapa&data=13/11'), ctx)).status).toBe(400)

    const r = await tratarPrevia(com(url), ctx)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('%PDF-falso')
    expect(ctx.acesso).toHaveBeenCalledWith('jwt')
    expect(snap).toHaveBeenCalledWith('2a-etapa', '2026-11-13')
    expect(c.htmls[0]).toContain('PRÉVIA — sem número')
    expect(c.enviados.size).toBe(0)
    expect(c.fonte.concluir).not.toHaveBeenCalled()

    souAdmin.mockResolvedValueOnce(false)
    expect((await tratarPrevia(com(url), ctx)).status).toBe(403)
    snap.mockRejectedValueOnce(new ErroRpc('admin_boletim_snapshot: Etapa não encontrada', 'P0002'))
    const nao = await tratarPrevia(com(url), ctx)
    expect([nao.status, await nao.json()]).toEqual([404, { erro: 'Etapa não encontrada' }])
  })

  it('POST /api/previa-boletim: aplica a edição ao snapshot do boletim e reaproveita o clima', async () => {
    const c = cenario([], snapshot)
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const souAdmin = vi.fn(async () => true)
    const boletim = vi.fn(async () => ({ snapshot: structuredClone(snapshot) }))
    const ctx = { fonte: c.fonte, deps: c.deps, acesso: vi.fn(() => ({ souAdmin, snapshot: vi.fn(), boletim })) }
    const post = (corpo: unknown, auth = 'Bearer jwt') =>
      new Request('https://exemplo/api/previa-boletim', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
      })
    const edicao = { textos: { [`servico:${snapshot.obras[0]!.servicos[0]!.id}`]: 'Texto da prévia' } }

    expect((await tratarPrevia(post({ boletim_id: id, edicao }, ''), ctx)).status).toBe(401)
    const r = await tratarPrevia(post({ boletim_id: id, edicao }), ctx)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/pdf')
    expect(boletim).toHaveBeenCalledWith(id)
    expect(c.htmls[0]).toContain('PRÉVIA — sem número')
    expect(c.htmls[0]).toContain('Texto da prévia')
    expect(c.deps.capturarClima).not.toHaveBeenCalled()
    expect(c.fonte.concluir).not.toHaveBeenCalled()
    expect(c.enviados.size).toBe(0)

    const invalidos: unknown[] = ['{não é json', { edicao }, { boletim_id: 'x', edicao }, { boletim_id: id }, { boletim_id: id, edicao: { textos: { a: 1 } } }, { boletim_id: id, edicao: { outra: [] } }]
    for (const corpo of invalidos) {
      const e = await tratarPrevia(post(corpo), ctx)
      expect(e.status).toBe(400)
      expect(typeof ((await e.json()) as { erro: string }).erro).toBe('string')
    }
    expect(boletim).toHaveBeenCalledTimes(1)

    souAdmin.mockResolvedValueOnce(false)
    expect((await tratarPrevia(post({ boletim_id: id, edicao }), ctx)).status).toBe(403)
    boletim.mockRejectedValueOnce(new ErroRpc('admin_boletim: Boletim não encontrado', 'P0002'))
    const nao = await tratarPrevia(post({ boletim_id: id, edicao }), ctx)
    expect([nao.status, await nao.json()]).toEqual([404, { erro: 'Boletim não encontrado' }])
  })
})
