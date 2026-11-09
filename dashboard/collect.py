#!/usr/bin/env python3
"""Coleta os dados do projeto e das sessões de agentes para o painel HTO.

Fontes:
  - tasks/plan.md e tasks/todo.md (roteiro oficial)
  - artifacts/validation/** (evidências técnicas)
  - OpenCode: ~/.local/share/opencode/opencode.db
  - Codex: ~/.codex/sessions/**/rollout-*.jsonl

Não altera nenhum arquivo do projeto. Retorna um único dicionário JSON.
"""

from __future__ import annotations

import datetime as dt
import glob
import json
import os
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DASHBOARD = Path(__file__).resolve().parent
OPENCODE_DB = Path(os.environ.get("OPENCODE_DB", Path.home() / ".local/share/opencode/opencode.db"))
CODEX_HOME = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
TZ = dt.timezone(dt.timedelta(hours=-3))

# Preços de tabela por 1M tokens (USD), catálogo OpenCode de 2026-11-05.
PRICING = [
    {"id": "deepseek-v4.1-flash", "label": "DeepSeek V4.1 Flash", "provider": "OpenCode Go",
     "input": 0.15, "output": 0.60, "cache_read": 0.003, "cache_write": 0.0, "family": "DeepSeek"},
    {"id": "deepseek-v4-pro", "label": "DeepSeek V4 Pro", "provider": "OpenCode Go",
     "input": 0.66, "output": 1.98, "cache_read": 0.022, "cache_write": 0.0, "family": "DeepSeek"},
    {"id": "claude-haiku-5-5", "label": "Claude Haiku 5.5", "provider": "OpenCode",
     "input": 0.10, "output": 0.50, "cache_read": 0.01, "cache_write": 0.125, "family": "Claude"},
    {"id": "gpt-6-luna", "label": "GPT-6 Luna", "provider": "OpenCode",
     "input": 0.10, "output": 0.50, "cache_read": 0.01, "cache_write": 0.125, "family": "GPT"},
    {"id": "mimo-v2.6-flash", "label": "MiMo V2.6 Flash", "provider": "OpenCode Go",
     "input": 0.14, "output": 0.28, "cache_read": 0.0028, "cache_write": 0.0, "family": "MiMo"},
    {"id": "glm-5.3-flash", "label": "GLM-5.3 Flash", "provider": "OpenCode Go",
     "input": 0.15, "output": 0.50, "cache_read": 0.03, "cache_write": 0.0, "family": "GLM"},
    {"id": "gpt-6.1-sol", "label": "GPT-6.1 Sol", "provider": "OpenCode",
     "input": 2.00, "output": 10.00, "cache_read": 0.10, "cache_write": 2.50, "family": "GPT"},
    {"id": "gpt-6.1-terra", "label": "GPT-6.1 Terra", "provider": "OpenCode",
     "input": 2.00, "output": 12.00, "cache_read": 0.20, "cache_write": 2.50, "family": "GPT",
     "reference": True, "note": "Tarifa de referência da família Terra; não havia entrada exata no catálogo na coleta."},
    {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5", "provider": "OpenCode",
     "input": 2.00, "output": 10.00, "cache_read": 0.20, "cache_write": 2.50, "family": "Claude"},
    {"id": "gpt-6-astra", "label": "GPT-6 Astra", "provider": "OpenCode",
     "input": 10.00, "output": 50.00, "cache_read": 1.00, "cache_write": 12.50, "family": "GPT"},
    {"id": "claude-opus-5-5", "label": "Claude Opus 5.5", "provider": "OpenCode",
     "input": 4.00, "output": 20.00, "cache_read": 0.20, "cache_write": 5.00, "family": "Claude"},
    {"id": "gpt-5.5", "label": "GPT-5.5", "provider": "OpenCode",
     "input": 5.00, "output": 30.00, "cache_read": 0.50, "cache_write": 0.0, "family": "GPT"},
]
PRICE_BY_ID = {p["id"]: p for p in PRICING}

MODEL_LABELS = {
    "gpt-6-astra": "GPT-6 Astra",
    "gpt-6.1-sol": "GPT-6.1 Sol",
    "gpt-6.1-terra": "GPT-6.1 Terra",
    "deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
    "deepseek-v4-pro": "DeepSeek V4 Pro",
}

DEFAULT_ESTIMATES = [
    {"id": "fechar-diagnostico", "section": "1. Diagnóstico dos arquivos",
     "label": "Fechar correspondência e documentar a transformação",
     "input": 90_000, "output": 9_000,
     "basis": "Revisão da evidência geométrica, documentação da transformação e relatório final."},
    {"id": "ambiente-piloto", "section": "2. Preparação do ambiente piloto",
     "label": "Importação reproduzível, vínculos e recorte 3D",
     "input": 1_200_000, "output": 60_000,
     "basis": "Base de 1,2M tokens de entrada por etapa, calibrada pelo diagnóstico medido (6,5M)."},
    {"id": "navegacao-2d-3d", "section": "3. Navegação 2D → 3D",
     "label": "Planta clicável, carregamento sob demanda e testes",
     "input": 2_000_000, "output": 100_000,
     "basis": "Maior esforço de frontend/Three.js; inclui testes em viewport móvel."},
    {"id": "telegram-auth", "section": "4. Acesso pelo Telegram",
     "label": "Identidade, autorização por obra e bot de teste",
     "input": 800_000, "output": 40_000,
     "basis": "Validação de initData, permissões e configuração HTTPS."},
    {"id": "fotos-historico", "section": "5. Foto e histórico por ambiente",
     "label": "Captura, legenda, histórico e autoria",
     "input": 1_200_000, "output": 60_000,
     "basis": "Fluxo de fotos, armazenamento e consulta por ambiente."},
    {"id": "offline-idempotencia", "section": "6. Registros com sinal instável",
     "label": "Rascunhos offline, idempotência e retomada",
     "input": 1_000_000, "output": 50_000,
     "basis": "IndexedDB, fila de sincronização e testes de quota/falha."},
    {"id": "publicacao-pendencias", "section": "7. Publicação e resolução",
     "label": "Fila de publicação e encerramento de pendências",
     "input": 900_000, "output": 45_000,
     "basis": "Integração com Bot API, reconciliação e permissões de gestor."},
    {"id": "piloto-assistido", "section": "8. Piloto assistido",
     "label": "Cadastro dos ambientes, desempenho e aceite",
     "input": 700_000, "output": 35_000,
     "basis": "Operação assistida, medição em aparelho real e aceite da equipe."},
]

