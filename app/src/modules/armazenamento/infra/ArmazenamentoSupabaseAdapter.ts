import type { SupabaseClient } from '@supabase/supabase-js'
import type { Armazenamento } from '@modules/armazenamento/application/ports/Armazenamento.port.ts'
import { ErroEnvio, MENSAGEM_REDE, type TipoErroEnvio } from '../../../dados/erros.ts'

const LOTE_LEITURA = 200
const MARGEM_CACHE_MS = 5 * 60_000
const TIMEOUT_PUT_MS = 60_000
const PASTA_PERSISTENTE = 'organizacao'
const PREFIXO_LOCAL = 'armazenamento:url:'

export interface OpcoesArmazenamento {
  fetch?: typeof fetch
  agora?: () => number
  timeoutPutMs?: number
  /** Para o cache persistente do logo; `null` desliga. Padrão: `localStorage`. */
  armazenamentoLocal?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
}

interface EntradaCache {
  url: string
  expiraEm: number
}

const TIPO_POR_CODIGO: Record<string, TipoErroEnvio> = {
  sem_sessao: 'sessao',
  sem_permissao: 'permissao',
  caminho_invalido: 'validacao',
  entrada_invalida: 'validacao',
  fora_do_limite: 'validacao',
  nao_encontrado: 'nao_encontrado',
  divergente: 'conflito',
  em_exclusao: 'conflito',
}

const MENSAGENS: Record<string, string> = {
  sem_sessao: 'Sua sessão expirou. Abra o app novamente pelo Telegram.',
  sem_permissao: 'Sem permissão para enviar esta foto.',
  nao_encontrado: 'Arquivo não encontrado.',
}

function erroRede(causa: unknown): ErroEnvio {
  return new ErroEnvio('rede', MENSAGEM_REDE, { cause: causa })
}

function erroDeCodigo(codigo: string, causa?: unknown): ErroEnvio {
  const tipo = TIPO_POR_CODIGO[codigo] ?? 'desconhecido'
  return new ErroEnvio(tipo, MENSAGENS[codigo] ?? 'Não foi possível processar o arquivo.', {
    cause: causa,
  })
}

/** Converte o erro de `functions.invoke` (HTTP, rede ou relay) em `ErroEnvio`. */
async function erroDaFunction(e: unknown): Promise<ErroEnvio> {
  if (e instanceof ErroEnvio) return e
  const bruto = (typeof e === 'object' && e !== null ? e : {}) as {
    name?: unknown
    context?: unknown
  }
  if (e instanceof TypeError || bruto.name === 'FunctionsFetchError') return erroRede(e)
  if (bruto.name === 'FunctionsHttpError' && bruto.context instanceof Response) {
    let codigo = ''
    try {
      const corpo = (await bruto.context.clone().json()) as { erro?: unknown }
      if (typeof corpo.erro === 'string') codigo = corpo.erro
    } catch {
      // corpo ilegível: cai no status
    }
    if (codigo) return erroDeCodigo(codigo, e)
    const status = bruto.context.status
    if (status === 401) return erroDeCodigo('sem_sessao', e)
    if (status === 403) return erroDeCodigo('sem_permissao', e)
    if (status >= 500) return erroRede(e)
  }
  return new ErroEnvio('desconhecido', 'Não foi possível processar o arquivo.', { cause: e })
}

