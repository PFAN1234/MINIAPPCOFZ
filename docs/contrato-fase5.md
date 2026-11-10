# Fase 5 — contrato do registro com sinal instável

Base: `docs/contrato-fase4.md`, cujo envio já é idempotente e retomável (`enviarRegistro` com ids gerados uma vez). O login real continua na fase 6, então o desenvolvimento e os testes usam a fixture.

Decisões de 2026-11-09:
- **Ao salvar, o app volta na hora.** O formulário grava o registro e as fotos no aparelho e retorna ao Histórico. O envio corre em segundo plano, com o progresso no próprio item.
- **Uso sem sinal entra nesta fase.** O app em si e os dados já vistos ficam no aparelho por até 7 dias, separados por usuário. Dá para navegar e registrar sem sinal no Android e no Telegram Desktop. No iPhone, o WebView do Telegram não roda service worker; lá a fila funciona, mas o app só abre com sinal.

## Estados de um registro

| Onde está | Texto no item |
| --- | --- |
| No aparelho, esperando envio | "Salvo no aparelho · aguardando envio" |
| No aparelho, enviando | "Enviando fotos 2 de 3…" e depois "Concluindo…" |
| No aparelho, com falha definitiva | "Não foi possível enviar: <mensagem>", com os botões "Tentar de novo" e "Descartar" |
| No servidor, publicação `pendente` ou `enviando` | "Salvo no servidor · aguardando publicação" |
| No servidor, `publicado` | "Publicado no tópico" |
| No servidor, `incerto` ou `falhou` | "Publicação com problema" |

## A. Armazenamento, fila e cache (`app/src/offline/`)

### Dependências

- `idb`, em dependências.
- `fake-indexeddb`, em devDependencies.
- Versões exatas, publicadas há pelo menos duas semanas.
- `src/test/setup.ts` importa `fake-indexeddb/auto` e recria o `indexedDB` (`new IDBFactory()`) antes de cada teste. Também limpa o `localStorage`.

### `armazenamento.ts`

O banco IndexedDB `diario-obra` (versão 1) tem três stores:
- `registros`: chave `id`, índice `usuarioId`;
- `fotos`: chave `[registroId, fotoId]`, índice `registroId`;
- `cache`: chave `usuarioId`.

As fotos são gravadas como `ArrayBuffer`, e não como `Blob`, porque o WebKit tem bugs antigos com blobs no IndexedDB. A listagem não lê as fotos.

```ts
export interface RegistroLocal {
  id: string // = Rascunho.id
  usuarioId: string
  obra: { id: string; slug: string; nome: string }
  ambiente: { id: string; codigo: string; nome: string }
  tipo: TipoRegistro
  legenda: string
  capturadoEm: string // ISO
  criadoEm: string // ISO; ordem da fila
  fotos: { id: string; largura: number; altura: number; bytes: number }[] // na ordem escolhida
  /** Falha definitiva; enquanto não for nula, a fila não tenta sozinha. */
  erro: { tipo: TipoErroEnvio; mensagem: string } | null
}

export class ErroArmazenamento extends Error {
  readonly tipo: 'cota' | 'indisponivel'
}
export const MENSAGEM_COTA = 'Sem espaço no aparelho para guardar este registro. Libere espaço e tente de novo.'

export interface Armazenamento {
  /** false quando o IndexedDB não está disponível e os dados ficam só na memória. */
  readonly persistente: boolean
  /** Grava o registro e as fotos numa transação só. Lança ErroArmazenamento. */
  salvar(r: RegistroLocal, fotos: { id: string; dados: ArrayBuffer }[]): Promise<void>
  /** Atualiza só os metadados (por exemplo, `erro`). */
  atualizar(r: RegistroLocal): Promise<void>
  listar(usuarioId: string): Promise<RegistroLocal[]> // por criadoEm crescente
  lerFoto(registroId: string, fotoId: string): Promise<ArrayBuffer | undefined>
  remover(id: string): Promise<void> // registro e fotos numa transação
  lerCache(usuarioId: string): Promise<CacheSalvo | undefined>
  salvarCache(usuarioId: string, c: CacheSalvo): Promise<void>
  /** Apaga o cache de consultas dos outros usuários; os registros deles ficam. */
  limparCachesExceto(usuarioId: string): Promise<void>
  fechar(): void
}
export interface CacheSalvo { versao: number; salvoEm: number; estado: unknown /* DehydratedState */ }

export async function abrirArmazenamento(): Promise<Armazenamento> // IndexedDB; se falhar, memória
export function criarArmazenamentoMemoria(): Armazenamento
```

