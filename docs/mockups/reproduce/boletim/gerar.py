"""Mockup do Boletim de Acompanhamento Diário: gera boletim.html (A4)."""
import base64
import pathlib

AQUI = pathlib.Path(__file__).parent
LOGO = base64.b64encode((AQUI / "logo.png").read_bytes()).decode()

import math

# INMET ilustrativo (estação automática A305), 11/11/2026, horário de Fortaleza, 06h..18h
LAT, LON, FUSO_H = -3.76, -38.53, -3
HORAS = list(range(6, 19))
TEMP = [25.2, 26.0, 27.6, 28.7, 29.5, 30.4, 31.1, 31.4, 30.2, 27.4, 27.0, 27.6, 27.3]
CHUVA = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2, 0.4, 0, 0]
RAZAO = [0.55, 0.70, 0.78, 0.82, 0.80, 0.74, 0.70, 0.60, 0.45, 0.18, 0.22, 0.50, 0.60]


def ceu_limpo(hora):
    """Radiação global de céu limpo (modelo de Haurwitz) na hora que termina em `hora`, kJ/m²."""
    dia = 315  # 11/11
    decl = math.radians(23.45) * math.sin(math.radians(360 / 365 * (284 + dia)))
    total = 0.0
    for k in range(6):  # média em passos de 10 min
        t = hora - 1 + (k + 0.5) / 6
        solar = t + (LON / 15 - FUSO_H)  # hora solar aproximada
        ang = math.radians(15 * (solar - 12))
        lat = math.radians(LAT)
        cosz = math.sin(lat) * math.sin(decl) + math.cos(lat) * math.cos(decl) * math.cos(ang)
        if cosz > 0:
            total += 1098 * cosz * math.exp(-0.057 / cosz)
    return total / 6 * 3.6


LIMPO = [ceu_limpo(h + 1) for h in HORAS]
RAD = [l * r for l, r in zip(LIMPO, RAZAO)]


def ceu(i0, i1):
    k = sum(RAD[i0:i1]) / sum(LIMPO[i0:i1])
    return ("ensolarado" if k >= 0.75 else "parcialmente nublado" if k >= 0.45 else "nublado"), k


def br(x, casas=1):
    return f"{x:.{casas}f}".replace(".", ",")