GALLERY = [
    {"file": "docs/mockups/modelo-federado-v1.png",
     "title": "Modelo federado · v1", "subtitle": "Seleção de disciplinas e controles de visualização", "tag": "Produto"},
    {"file": "docs/mockups/mini-app-v2.png",
     "title": "Mockup do Mini App · v2", "subtitle": "Acesso ao modelo federado acima da lista de ambientes", "tag": "Produto"},
    {"file": "docs/mockups/mini-app-v1.png",
     "title": "Mockup do Mini App · v1", "subtitle": "Frentes, ambientes, histórico, registro e pendências", "tag": "Produto"},
    {"file": "artifacts/validation/pdf/ground-ifc-overlay.png",
     "title": "Sobreposição IFC ↔ planta", "subtitle": "Térreo · 53 espaços", "tag": "QA visual"},
    {"file": "artifacts/validation/pdf/ground-apto101-ifc-overlay.png",
     "title": "Apto. 101 · correspondência", "subtitle": "IfcSpace 23 · 23,88 m²", "tag": "Piloto"},
    {"file": "artifacts/validation/pdf/ground-vestiarios-ifc-overlay.png",
     "title": "Vestiários · controle independente", "subtitle": "Resíduo de 0,13 pt", "tag": "Controle"},
    {"file": "artifacts/validation/pdf/CE01-14PE01-ARQ-DE017-R05-page-1.png",
     "title": "Planta do térreo", "subtitle": "CE01-14PE01-ARQ-DE017-R05", "tag": "PDF"},
    {"file": "artifacts/validation/pdf/CE01-14PE01-ARQ-DE018-R05-page-1.png",
     "title": "Planta do 1º pavimento", "subtitle": "CE01-14PE01-ARQ-DE018-R05", "tag": "PDF"},
    {"file": "artifacts/validation/pdf/ground-vestiarios-detail.png",
     "title": "Detalhe dos vestiários", "subtitle": "Recorte 4× para medição manual", "tag": "Detalhe"},
]

ARTIFACT_LABELS = [
    ("CE01-14PE01-ARQ-R05-inspection.json", "Inspeção IFC · Arquitetura"),
    ("CE01-14PE01-ANT-R01-inspection.json", "Inspeção IFC · Antenas"),
    ("CE01-14PE01-TLD-R00-inspection.json", "Inspeção IFC · Telefonia"),
    ("ANT-element-geometry.json", "Geometria dos elementos · ANT"),
    ("TLD-element-geometry.json", "Geometria dos elementos · TLD"),
    ("alignment-evidence.json", "Evidência de alinhamento entre disciplinas"),
    ("registration-ground.json", "Calibração PDF ↔ IFC · térreo"),
    ("registration-review.json", "Revisão de registro e gates"),
    ("pilot-candidate.json", "Ambiente piloto · Apto. 101"),
    ("inventory.json", "Inventário dos PDFs"),
    ("ground-ifc-overlay.png", "Overlay IFC ↔ planta · térreo"),
    ("ground-apto101-ifc-overlay.png", "Overlay do Apto. 101"),
    ("ground-vestiarios-ifc-overlay.png", "Overlay dos vestiários"),
    ("ground-apto101-detail.png", "Recorte do Apto. 101"),
    ("ground-vestiarios-detail.png", "Recorte dos vestiários"),
    ("reproduce/README.md", "Documentação de reprodução"),
    ("reproduce/inspect_pdfs.py", "Script de inspeção dos PDFs"),
    ("reproduce/calibrate_ground.py", "Script de calibração"),
    ("reproduce/validate_registration.py", "Validador de registro reproduzível"),
    ("reproduce/build_pilot.py", "Construtor do recorte 3D"),
    ("reproduce/inspect_hto_ifcs.py", "Script de inspeção dos IFCs"),
    ("reproduce/hto_alignment_evidence.py", "Script de evidência de alinhamento"),
    ("reproduce/hto_geometry_diagnostic.py", "Script de diagnóstico geométrico"),
]


def iso(ts: float | int | str | dt.datetime | None) -> str | None:
    if ts is None:
        return None
    if isinstance(ts, dt.datetime):
        d = ts
    elif isinstance(ts, (int, float)):
        d = dt.datetime.fromtimestamp(ts / 1000 if ts > 10_000_000_000 else ts, tz=dt.timezone.utc)
    else:
        try:
            d = dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(TZ).isoformat()


def parse_iso(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        d = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d


def read_json(rel: str):
    path = ROOT / rel
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def read_text(rel: str) -> str:
    try:
        return (ROOT / rel).read_text(encoding="utf-8")
    except OSError:
        return ""


def fmt_bytes(n: int | float | None) -> str:
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.2f} {unit}" if unit != "B" else f"{n:.0f} B"
        n /= 1024
    return f"{n:.2f} GB"


def cost_of(rate: dict, input_tokens: int, cached_tokens: int, output_tokens: int) -> float:
    noncached = max(int(input_tokens or 0) - int(cached_tokens or 0), 0)
    return (noncached * rate["input"] + int(cached_tokens or 0) * rate["cache_read"] +
            int(output_tokens or 0) * rate["output"]) / 1_000_000


def empty_tokens() -> dict:
    return {"input": 0, "cached": 0, "output": 0, "reasoning": 0, "total": 0}


def add_usage(dest: dict, usage: dict) -> None:
    dest["input"] += int(usage.get("input_tokens", usage.get("input", 0)) or 0)
    dest["cached"] += int(usage.get("cached_input_tokens", usage.get("cache_read", 0)) or 0)
    dest["output"] += int(usage.get("output_tokens", usage.get("output", 0)) or 0)
    dest["reasoning"] += int(usage.get("reasoning_output_tokens", usage.get("reasoning", 0)) or 0)


def finalize_tokens(t: dict) -> dict:
    t["total"] = t["input"] + t["output"]
    return t


# ---------------------------------------------------------------------------
# Roteiro oficial (tasks/plan.md e tasks/todo.md)
# ---------------------------------------------------------------------------

def parse_plan() -> dict:
    text = read_text("tasks/plan.md")
    title = ""
    for line in text.splitlines():
        if line.startswith("# "):
            title = line[2:].strip()
            break
    objective = ""
    m = re.search(r"## Objetivo confirmado\s+(.+?)(?=\n## |\Z)", text, re.S)
    if m:
        objective = re.sub(r"\s+", " ", m.group(1)).strip()
    milestone = ""
    m = re.search(r"## Primeiro marco:[^\n]*\n\s*(.+?)(?=\n## |\Z)", text, re.S)
    if m:
        milestone = re.sub(r"\s+", " ", m.group(1)).strip()
    return {"title": title, "objective": objective, "milestone": milestone}