- **Espaço:**
  - antes de `salvar`, se `navigator.storage?.estimate` existir e `quota - usage` for menor que o tamanho das fotos mais 1 MB, lança `ErroArmazenamento('cota', MENSAGEM_COTA)`;
  - `QuotaExceededError`, inclusive no `abort` da transação, também vira `cota`;
  - na primeira gravação, chama `navigator.storage?.persist?.()` sem esperar e sem tratar o resultado.
- **Sem cache de conexão:** `abrirArmazenamento` abre uma conexão nova a cada chamada, sem guardá-la em variável de módulo, para que os testes recriem o banco.

### `fila.ts`

```ts
export type EstadoItem = 'aguardando' | 'enviando' | 'erro'
export interface ItemFila { registro: RegistroLocal; estado: EstadoItem; progresso: Progresso | null }
export interface EstadoFila {
  carregada: boolean
  itens: ItemFila[] // do usuário atual, por criadoEm decrescente (mais recente primeiro)
  sincronizando: boolean
  /** Última falha transitória (rede ou sessão), para a barra; null depois de um envio bem-sucedido. */
  semConexao: boolean
  persistente: boolean
}
export interface NovoLocal {
  rascunho: Rascunho
  obra: { slug: string; nome: string }
  ambiente: { codigo: string; nome: string }
}
export interface Fila {
  obterEstado(): EstadoFila // referência estável até a próxima mudança (useSyncExternalStore)
  assinar(fn: () => void): () => void
  /** Grava no armazenamento e só então resolve; depois dispara sincronizar() sem esperar. */
  adicionar(n: NovoLocal): Promise<void>
  sincronizar(): Promise<void>
  tentarDeNovo(id: string): Promise<void> // limpa `erro`, grava e sincroniza
  descartar(id: string): Promise<void> // ignorado se o item estiver enviando
  /** Carrega os itens, liga os gatilhos e devolve a função que os desliga. */
  iniciar(): () => void
}
export function criarFila(o: {
  repo: Repositorio
  armazenamento: Armazenamento
  usuarioId: string
  /** Chamado depois de cada envio bem-sucedido, antes de tirar o item da memória (invalida as consultas). */
  aoEnviar?: (r: RegistroLocal) => Promise<void>
}): Fila
```

- **`sincronizar` em voo único:** uma chamada durante outra não inicia um segundo envio; ela marca que é preciso repetir ao terminar.
  - Os itens vão um de cada vez, em ordem de `criadoEm` crescente.
  - Itens com `erro` são pulados.
  - Para cada item, a fila monta o `Rascunho` com `new Blob([dados], { type: 'image/jpeg' })` e chama `enviarRegistro(repo, r, progresso)`, de `dados/envio.ts`.
- **Sucesso:** `armazenamento.remover(id)`, depois `await aoEnviar(r)` e, por fim, o item sai do estado.
- **Falha transitória** (`ErroEnvio` com tipo `rede` ou `sessao`, ou erro que não é `ErroEnvio`):
  - o item volta a `aguardando`, `semConexao` vira `true` e a rodada **para**, sem tentar os próximos;
  - nova tentativa automática em 15 s, 30 s, 60 s, 120 s e depois a cada 300 s;
  - o atraso volta ao início depois de um sucesso ou de um evento `online`.
- **Falha `desconhecido`:** é tratada como transitória, mas a rodada segue para o próximo item.
- **Falha definitiva** (`validacao`, `nao_encontrado`, `conflito`, `permissao`): grava `erro` no armazenamento, o item vira `erro` e a rodada segue. Não há nova tentativa automática.
- **Gatilhos de `iniciar`:**
  - a carga inicial, seguida de `sincronizar`;
  - o evento `online`, que zera o atraso;
  - `visibilitychange` para `visible`;
  - o temporizador de nova tentativa.

  `adicionar` e `tentarDeNovo` também chamam `sincronizar`.
- **Isolamento:** só os itens de `usuarioId` são listados e enviados.

### `cacheConsultas.ts`

Persiste o cache do react-query no armazenamento, por usuário, sem dependência nova. Usa `dehydrate` e `hydrate` de `@tanstack/react-query`.

```ts
export const VERSAO_CACHE = 1
export const IDADE_MAXIMA_MS = 7 * 24 * 60 * 60_000
export async function restaurarCache(qc: QueryClient, a: Armazenamento, usuarioId: string): Promise<void>
export function persistirCache(qc: QueryClient, a: Armazenamento, usuarioId: string): () => void // assina o queryCache, grava com debounce de 1 s; devolve cancelar
```

