import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach } from 'vitest'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  try {
    localStorage.clear()
  } catch {
    // Ambiente sem localStorage.
  }
})

afterEach(() => cleanup())