def parse_todo() -> dict:
    text = read_text("tasks/todo.md")
    sections: list[dict] = []
    current: dict | None = None
    note_parts: list[str] = []
    for line in text.splitlines():
        if line.startswith("## "):
            if current:
                current["note"] = re.sub(r"\s+", " ", " ".join(note_parts)).strip()
                sections.append(current)
            current = {
                "id": line[3:].strip(),
                "title": re.sub(r"^\d+\.\s*", "", line[3:].strip()),
                "tasks": [],
                "verification": "",
                "dependency": "",
                "note": "",
            }
            note_parts = []
            continue
        if current is None:
            continue
        m = re.match(r"\s*- \[(x|X| )\]\s*(.+)", line)
        if m:
            current["tasks"].append({"text": m.group(2).strip(), "done": m.group(1).lower() == "x"})
        elif line.strip().startswith("Verificação:"):
            current["verification"] = line.strip()
        elif line.strip().startswith("Dependência:"):
            current["dependency"] = line.strip()
        elif line.strip():
            note_parts.append(line.strip())
    if current:
        current["note"] = re.sub(r"\s+", " ", " ".join(note_parts)).strip()
        sections.append(current)

    total = sum(len(s["tasks"]) for s in sections)
    done = sum(1 for s in sections for t in s["tasks"] if t["done"])
    for s in sections:
        s["total"] = len(s["tasks"])
        s["done"] = sum(1 for t in s["tasks"] if t["done"])
        s["pct"] = round(100 * s["done"] / s["total"], 1) if s["total"] else 0.0
        s["status"] = "concluido" if s["total"] and s["done"] == s["total"] else ("em_andamento" if s["done"] else "pendente")

    unchecked = [t["text"] for s in sections for t in s["tasks"] if not t["done"]]
    priority = next((s for s in sections if s["id"].lower().startswith("prioridade")), None)
    return {
        "sections": sections,
        "done": done,
        "total": total,
        "pct": round(100 * done / total, 1) if total else 0.0,
        "unchecked": unchecked,
        "priority": priority,
        "updated_at": iso((ROOT / "tasks/todo.md").stat().st_mtime) if (ROOT / "tasks/todo.md").exists() else None,
    }


# ---------------------------------------------------------------------------
# Codex
# ---------------------------------------------------------------------------

def parse_codex_sessions() -> list[dict]:
    now = dt.datetime.now(TZ)
    sessions: list[dict] = []
    paths = sorted(glob.glob(str(CODEX_HOME / "sessions" / "*" / "*" / "*" / "rollout-*.jsonl")))
    root_str = str(ROOT)
    for path in paths[-80:]:
        try:
            raw = Path(path).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if root_str not in raw:
            continue
        meta: dict = {}
        model: str | None = None
        deltas: list[tuple[dt.datetime, str | None, dict]] = []
        users: list[dict] = []
        assistant_msgs: list[dict] = []
        tools: Counter = Counter()
        for line in raw.splitlines():
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            typ = d.get("type")
            payload = d.get("payload", {}) or {}
            ts = parse_iso(d.get("timestamp"))
            if typ == "session_meta":
                meta = payload
            elif typ == "turn_context":
                model = payload.get("model") or model
            elif typ == "event_msg" and payload.get("type") == "token_count":
                usage = (payload.get("info") or {}).get("last_token_usage") or {}
                if usage and ts:
                    deltas.append((ts, model, usage))
            elif typ == "response_item":
                ptype = payload.get("type")
                if ptype == "message" and payload.get("role") == "user":
                    txt = "".join(
                        c.get("text", "") for c in payload.get("content", [])
                        if c.get("type") in ("input_text", "text")
                    ).strip()
                    if txt and not txt.startswith("<environment_context>") and ts:
                        users.append({"time": iso(ts), "text": re.sub(r"\s+", " ", txt)[:300]})
                elif ptype == "message" and payload.get("role") == "assistant":
                    txt = "".join(
                        c.get("text", "") for c in payload.get("content", [])
                        if c.get("type") in ("output_text", "text")
                    ).strip()
                    if txt and ts:
                        assistant_msgs.append({"time": iso(ts), "text": re.sub(r"\s+", " ", txt)[:600]})
                elif ptype == "function_call":
                    tools[payload.get("name", "?")] += 1
        if not meta or not deltas:
            continue
        by_model: dict[str, dict] = {}
        for ts, m, u in deltas:
            key = m or meta.get("model") or "desconhecido"
            bucket = by_model.setdefault(key, empty_tokens())
            add_usage(bucket, u)
        cost = 0.0
        for m, t in by_model.items():
            finalize_tokens(t)
            rate = PRICE_BY_ID.get(m)
            if rate:
                cost += cost_of(rate, t["input"], t["cached"], t["output"])
        totals = empty_tokens()
        for t in by_model.values():
            for k in ("input", "cached", "output", "reasoning"):
                totals[k] += t[k]
        finalize_tokens(totals)

        source = meta.get("source")
        sub = {}
        if isinstance(source, dict):
            sub = ((source.get("subagent") or {}).get("thread_spawn") or {})
        nickname = sub.get("agent_nickname")
        agent_path = sub.get("agent_path")
        kind = "subagent" if sub else "main"
        first_user = users[0]["text"] if users else ""
        if kind == "subagent":
            title = f"Subagente {nickname or 'Codex'} · {(agent_path or 'tarefa').split('/')[-1]}"
        elif (meta.get("id") or "").startswith("01a1acd2"):
            title = "Descoberta e evidências do piloto"
        elif (meta.get("id") or "").startswith("01a1acfc"):
            title = "Retomada, validação e mockup do app"
        else:
            title = first_user[:90] if first_user else "Sessão Codex"
        started = parse_iso(meta.get("timestamp")) or deltas[0][0]
        last = max(d[0] for d in deltas)
        active = (now - last).total_seconds() < 240
        sessions.append({
            "id": meta.get("id") or Path(path).stem,
            "short": (meta.get("id") or Path(path).stem)[:8],
            "source": "codex",
            "kind": kind,
            "agent": "Codex",
            "nickname": nickname,
            "agent_path": agent_path,
            "parent_id": sub.get("parent_thread_id"),
            "title": title,
            "models": list(by_model.keys()),
            "model_labels": [MODEL_LABELS.get(m, m) for m in by_model.keys()],
            "model_tokens": by_model,
            "tokens": totals,
            "cost_usd": round(cost, 6),
            "started_at": iso(started),
            "last_activity_at": iso(last),
            "duration_s": max(int((last - started).total_seconds()), 0),
            "active": active,
            "turns": len(deltas),
            "tools": dict(tools),
            "user_messages": users[:12],
            "assistant_messages": assistant_msgs[-4:],
            "source_file": path,
            "_deltas": deltas,
            "_activity_points": [iso(ts) for ts, _, _ in deltas],
        })
    sessions.sort(key=lambda s: s["started_at"] or "")
    return sessions


