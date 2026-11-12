// Lógica da Edge Function publish-outbox, com dependências injetadas (testável sem rede).
import type { ClienteRpc, Segredos } from "../_shared/segredo.ts";
import {
  type ClienteTelegram,
  escaparHtml,
  linkApp,
  type ResultadoTelegram,
} from "../_shared/telegram.ts";

// deno-lint-ignore no-explicit-any
type Linhas = PromiseLike<{ data: any; error: { message: string } | null }>;

export interface ClienteAdmin extends ClienteRpc {
  // deno-lint-ignore no-explicit-any
  from(tabela: string): any;
  storage: {
    from(bucket: string): {
      download(
        caminho: string,
      ): PromiseLike<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
}

export interface Deps {
  telegram: ClienteTelegram;
  admin: ClienteAdmin;
  segredos: Segredos;
  botUsername: string;
  appName: string;
  agora?: () => Date;
}

export const LIMITE_LEGENDA = 1024;
export const LOTE_PUBLICACOES = 10;
export const LOTE_AVISOS = 5;
export const MAX_TENTATIVAS = 8;
export const ESPERA_SEM_TOPICO_MIN = 15;
export const ESPERA_429_PADRAO_S = 30;

export type Estado = "publicado" | "pendente" | "incerto" | "falhou";

interface Publicacao {
  id: number;
  obra_id: string;
  registro_id: string | null;
  encerramento_id: string | null;
  tentativas: number;
}

interface Destino {
  chatId: number;
  threadId: number;
}

interface Montagem {
  legenda: string;
  fotos: string[];
  replyTo?: number;
}

interface Resultado {
  estado: Estado;
  messageIds?: number[];
  erro?: string;
  proxima?: Date;
}

/** Minutos de espera antes da próxima tentativa: min(2^(tentativas-1), 60). */
export function backoffMinutos(tentativas: number): number {
  return Math.min(2 ** Math.max(tentativas - 1, 0), 60);
}

/** `dd/MM HH:mm` em America/Sao_Paulo. */
export function formatarData(iso: string | Date): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return `${p("day")}/${p("month")} ${p("hour")}:${p("minute")}`;
}

/** Corta o texto (sem HTML) em `max` unidades UTF-16, terminando em "…" se foi cortado. */
export function cortarTexto(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  if (max <= 0) return "";
  let saida = "";
  for (const c of texto) {
    if (saida.length + c.length > max - 1) break;
    saida += c;
  }
  return `${saida}…`;
}

interface PartesLegenda {
  /** Linhas fixas antes do texto livre, já em HTML, com o texto visível. */
  antes: { html: string; texto: string }[];
  /** Texto livre do usuário (legenda ou observação), vazio se não houver. */
  livre: string;
  /** Linhas fixas depois do texto livre. */
  depois: { html: string; texto: string }[];
}

/** Monta a legenda em HTML com no máximo 1024 caracteres visíveis; só o texto livre é cortado. */
export function montarLegenda(p: PartesLegenda): string {
  const fixas = [...p.antes, ...p.depois];
  const visivelFixo = fixas.reduce((n, l) => n + l.texto.length, 0);
  // Uma quebra de linha entre cada linha; o texto livre conta como mais uma linha.
  const linhas = fixas.length + (p.livre === "" ? 0 : 1);
  const disponivel = LIMITE_LEGENDA - visivelFixo - Math.max(linhas - 1, 0);
  const livre = p.livre === ""
    ? ""
    : escaparHtml(cortarTexto(p.livre, disponivel));
  return [
    ...p.antes.map((l) => l.html),
    ...(livre === "" ? [] : [livre]),
    ...p.depois.map((l) => l.html),
  ].join("\n");
}

function linha(texto: string, html?: string) {
  return { texto, html: html ?? escaparHtml(texto) };
}

export function criarHandler(deps: Deps) {
  const { admin, telegram } = deps;
  const agora = deps.agora ?? (() => new Date());
  const link = (param?: string) =>
    linkApp(deps.botUsername, deps.appName, param);

  async function ler(consulta: Linhas, o: string) {
    const { data, error } = await consulta;
    if (error) throw new Error(`consulta ${o}: ${error.message}`);
    return data;
  }

  const um = (tabela: string, colunas: string, coluna: string, valor: string) =>
    ler(
      admin.from(tabela).select(colunas).eq(coluna, valor).maybeSingle(),
      tabela,
    );

  async function destinoDaObra(
    obraId: string,
  ): Promise<
    { obra: { nome: string; slug: string }; destino: Destino | null }
  > {
    const obra = await um(
      "obra",
      "nome, slug, telegram_chat_id, telegram_thread_id",
      "id",
      obraId,
    );
    if (!obra) throw new Error("obra não encontrada");
    const destino = obra.telegram_chat_id != null &&
        obra.telegram_thread_id != null
      ? { chatId: obra.telegram_chat_id, threadId: obra.telegram_thread_id }
      : null;
    return { obra, destino };
  }

  async function baixarFotos(
    caminhos: string[],
  ): Promise<Blob[] | null> {
    const blobs: Blob[] = [];
    for (const c of caminhos) {
      const { data, error } = await admin.storage.from("fotos").download(c);
      if (error || !data) {
        console.warn("publish-outbox: falha ao baixar foto do Storage");
        return null;
      }
      blobs.push(data);
    }
    return blobs;
  }

  /** Lê o que é preciso e monta a legenda da publicação (registro ou encerramento). */
  async function montar(
    pub: Publicacao,
    obra: { nome: string },
  ): Promise<Montagem | null> {
    const ehEncerramento = pub.encerramento_id != null;
    let registro;
    let encerramento = null;
    if (ehEncerramento) {
      encerramento = await um(
        "encerramento",
        "id, registro_id, gestor_id, observacao, encerrado_em",
        "id",
        pub.encerramento_id!,
      );
      if (!encerramento) return null;
      registro = await um(
        "registro",
        "id, ambiente_id, tipo, legenda, autor_id, capturado_em",
        "id",
        encerramento.registro_id,
      );
    } else {
      registro = await um(
        "registro",
        "id, ambiente_id, tipo, legenda, autor_id, capturado_em",
        "id",
        pub.registro_id!,
      );
    }
    if (!registro) return null;

    const ambiente = await um(
      "ambiente",
      "nome_operacional, pavimento_id",
      "id",
      registro.ambiente_id,
    );
    const pavimento = ambiente
      ? await um("pavimento", "nome", "id", ambiente.pavimento_id)
      : null;
    const autor = await um(
      "usuario",
      "nome",
      "id",
      encerramento ? encerramento.gestor_id : registro.autor_id,
    );
    const nomeAmbiente = ambiente?.nome_operacional ?? "Ambiente";
    const local = [obra.nome, pavimento?.nome].filter(Boolean).join(" · ");
    const quando = formatarData(
      encerramento ? encerramento.encerrado_em : registro.capturado_em,
    );
    const nomeAutor = autor?.nome ?? "Usuário";
    const rodape = linha(`👤 ${nomeAutor} · ${quando}`);

    let fotosLinhas;
    if (encerramento) {
      fotosLinhas = await ler(
        admin.from("foto").select("storage_path, ordem")
          .eq("encerramento_id", encerramento.id).order("ordem"),
        "foto",
      );
    } else {
      fotosLinhas = await ler(
        admin.from("foto").select("storage_path, ordem")
          .eq("registro_id", registro.id).order("ordem"),
        "foto",
      );
    }
    const fotos = (fotosLinhas ?? []).map((f: { storage_path: string }) =>
      f.storage_path
    );

    let legenda: string;
    let replyTo: number | undefined;
    if (encerramento) {
      const rotulo = "✅ Pendência resolvida";
      legenda = montarLegenda({
        antes: [
          linha(
            `${rotulo} · ${nomeAmbiente}`,
            `✅ <b>Pendência resolvida</b> · ${escaparHtml(nomeAmbiente)}`,
          ),
          linha(local),
        ],
        livre: (encerramento.observacao ?? "").trim(),
        depois: [rodape, abrirNoApp(link(`registro_${registro.id}`))],
      });
      const anteriores = await ler(
        admin.from("publicacao_telegram").select("message_ids")
          .eq("registro_id", registro.id).eq("estado", "publicado").limit(1),
        "publicacao_telegram",
      );
      const primeiro = anteriores?.[0]?.message_ids?.[0];
      if (typeof primeiro === "number") replyTo = primeiro;
    } else {
      const pendencia = registro.tipo === "pendencia";
      const rotulo = pendencia ? "⚠️ Pendência" : "🔧 Serviço";
      legenda = montarLegenda({
        antes: [
          linha(
            `${rotulo} · ${nomeAmbiente}`,
            `${pendencia ? "⚠️" : "🔧"} <b>${
              pendencia ? "Pendência" : "Serviço"
            }</b> · ${escaparHtml(nomeAmbiente)}`,
          ),
          linha(local),
        ],
        livre: registro.legenda ?? "",
        depois: [rodape, abrirNoApp(link(`registro_${registro.id}`))],
      });
    }
    return { legenda, fotos, replyTo };
  }

  function abrirNoApp(url: string) {
    return {
      texto: "Abrir no Diário da obra",
      html: `<a href="${
        escaparHtml(url).replaceAll('"', "&quot;")
      }">Abrir no Diário da obra</a>`,
    };
  }

  async function enviar(
    destino: Destino,
    m: Montagem,
    blobs: Blob[],
  ): Promise<ResultadoTelegram<unknown>> {
    const form = new FormData();
    form.append("chat_id", String(destino.chatId));
    form.append("message_thread_id", String(destino.threadId));
    if (m.replyTo !== undefined) {
      form.append(
        "reply_parameters",
        JSON.stringify({
          message_id: m.replyTo,
          allow_sending_without_reply: true,
        }),
      );
    }
    if (blobs.length === 1) {
      form.append("caption", m.legenda);
      form.append("parse_mode", "HTML");
      form.append("photo", blobs[0], "foto.jpg");
      return await telegram.chamar("sendPhoto", form);
    }
    const media = blobs.map((_, i) => ({
      type: "photo",
      media: `attach://f${i}`,
      ...(i === 0 ? { caption: m.legenda, parse_mode: "HTML" } : {}),
    }));
    form.append("media", JSON.stringify(media));
    blobs.forEach((b, i) => form.append(`f${i}`, b, `f${i}.jpg`));
    return await telegram.chamar("sendMediaGroup", form);
  }

  function classificar(
    r: ResultadoTelegram<unknown>,
    tentativas: number,
  ): Resultado {
    const base = agora().getTime();
    if (r.tipo === "ok") {
      const res = r.resultado;
      const mensagens = Array.isArray(res) ? res : [res];
      const ids = mensagens.map((x) => (x as { message_id: number }).message_id)
        .filter((x) => typeof x === "number");
      return { estado: "publicado", messageIds: ids };
    }
    if (r.tipo === "rede") {
      return {
        estado: "incerto",
        erro: r.motivo === "timeout"
          ? "Tempo esgotado ao enviar; conferir no tópico."
          : "Falha de rede ao enviar; conferir no tópico.",
      };
    }
    const erro = r.description || `Erro ${r.status} do Telegram.`;
    if (r.status >= 500) {
      return { estado: "incerto", erro: `${erro} Conferir no tópico.` };
    }
    if (r.status === 429) {
      const s = r.retryAfter ?? ESPERA_429_PADRAO_S;
      return {
        estado: "pendente",
        erro,
        proxima: new Date(base + s * 1000),
      };
    }
    if (tentativas >= MAX_TENTATIVAS) return { estado: "falhou", erro };
    return {
      estado: "pendente",
      erro,
      proxima: new Date(base + backoffMinutos(tentativas) * 60_000),
    };
  }

  async function processar(pub: Publicacao): Promise<Resultado> {
    const backoff = () =>
      new Date(agora().getTime() + backoffMinutos(pub.tentativas) * 60_000);
    try {
      const { obra, destino } = await destinoDaObra(pub.obra_id);
      if (!destino) {
        return {
          estado: "pendente",
          erro: "Obra sem tópico vinculado.",
          proxima: new Date(agora().getTime() + ESPERA_SEM_TOPICO_MIN * 60_000),
        };
      }
      const m = await montar(pub, obra);
      if (!m) return { estado: "falhou", erro: "Registro não encontrado." };
      if (m.fotos.length === 0) {
        return { estado: "falhou", erro: "Registro sem fotos." };
      }
      const blobs = await baixarFotos(m.fotos);
      if (!blobs) {
        if (pub.tentativas >= MAX_TENTATIVAS) {
          return { estado: "falhou", erro: "Falha ao baixar foto do Storage." };
        }
        return {
          estado: "pendente",
          erro: "Falha ao baixar foto do Storage.",
          proxima: backoff(),
        };
      }
      const r = await enviar(destino, m, blobs);
      if (r.tipo === "http") {
        console.warn(
          `publish-outbox: publicação ${pub.id} recusada pelo Telegram (${r.status}): ${r.description}`,
        );
      } else if (r.tipo === "rede") {
        console.warn(
          `publish-outbox: publicação ${pub.id} sem resposta (${r.motivo})`,
        );
      }
      return classificar(r, pub.tentativas);
    } catch (e) {
      console.error(
        `publish-outbox: erro ao preparar a publicação ${pub.id}:`,
        e instanceof Error ? e.message : "erro desconhecido",
      );
      return {
        estado: "pendente",
        erro: "Erro interno ao preparar a publicação.",
        proxima: backoff(),
      };
    }
  }

  async function finalizar(pub: Publicacao, r: Resultado) {
    const { error } = await admin.rpc("finalizar_publicacao", {
      p_id: pub.id,
      p_estado: r.estado,
      p_message_ids: r.messageIds ?? null,
      p_erro: r.erro ?? null,
      p_proxima: r.proxima ? r.proxima.toISOString() : null,
    });
    if (error) {
      console.error(
        `publish-outbox: falha ao finalizar a publicação ${pub.id}: ${error.message}`,
      );
    }
  }

  async function avisarPedidos(): Promise<
    { enviados: number; falhos: number }
  > {
    const obras = await ler(
      admin.from("obra").select(
        "id, nome, slug, telegram_chat_id, telegram_thread_id",
      )
        .not("telegram_chat_id", "is", null)
        .not("telegram_thread_id", "is", null)
        // Obra arquivada não publica nada no tópico, nem aviso de pedido.
        .is("arquivada_em", null),
      "obra",
    ) as {
      id: string;
      nome: string;
      slug: string;
      telegram_chat_id: number;
      telegram_thread_id: number;
    }[];
    if (!obras || obras.length === 0) return { enviados: 0, falhos: 0 };
    const porId = new Map(obras.map((o) => [o.id, o]));

    const pedidos = await ler(
      admin.from("solicitacao_acesso").select("id, obra_id, usuario_id")
        .eq("estado", "pendente").is("notificada_em", null)
        .in("obra_id", [...porId.keys()]).order("criado_em").limit(LOTE_AVISOS),
      "solicitacao_acesso",
    ) as { id: string; obra_id: string; usuario_id: string }[];

    let enviados = 0;
    let falhos = 0;
    for (const p of pedidos ?? []) {
      const obra = porId.get(p.obra_id);
      if (!obra) continue;
      try {
        const u = await um("usuario", "nome, username", "id", p.usuario_id);
        const quem = `<b>${escaparHtml(u?.nome ?? "Alguém")}</b>${
          u?.username ? ` (@${escaparHtml(u.username)})` : ""
        }`;
        const url = escaparHtml(link(`acessos_${obra.slug}`));
        const r = await telegram.chamar("sendMessage", {
          chat_id: obra.telegram_chat_id,
          message_thread_id: obra.telegram_thread_id,
          text:
            `🔑 ${quem} pediu acesso ao Diário da obra.\nGestores: <a href="${url}">ver pedidos</a>`,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        });
        if (r.tipo !== "ok") {
          falhos++;
          console.warn(
            `publish-outbox: aviso de pedido ${p.id} não enviado (${
              r.tipo === "http" ? r.status : r.motivo
            })`,
          );
          continue;
        }
        const { error } = await admin.from("solicitacao_acesso")
          .update({ notificada_em: agora().toISOString() }).eq("id", p.id);
        if (error) {
          falhos++;
          console.error(
            `publish-outbox: falha ao gravar notificada_em: ${error.message}`,
          );
        } else enviados++;
      } catch (e) {
        falhos++;
        console.error(
          `publish-outbox: erro no aviso do pedido ${p.id}:`,
          e instanceof Error ? e.message : "erro desconhecido",
        );
      }
    }
    return { enviados, falhos };
  }

  function json(corpo: unknown, status = 200) {
    return new Response(JSON.stringify(corpo), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return json({ erro: "Método não permitido" }, 405);
    }
    if (!(await deps.segredos.conferirInterno(req))) {
      return json({ erro: "Não autorizado" }, 401);
    }

    const resumo = {
      reivindicadas: 0,
      publicadas: 0,
      pendentes: 0,
      incertas: 0,
      falhas: 0,
      avisos_enviados: 0,
      avisos_falhos: 0,
    };

    const { data, error } = await admin.rpc("reivindicar_publicacoes", {
      p_limite: LOTE_PUBLICACOES,
    });
    if (error) {
      console.error(
        `publish-outbox: reivindicar_publicacoes: ${error.message}`,
      );
      return json({ erro: "Erro interno" }, 500);
    }
    const lote = (data ?? []) as Publicacao[];
    resumo.reivindicadas = lote.length;
    for (const pub of lote) {
      const r = await processar(pub);
      await finalizar(pub, r);
      if (r.estado === "publicado") resumo.publicadas++;
      else if (r.estado === "pendente") resumo.pendentes++;
      else if (r.estado === "incerto") resumo.incertas++;
      else resumo.falhas++;
    }

    try {
      const a = await avisarPedidos();
      resumo.avisos_enviados = a.enviados;
      resumo.avisos_falhos = a.falhos;
    } catch (e) {
      console.error(
        "publish-outbox: erro nos avisos de pedidos:",
        e instanceof Error ? e.message : "erro desconhecido",
      );
    }
    return json(resumo);
  };
}