- Grava só as consultas com `status === 'success'`. As chaves `['sessao']` e `['usuario']` ficam de fora.
- As consultas `['imagens', ...]` entram no cache. A URL assinada antiga continua servindo offline, porque o service worker usa a URL sem `token` como chave. Online, a consulta já vencida é refeita.
- Cache com `versao` diferente ou mais velho que `IDADE_MAXIMA_MS` é descartado.
- `restaurarCache` também chama `limparCachesExceto(usuarioId)`.

### Repositório

- `Repositorio` ganha `idUsuario(): Promise<string | null>`.
  - Supabase: `auth.getSession()` → `session.user.id`. Funciona offline, porque a sessão fica no aparelho.
  - Fixture: `'usuario-teste'`.
- **Sem sinal:** na fixture, `enviarFoto` e `concluirRegistro` lançam `ErroEnvio('rede', MENSAGEM_REDE)` quando `navigator.onLine === false`. As leituras continuam funcionando.
- **Estado do servidor na fixture:**
  - `criarRepositorioFixture(opcoes?: { persistencia?: Storage | null })` (padrão `null`) guarda os registros novos e as fotos, como data URL, na chave `fixture-servidor`, e recarrega de lá ao ser criada;
  - `criarRepositorio()` passa `localStorage`.

  Assim, recarregar a página no e2e mantém o "servidor" e dá para conferir que nada se duplicou.

## B. Telas

- **`offline/contexto.tsx`:**
  - `OfflineProvider` fica dentro de `GuardaSessao` e envolve as rotas em `App.tsx`. Na montagem, ele:
    - obtém o `idUsuario` (consulta `['usuario']`, `networkMode: 'always'`);
    - abre o armazenamento;
    - roda `restaurarCache`, `persistirCache`, `criarFila` e `iniciar`.
  - Enquanto prepara, mostra `EstadoCarregando`; ao desmontar, desliga tudo e chama `fechar()`.
  - `aoEnviar` invalida `['registros']`, `['obras']`, `['obra', slug]` e `['ambiente', slug, codigo]`.
  - Exporta os hooks:
    - `useFila()`, com o estado (`useSyncExternalStore`) e as ações;
    - `useRegistrosLocais(filtro: { obraId?; ambienteId?; tipo? })`;
    - `useFotoLocal(registroId, fotoId)`, que devolve uma URL de objeto e a revoga ao desmontar.
- **`main.tsx`:** `networkMode: 'offlineFirst'` nas consultas. `useSessao` usa `networkMode: 'always'`.
- **Novo registro:**
  - "Salvar registro" vira "Guardando…" enquanto chama `fila.adicionar`.
  - **Sucesso:** volta ao Ambiente na aba Histórico, com `replace`, e mostra o aviso "Registro salvo no aparelho".
  - **`ErroArmazenamento`:** a mensagem aparece em `role="alert"` e o formulário continua preenchido.
  - Sai a lógica de envio da fase 4 (progresso, "Tentar de novo" e `travado`), que agora está nos itens da fila. `useNovoRegistro` é removido.
  - Com `persistente === false`, o formulário mostra o aviso "Este aparelho não permite guardar registros. Não feche o app até o envio terminar."
- **Listas** (Histórico e Pendências do ambiente, Últimos registros, Registros, Pendências):
  - os itens locais do filtro aparecem **antes** dos do servidor;
  - itens com o mesmo `id` dos do servidor ficam de fora;
  - cada item local mostra a miniatura pela foto local, o selo do tipo, o horário, a legenda e "Você" (ou "obra · ambiente · Você" fora do ambiente), além do texto de estado da tabela acima;
  - "Descartar" pede confirmação: "Descartar este registro? Ele ainda não foi enviado."
  - Nos Últimos registros da tela Obras, o limite de 5 vale para a soma.
- **Barra de sincronização** (no `Layout`, acima do conteúdo):
  - com itens aguardando, "1 registro aguardando envio" ou "N registros aguardando envio", e o botão "Tentar agora", que vira "Enviando…" e fica desabilitado durante a sincronização;
  - com itens em erro, "N registro(s) com erro no envio", com o link "Ver" para `/registros`;
  - sem itens e com `navigator.onLine === false`, "Sem conexão · mostrando dados salvos no aparelho";
  - nos outros casos, a barra não aparece.
