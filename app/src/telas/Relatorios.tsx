import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Abas } from "../components/Abas.tsx";
import { AbasEtapa } from "../components/AbasEtapa.tsx";
import { EstadoConsulta } from "../components/Estado.tsx";
import { PainelRelatorios } from "../components/PainelRelatorios.tsx";
import { TopoTela } from "../components/TopoTela.tsx";
import { useRepositorio } from "../dados/contexto.tsx";
import {
  useEmitirBoletim,
  useExcluirBoletim,
  useExportarPendencias,
  usePainelRelatorios,
  useRelatorios,
} from "../dados/hooks.ts";
import type {
  BoletimRelatorio,
  EtapaRelatorio,
  ResultadoExclusaoBoletim,
} from "../dados/tipos.ts";
import { abrirLink } from "../telegram.ts";
import { FUSO_PADRAO, formatarDia, horaNoFuso } from "../util/fuso.ts";

function mensagemDe(e: unknown, padrao: string): string {
  return e instanceof Error && e.message ? e.message : padrao;
}

/** `AAAA-MM-DD` → `dd/mm`. */
function diaMes(data: string): string {
  return formatarDia(data).slice(0, 5);
}

function textoExclusao(r: ResultadoExclusaoBoletim): string {
  let t = `Boletim ${r.numero} excluído.`;
  if (r.mensagens.falhas > 0) {
    t +=
      " Não foi possível apagar a mensagem no grupo do Telegram (o Telegram só permite apagar até 48 h depois do envio): apague-a lá manualmente.";
  } else if (r.mensagens.apagadas > 0) {
    t += " A mensagem foi apagada do grupo.";
  }
  if (r.arquivos_erro) t += " Os PDFs não foram removidos do armazenamento.";
  return t;
}

/** "Abrir PDF": pega a URL assinada e abre; o erro vira aviso na tela. */
function useAbrirPdf() {
  const repo = useRepositorio();
  const [erro, setErro] = useState<string | null>(null);
  async function abrir(caminho: string) {
    setErro(null);
    try {
      abrirLink(await repo.urlPdfBoletim(caminho));
    } catch (e) {
      setErro(mensagemDe(e, "Não foi possível abrir o PDF. Tente de novo."));
    }
  }
  return { abrir, erro };
}

function CartaoHoje({
  etapa,
  admin,
  pdfPath,
  onAbrirPdf,
}: {
  etapa: EtapaRelatorio;
  admin: boolean;
  pdfPath: string | null;
  onAbrirPdf: (caminho: string) => void;
}) {
  const emitir = useEmitirBoletim();
  const boletim = etapa.boletim_hoje;
  const estado = etapa.pedido_hoje?.estado;
  const emAndamento = estado === "pendente" || estado === "gerando";
  const falhou = estado === "falhou";

  function pedirEmissao() {
    const dia = diaMes(etapa.hoje);
    const texto = boletim
      ? `Emitir agora o boletim de ${dia} da ${etapa.nome}? Será uma nova revisão, publicada no grupo do Telegram.`
      : `Emitir agora o boletim de ${dia} da ${etapa.nome}? Ele será publicado no grupo do Telegram.`;
    if (!window.confirm(texto)) return;
    emitir.mutate({ slug: etapa.slug, data: etapa.hoje });
  }

  let situacao: ReactNode;
  if (emAndamento) situacao = "Gerando o boletim…";
  else if (falhou)
    situacao = etapa.pedido_hoje?.erro
      ? `A emissão falhou: ${etapa.pedido_hoje.erro}`
      : "A emissão falhou";
  else if (boletim)
    situacao = `Boletim ${boletim.numero} emitido às ${horaNoFuso(boletim.emitido_em, FUSO_PADRAO)}`;
  else situacao = `Ainda não emitido · sai automaticamente às ${etapa.horario}`;

  const n = etapa.registros_hoje;
  const registros =
    n === 0
      ? "Nenhum registro hoje"
      : n === 1
        ? "1 registro hoje"
        : `${n} registros hoje`;

  return (
    <article
      className="cartao relatorio-cartao"
      aria-label={`Hoje, ${etapa.nome}`}
    >
      <h3 className="relatorio-titulo">
        {etapa.nome}{" "}
        <span className="relatorio-dica">{diaMes(etapa.hoje)}</span>
      </h3>
      <p>{situacao}</p>
      <p className="relatorio-dica">{registros}</p>
      <div className="relatorio-acoes">
        {boletim && (
          <button
            type="button"
            className="botao botao-secundario"
            disabled={!pdfPath}
            onClick={() => pdfPath && onAbrirPdf(pdfPath)}
          >
            Abrir PDF
          </button>
        )}
        {admin && (
          <button
            type="button"
            className="botao"
            disabled={emAndamento || emitir.isPending}
            onClick={pedirEmissao}
          >
            {boletim ? "Emitir revisão" : "Emitir agora"}
          </button>
        )}
      </div>
      {emitir.isError && (
        <p className="relatorio-erro" role="alert">
          {mensagemDe(
            emitir.error,
            "Não foi possível pedir a emissão. Tente de novo.",
          )}
        </p>
      )}
    </article>
  );
}