# ---------------------------------------------------------------------------
# OpenCode
# ---------------------------------------------------------------------------

def parse_opencode_sessions() -> list[dict]:
    if not OPENCODE_DB.exists():
        return []
    now = dt.datetime.now(TZ)
    sessions: list[dict] = []
    try:
        con = sqlite3.connect(f"file:{OPENCODE_DB}?mode=ro", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """SELECT id, title, time_created, time_updated, model, tokens_input, tokens_output,
                      tokens_reasoning, tokens_cache_read, tokens_cache_write, cost
               FROM session_v2 WHERE directory = ? OR directory = ? ORDER BY time_created""",
            (str(ROOT), str(ROOT) + "/"),
        ).fetchall()
        for row in rows:
            try:
                model = json.loads(row["model"] or "{}")
            except json.JSONDecodeError:
                model = {}
            model_id = model.get("id") or "desconhecido"
            cache_read = row["tokens_cache_read"] or 0
            # No OpenCode, tokens_input é a entrada não cacheada; cache_read é o prefixo cacheado.
            # Normalizamos para "input total" e "cached" como subconjunto, igual ao Codex.
            input_total = (row["tokens_input"] or 0) + cache_read
            billed_output = (row["tokens_output"] or 0) + (row["tokens_reasoning"] or 0)
            t = {
                "input": input_total,
                "cached": cache_read,
                "output": billed_output,
                "reasoning": row["tokens_reasoning"] or 0,
                "total": input_total + billed_output,
            }
            rate = PRICE_BY_ID.get(model_id)
            cost = cost_of(rate, t["input"], t["cached"], t["output"]) if rate else 0.0
            try:
                parts = con.execute(
                    """SELECT type, data FROM session_part WHERE session_id = ?
                       ORDER BY time_created, ordinal""", (row["id"],)
                ).fetchall()
            except sqlite3.Error:
                parts = []
            users = []
            for p in parts[:20]:
                if p["type"] == "text":
                    try:
                        data = json.loads(p["data"])
                    except json.JSONDecodeError:
                        continue
                    if data.get("role") == "user" and data.get("text"):
                        users.append({"time": iso(row["time_created"]), "text": data["text"][:300]})
                        break
            last = row["time_updated"] or row["time_created"]
            active = (now - dt.datetime.fromtimestamp(last / 1000, tz=dt.timezone.utc)).total_seconds() < 240
            title = row["title"] or "Sessão OpenCode"
            try:
                points = [iso(r[0]) for r in con.execute(
                    "SELECT time_created FROM session_message WHERE session_id = ? ORDER BY seq",
                    (row["id"],)
                ).fetchall() if r[0]]
            except sqlite3.Error:
                points = []
            sessions.append({
                "id": row["id"],
                "short": row["id"][-8:],
                "source": "opencode",
                "kind": "main",
                "agent": "OpenCode",
                "nickname": None,
                "agent_path": None,
                "parent_id": None,
                "title": title,
                "models": [model_id],
                "model_labels": [MODEL_LABELS.get(model_id, model_id)],
                "model_tokens": {model_id: dict(t)},
                "tokens": t,
                "cost_usd": round(cost, 6),
                "recorded_cost_usd": round(row["cost"] or 0.0, 6),
                "started_at": iso(row["time_created"]),
                "last_activity_at": iso(last),
                "duration_s": max(int((last - row["time_created"]) / 1000), 0),
                "active": active,
                "turns": None,
                "tools": {},
                "user_messages": users,
                "assistant_messages": [],
                "source_file": str(OPENCODE_DB),
                "_activity_points": points,
            })
        con.close()
    except sqlite3.Error:
        return sessions
    sessions.sort(key=lambda s: s["started_at"] or "")
    return sessions


# ---------------------------------------------------------------------------
# Tarefas medidas
# ---------------------------------------------------------------------------

def tokens_from_deltas(deltas: list[tuple[dt.datetime, str | None, dict]], start=None, end=None) -> tuple[dict, dict, float]:
    by_model: dict[str, dict] = {}
    for ts, model, usage in deltas:
        if start and ts < start:
            continue
        if end and ts >= end:
            continue
        key = model or "desconhecido"
        bucket = by_model.setdefault(key, empty_tokens())
        add_usage(bucket, usage)
    totals = empty_tokens()
    cost = 0.0
    for m, t in by_model.items():
        finalize_tokens(t)
        totals["input"] += t["input"]
        totals["cached"] += t["cached"]
        totals["output"] += t["output"]
        totals["reasoning"] += t["reasoning"]
        rate = PRICE_BY_ID.get(m)
        if rate:
            cost += cost_of(rate, t["input"], t["cached"], t["output"])
    finalize_tokens(totals)
    return totals, by_model, cost


