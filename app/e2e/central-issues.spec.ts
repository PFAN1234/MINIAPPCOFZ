import { existsSync, readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { expect, test } from '@playwright/test'

// Issues da central com o motor real: cria uma issue com elemento selecionado, exporta em BCF,
// confere o arquivo e reimporta (idempotente). Mesma preparação do central-modelos.spec.ts:
// o manifesto e o ARQ.frag da HTO são servidos por `page.route` (o build remove `public/modelos`).
test.use({
  viewport: { width: 1440, height: 900 },
  isMobile: false,
  hasTouch: false,
  launchOptions: {
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

  test('cria uma issue, exporta em BCF e reimporta o mesmo arquivo sem criar de novo', async ({ page }, info) => {
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

    // Seleciona um elemento pela busca, para a vista da issue levar um GlobalId.
    await page.getByRole('searchbox', { name: 'Buscar itens' }).fill('a')
    await page.getByRole('list', { name: 'Resultados da busca' }).getByRole('button').first().click({ timeout: 60_000 })
    await expect(page.getByText(/^Selecionado \([1-9]\d*\)$/)).toBeVisible({ timeout: 30_000 })

    // Nova issue a partir da vista atual.
    await page.getByRole('tab', { name: 'Issues' }).click()
    await expect(page.getByText(/\d+ abertas? de \d+/)).toBeVisible()
    await page.getByRole('button', { name: 'Nova issue' }).click()
    await page.getByLabel('Título').fill('Issue do teste de BCF')
    const salvar = page.getByRole('button', { name: 'Salvar' })
    await expect(salvar).toBeEnabled({ timeout: 60_000 })
    await salvar.click()
    await expect(page.getByRole('article', { name: /Issue #\d+/ })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Voltar à lista' }).click()
    await expect(page.getByText('Issue do teste de BCF')).toBeVisible()

    // Exporta as issues do filtro atual (abertas) em BCF 2.1.
    await page.getByRole('button', { name: 'Exportar BCF' }).click()
    const baixando = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Baixar .bcfzip' }).click()
    const download = await baixando
    expect(download.suggestedFilename()).toMatch(/^hto-issues-\d{4}-\d{2}-\d{2}\.bcfzip$/)
    const caminho = info.outputPath('issues.bcfzip')
    await download.saveAs(caminho)
    const resultado = page.getByRole('status', { name: 'Resultado do BCF' })
    await expect(resultado).toContainText('exportadas em BCF 2.1')

    const arquivos = unzipSync(new Uint8Array(readFileSync(caminho)))
    expect(Object.keys(arquivos).filter((n) => n.endsWith('markup.bcf')).length).toBeGreaterThanOrEqual(3)
    const markup = Object.entries(arquivos).find(([n, c]) => n.endsWith('markup.bcf') && new TextDecoder().decode(c).includes('Issue do teste de BCF'))
    expect(markup).toBeTruthy()
    const pasta = markup![0].replace(/markup\.bcf$/, '')
    const bcfv = Object.entries(arquivos).find(([n]) => n.startsWith(pasta) && n.endsWith('.bcfv'))
    expect(new TextDecoder().decode(bcfv![1])).toMatch(/<Selection><Component IfcGuid="[^"]{22}"/)
    const totalAbertas = Object.keys(arquivos).filter((n) => n.endsWith('markup.bcf')).length

    // Reimporta o mesmo arquivo: nada é criado, tudo é atualizado, e o elemento é achado no modelo.
    await page.getByLabel('Arquivo BCF').setInputFiles(caminho)
    await expect(resultado).toContainText(`Importação concluída: 0 criadas, ${totalAbertas} atualizadas, 0 elementos não encontrados`, {
      timeout: 60_000,
    })
    expect(erros).toEqual([])
  })
})
