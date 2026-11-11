// Teste ponta a ponta dos modelos contra o Supabase LOCAL (`supabase start`):
// publica o .frag, confere a RLS da tabela `modelo` e do bucket `modelos` para participante, estranho e anônimo.
// Uso (em app/): npm run testar:modelos -- --obra hto   (precisa de app/public/modelos/<obra>/ já convertido)
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const i = process.argv.indexOf('--obra')
const slug = i > 0 ? process.argv[i + 1] : undefined
if (!slug) throw new Error('Uso: npm run testar:modelos -- --obra <slug>')

const ambiente = Object.fromEntries(
  execFileSync('supabase', ['status', '-o', 'env'], { cwd: path.join(raiz, '..'), encoding: 'utf8' })
    .split('\n')
    .map((l) => l.match(/^(\w+)="?(.*?)"?$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
)
const url = ambiente.API_URL
const chavePublica = ambiente.PUBLISHABLE_KEY ?? ambiente.ANON_KEY
const chaveSecreta = ambiente.SECRET_KEY ?? ambiente.SERVICE_ROLE_KEY
if (!url || !chavePublica || !chaveSecreta) throw new Error('`supabase status -o env` sem URL/chaves: o stack local está de pé?')

// O service_role não tem grants nas tabelas de usuário/participação (de propósito): o preparo
// do teste vai direto ao Postgres local, dentro do contêiner do Supabase.
const nomeBanco = 'supabase_db_MINIAPPCOFZ' // project_id de supabase/config.toml
function sql(texto) {
  return execFileSync('docker', ['exec', '-i', nomeBanco, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', texto], {
    encoding: 'utf8',
  }).trim()
}

const opcoes = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, chaveSecreta, opcoes)
const falhas = []
function conferir(descricao, ok) {
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${descricao}`)
  if (!ok) falhas.push(descricao)
}
const ok = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data
}

// Obra e usuários de teste ------------------------------------------------------
const obra = {
  id: sql(`insert into public.obra (slug, nome) values ('${slug}', '${slug.toUpperCase()}') on conflict (slug) do update set nome = excluded.nome returning id`).split('\n')[0],
}
const sufixo = randomUUID().slice(0, 8)
async function criarUsuario(nome, telegramId) {
  const email = `${nome}-${sufixo}@teste.local`
  const senha = randomUUID()
  const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (error) throw error
  sql(`insert into public.usuario (id, telegram_id, nome) values ('${data.user.id}', ${telegramId}, '${nome}')`)
  const cliente = createClient(url, chavePublica, opcoes)
  const { error: e2 } = await cliente.auth.signInWithPassword({ email, password: senha })
  if (e2) throw e2
  return { id: data.user.id, cliente }
}
const base = 9_000_000_000 + Math.floor(Math.random() * 1e6)
const participante = await criarUsuario('participante', base)
const estranho = await criarUsuario('estranho', base + 1)
sql(`insert into public.participacao (obra_id, usuario_id, papel) values ('${obra.id}', '${participante.id}', 'equipe')`)

try {
  // Publicação ----------------------------------------------------------------
  const saida = execFileSync('node', ['scripts/publicar_modelos.mjs', '--obra', slug], {
    cwd: raiz,
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: url, SUPABASE_SECRET_KEY: chaveSecreta },
  })
  conferir('publicar_modelos envia sem erro', saida.includes('Publicados'))
  // Republicar é idempotente (upsert): não duplica a linha.
  execFileSync('node', ['scripts/publicar_modelos.mjs', '--obra', slug], {
    cwd: raiz,
    env: { ...process.env, SUPABASE_URL: url, SUPABASE_SECRET_KEY: chaveSecreta },
  })
  const todas = ok(await admin.from('modelo').select('sigla, caminho, bytes, hash').eq('obra_id', obra.id))
  const manifesto = JSON.parse(readFileSync(path.join(raiz, 'public', 'modelos', slug, 'manifesto.json'), 'utf8')).modelos
  conferir('republicar não duplica linhas', todas.length === manifesto.length)

  // Participante ---------------------------------------------------------------
  const linhas = ok(await participante.cliente.from('modelo').select('sigla, caminho, bytes, hash').eq('obra_id', obra.id).order('sigla'))
  conferir('participante vê os modelos da obra', linhas.length === manifesto.length && linhas.length > 0)
  for (const m of linhas) {
    const { data, error } = await participante.cliente.storage.from('modelos').download(m.caminho)
    const bytes = data ? Buffer.from(await data.arrayBuffer()) : Buffer.alloc(0)
    conferir(`participante baixa ${m.sigla}.frag (${bytes.length} bytes)`, !error && bytes.length === Number(m.bytes))
    const hashLocal = createHash('sha256').update(readFileSync(path.join(raiz, 'public', 'modelos', slug, `${m.sigla}.frag`))).digest('hex').slice(0, 16)
    conferir(`conteúdo de ${m.sigla} bate com o hash do manifesto`, hashLocal === m.hash)
  }
  const { error: erroEscrita } = await participante.cliente.from('modelo').insert({ obra_id: obra.id, sigla: 'XXX', caminho: 'x', bytes: 1, hash: 'x' })
  conferir('participante não grava na tabela modelo', Boolean(erroEscrita))
  const { error: erroUpload } = await participante.cliente.storage.from('modelos').upload(`${obra.id}/XXX.frag`, new Blob(['x']), { contentType: 'application/octet-stream' })
  conferir('participante não envia ao bucket modelos', Boolean(erroUpload))

  // Estranho e anônimo --------------------------------------------------------
  const veEstranho = ok(await estranho.cliente.from('modelo').select('sigla').eq('obra_id', obra.id))
  conferir('quem não participa não vê modelos', veEstranho.length === 0)
  const { error: erroEstranho } = await estranho.cliente.storage.from('modelos').download(linhas[0].caminho)
  conferir('quem não participa não baixa o .frag', Boolean(erroEstranho))
  const anonimo = createClient(url, chavePublica, opcoes)
  const { error: erroAnonimo } = await anonimo.from('modelo').select('sigla')
  const { error: erroAnonimoBucket } = await anonimo.storage.from('modelos').download(linhas[0].caminho)
  conferir('anônimo não lê a tabela modelo', Boolean(erroAnonimo))
  conferir('anônimo não baixa o .frag', Boolean(erroAnonimoBucket))
} finally {
  sql(`delete from public.modelo where obra_id = '${obra.id}'`)
  const { data: arquivos } = await admin.storage.from('modelos').list(obra.id)
  if (arquivos?.length) await admin.storage.from('modelos').remove(arquivos.map((a) => `${obra.id}/${a.name}`))
  await admin.auth.admin.deleteUser(participante.id)
  await admin.auth.admin.deleteUser(estranho.id)
}

if (falhas.length) {
  console.error(`\n${falhas.length} verificação(ões) falharam.`)
  process.exit(1)
}
console.log('\nTodas as verificações passaram.')
