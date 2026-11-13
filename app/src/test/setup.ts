import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, vi } from 'vitest'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  try {
    localStorage.clear()
  } catch {
    // Ambiente sem localStorage.
  }
})

afterEach(() => cleanup())

// jsdom não desenha mapas: o mapa do cadastro da etapa vira um botão que "toca" num ponto fixo.
vi.mock('../admin/telas/etapa/MapaEscolha.tsx', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ aoEscolher }: { aoEscolher: (latitude: number, longitude: number) => void }) =>
      createElement('button', { type: 'button', onClick: () => aoEscolher(-3.761234, -38.530123) }, 'Tocar no mapa'),
  }
})