def build_measured_tasks(codex: list[dict], opencode: list[dict], checklist: dict) -> list[dict]:
    tasks: list[dict] = []
    parent_id = "01a1acd2-f7de-7051-89c1-7fcfbc51b3f5"
    cutoff = parse_iso("2026-11-05T18:15:36Z")
    parent = next((s for s in codex if s["id"] == parent_id), None)
    used_codex: set[str] = set()
    used_opencode: set[str] = set()

    if parent:
        used_codex.add(parent["id"])
        deltas = parent["_deltas"]
        seg_a_start = min(d[0] for d in deltas)
        seg_a_tokens, seg_a_models, seg_a_cost = tokens_from_deltas(deltas, end=cutoff)
        seg_b_tokens, seg_b_models, seg_b_cost = tokens_from_deltas(deltas, start=cutoff)
        if seg_a_tokens["total"]:
            tasks.append({
                "id": "descoberta-plano",
                "label": "Descoberta, requisitos e plano",
                "section": "1. Diagnóstico dos arquivos",
                "status": "concluida",
                "measured": True,
                "models": list(seg_a_models.keys()),
                "model_labels": [MODEL_LABELS.get(m, m) for m in seg_a_models.keys()],
                "tokens": seg_a_tokens,
                "cost_usd": round(seg_a_cost, 6),
                "started_at": iso(seg_a_start),
                "ended_at": parent["started_at"] if parent["started_at"] else None,
                "duration_s": int((cutoff - seg_a_start).total_seconds()),
                "evidence": ["tasks/plan.md"],
                "notes": "Conversa inicial, requisitos do Mini App, escolha de modelos e plano de execução.",
                "session_refs": [parent["id"]],
            })
        if seg_b_tokens["total"]:
            tasks.append({
                "id": "consolidacao-evidencias",
                "label": "Correspondência, registro e evidências",
                "section": "1. Diagnóstico dos arquivos",
                "status": "concluida",
                "measured": True,
                "models": list(seg_b_models.keys()),
                "model_labels": [MODEL_LABELS.get(m, m) for m in seg_b_models.keys()],
                "tokens": seg_b_tokens,
                "cost_usd": round(seg_b_cost, 6),
                "started_at": iso(cutoff),
                "ended_at": parent["last_activity_at"],
                "duration_s": max(int((parse_iso(parent["last_activity_at"]) - cutoff).total_seconds()), 0) if parent["last_activity_at"] else None,
                "evidence": [
                    "artifacts/validation/ifc/alignment-evidence.json",
                    "artifacts/validation/pdf/registration-ground.json",
                    "artifacts/validation/pdf/reproduce/README.md",
                ],
                "notes": "Orquestração dos subagentes, consolidação da correspondência, calibração e scripts reproduzíveis.",
                "session_refs": [parent["id"]],
            })

    for s in codex:
        if s["id"] in used_codex:
            continue
        used_codex.add(s["id"])
        label = s["title"]
        if s["kind"] == "subagent":
            path = (s["agent_path"] or "").lower()
            names = {
                "inspect_pdfs": "Inventário de PDFs e prévias",
                "inspect_ifcs": "Inspeção dos modelos IFC",
                "validacao_geometrica": "Validação geométrica e registro",
                "recorte_piloto": "Recorte 3D do ambiente piloto",
                "controles_alinhamento": "Controles independentes de alinhamento",
            }
            label = next((v for k, v in names.items() if k in path), f"Subagente · {(s['agent_path'] or 'tarefa').split('/')[-1]}")
            if s["nickname"]:
                label += f" · {s['nickname']}"
        elif s["id"].startswith("01a1acfc"):
            label = "Retomada, validação e mockup do app"
        tasks.append({
            "id": f"codex-{s['short']}",
            "label": label,
            "section": "1. Diagnóstico dos arquivos",
            "status": "em_andamento" if s["active"] else "concluida",
            "measured": True,
            "models": s["models"],
            "model_labels": s["model_labels"],
            "tokens": s["tokens"],
            "cost_usd": s["cost_usd"],
            "started_at": s["started_at"],
            "ended_at": s["last_activity_at"],
            "duration_s": s["duration_s"],
            "evidence": ["artifacts/validation/ifc/", "artifacts/validation/pdf/"] if s["kind"] == "subagent" else ["tasks/todo.md"],
            "notes": (s["assistant_messages"][-1]["text"][:220] + "…") if s["assistant_messages"] else "",
            "session_refs": [s["id"]],
        })

    for s in opencode:
        used_opencode.add(s["id"])
        label = "Painel de acompanhamento e tokens" if "painel" in (s["title"] or "").lower() else s["title"]
        tasks.append({
            "id": f"opencode-{s['short']}",
            "label": label,
            "section": "Entrega",
            "status": "em_andamento" if s["active"] else "concluida",
            "measured": True,
            "models": s["models"],
            "model_labels": s["model_labels"],
            "tokens": s["tokens"],
            "cost_usd": s["cost_usd"],
            "started_at": s["started_at"],
            "ended_at": s["last_activity_at"],
            "duration_s": s["duration_s"],
            "evidence": ["dashboard/index.html", "dashboard/serve.py"],
            "notes": "Painel HTML com acompanhamento do roteiro, evidências e custos de API.",
            "session_refs": [s["id"]],
        })

    tasks.sort(key=lambda t: t["started_at"] or "")
    return tasks


# ---------------------------------------------------------------------------
# Documentos, validação e evidências
# ---------------------------------------------------------------------------

def build_documents() -> dict:
    ifc = []
    for name, rel in [
        ("ARQ-R05 · Arquitetura", "artifacts/validation/ifc/CE01-14PE01-ARQ-R05-inspection.json"),
        ("ANT-R01 · Antenas", "artifacts/validation/ifc/CE01-14PE01-ANT-R01-inspection.json"),
        ("TLD-R00 · Telefonia", "artifacts/validation/ifc/CE01-14PE01-TLD-R00-inspection.json"),
    ]:
        d = read_json(rel)
        if not d:
            continue
        storeys = [s.get("name") for s in d.get("spatial", []) if s.get("type") == "IfcBuildingStorey"]
        top_elements = sorted((d.get("element_counts") or {}).items(), key=lambda kv: kv[1], reverse=True)[:5]
        ifc.append({
            "label": name,
            "file": d.get("file"),
            "bytes": d.get("bytes"),
            "schema": d.get("schema"),
            "entities": d.get("entities_count"),
            "products": d.get("products_count"),
            "spaces": len(d.get("spaces") or []),
            "storeys": storeys,
            "top_elements": [{"type": k, "count": v} for k, v in top_elements],
            "placements": len(d.get("element_placements") or []),
            "elapsed_s": round(d.get("elapsed_s") or 0, 3),
            "inspection": rel,
        })
    pdf = []
    inv = read_json("artifacts/validation/pdf/inventory.json") or {}
    labels = {
        "CE01-14PE01-ARQ-DE017-R05.pdf": ("Térreo · DE017 R05", 44),
        "CE01-14PE01-ARQ-DE018-R05.pdf": ("1º Pavimento · DE018 R05", 43),
    }
    for doc in inv.get("documents", []):
        base = Path(doc.get("path", "")).name
        label, candidates = labels.get(base, (base, None))
        page = (doc.get("pages") or [{}])[0]
        pdf.append({
            "label": label,
            "file": base,
            "path": doc.get("path"),
            "bytes": doc.get("bytes"),
            "sha256": doc.get("sha256"),
            "pages": doc.get("page_count"),
            "width_in": round((page.get("width_points") or 0) / 72, 2),
            "height_in": round((page.get("height_points") or 0) / 72, 2),
            "spans": len(page.get("text_spans") or []),
            "label_candidates": candidates,
            "preview": page.get("preview"),
            "text": page.get("preview", "").replace(".png", ".txt") if page.get("preview") else None,
        })
    return {"ifc": ifc, "pdf": pdf}