def grafico():
    w, h = 690, 226
    esq, dir_ = 38, 48
    top, base = 24, 132          # temperatura + chuva
    rtop, rbase = 162, 210       # radiação
    larg = (w - esq - dir_) / (len(HORAS) - 1)
    tmin, tmax, cmax = 24, 32, 2.0
    rmax = 3600

    def x(i):
        return esq + i * larg

    def yt(t):
        return base - (t - tmin) / (tmax - tmin) * (base - top)

    def yc(c):
        return base - c / cmax * (base - top)

    def yr(r):
        return rbase - r / rmax * (rbase - rtop)

    p = []
    for t in range(tmin, tmax + 1, 2):
        p.append(f'<line x1="{esq}" y1="{yt(t):.1f}" x2="{w-dir_}" y2="{yt(t):.1f}" class="grade"/>')
        p.append(f'<text x="{esq-6}" y="{yt(t)+3.5:.1f}" class="eixo" text-anchor="end">{t}°</text>')
    for c in (0.5, 1.0, 1.5, 2.0):
        p.append(f'<text x="{w-dir_+6}" y="{yc(c)+3.5:.1f}" class="eixo">{br(c)}</text>')
    p.append(f'<text x="{esq-6}" y="{top-12}" class="eixo" text-anchor="end">°C</text>')
    p.append(f'<text x="{w-dir_+6}" y="{top-12}" class="eixo">mm</text>')
    p.append(f'<line x1="{x(6):.1f}" y1="{top}" x2="{x(6):.1f}" y2="{rbase}" class="divisor"/>')
    p.append(f'<text x="{x(3):.1f}" y="{top-2}" class="periodo" text-anchor="middle">MANHÃ</text>')
    p.append(f'<text x="{x(9):.1f}" y="{top-2}" class="periodo" text-anchor="middle">TARDE</text>')
    bw = larg * 0.5
    for i, c in enumerate(CHUVA):
        if c > 0:
            p.append(f'<rect x="{x(i)-bw/2:.1f}" y="{yc(c):.1f}" width="{bw:.1f}" height="{base-yc(c):.1f}" class="chuva" rx="1.5"/>')
            p.append(f'<text x="{x(i):.1f}" y="{yc(c)-4:.1f}" class="rotulo azul" text-anchor="middle">{br(c)}</text>')
    pts = " ".join(f"{x(i):.1f},{yt(t):.1f}" for i, t in enumerate(TEMP))
    p.append(f'<polyline points="{pts}" class="temp"/>')
    for i, t in enumerate(TEMP):
        p.append(f'<circle cx="{x(i):.1f}" cy="{yt(t):.1f}" r="2.4" class="ponto"/>')
    imax = TEMP.index(max(TEMP))
    p.append(f'<text x="{x(imax):.1f}" y="{yt(TEMP[imax])-7:.1f}" class="rotulo" text-anchor="middle">{br(TEMP[imax])} °C</text>')
    for i, hh in enumerate(HORAS):
        p.append(f'<text x="{x(i):.1f}" y="{base+13}" class="eixo" text-anchor="middle">{hh:02d}h</text>')
    p.append(f'<line x1="{esq}" y1="{base}" x2="{w-dir_}" y2="{base}" class="base"/>')
    # radiação: medida (área) × céu limpo (tracejado)
    area = f"{x(0):.1f},{rbase} " + " ".join(f"{x(i):.1f},{yr(r):.1f}" for i, r in enumerate(RAD)) + f" {x(len(RAD)-1):.1f},{rbase}"
    p.append(f'<polygon points="{area}" class="rad"/>')
    lp = " ".join(f"{x(i):.1f},{yr(r):.1f}" for i, r in enumerate(LIMPO))
    p.append(f'<polyline points="{lp}" class="limpo"/>')
    p.append(f'<line x1="{esq}" y1="{rbase}" x2="{w-dir_}" y2="{rbase}" class="base"/>')
    p.append(f'<text x="{esq}" y="{rtop-8}" class="periodo">RADIAÇÃO SOLAR (kJ/m² por hora) · área = medida · tracejado = céu limpo</text>')
    for r in (0, 1800, 3600):
        p.append(f'<text x="{w-dir_+6}" y="{yr(r)+3.5:.1f}" class="eixo">{r:,}</text>'.replace(",", "."))
    return f'<svg viewBox="0 0 {w} {h}" width="100%" class="grafico">{"".join(p)}</svg>'


CAMERA = (
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6">'
    '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'
)


def foto(rotulo, tom=0):
    tons = [
        ("#b9b1a4", "#8f8577"),
        ("#a9b3b8", "#7b878e"),
        ("#c2b39a", "#97856b"),
        ("#b5b5ad", "#86867c"),
    ]
    a, b = tons[tom % len(tons)]
    return (
        f'<figure class="foto"><div class="img" style="background:linear-gradient(160deg,{a},{b})">'
        f'{CAMERA}<span>foto</span></div><figcaption>{rotulo}</figcaption></figure>'
    )


SERVICOS = [
    ("BLOCO DE ALOJAMENTO", [
        ("Térreo › Apto. 101", "08:14", "3S JOÃO FELIPE",
         "Assentamento de porcelanato 60×60 no piso do quarto; cerca de 70% concluído.", 2),
        ("1º pavimento › Circulação norte", "09:40", "CB ALMEIDA",
         "Instalação de eletrocalhas e passagem de cabos da rede de dados entre os eixos 3 e 8.", 2),
        ("Térreo › Salão de eventos", "14:05", "3S JOÃO FELIPE",
         "Aplicação da 1ª demão de massa corrida no forro de gesso.", 1),
    ]),
    ("BLOCO DIDÁTICO", [
        ("Térreo › Sala de aula 03", "10:22", "2S RIBEIRO",
         "Execução de reboco interno nas paredes leste e sul.", 2),
        ("Cobertura › Eixos 4 a 7", "15:48", "2S RIBEIRO",
         "Montagem da estrutura metálica da cobertura; terças instaladas até o eixo 6.", 1),
    ]),
]

