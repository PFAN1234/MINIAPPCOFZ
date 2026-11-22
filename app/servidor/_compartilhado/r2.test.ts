import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const IMPORT_DENO = 'import { AwsClient } from "npm:aws4fetch@1.0.20";'
const IMPORT_NODE = 'import { AwsClient } from "aws4fetch";'

describe('cópia do cliente R2', () => {
  it('só difere da versão das Edge Functions na linha do import', () => {
    const original = readFileSync(resolve(process.cwd(), '../supabase/functions/_shared/r2.ts'), 'utf8')
    const copia = readFileSync(resolve(process.cwd(), 'servidor/_compartilhado/r2.ts'), 'utf8')
    expect(original).toContain(IMPORT_DENO)
    expect(original.replace(IMPORT_DENO, IMPORT_NODE)).toBe(copia)
  })
})
