import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { PontoSerie } from "../util/painel.ts";

/** Largura inicial (antes de medir) e altura fixa, em px reais: o texto do SVG fica em 11 px em qualquer tela. */
const L_PADRAO = 320;
const A = 190;
const M = { e: 30, d: 36, t: 12, b: 24 };
const ALT = A - M.t - M.b;

/** `AAAA-MM-DD` → `dd/mm`. */
export function ddmm(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** Menor passo "bonito" (1, 2, 5 × 10^k, inteiro) com que até 4 passos cobrem o máximo. */
export function passoBonito(max: number): number {
  const alvo = Math.max(max, 1);
  for (let pot = 1; ; pot *= 10) {
    for (const m of [1, 2, 5])
      if (Math.ceil(alvo / (m * pot)) <= 4) return m * pot;
  }
}

/** Afasta rótulos com menos de `min` px entre si, mantendo a ordem. */
export function afastar(ys: number[], min = 12): number[] {
  const ordem = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ordem.length; k++) {
    if (ordem[k].y - ordem[k - 1].y < min) ordem[k].y = ordem[k - 1].y + min;
  }
  const saida = [...ys];
  for (const o of ordem) saida[o.i] = o.y;
  return saida;
}

const SERIES = [
  {
    chave: "servicos",
    nome: "Serviços",
    cor: "var(--servico)",
    classe: "serie-servicos",
  },
  {
    chave: "pendencias",
    nome: "Pendências",
    cor: "var(--pendencia)",
    classe: "serie-pendencias",
  },
  {
    chave: "resolvidas",
    nome: "Resolvidas",
    cor: "var(--ok)",
    classe: "serie-resolvidas",
  },
] as const;

/** Gráfico de linhas do acumulado (serviços, pendências registradas e resolvidas), em SVG próprio. */
export function GraficoAcumulado({ serie }: { serie: PontoSerie[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const [L, setL] = useState(L_PADRAO);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = caixa.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const medir = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setL(w);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = serie.length;
  const LARG = L - M.e - M.d;
  if (n === 0) return null;
  const ult = serie[n - 1];
  const passo = passoBonito(
    Math.max(ult.servicos, ult.pendencias, ult.resolvidas),
  );
  const topo =
    Math.max(
      1,
      Math.ceil(Math.max(ult.servicos, ult.pendencias, ult.resolvidas) / passo),
    ) * passo;
  const x = (i: number) => M.e + (n === 1 ? LARG : (i / (n - 1)) * LARG);
  const y = (v: number) => M.t + ALT - (v / topo) * ALT;
  const marcas = Array.from({ length: topo / passo + 1 }, (_, k) => k * passo);
  const idxX = [
    ...new Set([0, 1, 2, 3].map((k) => Math.round((k * (n - 1)) / 3))),
  ];
  const rotulosY = afastar(SERIES.map((s) => y(ult[s.chave]) + 4));
  const resumo = `Acumulado até ${ddmm(ult.dia)}: ${ult.servicos} serviços, ${ult.pendencias} pendências registradas, ${ult.resolvidas} resolvidas.`;

  function indiceDe(e: PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = r.width > 0 ? ((e.clientX - r.left) / r.width) * L : 0;
    const i = Math.round(((px - M.e) / LARG) * (n - 1));
    return Math.min(n - 1, Math.max(0, i));
  }
  function teclado(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key === "ArrowLeft") setSel((s) => Math.max(0, (s ?? n) - 1));
    else if (e.key === "ArrowRight")
      setSel((s) => Math.min(n - 1, (s ?? -1) + 1));
    else if (e.key === "Escape") setSel(null);
    else return;
    e.preventDefault();
  }
  const p = sel === null ? null : serie[sel];

  return (
    <div className="grafico" ref={caixa}>
      <ul className="grafico-legenda">
        {SERIES.map((s) => (
          <li key={s.chave}>
            <span className={`grafico-chave ${s.classe}`} aria-hidden="true" />
            {s.nome}
          </li>
        ))}
      </ul>
      <p
        className="grafico-dica"
        aria-live="polite"
        data-visivel={p ? "sim" : "nao"}
      >
        {p
          ? `${ddmm(p.dia)} · Serviços ${p.servicos} · Pendências ${p.pendencias} · Resolvidas ${p.resolvidas}`
          : " "}
      </p>
      <svg
        className="grafico-svg"
        viewBox={`0 0 ${L} ${A}`}
        role="img"
        aria-label={resumo}
        tabIndex={0}
        onPointerDown={(e) => setSel(indiceDe(e))}
        onPointerMove={(e) => setSel(indiceDe(e))}
        onPointerUp={(e) => e.pointerType !== "mouse" && setSel(null)}
        onPointerLeave={() => setSel(null)}
        onPointerCancel={() => setSel(null)}
        onKeyDown={teclado}
        onBlur={() => setSel(null)}
      >
        {marcas.map((m) => (
          <g key={m}>
            <line
              className="grafico-grade"
              x1={M.e}
              x2={L - M.d + 6}
              y1={y(m)}
              y2={y(m)}
            />
            <text
              className="grafico-eixo"
              x={M.e - 6}
              y={y(m) + 4}
              textAnchor="end"
            >
              {m}
            </text>
          </g>
        ))}
        {idxX.map((i) => (
          <text
            key={i}
            className="grafico-eixo"
            x={x(i)}
            y={A - 6}
            textAnchor={
              i === 0 && idxX.length > 1
                ? "start"
                : i === n - 1 && idxX.length > 1
                  ? "end"
                  : "middle"
            }
          >
            {ddmm(serie[i].dia)}
          </text>
        ))}
        {SERIES.map((s) => (
          <polyline
            key={s.chave}
            className={`grafico-linha ${s.classe}`}
            fill="none"
            stroke={s.cor}
            points={serie
              .map((q, i) => `${x(i).toFixed(1)},${y(q[s.chave]).toFixed(1)}`)
              .join(" ")}
          />
        ))}
        {SERIES.map((s, k) => (
          <text
            key={s.chave}
            className="grafico-valor"
            x={L - M.d + 8}
            y={rotulosY[k]}
          >
            {ult[s.chave]}
          </text>
        ))}
        {p && sel !== null && (
          <g pointerEvents="none">
            <line
              className="grafico-cursor"
              x1={x(sel)}
              x2={x(sel)}
              y1={M.t}
              y2={M.t + ALT}
            />
            {SERIES.map((s) => (
              <circle
                key={s.chave}
                cx={x(sel)}
                cy={y(p[s.chave])}
                r={3.5}
                fill={s.cor}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