ABERTAS = [
    ("BLOCO DE ALOJAMENTO › Térreo › Banheiro Apto. 104", "09:02", "3S JOÃO FELIPE",
     "Caimento do piso do box invertido; água acumula junto à porta."),
    ("BLOCO DE ALOJAMENTO › 1º pavimento › Apto. 211", "11:30", "CB ALMEIDA",
     "Esquadria da janela com folga e sem vedação de silicone no lado externo."),
    ("BLOCO DIDÁTICO › Térreo › Laboratório 1", "15:12", "2S RIBEIRO",
     "Eletroduto aparente fora do projeto na parede norte."),
    ("BLOCO DE ALOJAMENTO › Térreo › Circulação sul", "16:40", "3S JOÃO FELIPE",
     "Fissura no reboco acima da porta corta-fogo PCF-02."),
]

ENCERRADAS = [
    ("BLOCO DE ALOJAMENTO › Térreo › Apto. 108", "aberta em 03/11 (8 dias)", "3S JOÃO FELIPE", "13:20",
     "Rejunte falhado no piso do quarto.", "Rejunte refeito em toda a área; conferido com a contratada."),
    ("BLOCO DIDÁTICO › Térreo › Sala de aula 01", "aberta em 06/11 (5 dias)", "2S RIBEIRO", "16:05",
     "Tomada da bancada sem espelho e com fiação exposta.", "Espelho instalado e circuito identificado no quadro QD-T1."),
]


def servicos_html():
    out = []
    n = 0
    for obra, itens in SERVICOS:
        out.append(f'<h3 class="obra">{obra}</h3>')
        for amb, hora, autor, legenda, nf in itens:
            fotos = "".join(foto(f"Foto {k+1} · {hora}", n + k) for k in range(nf))
            n += nf
            out.append(
                f'<div class="registro"><div class="reg-cab"><b>{amb}</b>'
                f'<span>{hora} · {autor}</span></div><p>{legenda}</p><div class="fotos">{fotos}</div></div>'
            )
    out.append('<p class="nota">Mostrando 5 de 11 registros de serviço do dia; o boletim real lista todos.</p>')
    return "".join(out)


def abertas_html():
    out = []
    for i, (amb, hora, autor, legenda) in enumerate(ABERTAS):
        out.append(
            f'<div class="pend"><div class="pend-foto">{foto("", i + 1)}</div><div>'
            f'<div class="reg-cab"><b>{amb}</b><span>{hora} · {autor}</span></div>'
            f'<p>{legenda}</p><span class="tag aberta">ABERTA</span></div></div>'
        )
    return "".join(out)


def encerradas_html():
    out = []
    for i, (amb, aberta, quem, hora, legenda, obs) in enumerate(ENCERRADAS):
        out.append(
            f'<div class="registro"><div class="reg-cab"><b>{amb}</b><span>{aberta}</span></div>'
            f'<p><b>Pendência:</b> {legenda}</p>'
            f'<p><b>Encerramento</b> ({hora} · {quem}): {obs}</p>'
            f'<div class="fotos">{foto("Antes (registro original)", i)}{foto("Depois (comprovação)", i + 2)}</div>'
            f'<span class="tag encerrada">ENCERRADA</span></div>'
        )
    out.append('<p class="nota">Mostrando 2 de 6 pendências encerradas no dia.</p>')
    return "".join(out)


def kpi(valor, rotulo, cls=""):
    return f'<div class="kpi {cls}"><div class="v">{valor}</div><div class="r">{rotulo}</div></div>'


CEU_M, K_M = ceu(0, 6)
CEU_T, K_T = ceu(6, 12)
K_M, K_T = round(K_M * 100), round(K_T * 100)

