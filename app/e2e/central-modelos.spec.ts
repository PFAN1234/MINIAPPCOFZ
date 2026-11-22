import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Central de modelos do admin (`/admin/modelos/:slug`), fixture: o build remove `public/modelos`,
// então o manifesto e o .frag da HTO são servidos por `page.route`. O .frag é gerado fora do Git
// (`npm run modelos -- --obra hto`).
test.use({
  viewport: { width: 1440, height: 900 },
  isMobile: false,
  hasTouch: false,
  launchOptions: {
    // WebGL por software quando não há GPU no ambiente.
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  },
})

const FRAG_LOCAL = new URL('../public/modelos/hto/ARQ.frag', import.meta.url)
const MANIFESTO = {
  modelos: [{ sigla: 'ARQ', revisao: 'R06', arquivo: 'ARQ.frag', bytes: 1, hash: 'e2e' }],
}

test.describe('com o ARQ.frag gerado localmente', () => {
  test.skip(!existsSync(FRAG_LOCAL), 'ARQ.frag ausente: rode `npm run modelos -- --obra hto`')

  test('abre a obra, seleciona, isola, mostra tudo e troca o tema sem erros', async ({ page }) => {
    // O WebGL por software leva ~7,5 min sozinho (já antes da etapa 7); com outros specs em paralelo passa de 8.
    test.setTimeout(900_000)
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))
    await page.route('**/modelos/hto/manifesto.json', (rota) =>
      rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANIFESTO) }),
    )
    await page.route('**/modelos/hto/ARQ.frag*', (rota) =>
      rota.fulfill({ status: 200, contentType: 'application/octet-stream', body: readFileSync(FRAG_LOCAL) }),
    )

    await page.goto('/admin/modelos')
    await expect(page.getByRole('heading', { name: 'Modelos', level: 1 })).toBeVisible()
    // A fixture semeia documentos na HTO: ela aparece na lista principal (fora de "Sem arquivos").
    await page.getByRole('link', { name: /HTO/ }).first().click()
    await page.getByRole('tab', { name: 'Itens' }).click()

    await expect(page.getByText(/Carregando modelos/)).toBeHidden({ timeout: 120_000 })
    const arvore = page.getByRole('tree', { name: 'Árvore do modelo' })
    await expect(arvore).toBeVisible({ timeout: 60_000 })
    await expect(arvore).toContainText('ARQ')

    // Seleção: clica no centro do canvas até acertar um elemento.
    const canvas = page.locator('.central-tela canvas').first()
    await expect(canvas).toBeVisible()
    const caixa = (await canvas.boundingBox())!
    const selecionado = page.getByText(/^Selecionado \([1-9]\d*\)$/)
    const alvos = [
      [0.5, 0.5],
      [0.45, 0.55],
      [0.55, 0.45],
      [0.4, 0.6],
      [0.6, 0.6],
      [0.5, 0.65],
      [0.35, 0.5],
      [0.65, 0.5],
    ]
    for (const [fx, fy] of alvos) {
      if (await selecionado.isVisible()) break
      await page.mouse.click(caixa.x + caixa.width * fx, caixa.y + caixa.height * fy)
      await page.waitForTimeout(700)
    }
    if (!(await selecionado.isVisible())) {
      // Plano B: seleciona pela busca por nome.
      await page.getByRole('searchbox', { name: 'Buscar itens' }).fill('a')
      await page.getByRole('list', { name: 'Resultados da busca' }).getByRole('button').first().click({ timeout: 60_000 })
    }
    await expect(selecionado).toBeVisible({ timeout: 30_000 })

    // Inspeção: grupo Atributos com GlobalId e ao menos um conjunto de propriedades (Pset_…).
    await page.getByRole('button', { name: 'Inspecionar' }).click()
    const contexto = page.getByRole('region', { name: 'Contexto' })
    await expect(contexto.getByText('Atributos', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(contexto.getByText('GlobalId', { exact: true })).toBeVisible()
    await expect(contexto.locator('summary', { hasText: /^Pset_/ }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Ver', exact: true }).click()

    const isolar = page.getByRole('button', { name: 'Isolar' })
    await isolar.click()
    await expect(isolar).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: 'test-results/central-2b.png' })
    await page.getByRole('button', { name: 'Mostrar tudo' }).click()
    await expect(isolar).toHaveAttribute('aria-pressed', 'false')

    // Etapa 4A: planta do primeiro pavimento, volta ao 3D, corte (criar e apagar) e minimapa.
    const vista3d = page.getByRole('button', { name: 'Vista 3D' })
    const seletor = page.getByRole('combobox', { name: 'Pavimento' })
    await expect(seletor.locator('option').first()).not.toHaveText('Sem pavimentos', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Planta' }).click()
    await expect(page.getByRole('button', { name: 'Planta' })).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'test-results/central-4a-planta.png' })
    await vista3d.click()
    await expect(vista3d).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: 'Cortar' }).click()
    const listaCortes = page.getByRole('list', { name: 'Lista de cortes' })
    await expect(listaCortes.getByRole('listitem')).toHaveCount(1, { timeout: 30_000 })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'test-results/central-4a-corte.png' })
    await page.getByRole('button', { name: 'Apagar corte 1' }).click()
    await expect(listaCortes).toBeHidden()

    // Medições: distância com dois cliques no canvas (vários pares de pontos, pois a captura depende do WebGL de software).
    await page.getByRole('tab', { name: 'Medições' }).click()
    await page.getByRole('button', { name: 'Medir' }).click()
    await page.getByRole('button', { name: 'Distância' }).click()
    await expect(page.getByRole('button', { name: 'Distância' })).toHaveAttribute('aria-pressed', 'true')
    const itensMedicao = page.getByRole('list', { name: 'Lista de medições' }).getByRole('listitem')
    const pares = [
      [[0.45, 0.5], [0.55, 0.55]],
      [[0.4, 0.45], [0.6, 0.6]],
    ]
    let medido = false
    for (const [a, b] of pares) {
      for (const [fx, fy] of [a, b]) {
        await page.mouse.move(caixa.x + caixa.width * fx, caixa.y + caixa.height * fy)
        await page.waitForTimeout(700)
        await page.mouse.click(caixa.x + caixa.width * fx, caixa.y + caixa.height * fy)
        await page.waitForTimeout(700)
      }
      medido = (await itensMedicao.count()) === 1
      if (medido) break
    }
    if (medido) {
      await expect(itensMedicao).toHaveCount(1)
      await page.screenshot({ path: 'test-results/central-4b-medicao.png' })
      await page.getByRole('button', { name: 'Apagar medição 1' }).click()
      await expect(page.getByText('Nenhuma medição.')).toBeVisible()
    } else {
      test.info().annotations.push({ type: 'medicao', description: 'cliques no canvas não geraram medição no WebGL de software' })
    }
    await page.getByRole('button', { name: 'Distância' }).click()
    await expect(page.getByRole('button', { name: 'Medir' })).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('tab', { name: 'Itens' }).click()

    await page.getByRole('button', { name: 'Minimapa' }).click()
    await expect(page.getByTestId('minimapa')).toBeVisible()

    // Grade e cor.
    const grade = page.getByRole('button', { name: 'Grade' })
    await grade.click()
    await expect(grade).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('button', { name: 'Cor', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Categoria' }).click()
    await page.getByRole('tab', { name: 'Categorias' }).click()
    const categorias = page.getByRole('list', { name: 'Categorias IFC' })
    await expect(categorias).toBeVisible()
    await expect(categorias).not.toContainText(/IFCPROPERTY|IFCMATERIAL|TYPE/)

    // Documentos: vincular a seleção à prancha, vê-la no contexto e abrir a prévia do PDF.
    await page.mouse.click(caixa.x + caixa.width * 0.5, caixa.y + caixa.height * 0.5)
    await page.getByRole('tab', { name: 'Documentos' }).click()
    const prancha = page.locator('[data-testid^="documento-"]').filter({ hasText: 'Planta baixa' })
    await prancha.getByRole('button', { name: /Vínculos/ }).click()
    const vincular = prancha.getByRole('button', { name: /Vincular seleção/ })
    if (await vincular.isEnabled()) {
      await vincular.click()
      await expect(page.getByRole('region', { name: 'Contexto' })).toContainText('Documentos deste elemento')
    }
    await prancha.getByRole('button', { name: 'Ver', exact: true }).click()
    const previa = page.getByRole('dialog', { name: /Planta baixa/ })
    await expect(previa.locator('canvas')).toBeVisible({ timeout: 60_000 })
    await expect(page).toHaveURL(/doc=/)
    await page.keyboard.press('Escape')
    await expect(previa).toBeHidden()

    const raiz = page.locator('.central')
    await expect(raiz).toHaveAttribute('data-tema', 'escuro')
    await page.getByRole('button', { name: /Configurações/ }).click()
    await expect(raiz).toHaveAttribute('data-tema', 'claro')
    expect(erros).toEqual([])
  })

  test('vista salva, captura PNG e marcadores no motor 3D (etapa 7C1)', async ({ page }) => {
    test.setTimeout(480_000)
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))
    await page.route('**/modelos/hto/manifesto.json', (rota) =>
      rota.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MANIFESTO) }),
    )
    await page.route('**/modelos/hto/ARQ.frag*', (rota) =>
      rota.fulfill({ status: 200, contentType: 'application/octet-stream', body: readFileSync(FRAG_LOCAL) }),
    )
    await page.goto('/admin/modelos')
    await page.getByRole('link', { name: /HTO/ }).first().click()
    await page.getByRole('tab', { name: 'Itens' }).click()
    await expect(page.getByText(/Carregando modelos/)).toBeHidden({ timeout: 120_000 })
    await expect(page.getByRole('tree', { name: 'Árvore do modelo' })).toBeVisible({ timeout: 60_000 })
    await page.waitForFunction(() => Boolean((window as never as { __motorCentral?: unknown }).__motorCentral))

    // Câmera + corte + elemento oculto: lê a vista, muda tudo, reaplica e confere que voltou.
    const resultado = await page.evaluate(async () => {
      type Motor = {
        vistaAtual(): { camera: { posicao: number[]; alvo: number[]; projecao: string; campo?: number }; cortes: unknown[]; ocultos: unknown[]; isolados: unknown }
        aplicarVista(v: unknown): Promise<void>
        buscar(f: unknown): Promise<unknown[]>
        ocultar(r: unknown[]): void
        mostrarTudo(): void
        projecao(p: string): void
        cortes: { criar(): void; apagar(): void; listar(): unknown[] }
      }
      const m = (window as never as { __motorCentral: Motor }).__motorCentral
      const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
      let refs: unknown[] = []
      for (const classe of ['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCDOOR']) {
        refs = await m.buscar({ classe, operador: 'existe' })
        if (refs.length) break
      }
      m.ocultar(refs.slice(0, 2))
      m.cortes.criar()
      for (let i = 0; i < 60 && m.cortes.listar().length === 0; i++) await espera(250)
      const original = m.vistaAtual()
      // Muda tudo.
      m.mostrarTudo()
      m.cortes.apagar()
      await m.aplicarVista({
        ...m.vistaAtual(),
        camera: { posicao: [-40, 50, 15], alvo: [2, 3, 4], projecao: 'ortografica', campo: 30 },
        cortes: [],
        ocultos: [],
      })
      const alterada = m.vistaAtual()
      // Volta.
      await m.aplicarVista(original)
      const restaurada = m.vistaAtual()
      // Refs de disciplina não carregada e GlobalId inexistente não derrubam a aplicação.
      await m.aplicarVista({ ...original, ocultos: [{ sigla: 'XXX', globalId: 'nao-existe' }], selecionados: [{ sigla: 'ARQ', globalId: 'nao-existe' }] })
      return { tinha: refs.length, original, alterada, restaurada }
    })
    expect(resultado.tinha).toBeGreaterThan(0)
    expect(resultado.original.cortes).toHaveLength(1)
    expect(resultado.original.ocultos.length).toBeGreaterThan(0)
    expect(resultado.alterada.cortes).toHaveLength(0)
    expect(resultado.alterada.camera.projecao).toBe('ortografica')
    // Na ortográfica, `campo` é a altura visível em metros: o zoom volta igual.
    expect(resultado.alterada.camera.campo).toBeCloseTo(30, 1)
    expect(resultado.restaurada.cortes).toEqual(resultado.original.cortes)
    expect(resultado.restaurada.ocultos).toEqual(resultado.original.ocultos)
    expect(resultado.restaurada.camera.projecao).toBe(resultado.original.camera.projecao)
    resultado.original.camera.posicao.forEach((v, i) => expect(resultado.restaurada.camera.posicao[i]).toBeCloseTo(v, 1))
    resultado.original.camera.alvo.forEach((v, i) => expect(resultado.restaurada.camera.alvo[i]).toBeCloseTo(v, 1))

    // Captura: PNG não vazio, até 1600 px de largura.
    const png = await page.evaluate(async () => {
      const m = (window as never as { __motorCentral: { capturar(): Promise<Blob> } }).__motorCentral
      const b = await m.capturar()
      const bytes = new Uint8Array(await b.arrayBuffer())
      const img = await createImageBitmap(b)
      return { tipo: b.type, tamanho: b.size, assinatura: [...bytes.slice(0, 4)], largura: img.width }
    })
    expect(png.tipo).toBe('image/png')
    expect(png.tamanho).toBeGreaterThan(1000)
    expect(png.tamanho).toBeLessThan(5 * 1024 * 1024)
    expect(png.assinatura).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(png.largura).toBeLessThanOrEqual(1600)

    // Marcador: pino visível no alvo da câmera; o clique emite o evento; lista vazia limpa.
    await page.evaluate(() => {
      type Motor = {
        vistaAtual(): { camera: { alvo: number[] } }
        marcadores(i: unknown[]): void
        ao(e: string, cb: (d: unknown) => void): void
      }
      const w = window as never as { __motorCentral: Motor; __cliques: unknown[] }
      w.__cliques = []
      w.__motorCentral.ao('marcador', (d) => w.__cliques.push(d))
      w.__motorCentral.marcadores([{ id: 'issue-3', posicao: w.__motorCentral.vistaAtual().camera.alvo, rotulo: '#3' }])
    })
    const pino = page.getByRole('button', { name: 'Marcador #3' })
    await expect(pino).toBeVisible({ timeout: 30_000 })
    await pino.click()
    expect(await page.evaluate(() => (window as never as { __cliques: unknown[] }).__cliques)).toEqual([{ id: 'issue-3' }])
    await page.evaluate(() => (window as never as { __motorCentral: { marcadores(i: unknown[]): void } }).__motorCentral.marcadores([]))
    await expect(pino).toHaveCount(0)
    expect(erros).toEqual([])
  })
})
