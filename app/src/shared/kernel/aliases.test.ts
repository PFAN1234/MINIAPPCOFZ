import { describe, expect, it } from 'vitest'
import * as kernel from '@shared/kernel'

describe('alias @shared', () => {
  it('resolve o Shared Kernel', () => {
    expect(typeof kernel).toBe('object')
  })
})
