// Lógica da Edge Function assinar-envio-plantas: devolve URLs assinadas de envio
// (uso único, válidas por 2 h) para arquivos do bucket `plantas`. Permite publicar
// as imagens das plantas sem que a chave secreta saia do Supabase.

const CAMINHO = /^[0-9a-f-]{36}(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+\.webp$/;
const MAXIMO = 200;

export interface ClienteStorage {
  storage: {
    from(bucket: string): {
      createSignedUploadUrl(
        caminho: string,
        opcoes?: { upsert: boolean },
      ): PromiseLike<
        {
          data: { signedUrl: string } | null;
          error: { message: string } | null;
        }
      >;
    };
  };
}

/** Só a conferência do cabeçalho `x-segredo-interno`. */
export interface ConferirSegredo {
  conferirInterno(req: Request): Promise<boolean>;
}

export interface Deps {
  admin: ClienteStorage;
  segredos: ConferirSegredo;
}

function json(corpo: unknown, status: number) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function criarHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return json({ erro: "Método não permitido" }, 405);
    }
    if (!(await deps.segredos.conferirInterno(req))) {
      return json({ erro: "Não autorizado" }, 401);
    }
    let caminhos: unknown;
    try {
      caminhos = (await req.json())?.caminhos;
    } catch {
      return json({ erro: "Corpo inválido" }, 400);
    }
    if (
      !Array.isArray(caminhos) || caminhos.length === 0 ||
      caminhos.length > MAXIMO ||
      !caminhos.every((c) => typeof c === "string" && CAMINHO.test(c))
    ) {
      return json({ erro: "Lista de caminhos inválida" }, 400);
    }
    const urls: Record<string, string> = {};
    for (const caminho of caminhos as string[]) {
      const { data, error } = await deps.admin.storage.from("plantas")
        .createSignedUploadUrl(caminho, { upsert: true });
      if (error || !data) {
        return json({ erro: `Falha ao assinar ${caminho}` }, 500);
      }
      urls[caminho] = data.signedUrl;
    }
    return json({ urls }, 200);
  };
}
