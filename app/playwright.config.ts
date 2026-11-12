import { defineConfig } from '@playwright/test'

const PORTA = 4174
const URL_BASE = `http://localhost:${PORTA}`

// Em máquinas sem o Chromium baixado pelo `playwright install`, aponte
// PW_CHROMIUM para um executável existente (ex.: /opt/pw-browsers/...).
const executavel = process.env.PW_CHROMIUM

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: URL_BASE,
    trace: 'off',
    // A fixture não precisa de service worker; bloqueá-lo evita cache entre execuções.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        // Câmera simulada para a realidade aumentada (`e2e/ra.spec.ts`).
        permissions: ['camera'],
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
          ...(executavel ? { executablePath: executavel } : {}),
        },
      },
    },
  ],
  webServer: {
    command: `npm run build:fixture && npx vite preview --outDir dist-fixture --port ${PORTA} --strictPort`,
    url: URL_BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