function localStorageSeguro(): OpcoesArmazenamento['armazenamentoLocal'] {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

interface RespostaEnviar {
  situacao: 'enviar' | 'ja_confirmado'
  url?: string
  cabecalhos?: Record<string, string>
}

/** Armazenamento real: function `armazenamento` (URLs assinadas) e `fetch` para PUT e GET. */
export function criarArmazenamentoSupabase(
  cliente: Pick<SupabaseClient, 'functions'>,
  opcoes: OpcoesArmazenamento = {},
): Armazenamento {
  const http = opcoes.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const agora = opcoes.agora ?? (() => Date.now())
  const timeoutPut = opcoes.timeoutPutMs ?? TIMEOUT_PUT_MS
  const local =
    opcoes.armazenamentoLocal === undefined ? localStorageSeguro() : opcoes.armazenamentoLocal
  const cache = new Map<string, EntradaCache>()
  const chave = (pasta: string, caminho: string) => `${pasta}/${caminho}`

  async function invocar<T>(corpo: Record<string, unknown>): Promise<T> {
    try {
      const { data, error } = await cliente.functions.invoke('armazenamento', {
        body: corpo,
      })
      if (error) throw error
      return data as T
    } catch (e) {
      throw await erroDaFunction(e)
    }
  }

  function valida(e: EntradaCache | undefined): e is EntradaCache {
    return !!e && e.expiraEm - agora() > MARGEM_CACHE_MS
  }

  function lerLocal(pasta: string, caminho: string): EntradaCache | undefined {
    if (pasta !== PASTA_PERSISTENTE || !local) return undefined
    try {
      const bruto = local.getItem(PREFIXO_LOCAL + chave(pasta, caminho))
      if (!bruto) return undefined
      const e = JSON.parse(bruto) as Partial<EntradaCache>
      if (typeof e.url === 'string' && typeof e.expiraEm === 'number') {
        return { url: e.url, expiraEm: e.expiraEm }
      }
    } catch {
      // armazenamento local indisponível ou corrompido: ignora
    }
    return undefined
  }

  function guardar(pasta: string, caminho: string, e: EntradaCache) {
    cache.set(chave(pasta, caminho), e)
    if (pasta !== PASTA_PERSISTENTE || !local) return
    try {
      local.setItem(PREFIXO_LOCAL + chave(pasta, caminho), JSON.stringify(e))
    } catch {
      // cota cheia ou modo privado: só o cache em memória vale
    }
  }

  function esquecer(pasta: string, caminho: string) {
    cache.delete(chave(pasta, caminho))
    if (pasta !== PASTA_PERSISTENTE || !local) return
    try {
      local.removeItem(PREFIXO_LOCAL + chave(pasta, caminho))
    } catch {
      // ignora
    }
  }

  async function put(
    url: string,
    cabecalhos: Record<string, string>,
    dados: Blob,
  ): Promise<number> {
    const controle = new AbortController()
    const timer = setTimeout(() => controle.abort(), timeoutPut)
    try {
      const r = await http(url, {
        method: 'PUT',
        headers: cabecalhos,
        body: dados,
        signal: controle.signal,
      })
      return r.status
    } catch (e) {
      throw erroRede(e)
    } finally {
      clearTimeout(timer)
    }
  }

  const adaptador: Armazenamento = {
    async enviar(pasta, caminho, dados, tipo) {
      const pedir = () =>
        invocar<RespostaEnviar>({
          acao: 'enviar',
          pasta,
          caminho,
          tamanho: dados.size,
          tipo,
        })
      let r = await pedir()
      if (r.situacao === 'ja_confirmado') return 'ja_confirmado'
      let status = await put(r.url ?? '', r.cabecalhos ?? { 'content-type': tipo }, dados)
      if (status === 403) {
        // URL vencida: uma nova tentativa, com URL nova.
        r = await pedir()
        if (r.situacao === 'ja_confirmado') return 'ja_confirmado'
        status = await put(r.url ?? '', r.cabecalhos ?? { 'content-type': tipo }, dados)
      }
      if (status === 403) throw erroDeCodigo('sem_permissao')
      if (status >= 500) throw erroRede(new Error(`PUT ${status}`))
      if (status < 200 || status >= 300) {
        throw new ErroEnvio('desconhecido', 'Não foi possível enviar o arquivo.')
      }
      await invocar({ acao: 'confirmar', pasta, caminho })
      esquecer(pasta, caminho)
      return 'enviado'
    },

    async urls(pasta, caminhos) {
      const saida = new Map<string, string>()
      const faltam: string[] = []
      for (const c of new Set(caminhos)) {
        let e = cache.get(chave(pasta, c))
        if (!valida(e)) {
          e = lerLocal(pasta, c)
          if (valida(e)) cache.set(chave(pasta, c), e)
        }
        if (valida(e)) saida.set(c, e.url)
        else faltam.push(c)
      }
      for (let i = 0; i < faltam.length; i += LOTE_LEITURA) {
        const lote = faltam.slice(i, i + LOTE_LEITURA)
        const r = await invocar<{
          urls?: Record<string, string>
          expira_em?: string
        }>({
          acao: 'ler',
          itens: lote.map((caminho) => ({ pasta, caminho })),
        })
        const expiraEm = Date.parse(r.expira_em ?? '')
        for (const c of lote) {
          const url = r.urls?.[chave(pasta, c)]
          if (!url) continue
          saida.set(c, url)
          if (Number.isFinite(expiraEm)) guardar(pasta, c, { url, expiraEm })
        }
      }
      return saida
    },

    async baixar(pasta, caminho) {
      const url = (await adaptador.urls(pasta, [caminho])).get(caminho)
      if (!url) throw erroDeCodigo('nao_encontrado')
      let r: Response
      try {
        r = await http(url)
      } catch (e) {
        throw erroRede(e)
      }
      if (!r.ok) {
        esquecer(pasta, caminho)
        if (r.status >= 500) throw erroRede(new Error(`GET ${r.status}`))
        throw erroDeCodigo(
          r.status === 404 ? 'nao_encontrado' : r.status === 403 ? 'sem_permissao' : '',
        )
      }
      return r.blob()
    },

    async excluir(pasta, caminho) {
      await invocar({ acao: 'excluir', pasta, caminho })
      esquecer(pasta, caminho)
    },
  }
  return adaptador
}