function LinhaBoletim({
  b,
  admin,
  onAbrirPdf,
  onExcluido,
}: {
  b: BoletimRelatorio;
  admin: boolean;
  onAbrirPdf: (caminho: string) => void;
  onExcluido: (r: ResultadoExclusaoBoletim) => void;
}) {
  const excluir = useExcluirBoletim();

  function pedirExclusao() {
    const msg = `Excluir o boletim ${b.numero}? Sai o dia ${formatarDia(b.data)} inteiro, com as revisões, os PDFs e a mensagem no grupo do Telegram. Não dá para desfazer.`;
    if (!window.confirm(msg)) return;
    excluir.mutate(b.id, { onSuccess: onExcluido });
  }

  return (
    <li className="cartao relatorio-linha">
      <div className="relatorio-linha-topo">
        <strong>{b.numero}</strong>
        {b.publicado && (
          <span className="selo selo-resolvida">Publicado no grupo</span>
        )}
      </div>
      <p>
        {b.etapa_nome} · {formatarDia(b.data)}
        {b.revisao > 0 ? ` · Revisão ${b.revisao}` : ""}
      </p>
      <div className="relatorio-acoes">
        <button
          type="button"
          className="botao botao-secundario"
          disabled={!b.pdf_path}
          aria-label={`Abrir PDF do boletim ${b.numero}`}
          onClick={() => b.pdf_path && onAbrirPdf(b.pdf_path)}
        >
          Abrir PDF
        </button>
        {admin && b.ultima_revisao && (
          <button
            type="button"
            className="botao botao-perigo"
            disabled={excluir.isPending}
            aria-label={`Excluir o boletim ${b.numero}`}
            onClick={pedirExclusao}
          >
            Excluir
          </button>
        )}
      </div>
      {excluir.isError && (
        <p className="relatorio-erro" role="alert">
          {mensagemDe(
            excluir.error,
            "Não foi possível excluir. Tente de novo.",
          )}
        </p>
      )}
    </li>
  );
}

/** Seção "Painel" e "Exportar" de uma etapa, com o filtro de obra. */
function PainelEtapa({
  etapa,
  obraSlug,
  onObra,
}: {
  etapa: EtapaRelatorio;
  obraSlug: string;
  onObra: (slug: string) => void;
}) {
  const consulta = usePainelRelatorios(etapa.id);
  const exportar = useExportarPendencias();

  return (
    <EstadoConsulta consulta={consulta}>
      {(painel) => {
        const obra = painel.obras.find((o) => o.slug === obraSlug) ?? null;
        function pedirPdf() {
          exportar.mutate(
            { etapaId: etapa.id, obraId: obra?.id ?? null },
            { onSuccess: (url) => abrirLink(url) },
          );
        }
        return (
          <>
            {painel.obras.length >= 2 && (
              <div className="filtro-obra">
                <Abas
                  rotulo="Obra"
                  ativa={obra?.slug ?? ""}
                  onMudar={onObra}
                  itens={[
                    { id: "", rotulo: "Todas" },
                    ...painel.obras.map((o) => ({
                      id: o.slug,
                      rotulo: o.nome,
                    })),
                  ]}
                />
              </div>
            )}
            <h2 className="relatorio-secao">Painel</h2>
            <PainelRelatorios painel={painel} obraId={obra?.id ?? null} />
            <h2 className="relatorio-secao">Exportar</h2>
            <button
              type="button"
              className="botao"
              disabled={exportar.isPending}
              onClick={pedirPdf}
            >
              {exportar.isPending
                ? "Gerando PDF…"
                : "Relatório de pendências (PDF)"}
            </button>
            <p className="relatorio-dica">
              {obra ? `Obra ${obra.nome}` : `Todas as obras da ${etapa.nome}`} ·
              abertas e resolvidas, com fotos
            </p>
            {exportar.isError && (
              <p className="relatorio-erro" role="alert">
                {mensagemDe(
                  exportar.error,
                  "Não foi possível gerar o PDF. Tente de novo.",
                )}
              </p>
            )}
          </>
        );
      }}
    </EstadoConsulta>
  );
}

