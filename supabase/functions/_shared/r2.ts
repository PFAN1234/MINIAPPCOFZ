// Cliente do Cloudflare R2 (API compatível com S3), só com `fetch` e `aws4fetch`.
// Sem API exclusiva do Deno: o arquivo é copiado sem mudança para os servidores Node (Vercel).
// Chave do objeto: `<pasta>/<caminho>`. Contrato: docs/contrato-r2.md.
import { AwsClient } from "npm:aws4fetch@1.0.20";

export const PASTAS = [
  "fotos",
  "plantas",
  "originais",
  "modelos",
  "boletins",
  "relatorios",
  "organizacao",
  "documentos",
  "issues",
] as const;
export type Pasta = typeof PASTAS[number];

/** Máximo de chaves por chamada de DeleteObjects. */
export const LOTE_APAGAR = 1000;

export interface ConfigR2 {
  contaId: string;
  chaveId: string;
  segredo: string;
  bucket: string;
}

export interface CabecalhoObjeto {
  tamanho: number;
  tipo: string;
}

export interface PaginaListagem {
  objetos: { chave: string; tamanho: number }[];
  /** Token para a próxima página; ausente na última. */
  proxima?: string;
}

export interface ClienteR2 {
  urlAssinada(
    metodo: "GET" | "PUT",
    chave: string,
    segundos: number,
    cabecalhos?: Record<string, string>,
  ): Promise<string>;
  cabecalho(chave: string): Promise<CabecalhoObjeto | null>;
  baixar(chave: string): Promise<Uint8Array>;
  gravar(chave: string, bytes: Uint8Array, tipo: string): Promise<void>;
  apagar(chaves: string[]): Promise<void>;
  listar(prefixo: string, continuacao?: string): Promise<PaginaListagem>;
}

/** Lê a configuração das variáveis de ambiente (passadas por quem chama). Lança se faltar. */
export function configDoAmbiente(
  env: (nome: string) => string | undefined,
): ConfigR2 {
  const ler = (n: string) => {
    const v = env(n);
    if (!v) throw new Error(`variável ${n} ausente`);
    return v;
  };
  return {
    contaId: ler("R2_ACCOUNT_ID"),
    chaveId: ler("R2_ACCESS_KEY_ID"),
    segredo: ler("R2_SECRET_ACCESS_KEY"),
    bucket: ler("R2_BUCKET"),
  };
}

/** Monta `<pasta>/<caminho>`. Lança se a pasta não existir ou o caminho for inseguro. */
export function chaveObjeto(pasta: string, caminho: string): string {
  if (!(PASTAS as readonly string[]).includes(pasta)) {
    throw new Error("pasta inválida");
  }
  if (
    caminho === "" || caminho.startsWith("/") || caminho.includes("..")
  ) {
    throw new Error("caminho inválido");
  }
  return `${pasta}/${caminho}`;
}

function codificarSegmento(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function codificarChave(chave: string): string {
  return chave.split("/").map(codificarSegmento).join("/");
}

function desescaparXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function escaparXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function criarR2(
  config: ConfigR2,
  buscar: typeof fetch = (...a) => fetch(...a),
): ClienteR2 {
  const aws = new AwsClient({
    accessKeyId: config.chaveId,
    secretAccessKey: config.segredo,
    service: "s3",
    region: "auto",
  });
  const base =
    `https://${config.contaId}.r2.cloudflarestorage.com/${config.bucket}`;
  const urlDe = (chave: string) => `${base}/${codificarChave(chave)}`;

  async function enviar(url: string, init: RequestInit): Promise<Response> {
    const assinado = await aws.sign(url, init);
    return await buscar(assinado);
  }

  return {
    async urlAssinada(metodo, chave, segundos, cabecalhos = {}) {
      const url = new URL(urlDe(chave));
      url.searchParams.set("X-Amz-Expires", String(segundos));
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(cabecalhos)) {
        headers[k.toLowerCase()] = v;
      }
      const assinado = await aws.sign(url.toString(), {
        method: metodo,
        headers,
        aws: { signQuery: true, allHeaders: metodo === "PUT" },
      });
      return assinado.url;
    },

    async cabecalho(chave) {
      const r = await enviar(urlDe(chave), { method: "HEAD" });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`R2 HEAD ${r.status}`);
      const tamanho = Number(r.headers.get("content-length"));
      if (!Number.isFinite(tamanho)) throw new Error("R2 HEAD sem tamanho");
      return { tamanho, tipo: r.headers.get("content-type") ?? "" };
    },

    async baixar(chave) {
      const r = await enviar(urlDe(chave), { method: "GET" });
      if (!r.ok) {
        await r.body?.cancel();
        throw new Error(`R2 GET ${r.status}`);
      }
      return new Uint8Array(await r.arrayBuffer());
    },

    async gravar(chave, bytes, tipo) {
      const r = await enviar(urlDe(chave), {
        method: "PUT",
        headers: { "content-type": tipo },
        body: bytes as unknown as BodyInit,
      });
      await r.body?.cancel();
      if (!r.ok) throw new Error(`R2 PUT ${r.status}`);
    },

    async apagar(chaves) {
      for (let i = 0; i < chaves.length; i += LOTE_APAGAR) {
        const lote = chaves.slice(i, i + LOTE_APAGAR);
        const objetos = lote
          .map((c) => `<Object><Key>${escaparXml(c)}</Key></Object>`)
          .join("");
        const corpo =
          `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${objetos}</Delete>`;
        const r = await enviar(`${base}?delete`, {
          method: "POST",
          headers: { "content-type": "application/xml" },
          body: corpo,
        });
        const texto = await r.text();
        if (!r.ok) throw new Error(`R2 DELETE ${r.status}`);
        // Com Quiet só voltam os erros; chave inexistente (NoSuchKey) não conta.
        const erros = [...texto.matchAll(/<Error>([\s\S]*?)<\/Error>/g)]
          .map((m) => /<Code>([^<]*)<\/Code>/.exec(m[1])?.[1] ?? "?")
          .filter((c) => c !== "NoSuchKey");
        if (erros.length > 0) {
          throw new Error(`R2 DELETE falhou em ${erros.length} chave(s)`);
        }
      }
    },

    async listar(prefixo, continuacao) {
      const url = new URL(base);
      url.searchParams.set("list-type", "2");
      if (prefixo !== "") url.searchParams.set("prefix", prefixo);
      if (continuacao) url.searchParams.set("continuation-token", continuacao);
      const r = await enviar(url.toString(), { method: "GET" });
      const texto = await r.text();
      if (!r.ok) throw new Error(`R2 LIST ${r.status}`);
      const objetos = [...texto.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)]
        .map((m) => ({
          chave: desescaparXml(/<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1] ?? ""),
          tamanho: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0),
        }))
        .filter((o) => o.chave !== "");
      const truncado = /<IsTruncated>true<\/IsTruncated>/.test(texto);
      const proxima = truncado
        ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(
          texto,
        )?.[1]
        : undefined;
      return {
        objetos,
        ...(proxima ? { proxima: desescaparXml(proxima) } : {}),
      };
    },
  };
}