def build_validation(documents: dict) -> dict:
    align = read_json("artifacts/validation/ifc/alignment-evidence.json") or {}
    reg = read_json("artifacts/validation/pdf/registration-ground.json") or {}
    review = read_json("artifacts/validation/ifc/registration-review.json") or {}
    distances = [m.get("distance_panel_face_midpoint_to_space_boundary_m", 0) for m in align.get("all_matches", [])]
    arq = next((d for d in documents.get("ifc", []) if d["label"].startswith("ARQ")), {})
    generic = 0
    arq_insp = read_json("artifacts/validation/ifc/CE01-14PE01-ARQ-R05-inspection.json") or {}
    for space in arq_insp.get("spaces", []):
        name = (space.get("name") or "").strip()
        long_name = (space.get("long_name") or "").strip()
        if name in ("Ambiente", "") or long_name in ("Ambiente", ""):
            generic += 1
    scale_error = None
    if reg.get("scale_pt_per_m") and reg.get("expected_scale_1_to_125_pt_per_m"):
        scale_error = (reg["scale_pt_per_m"] / reg["expected_scale_1_to_125_pt_per_m"] - 1) * 100
    pilot = reg.get("pilot_room") or {}
    audit = review.get("ant_boundary_audit") or {}
    tld = review.get("tld_diagnostic") or {}
    pdf_review = review.get("pdf_apto101") or {}
    floor = review.get("floor_metadata") or {}
    gates = review.get("gates") or {}
    pending = review.get("pending_gates") or []
    gate_labels = {
        "human_pdf_room_identity_and_boundary_approval": "Aprovação humana do vínculo e do limite PDF ↔ ambiente",
        "distributed_semantic_ant_xy_controls_including_held_out_point": "Controles XY semânticos distribuídos (ANT), com ponto não usado no ajuste",
        "tld_independent_xy_control": "Controle XY independente para TLD",
        "tld_independent_z_control": "Controle Z independente para TLD",
        "physical_z_controls_and_first_floor_difference_resolution": "Controles físicos de Z e resolução dos 35 mm do 1º pavimento",
    }
    return {
        "alignment": {
            "matches": align.get("matches_count") or len(distances),
            "separated": len(align.get("spatially_separated_matches", [])),
            "tolerance_m": align.get("test_tolerance_m"),
            "max_distance_m": max(distances) if distances else None,
            "mean_distance_m": (sum(distances) / len(distances)) if distances else None,
            "floor_delta_m": floor.get("first_floor_arq_minus_ant_m") or 0.035,
            "formal_map_conversion": bool(align.get("formal_map_conversion_present")),
            "interpretation": align.get("interpretation", ""),
            "status": review.get("status", "not_validated"),
            "status_label": "Candidato · não validado para publicação",
            "publish_as_validated": bool(review.get("publish_as_validated_federation")),
            "ant_audit": {
                "ground_spaces": audit.get("ground_space_count"),
                "panels": audit.get("inspection_panel_count"),
                "geometry_panels": audit.get("geometry_panel_count"),
                "eligible": audit.get("eligible_panel_count"),
                "hits": audit.get("hit_panel_count"),
                "misses": audit.get("miss_panel_count"),
                "tolerance_m": audit.get("tolerance_m"),
            },
            "tld": {
                "status": tld.get("status"),
                "candidates": tld.get("existing_candidate_geometry_count"),
                "bbox_overlaps": tld.get("candidate_bbox_overlap_count"),
                "independent_xy": tld.get("independent_xy_control_count"),
                "independent_z": tld.get("independent_z_control_count"),
            },
        },
        "registration": {
            "scale_pt_per_m": reg.get("scale_pt_per_m"),
            "expected_scale_pt_per_m": reg.get("expected_scale_1_to_125_pt_per_m"),
            "scale_error_pct": scale_error,
            "calibration_max_residual_pt": max((c.get("residual_pt", 0) for c in reg.get("calibration_points", [])), default=None),
            "control_residual_pt": (reg.get("independent_control") or {}).get("residual_pt"),
            "control_residual_m": (pdf_review.get("held_out_control") or {}).get("residual_in_model_m"),
            "uncertainty_pt": reg.get("measurement_uncertainty_pt"),
            "area_difference_m2": pdf_review.get("area_difference_m2"),
            "pilot_label": pilot.get("pdf_label"),
            "pilot_ifc_name": pilot.get("ifc_name"),
            "pilot_guid": pilot.get("ifc_guid"),
            "area_ifc_m2": pilot.get("area_ifc_m2"),
            "area_pdf_m2": pilot.get("area_pdf_m2"),
            "status": pdf_review.get("status", "candidate"),
            "status_label": "Calibração candidata · revisão humana pendente",
            "method": reg.get("method", ""),
            "note": reg.get("status", ""),
            "limitation": pdf_review.get("limitation", ""),
        },
        "governance": {
            "status": review.get("status", "not_validated"),
            "publish_blocked": not bool(review.get("publish_as_validated_federation")),
            "gates_total": len(gates),
            "gates_passed": sum(1 for v in gates.values() if v is True),
            "pending_gates": [gate_labels.get(g, g) for g in pending],
            "roundtrip_error_m": (review.get("candidate_transform") or {}).get("roundtrip_max_error_m"),
            "roundtrip_points": (review.get("candidate_transform") or {}).get("roundtrip_point_count"),
            "transform_status": (review.get("candidate_transform") or {}).get("status"),
            "transform_limitation": (review.get("candidate_transform") or {}).get("limitation"),
        },
        "quality": {
            "arq_spaces": arq.get("spaces") or 0,
            "generic_spaces": generic,
            "generic_pct": round(100 * generic / arq["spaces"], 1) if arq.get("spaces") else None,
            "ground_spaces": audit.get("ground_space_count"),
        },
    }


def scan_artifacts() -> dict:
    items = []
    for path in sorted((ROOT / "artifacts").rglob("*")):
        if not path.is_file():
            continue
        if "__pycache__" in path.parts or path.suffix.lower() in (".pyc", ".pyo"):
            continue
        rel = str(path.relative_to(ROOT))
        ext = path.suffix.lower().lstrip(".") or "arquivo"
        label = None
        for needle, friendly in ARTIFACT_LABELS:
            if rel.endswith(needle):
                label = friendly
                break
        items.append({
            "path": rel,
            "name": path.name,
            "bytes": path.stat().st_size,
            "mtime": iso(path.stat().st_mtime),
            "ext": ext,
            "label": label or path.name,
        })
    counts = Counter(i["ext"] for i in items)
    return {
        "count": len(items),
        "bytes": sum(i["bytes"] for i in items),
        "by_ext": dict(counts),
        "items": items,
    }