html = f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Boletim BA2/261111/COFZ</title>
<style>
@page {{ size: A4; margin: 12mm 12mm 16mm 12mm; }}
* {{ box-sizing: border-box; }}
html {{ padding-right: 2px; }}
body {{ margin: 0; font-family: "Liberation Serif", "Times New Roman", serif; color: #111; font-size: 11.5pt; }}
table.cab {{ width: 100%; border-collapse: collapse; }}
table.cab td {{ border: 1.4px solid #222; padding: 4px 8px; vertical-align: middle; }}
.cinza {{ background: #d9d9d9; }}
.logo {{ width: 19%; text-align: center; }}
.logo img {{ width: 112px; display: block; margin: 4px auto; }}
.om {{ text-align: center; font-weight: bold; line-height: 1.15; }}
.om .l1 {{ font-size: 14.5pt; }} .om .l2 {{ font-size: 10.8pt; white-space: nowrap; }}
.doc {{ width: 26%; text-align: center; padding: 0 !important; }}
.doc div {{ border-bottom: 1.4px solid #222; padding: 6px 4px; }}
.doc div:last-child {{ border-bottom: 0; }}
.doc .rot {{ background: #d9d9d9; font-size: 8.5pt; }}
.doc .val {{ font-weight: bold; font-size: 11.5pt; }}
.chave {{ font-weight: bold; font-size: 10.5pt; width: 19%; }}
.assunto {{ text-align: center; font-weight: bold; font-size: 15pt; }}
.just {{ text-align: justify; }}
h2 {{ font-size: 12.5pt; margin: 14px 0 6px; display: flex; gap: 10px; break-after: avoid; }}
h3.obra {{ font-size: 10.5pt; margin: 10px 0 4px; letter-spacing: .03em; border-bottom: 1px solid #999; padding-bottom: 2px; break-after: avoid; }}
.dados {{ padding-left: 26px; font-size: 10.8pt; line-height: 1.45; }}
.dados span {{ margin-right: 18px; }}
.dados div b {{ font-weight: bold; }}
.prazo {{ margin: 8px 0 0 26px; font-size: 10pt; }}
.barra {{ height: 9px; background: #e4e4e4; border: 1px solid #999; margin: 3px 0; position: relative; }}
.barra i {{ position: absolute; inset: 0 auto 0 0; width: 56.2%; background: #3d5f8c; }}
.barra em {{ position: absolute; top: -3px; bottom: -3px; left: 56.2%; border-left: 2px solid #111; }}
.legenda-prazo {{ display: flex; justify-content: space-between; color: #333; font-size: 9pt; }}
table.met {{ width: 100%; border-collapse: collapse; font-size: 9.8pt; margin-top: 4px; }}
table.met th, table.met td {{ border: 1px solid #555; padding: 3px 5px; text-align: center; }}
table.met th {{ background: #d9d9d9; font-size: 8.8pt; }}
table.met td:first-child {{ text-align: left; font-weight: bold; white-space: nowrap; }}
.sub {{ font-size: 9pt; color: #333; padding-left: 26px; margin-top: -2px; }}
.resumo {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 6px; }}
.resumo div {{ border: 1px solid #999; padding: 4px 6px; font-size: 9.2pt; line-height: 1.25; }}
.resumo b {{ display: block; font-size: 11.5pt; }}
.alerta {{ border: 1px solid #b07d1a; background: #fbf3df; padding: 5px 8px; font-size: 9.3pt; margin-top: 6px; }}
.grafico {{ margin-top: 6px; font-family: "Liberation Sans", sans-serif; }}
.grafico .grade {{ stroke: #e2e2e2; stroke-width: 1; }}
.grafico .divisor {{ stroke: #999; stroke-dasharray: 3 3; }}
.grafico .base {{ stroke: #555; }}
.grafico .eixo {{ font-size: 9px; fill: #444; }}
.grafico .periodo {{ font-size: 8.5px; fill: #666; letter-spacing: .08em; }}
.grafico .temp {{ fill: none; stroke: #c0392b; stroke-width: 2; }}
.grafico .ponto {{ fill: #c0392b; }}
.grafico .rotulo {{ font-size: 9.5px; fill: #c0392b; font-weight: bold; }}
.grafico .chuva {{ fill: #3d6fb0; }}
.grafico .rad {{ fill: #f2c14e; opacity: .55; }}
.grafico .limpo {{ fill: none; stroke: #b8860b; stroke-width: 1.4; stroke-dasharray: 4 3; }}
.grafico .rotulo.azul {{ fill: #3d6fb0; }}
.obs-obra {{ font-size: 10pt; margin: 2px 0 8px; }}
.obs-obra .item {{ display: grid; grid-template-columns: 150px 1fr; gap: 8px; padding: 3px 0; border-bottom: 1px dotted #bbb; }}
.obs-obra .quem {{ color: #444; font-size: 9pt; }}
.leg {{ font-family: "Liberation Sans", sans-serif; font-size: 8.5pt; color: #333; display: flex; gap: 14px; justify-content: center; }}
.leg i {{ display: inline-block; width: 12px; height: 8px; margin-right: 4px; vertical-align: middle; }}
.fonte {{ font-size: 8.5pt; color: #444; margin-top: 3px; }}
.kpis {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }}
.kpi {{ border: 1px solid #999; padding: 5px 7px; break-inside: avoid; }}
.kpi .v {{ font-size: 17pt; font-weight: bold; line-height: 1.1; }}
.kpi .r {{ font-size: 8.8pt; color: #333; }}
.kpi.mais .v {{ color: #a33; }} .kpi.menos .v {{ color: #2e7d32; }}
.kpi.dest {{ background: #eef2f8; border-color: #3d5f8c; }}
.grupo {{ font-size: 9pt; font-weight: bold; color: #333; margin: 8px 0 3px; text-transform: uppercase; letter-spacing: .04em; }}
.kpis3 {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }}
.linha {{ border: 1px solid #999; padding: 5px 8px; font-size: 9.6pt; line-height: 1.35; }}
.linha b {{ font-size: 11pt; }}
table.obras {{ width: 100%; border-collapse: collapse; font-size: 9.6pt; margin-top: 6px; }}
table.obras th, table.obras td {{ border: 1px solid #555; padding: 3px 6px; text-align: center; }}
table.obras th {{ background: #d9d9d9; font-size: 8.8pt; }}
table.obras td:first-child {{ text-align: left; }}
table.obras tr.total td {{ font-weight: bold; background: #f0f0f0; }}
.registro {{ border: 1px solid #bbb; padding: 6px 8px; margin-bottom: 6px; break-inside: avoid; position: relative; }}
.reg-cab {{ display: flex; justify-content: space-between; gap: 8px; font-size: 10pt; }}
.reg-cab span {{ color: #444; font-size: 9pt; white-space: nowrap; }}
.registro p, .pend p {{ margin: 3px 0 5px; font-size: 10pt; text-align: justify; }}
.fotos {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }}
.foto {{ margin: 0; }}
.foto .img {{ aspect-ratio: 4 / 3; display: flex; flex-direction: column; align-items: center; justify-content: center; color: rgba(255,255,255,.85); font-family: "Liberation Sans", sans-serif; font-size: 8pt; letter-spacing: .1em; text-transform: uppercase; gap: 2px; }}
.foto figcaption {{ font-size: 8.5pt; color: #444; margin-top: 2px; }}
.foto figcaption:empty {{ display: none; }}
.pendencias {{ display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }}
.pend {{ border: 1px solid #bbb; padding: 6px; display: grid; grid-template-columns: 38% 1fr; gap: 8px; break-inside: avoid; }}
.pend .reg-cab {{ flex-direction: column; gap: 1px; font-size: 9.2pt; }}
.pend p {{ font-size: 9.4pt; }}
.tag {{ font-family: "Liberation Sans", sans-serif; font-size: 7.5pt; font-weight: bold; padding: 1px 5px; border-radius: 2px; letter-spacing: .05em; }}
.tag.aberta {{ background: #f6dede; color: #8b1e1e; }}
.tag.encerrada {{ background: #dcefdc; color: #1f5f22; position: absolute; top: 6px; right: 8px; display: none; }}
.nota {{ font-size: 8.8pt; color: #555; font-style: italic; margin: 2px 0 0; }}
.obs {{ border: 1px solid #999; min-height: 44px; padding: 6px 8px; font-size: 10pt; color: #444; }}
.assin {{ width: 50%; margin: 34px auto 0; text-align: center; font-size: 10pt; }}
.assin div {{ border-top: 1px solid #111; padding-top: 3px; }}
.emissao {{ margin-top: 16px; font-size: 9pt; color: #333; border-top: 1px solid #ccc; padding-top: 6px; }}
.sec {{ padding-left: 26px; }}
</style></head><body>

<table class="cab">
<tr>
  <td class="logo" rowspan="1"><img src="data:image/png;base64,{LOGO}" alt="Logo da OM"></td>
  <td class="om"><div class="l1">COMANDO DA AERONÁUTICA</div><div class="l2">DIRETORIA DE INFRAESTRUTURA DA AERONÁUTICA</div><div class="l2">COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)</div></td>
  <td class="doc"><div class="rot">Nº DO DOCUMENTO</div><div class="val">BA2/261111/COFZ</div><div class="rot">EXPEDIÇÃO</div><div class="val">11/11/26 · 23:30</div></td>
</tr>
<tr><td class="chave cinza">ASSUNTO</td><td colspan="2" class="assunto">BOLETIM DE ACOMPANHAMENTO DIÁRIO</td></tr>
<tr><td class="chave cinza">OBRA/SERVIÇO</td><td colspan="2" class="just">OBRA DE IMPLANTAÇÃO DA 2ª ETAPA DO CAMPUS EM FORTALEZA DO ITA COMPREENDENDO O 1 BLOCO DE ALOJAMENTO E 1 BLOCO DIDÁTICO</td></tr>
<tr><td class="chave cinza">LOCAL</td><td colspan="2">INSTITUTO TECNOLÓGICO DE AERONÁUTICA - CAMPUS FORTALEZA<br>Av Borges de Melo, 205 - CEP 60415-513 Fortaleza - CE</td></tr>
<tr><td class="chave cinza">RESPONSÁVEIS</td><td colspan="2">3S JOÃO FELIPE</td></tr>
</table>

<h2><span>1.</span>DADOS DA OBRA/SERVIÇO</h2>
<div class="dados">
  <div><b>CONTRATANTE:</b> Superintendência de Obras Públicas - SOP-CE</div>
  <div><span><b>ÁREA TOTAL CONSTRUÍDA:</b> 86.102,17 m²</span><b>CONTRATO:</b> 120/2025 - SOP</div>
  <div><b>CONTRATADA:</b> Consórcio Cetro/Porto/Morais Engenharia · CNPJ 57.228.483/0001-01</div>
  <div><span><b>ORDEM DE SERVIÇO Nº:</b> 313/2025</span><b>DATA DE ASSINATURA DA OS:</b> 06/08/2025</div>
  <div><span><b>VIGÊNCIA ORIGINAL:</b> 27 meses</span><b>VALOR ORIGINAL:</b> R$ 79.499.000,00</div>
  <div><span><b>ADITIVOS:</b> nenhum</span><span><b>TÉRMINO ATUAL:</b> 06/11/2027</span><b>VALOR ATUALIZADO:</b> R$ 79.499.000,00</div>
</div>
<div class="prazo">
  <b>PRAZO DECORRIDO:</b> 462 de 822 dias (56,2%) · restam 360 dias
  <div class="barra"><i></i><em></em></div>
  <div class="legenda-prazo"><span>OS 06/08/2025</span><span>hoje 11/11/2026</span><span>término 06/11/2027</span></div>
</div>

<h2><span>2.</span>CONDIÇÕES METEOROLÓGICAS</h2>
<div class="sub">INMET · estação automática A305 Fortaleza (a 6 km da obra) · horário de Fortaleza (UTC−3)</div>
<table class="met">
<tr><th>PERÍODO</th><th>CONDIÇÃO</th><th>TEMPERATURA</th><th>UMIDADE</th><th>CHUVA</th><th>VENTO / RAJADA</th><th>RADIAÇÃO*<br><small>% do céu limpo</small></th></tr>
<tr><td>MANHÃ (6h–12h)</td><td>Sem chuva · {CEU_M}</td><td>25,2 – 30,4 °C</td><td>62 – 84%</td><td>0,0 mm</td><td>14 / 38 km/h</td><td>{K_M}%</td></tr>
<tr><td>TARDE (12h–18h)</td><td>Chuva · {CEU_T}</td><td>27,0 – 31,4 °C</td><td>58 – 82%</td><td>1,6 mm<br><small>15h–17h</small></td><td>18 / 47 km/h</td><td>{K_T}%</td></tr>
</table>
<div class="resumo">
  <div>Temperatura do dia<b>24,6 – 31,4 °C</b>ponto de orvalho 22,8 °C</div>
  <div>Umidade relativa<b>73% média</b>mínima 58%</div>
  <div>Chuva em 24 h<b>1,6 mm</b>2 h com chuva</div>
  <div>Vento<b>até 19 km/h · E</b>rajada 47 km/h · 1009 hPa</div>
</div>
{grafico()}
<div class="leg"><span><i style="background:#c0392b;height:2px"></i>Temperatura</span><span><i style="background:#3d6fb0"></i>Chuva (mm na hora)</span><span><i style="background:#f2c14e"></i>Radiação medida</span><span><i style="border-top:2px dashed #b8860b;height:0"></i>Céu limpo (calculado)</span></div>
<div class="fonte">* Céu estimado pela radiação solar medida em relação à de um dia de céu limpo no mesmo local e horário (≥ 75% ensolarado; 45–75% parcialmente nublado; &lt; 45% nublado). Fonte: INMET, dados brutos da estação, obtidos em 11/11/2026 23:25 e convertidos de UTC.</div>

<h2><span>3.</span>INDICADORES</h2>
<div class="grupo">Pendências no dia</div>
<div class="kpis">
  {kpi("18", "abertas no início do dia")}
  {kpi("+4", "abertas no dia", "mais")}
  {kpi("−6", "encerradas no dia", "menos")}
  {kpi("16", "abertas ao fim do dia", "dest")}
</div>
<div class="grupo">Acumulado desde a OS</div>
<div class="kpis3">
  <div class="linha"><b>142</b> abertas · <b>126</b> encerradas<br>taxa de resolução <b>88,7%</b></div>
  <div class="linha">Abertas há mais de 7 / 15 / 30 dias<br><b>9 · 5 · 2</b></div>
  <div class="linha">Tempo médio de resolução<br><b>6,4 dias</b></div>
</div>
<div class="grupo">Atividade e clima</div>
<div class="kpis3">
  <div class="linha"><b>11</b> registros de serviço · <b>34</b> fotos<br><b>12</b> ambientes com lançamento · <b>5</b> pessoas</div>
  <div class="linha">Dias com chuva<br><b>2</b> em novembro · <b>71</b> desde a OS</div>
  <div class="linha">Chuva acumulada<br><b>7,8 mm</b> em novembro</div>
</div>
<table class="obras">
<tr><th>OBRA</th><th>SERVIÇOS NO DIA</th><th>PEND. ABERTAS NO DIA</th><th>PEND. ENCERRADAS NO DIA</th><th>ABERTAS AO FIM DO DIA</th><th>ABERTAS &gt; 15 DIAS</th></tr>
<tr><td>Bloco de Alojamento</td><td>7</td><td>3</td><td>4</td><td>10</td><td>3</td></tr>
<tr><td>Bloco Didático</td><td>4</td><td>1</td><td>2</td><td>6</td><td>2</td></tr>
<tr class="total"><td>Total da etapa</td><td>11</td><td>4</td><td>6</td><td>16</td><td>5</td></tr>
</table>

<h2><span>4.</span>SERVIÇOS EM EXECUÇÃO</h2>
<div class="sec">{servicos_html()}</div>

<h2><span>5.</span>PENDÊNCIAS ABERTAS NO DIA (4)</h2>
<div class="sec pendencias">{abertas_html()}</div>

<h2><span>6.</span>PENDÊNCIAS ENCERRADAS NO DIA (6)</h2>
<div class="sec">{encerradas_html()}</div>

<h2><span>7.</span>OBSERVAÇÕES</h2>
<div class="sec">
<h3 class="obra">BLOCO DE ALOJAMENTO</h3>
<div class="obs-obra">
  <div class="item"><span class="quem">10:15 · CP PATRICIO</span><span>Visita técnica da fiscalização da SOP-CE ao 1º pavimento, sem ressalvas.</span></div>
  <div class="item"><span class="quem">17:40 · 3S JOÃO FELIPE</span><span>Efetivo reduzido na frente de pisos (8 de 12 oficiais) por falta de transporte da contratada.</span></div>
</div>
<h3 class="obra">BLOCO DIDÁTICO</h3>
<div class="obs-obra">
  <div class="item"><span class="quem">14:30 · 2S RIBEIRO</span><span>Concretagem da laje do eixo 7 adiada para 13/11 por indisponibilidade da bomba; chuva das 15h às 17h suspendeu o reboco externo.</span></div>
</div>
</div>

<div style="break-inside: avoid"><h2><span>8.</span>RESPONSÁVEIS</h2>
<div class="sec">
  <div class="assin"><div>3S JOÃO FELIPE<br>Fiscal da obra</div></div>
  <div class="emissao">Emitido automaticamente pelo Fiscal Bot em 11/11/2026 às 23:30 (horário de Fortaleza), com os lançamentos de 11/11/2026. Retificações: nenhuma. Lançamentos deste dia recebidos após a emissão entram no boletim seguinte.</div>
</div></div>
</body></html>
"""

(AQUI / "boletim.html").write_text(html, encoding="utf-8")
print("ok")
