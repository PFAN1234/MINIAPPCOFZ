// Publica os .frag de uma obra no Supabase: envia ao bucket privado `modelos` e registra na tabela `modelo`.
// Uso (em app/): SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run publicar:modelos -- --obra hto [--dry-run]
// Lê app/public/modelos/<obra>/manifesto.json (gerado por `npm run modelos`). A chave secreta nunca é impressa.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BUCKET = 'modelos'
const raiz = fileURLToPath(new URL('..', import.meta.url))

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

export function caminhoNoBucket(obraId, sigla) {
  return `${obraId}/${sigla}.frag`
}

async function pedir(url, chave, opcoes = {}) {
  const r = await fetch(url, {
    ...opcoes,
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, ...opcoes.headers },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url.split('?')[0]}: ${(await r.text()).slice(0, 300)}`)
  return r
}

async function principal() {
  const obra = argumento('obra')
  if (!obra || !/^[a-z0-9-]+$/.test(obra)) {
    console.error('Uso: npm run publicar:modelos -- --obra <slug> [--dry-run]')
    return 1
  }
  const pasta = path.join(raiz, 'public', 'modelos', obra)
  const arqManifesto = path.join(pasta, 'manifesto.json')
  if (!existsSync(arqManifesto)) {
    console.error(`Sem ${arqManifesto}: rode \`npm run modelos -- --obra ${obra}\` antes.`)
    return 1
  }
  const { modelos } = JSON.parse(readFileSync(arqManifesto, 'utf8'))

  if (process.argv.includes('--dry-run')) {
    for (const m of modelos) console.log(`${m.arquivo} -> ${BUCKET}/${caminhoNoBucket('<obra_id>', m.sigla)} (${m.bytes} bytes)`)
    console.log(`${modelos.length} modelos (simulação, nada enviado)`)
    return 0
  }

  const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
  const chave = process.env.SUPABASE_SECRET_KEY ?? ''
  if (!url || !chave) {
    console.error('Defina SUPABASE_URL e SUPABASE_SECRET_KEY.')
    return 2
  }

  const linhas = await (await pedir(`${url}/rest/v1/obra?slug=eq.${encodeURIComponent(obra)}&select=id`, chave)).json()
  if (!linhas.length) {
    console.error(`Obra '${obra}' não encontrada. Rode o seed (supabase/seed/${obra}.sql) antes.`)
    return 1
  }
  const obraId = linhas[0].id

  for (const [i, m] of modelos.entries()) {
    const caminho = caminhoNoBucket(obraId, m.sigla)
    const bytes = readFileSync(path.join(pasta, m.arquivo))
    await pedir(`${url}/storage/v1/object/${BUCKET}/${caminho}`, chave, {
      method: 'POST',
      body: bytes,
      headers: { 'x-upsert': 'true', 'content-type': 'application/octet-stream' },
    })
    await pedir(`${url}/rest/v1/modelo?on_conflict=obra_id,sigla`, chave, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        obra_id: obraId,
        sigla: m.sigla,
        revisao: m.revisao,
        caminho,
        bytes: bytes.byteLength,
        hash: m.hash,
        atualizado_em: new Date().toISOString(),
      }),
    })
    console.log(`[${i + 1}/${modelos.length}] ${caminho} (${(bytes.byteLength / 1e6).toFixed(1)} MB)`)
  }
  console.log(`Publicados ${modelos.length} modelos da obra '${obra}'.`)
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().then(
    (codigo) => process.exit(codigo),
    (e) => {
      console.error(e.message)
      process.exit(1)
    },
  )
}