def scan_docs() -> list[dict]:
    docs = []
    labels = {
        "docs/validacao-hto.md": "Documento de validação HTO",
        "docs/mockups/README.md": "README dos mockups",
        "docs/mockups/prompt-mini-app-v1.txt": "Prompt do mockup v1",
        "docs/mockups/prompt-mini-app-v2.txt": "Prompt do mockup v2",
        "tasks/plan.md": "Plano do piloto",
        "tasks/todo.md": "Checklist de execução",
    }
    candidates = set((ROOT / rel) for rel in labels)
    for path in (ROOT / "docs").rglob("*") if (ROOT / "docs").exists() else []:
        if path.is_file() and path.suffix.lower() in (".md", ".txt"):
            candidates.add(path)
    for path in sorted(candidates):
        if not path.exists():
            continue
        rel = str(path.relative_to(ROOT))
        docs.append({
            "path": rel,
            "label": labels.get(rel, path.name),
            "bytes": path.stat().st_size,
            "mtime": iso(path.stat().st_mtime),
        })
    docs.sort(key=lambda d: d["mtime"] or "", reverse=True)
    return docs


def build_activity(codex: list[dict], opencode: list[dict], artifacts: dict, docs: list[dict]) -> list[dict]:
    events: list[dict] = []
    now = dt.datetime.now(TZ)
    for item in artifacts["items"]:
        when = parse_iso(item["mtime"])
        if not when or (now - when).days > 3:
            continue
        if item["ext"] not in ("json", "png", "py", "md", "glb", "gltf", "obj"):
            continue
        events.append({
            "time": item["mtime"],
            "kind": "artifact",
            "title": item["label"],
            "detail": f"{fmt_bytes(item['bytes'])} · {item['path']}",
            "path": item["path"],
        })
    for doc in docs:
        events.append({
            "time": doc["mtime"],
            "kind": "doc",
            "title": doc["label"],
            "detail": f"{fmt_bytes(doc['bytes'])} · {doc['path']}",
            "path": doc["path"],
        })
    for s in codex + opencode:
        if s.get("started_at"):
            events.append({
                "time": s["started_at"],
                "kind": "session",
                "title": f"{s['agent']} iniciou · {s['title'][:70]}",
                "detail": ", ".join(s.get("model_labels", [])) or "modelo não informado",
                "path": None,
            })
        for msg in s.get("user_messages", []):
            events.append({
                "time": msg["time"],
                "kind": "user",
                "title": f"Solicitação · {msg['text'][:80]}",
                "detail": s["agent"],
                "path": None,
            })
    events.sort(key=lambda e: e["time"], reverse=True)
    seen = set()
    out = []
    for e in events:
        key = (e["time"], e["title"])
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out[:18]


def build_sessions_payload(codex: list[dict], opencode: list[dict]) -> dict:
    def clean(s: dict) -> dict:
        s = dict(s)
        s.pop("_deltas", None)
        s.pop("_activity_points", None)
        return s

    def clusters(points: list[str], start: dt.datetime | None, end: dt.datetime | None) -> list[tuple[dt.datetime, dt.datetime]]:
        parsed = sorted(p for p in (parse_iso(x) for x in points) if p)
        if not parsed:
            return [(start, end)] if start and end else []
        out: list[tuple[dt.datetime, dt.datetime]] = []
        cluster_start = prev = parsed[0]
        for point in parsed[1:]:
            if (point - prev).total_seconds() > 600:
                out.append((cluster_start, prev))
                cluster_start = point
            prev = point
        out.append((cluster_start, prev))
        return [(a, max(b, a + dt.timedelta(seconds=30))) for a, b in out]

    intervals_by_id: dict[str, list[tuple[dt.datetime, dt.datetime]]] = {}
    raw_intervals: list[tuple[dt.datetime, dt.datetime]] = []
    for s in codex + opencode:
        start, end = parse_iso(s["started_at"]), parse_iso(s["last_activity_at"])
        intervals = clusters(s.get("_activity_points", []), start, end)
        intervals_by_id[s["id"]] = intervals
        raw_intervals.extend(intervals)
    raw_intervals.sort()
    merged: list[tuple[dt.datetime, dt.datetime]] = []
    for start, end in raw_intervals:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    active_minutes = int(sum((end - start).total_seconds() for start, end in merged) / 60)

    all_sessions = []
    for s in codex + opencode:
        item = clean(s)
        item["activity_intervals"] = [[iso(a), iso(b)] for a, b in intervals_by_id.get(s["id"], [])]
        all_sessions.append(item)
    all_sessions.sort(key=lambda s: s["started_at"] or "")

    totals = empty_tokens()
    cost = 0.0
    for s in all_sessions:
        for k in ("input", "cached", "output", "reasoning"):
            totals[k] += s["tokens"][k]
        cost += s["cost_usd"]
    finalize_tokens(totals)
    timeline = []
    for s in all_sessions:
        timeline.append({
            "id": s["id"],
            "label": (s["nickname"] or s["agent"]) + (" · " + (s["agent_path"] or "").split("/")[-1] if s["kind"] == "subagent" else ""),
            "agent": s["agent"],
            "kind": s["kind"],
            "start": s["started_at"],
            "end": s["last_activity_at"],
            "models": s["model_labels"],
            "cost_usd": s["cost_usd"],
            "tokens_total": s["tokens"]["total"],
            "active": s["active"],
            "intervals": s.get("activity_intervals", []),
        })
    return {
        "codex": [clean(s) for s in codex],
        "opencode": [clean(s) for s in opencode],
        "all": all_sessions,
        "totals": {**totals, "cost_usd": round(cost, 6), "active_minutes": active_minutes},
        "timeline": timeline,
        "active_minutes": active_minutes,
        "active_intervals": [[iso(start), iso(end)] for start, end in merged],
    }


def build_totals(documents: dict, artifacts: dict, checklist: dict, sessions: dict, tasks_measured: list[dict]) -> dict:
    tokens = sessions["totals"]
    cache_hit = (tokens["cached"] / tokens["input"] * 100) if tokens["input"] else 0
    active_minutes = sessions.get("active_minutes", 0)
    return {
        "documents": len(documents.get("ifc", [])) + len(documents.get("pdf", [])),
        "documents_bytes": sum(d.get("bytes") or 0 for d in documents.get("ifc", [])) + sum(d.get("bytes") or 0 for d in documents.get("pdf", [])),
        "artifacts": artifacts["count"],
        "artifacts_bytes": artifacts["bytes"],
        "checklist": {"done": checklist["done"], "total": checklist["total"], "pct": checklist["pct"]},
        "evidence_extra": 1,
        "sessions": len(sessions["all"]),
        "measured_tokens": tokens["total"],
        "measured_tokens_input": tokens["input"],
        "measured_tokens_cached": tokens["cached"],
        "measured_tokens_output": tokens["output"],
        "measured_cost_usd": sessions["totals"]["cost_usd"],
        "cache_hit_pct": round(cache_hit, 2),
        "duration_min": active_minutes,
        "cost_per_hour_usd": round(sessions["totals"]["cost_usd"] / (active_minutes / 60), 4) if active_minutes else None,
    }