- **`EstadoConsulta`:**
  - com dados, mostra os dados mesmo que a consulta tenha erro;
  - sem dados e com `fetchStatus === 'paused'`, mostra "Sem conexão. Esta tela aparece quando o sinal voltar." com "Tentar de novo".
- **Textos do servidor:** "Aguardando publicação" passa a ser "Salvo no servidor · aguardando publicação".

## C. Service worker (app no aparelho)

- **Manifesto de precache:** um plugin no `vite.config.ts`, só no build, emite `precache-manifest.json` com:
  - `versao`, um hash curto dos nomes dos arquivos do bundle;
  - `arquivos`: `"/index.html"` e todos os `js`, `css` e assets do bundle, com caminho absoluto.
- **`public/sw.js`:**
  - **install:** busca o manifesto com `cache: 'no-store'`, faz `addAll` em `app-<versao>` e chama `skipWaiting`;
  - **activate:** apaga os outros `app-*` e chama `clients.claim`;
  - **mensagem `'verificar-atualizacao'`:** busca o manifesto e, se a `versao` mudou, faz o precache da nova e apaga a antiga;
  - **navegação** (`request.mode === 'navigate'`): rede primeiro, com limite de 4 s, e depois o `/index.html` do cache atual, ignorando a query string;
  - **`/assets/*`:** cache primeiro, em todos os caches `app-*`, e depois a rede;
  - **imagens:**
    - as plantas continuam como estão (`plantas-v1`);
    - as fotos assinadas (`/storage/v1/object/sign/fotos/`) seguem a mesma regra, em `fotos-v1`, com chave sem `token` e no máximo 300 entradas (as mais antigas saem);
  - **o que nunca passa pelo cache:** POST, Storage `upload`, `/rest/`, `/auth/` e `/functions/`.
- **`registrarSw.ts`:**
  - continua registrando só em produção, o que inclui o `build:fixture`;
  - depois do registro, envia `'verificar-atualizacao'` ao service worker ativo quando a página carrega e a cada `visibilitychange` para `visible`.

## D. Verificação

- **Vitest:**
  - **armazenamento:**
    - grava e lista por usuário;
    - as fotos ficam separadas e `remover` apaga as duas partes;
    - cota pelo `estimate` e por `QuotaExceededError`;
    - `limparCachesExceto` preserva os registros;
    - na memória, `persistente` vale `false`;
  - **fila** (temporizadores falsos, repositório falso idempotente):
    - grava antes de resolver;
    - sucesso remove e chama `aoEnviar`;
    - rede para a rodada e agenda o backoff, e `online` dispara na hora;
    - falha definitiva grava `erro`, segue para o próximo e só volta com `tentarDeNovo`;
    - voo único;
    - isolamento por usuário;
    - uma fila nova sobre o mesmo armazenamento retoma sem duplicar;
    - perda da resposta da RPC não duplica;
    - `descartar`;
  - **cache:** restaura por usuário, descarta o vencido e a versão diferente, e exclui `sessao` e `usuario`;
  - **fixture:** sem sinal, lança `rede`; a persistência do "servidor" sobrevive a uma recriação;
  - **telas:**
    - salvar volta ao Histórico com o item local e o aviso;
    - com envio bem-sucedido, o item passa a "Salvo no servidor · aguardando publicação";
    - com falha de rede, o item fica "Salvo no aparelho · aguardando envio", a barra mostra "Tentar agora" e, depois de voltar o sinal, envia;
    - com falha definitiva, aparecem "Tentar de novo" e "Descartar";
    - a cota mostra o alerta e mantém o formulário;
    - o `EstadoConsulta` pausado mostra "Sem conexão".
- **Playwright** (`e2e/offline.spec.ts`, fixture com o service worker ativo):
  1. Abrir o Apto. 101, esperar `navigator.serviceWorker.ready` e o precache, e então ficar offline (`context.setOffline(true)`).
  2. Novo registro com a foto de teste, Pendência e legenda, depois Salvar. O Histórico mostra "Salvo no aparelho · aguardando envio" e a barra "1 registro aguardando envio".
  3. Recarregar a página offline: o app abre pelo service worker e o item continua lá.
  4. Voltar online: o item vira "Salvo no servidor · aguardando publicação" e a barra some.
  5. Recarregar: a legenda aparece **uma** vez.
  6. **Cota:** com `navigator.storage.estimate` simulado com pouco espaço (`addInitScript`), salvar mostra o alerta de espaço e mantém o formulário.
- O build de produção continua sem a fixture. O `precache-manifest.json` não lista o chunk da fixture no build normal.