/** Boletins diários de obra: situação de hoje por etapa e a lista dos emitidos (admin emite e exclui). */
export default function Relatorios() {
  const [params, setParams] = useSearchParams();
  const consulta = useRelatorios();
  const pdf = useAbrirPdf();
  const [aviso, setAviso] = useState<string | null>(null);
  const filtro = params.get("etapa") ?? "";
  const obraSlug = params.get("obra") ?? "";
  const etapas = consulta.data?.etapas ?? [];
  const etapaAtual = etapas.find((e) => e.slug === filtro) ?? etapas[0];

  function mudarParametros(mudar: (p: URLSearchParams) => void) {
    const prox = new URLSearchParams(params);
    mudar(prox);
    setParams(prox, { replace: true });
  }
  function mudarEtapa(slug: string) {
    mudarParametros((p) => {
      p.set("etapa", slug);
      p.delete("obra");
    });
  }
  function mudarObra(slug: string) {
    mudarParametros((p) => (slug ? p.set("obra", slug) : p.delete("obra")));
  }

  return (
    <section aria-labelledby="titulo-relatorios">
      <TopoTela
        titulo="Relatórios"
        idTitulo="titulo-relatorios"
        base={
          etapaAtual && (
            <AbasEtapa
              etapas={etapas}
              valor={etapaAtual.id}
              onMudar={(id) =>
                mudarEtapa(etapas.find((e) => e.id === id)?.slug ?? "")
              }
            />
          )
        }
      />
      <EstadoConsulta consulta={consulta}>
        {({ admin, etapas, boletins }) => {
          const atual = etapaAtual ?? etapas[0];
          const emitidos = atual
            ? boletins.filter((b) => b.etapa_slug === atual.slug)
            : [];
          return (
            <>
              {atual && (
                <PainelEtapa
                  key={atual.id}
                  etapa={atual}
                  obraSlug={obraSlug}
                  onObra={mudarObra}
                />
              )}
              {pdf.erro && (
                <p className="relatorio-erro" role="alert">
                  {pdf.erro}
                </p>
              )}
              {aviso && (
                <p className="relatorio-aviso" role="status">
                  {aviso}
                </p>
              )}
              <h2 className="relatorio-secao">Hoje</h2>
              {atual && (
                <CartaoHoje
                  etapa={atual}
                  admin={admin}
                  pdfPath={
                    boletins.find((b) => b.id === atual.boletim_hoje?.id)
                      ?.pdf_path ?? null
                  }
                  onAbrirPdf={pdf.abrir}
                />
              )}
              <h2 className="relatorio-secao">Emitidos</h2>
              {emitidos.length === 0 ? (
                <p className="relatorio-dica">Nenhum boletim emitido ainda.</p>
              ) : (
                <ul className="lista-cartoes relatorio-lista">
                  {emitidos.map((b) => (
                    <LinhaBoletim
                      key={b.id}
                      b={b}
                      admin={admin}
                      onAbrirPdf={pdf.abrir}
                      onExcluido={(r) => setAviso(textoExclusao(r))}
                    />
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </EstadoConsulta>
    </section>
  );
}