def collect() -> dict:
    plan = parse_plan()
    checklist = parse_todo()
    codex = parse_codex_sessions()
    opencode = parse_opencode_sessions()
    documents = build_documents()
    validation = build_validation(documents)
    artifacts = scan_artifacts()
    docs = scan_docs()
    measured = build_measured_tasks(codex, opencode, checklist)
    sessions = build_sessions_payload(codex, opencode)
    totals = build_totals(documents, artifacts, checklist, sessions, measured)

    estimates_path = DASHBOARD / "estimates.json"
    try:
        planned = json.loads(estimates_path.read_text(encoding="utf-8"))
        if not isinstance(planned, list):
            planned = DEFAULT_ESTIMATES
    except (OSError, json.JSONDecodeError):
        planned = DEFAULT_ESTIMATES
    for p in planned:
        p.setdefault("status", "planejada")
        p.setdefault("basis", "")

    priority = checklist.get("priority")
    priority_done = bool(priority and priority["total"] and priority["done"] == priority["total"])
    priority_note = priority.get("note", "") if priority else ""
    focus = (re.split(r"\s+Escopo desta proposta", priority_note)[0].strip() if priority_note else None) or (checklist["unchecked"][0] if checklist["unchecked"] else "Projeto concluído")
    next_steps = checklist["unchecked"][:4]
    plan_obj = plan.get("objective") or plan.get("milestone") or "Piloto de registro fotográfico por ambiente com navegação 2D → 3D."
    if priority:
        short = re.sub(r"^Prioridade atual\s*—\s*", "", priority["title"])
        short = re.sub(r"\s*\(\d{4}-\d{2}-\d{2}\)\s*$", "", short).strip()
        short = short[:1].upper() + short[1:] if short else short
        phase_label = f"{short} · {'concluído' if priority_done else 'em andamento'}"
    else:
        phase_label = checklist["sections"][0]["title"] if checklist["sections"] else "Diagnóstico"
    active_sessions = [s for s in sessions["all"] if s["active"]]
    latest_msg = ""
    for s in sorted(codex, key=lambda x: x["last_activity_at"] or "", reverse=True):
        if s["assistant_messages"]:
            latest_msg = s["assistant_messages"][-1]["text"]
            break
    pilot_files = [
        {"path": str(p.relative_to(ROOT)), "bytes": p.stat().st_size, "mtime": iso(p.stat().st_mtime)}
        for p in sorted((ROOT / "artifacts/validation/pilot").glob("*")) if p.is_file()
    ] if (ROOT / "artifacts/validation/pilot").exists() else []
    totals["gates_pending"] = len(validation["governance"]["pending_gates"])
    totals["pilot_files"] = len(pilot_files)
    totals["pilot_bytes"] = sum(p["bytes"] for p in pilot_files)

    notes = [
        "Os custos usam preços de tabela por 1M tokens do catálogo OpenCode em 05/11/2026. Não representam necessariamente a cobrança da assinatura.",
        "Tokens do Codex vêm dos rollouts locais (~/.codex/sessions). Tokens do OpenCode vêm do banco local de sessões.",
        "No Codex o raciocínio já está incluído nos tokens de saída; no OpenCode ele é somado à saída para fins de custo. O cache é contado como subconjunto da entrada.",
        "A sessão que constrói este painel também é medida e aparece como 'Painel de acompanhamento e tokens'; ela entra no total medido, mas não nas tarefas planejadas.",
        "O GPT-6.1 Terra usa a tarifa de referência da família Terra; não havia entrada exata desse modelo no catálogo no momento da coleta.",
        "A correspondência PDF ↔ IFC é candidata e não tem validade topográfica. O primeiro pavimento exige calibração própria.",
        "Dos 103 espaços do IFC de arquitetura, 102 têm nome genérico 'Ambiente'; a identidade deve ser vinculada por geometria e posição.",
        "O checklist de tasks/todo.md pode estar defasado em relação às evidências: a correspondência geométrica já tem artefatos, mas a revisão/documentação final segue pendente.",
        "A federação está bloqueada para publicação: 5 gates técnicos seguem abertos no registration-review.json.",
        "A prioridade atual do projeto é o mockup do Mini App; a integração IFC ↔ planta 2D está pausada a pedido do usuário, preservando o diagnóstico existente.",
    ]

    return {
        "generated_at": iso(dt.datetime.now(dt.timezone.utc)),
        "generated_at_local": iso(dt.datetime.now(dt.timezone.utc)),
        "project": {
            "name": "Piloto HTO",
            "title": plan.get("title") or "Mini App Telegram — piloto HTO",
            "code": "HTO",
            "objective": plan_obj,
            "milestone": plan.get("milestone", ""),
            "root": str(ROOT),
            "focus": focus,
            "next_steps": next_steps,
            "latest_agent_message": latest_msg,
            "status": "em_desenvolvimento",
            "status_label": "Desenvolvimento em andamento · integração IFC pausada",
            "phase_label": phase_label,
            "priority": priority,
            "priority_done": priority_done,
            "active_agents": len(active_sessions),
            "plan_updated_at": iso((ROOT / "tasks/plan.md").stat().st_mtime) if (ROOT / "tasks/plan.md").exists() else None,
        },
        "totals": totals,
        "checklist": checklist,
        "sessions": sessions,
        "tasks_measured": measured,
        "tasks_planned": planned,
        "documents": documents,
        "docs": docs,
        "validation": validation,
        "pilot": {"files": pilot_files, "status": "gerado" if pilot_files else "pendente"},
        "artifacts": artifacts,
        "gallery": [g for g in GALLERY if (ROOT / g["file"]).exists()],
        "activity": build_activity(codex, opencode, artifacts, docs),
        "pricing": PRICING,
        "notes": notes,
        "meta": {
            "data_sources": [
                "tasks/plan.md", "tasks/todo.md", "docs/validacao-hto.md",
                "artifacts/validation/**", "OpenCode session_v2", "Codex rollout JSONL",
            ],
            "collector": "dashboard/collect.py",
            "pricing_date": "2026-11-05",
        },
    }


if __name__ == "__main__":
    print(json.dumps(collect(), ensure_ascii=False, indent=2))
