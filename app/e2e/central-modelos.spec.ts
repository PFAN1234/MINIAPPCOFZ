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
    test.setTimeout(180_000)
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
    // A fixture ainda não tem disciplinas "publicadas": a HTO aparece em "Sem arquivos".
    await page.getByText(/Sem arquivos/).click()
    await expect(page.getByText('HTO', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Enviar primeiro modelo' }).first().click()
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
      await page.waitForTimeout(1500)
    }
    if (!(await selecionado.isVisible())) {
      // Plano B: seleciona pela busca por nome.
      await page.getByRole('searchbox', { name: 'Buscar itens' }).fill('a')
      await page.getByRole('list', { name: 'Resultados da busca' }).getByRole('button').first().click({ timeout: 60_000 })
    }
    await expect(selecionado).toBeVisible({ timeout: 30_000 })

    const isolar = page.getByRole('button', { name: 'Isolar' })
    await isolar.click()
    await expect(isolar).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: 'test-results/central-2b.png' })
    await page.getByRole('button', { name: 'Mostrar tudo' }).click()
    await expect(isolar).toHaveAttribute('aria-pressed', 'false')

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

    const raiz = page.locator('.central')
    await expect(raiz).toHaveAttribute('data-tema', 'escuro')
    await page.getByRole('button', { name: /Configurações/ }).click()
    await expect(raiz).toHaveAttribute('data-tema', 'claro')
    expect(erros).toEqual([])
  })
})
