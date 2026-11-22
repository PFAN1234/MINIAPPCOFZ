// Publica os .frag de uma obra: envia à pasta `modelos` do R2 pela Edge Function `armazenamento`
// (enviar -> PUT -> confirmar) e registra na tabela `modelo`.
// Uso (em app/): SUPABASE_URL=... SUPABASE_SECRET_KEY=... [SEGREDO_INTERNO=...] npm run publicar:modelos -- --obra hto [--dry-run]
// Sem SEGREDO_INTERNO, o segredo vem da RPC `segredo_interno`.
// Lê app/public/modelos/<obra>/manifesto.json (gerado por `npm run modelos`). Chave e segredo nunca são impressos.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PASTA = 'modelos'
const TIPO = 'application/octet-stream'

function argumento(nome) {
  const i = process.argv.indexOf(`--${nome}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

export function caminhoNoBucket(obraId, sigla) {
  return `${obraId}/${sigla}.frag`
}

async function pedir(url, chave, opcoes = {}, doFetch = fetch) {
  const r = await doFetch(url, {
    ...opcoes,
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, ...opcoes.headers },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url.split('?')[0]}: ${(await r.text()).slice(0, 300)}`)
  return r
}

export async function obterSegredo(url, chave, ambiente = process.env, doFetch = fetch) {
  if (ambiente.SEGREDO_INTERNO) return ambiente.SEGREDO_INTERNO
  const r = await pedir(
    `${url}/rest/v1/rpc/segredo_interno`,
    chave,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    doFetch,
  )
  const valor = await r.json()
  if (typeof valor !== 'string' || !valor) throw new Error('A RPC segredo_interno não devolveu o segredo')
  return valor
}

async function chamarFuncao(url, chave, segredo, corpo, doFetch) {
  const r = await doFetch(`${url}/functions/v1/armazenamento`, {
    method: 'POST',
    headers: {
      apikey: chave,
      Authorization: `Bearer ${chave}`,
      'content-type': 'application/json',
      'x-segredo-interno': segredo,
    },
    body: JSON.stringify(corpo),
  })
  if (!r.ok) {
    let motivo = ''
    try {
      motivo = String((await r.json()).erro ?? '').slice(0, 200)
    } catch {
      /* sem corpo JSON */
    }
    throw new Error(`armazenamento/${corpo.acao} recusou ${corpo.caminho}: HTTP ${r.status} ${motivo}`.trim())
  }
  return r.json()
}

/** enviar -> PUT direto na URL assinada -> confirmar. Os erros nunca trazem chave, segredo nem URL assinada. */
export async function enviarModelo(url, chave, segredo, caminho, bytes, doFetch = fetch) {
  const ordem = await chamarFuncao(
    url, chave, segredo,
    { acao: 'enviar', pasta: PASTA, caminho, tamanho: bytes.byteLength, tipo: TIPO },
    doFetch,
  )
  if (ordem.situacao !== 'enviar' || !ordem.url) throw new Error(`Resposta inesperada de armazenamento/enviar para ${caminho}`)
  const put = await doFetch(ordem.url, { method: ordem.metodo ?? 'PUT', headers: ordem.cabecalhos ?? {}, body: bytes })
  if (!put.ok) throw new Error(`O R2 recusou o PUT de ${caminho}: HTTP ${put.status}`)
  const c = await chamarFuncao(url, chave, segredo, { acao: 'confirmar', pasta: PASTA, caminho }, doFetch)
  if (c.situacao !== 'confirmado') throw new Error(`Resposta inesperada de armazenamento/confirmar para ${caminho}`)
}

async function principal() {
  const obra = argumento('obra')
  if (!obra || !/^[a-z0-9-]+$/.test(obra)) {
    console.error('Uso: npm run publicar:modelos -- --obra <slug> [--dry-run]')
    return 1
  }
  const raiz = fileURLToPath(new URL('..', import.meta.url))
  const pasta = path.join(raiz,'public', 'modelos', obra)
  const arqManifesto = path.join(pasta, 'manifesto.json')
  if (!existsSync(arqManifesto)) {
    console.error(`Sem ${arqManifesto}: rode \`npm run modelos -- --obra ${obra}\` antes.`)
    return 1
  }
  const { modelos } = JSON.parse(readFileSync(arqManifesto, 'utf8'))

  if (process.argv.includes('--dry-run')) {
    for (const m of modelos) console.log(`${m.arquivo} -> ${PASTA}/${caminhoNoBucket('<obra_id>', m.sigla)} (${m.bytes} bytes)`)
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
  const segredo = await obterSegredo(url, chave)

  for (const [i, m] of modelos.entries()) {
    const caminho = caminhoNoBucket(obraId, m.sigla)
    const bytes = readFileSync(path.join(pasta, m.arquivo))
    await enviarModelo(url, chave, segredo, caminho, bytes)
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

if (import.meta.url.startsWith('file:') && process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().then(
    (codigo) => process.exit(codigo),
    (e) => {
      console.error(e.message)
      process.exit(1)
    },
  )
}
