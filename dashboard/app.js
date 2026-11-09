/* ============================================================
   Painel HTO — cliente
   Dados: GET /api/data (coletados por dashboard/collect.py)
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const REFRESH_MS = 15000;
  const TZ = 'America/Sao_Paulo';

  const state = {
    data: null,
    modelId: localStorage.getItem('hto.model') || 'gpt-6.1-sol',
    cachePct: Number(localStorage.getItem('hto.cache') ?? 80),
    fx: Number(localStorage.getItem('hto.fx') ?? 5.42),
    budget: Number(localStorage.getItem('hto.budget') ?? 25),
    overrides: readJSON('hto.overrides', {}),
    countdown: REFRESH_MS / 1000,
    loading: false,
    paused: false,
    galleryIndex: 0,
    roadmapRendered: false,
  };

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  // ------------------------------------------------------------
  // Formatação
  // ------------------------------------------------------------
  const intFmt = new Intl.NumberFormat('pt-BR');
  const compactFmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 2 });
  const pctFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

  function fmtInt(n) { return n == null || Number.isNaN(n) ? '—' : intFmt.format(Math.round(n)); }
  function fmtCompact(n) { return n == null || Number.isNaN(n) ? '—' : compactFmt.format(n); }
  function fmtPct(n, digits = 1) {
    if (n == null || Number.isNaN(n)) return '—';
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n)}%`;
  }
  function fmtUsd(n, digits) {
    if (n == null || Number.isNaN(n)) return '—';
    const d = digits ?? (Math.abs(n) < 0.01 ? 5 : Math.abs(n) < 1 ? 4 : 2);
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d,
    }).format(n);
  }
  function fmtBrl(n, digits = 2) {
    if (n == null || Number.isNaN(n)) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: 'BRL', minimumFractionDigits: digits, maximumFractionDigits: digits,
    }).format(n * state.fx);
  }
  function fmtBytes(n) {
    if (n == null) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let v = Number(n), i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(v)} ${units[i]}`;
  }
  function fmtSci(n) {
    if (n == null || Number.isNaN(n)) return '—';
    if (n === 0) return '0 m';
    return `${n.toExponential(2).replace('.', ',')} m`;
  }
  function fmtMeters(n) {
    if (n == null) return '—';
    return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(n)} m`;
  }
  function fmtPt(n) {
    if (n == null) return '—';
    return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n)} pt`;
  }
  function fmtDuration(seconds) {
    if (seconds == null) return '—';
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}min`;
  }
  function fmtDate(iso, withTime = true) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      ...(withTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : {}),
      timeZone: TZ,
    }).format(d);
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d);
  }
  function timeAgo(iso) {
    if (!iso) return '—';
    const d = new Date(iso).getTime();
    if (Number.isNaN(d)) return '—';
    const diff = Math.max(0, Date.now() - d);
    if (diff < 60000) return 'agora';
    if (diff < 3600000) return `há ${Math.floor(diff / 60000)} min`;
    if (diff < 86400000) return `há ${Math.floor(diff / 3600000)}h`;
    return fmtDate(iso, false);
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function fileHref(path) {
    if (!path) return '#';
    return `/files/${String(path).split('/').map(encodeURIComponent).join('/')}`;
  }
  function icon(id, cls = '') {
    return `<svg class="icon ${cls}"><use href="#i-${id}"/></svg>`;
  }
  function modelName(id) {
    const p = state.data?.pricing?.find(x => x.id === id);
    return p?.label || id;
  }
  function rateFor(id) {
    return state.data?.pricing?.find(p => p.id === id) || state.data?.pricing?.[0];
  }
  function costAt(rate, input, cached, output) {
    if (!rate) return 0;
    const noncached = Math.max(input - cached, 0);
    return (noncached * rate.input + cached * rate.cache_read + output * rate.output) / 1e6;
  }

  // ------------------------------------------------------------
  // Dados e cálculos
  // ------------------------------------------------------------
  function plannedTasks() {
    if (!state.data) return [];
    return state.data.tasks_planned.map(t => {
      const ov = state.overrides[t.id] || {};
      const input = Math.max(0, Number(ov.input ?? t.input) || 0);
      const output = Math.max(0, Number(ov.output ?? t.output) || 0);
      return { ...t, input, output };
    });
  }

  function plannedTotals() {
    const rate = rateFor(state.modelId);
    let input = 0, cached = 0, output = 0, cost = 0;
    for (const t of plannedTasks()) {
      const c = Math.round(t.input * state.cachePct / 100);
      input += t.input; cached += c; output += t.output;
      cost += costAt(rate, t.input, c, t.output);
    }
    return { input, cached, output, cost, rate };
  }

  function measuredTotals() {
    const tasks = state.data?.tasks_measured || [];
    let input = 0, cached = 0, output = 0, cost = 0;
    for (const t of tasks) {
      input += t.tokens.input; cached += t.tokens.cached; output += t.tokens.output; cost += t.cost_usd;
    }
    return { input, cached, output, cost };
  }

  function workload() {
    const m = measuredTotals();
    const p = plannedTotals();
    return { input: m.input + p.input, cached: m.cached + p.cached, output: m.output + p.output };
  }

  // ------------------------------------------------------------
  // Render: projeto e KPIs
  // ------------------------------------------------------------
  function renderProject() {
    const d = state.data;
    const p = d.project;
    const t = d.totals;

    $('#project-objective').textContent = p.objective || 'Objetivo não encontrado em tasks/plan.md.';
    $('#project-status').innerHTML = `<span class="pulse"></span> ${esc(p.status_label || 'Em desenvolvimento')}`;
    $('#phase-chip').textContent = p.phase_label || 'Diagnóstico';
    $('#updated-chip').textContent = `coletado ${timeAgo(d.generated_at)} · ${fmtTime(d.generated_at)}`;
    const docsLink = $('#visao-geral .chip-link');
    if (docsLink) docsLink.href = fileHref('docs/validacao-hto.md');

    const pct = Number(t.checklist.pct || 0);
    const ring = $('#progress-ring');
    ring.style.setProperty('--p', pct.toFixed(2));
    $('#progress-pct').textContent = `${Math.round(pct)}%`;
    $('#progress-label').textContent = `${t.checklist.done} de ${t.checklist.total} itens`;
    $('#progress-extra').textContent = t.evidence_extra ? `+${t.evidence_extra} item com evidência técnica` : 'sem evidência extra registrada';

    $('#focus-text').textContent = p.focus || '—';
    $('#active-agents').textContent = p.active_agents > 0
      ? `${p.active_agents} ${p.active_agents === 1 ? 'sessão ativa' : 'sessões ativas'} agora`
      : 'nenhuma sessão ativa agora';
    $('#sidebar-updated').textContent = `atualizado ${timeAgo(d.generated_at)}`;
  }

  function renderKpis() {
    const d = state.data;
    const t = d.totals;
    const v = d.validation;

    $('#kpi-docs').textContent = fmtInt(t.documents);
    $('#kpi-docs-sub').textContent = `${d.documents.ifc.length} IFC · ${d.documents.pdf.length} PDF · ${fmtBytes(t.documents_bytes)}`;

    $('#kpi-artifacts').textContent = fmtInt(t.artifacts);
    $('#kpi-artifacts-sub').textContent = `${fmtBytes(t.artifacts_bytes)} em evidências e scripts`;

    $('#kpi-matches').textContent = fmtInt(v.alignment.matches);
    $('#kpi-matches-sub').textContent = `${v.alignment.ant_audit.hits ?? '—'}/${v.alignment.ant_audit.eligible ?? '—'} ANT · tolerância 1 mm`;

    $('#kpi-tokens').textContent = fmtCompact(t.measured_tokens);
    $('#kpi-tokens-sub').textContent = `${fmtCompact(t.measured_tokens_input)} de entrada · ${fmtPct(t.cache_hit_pct)} cache`;

    $('#kpi-cost').textContent = fmtUsd(t.measured_cost_usd, 4);
    $('#kpi-cost-sub').textContent = `≈ ${fmtBrl(t.measured_cost_usd, 2)} · preço de tabela`;

    $('#kpi-gates').textContent = fmtInt(t.gates_pending);
    $('#kpi-gates-sub').textContent = v.governance.publish_blocked ? 'publicação federada bloqueada' : 'publicação liberada';

    $('#docs-size').textContent = `${fmtBytes(t.documents_bytes)} analisados`;
  }

  // ------------------------------------------------------------
  // Render: desenvolvimento
  // ------------------------------------------------------------
  function sectionStatusLabel(status) {
    return status === 'concluido' ? 'concluído' : status === 'em_andamento' ? 'em andamento' : 'pendente';
  }

  function renderRoadmap() {
    const d = state.data;
    const open = new Set($$('.roadmap-item[open]', $('#roadmap')).map(el => el.dataset.section));
    const firstLoad = !state.roadmapRendered;
    state.roadmapRendered = true;
    const html = d.checklist.sections.map((s, idx) => {
      const shouldOpen = firstLoad ? (s.status === 'em_andamento' || idx === 0) : open.has(s.id);
      const numeric = /^\d+\./.test(s.id);
      const numLabel = numeric ? s.id.split('.')[0].padStart(2, '0') : '★';
      const tasks = s.tasks.map(t => `
        <div class="task-row ${t.done ? 'done' : ''}">
          <span class="task-check">${t.done ? icon('check') : ''}</span>
          <span>${esc(t.text)}</span>
        </div>`).join('');
      const meta = [s.verification, s.dependency].filter(Boolean)
        .map(line => `<span>${esc(line)}</span>`).join('');
      return `
        <details class="roadmap-item status-${s.status === 'em_andamento' ? 'progress' : s.status === 'concluido' ? 'done' : 'pending'}" data-section="${esc(s.id)}" ${shouldOpen ? 'open' : ''}>
          <summary>
            <span class="roadmap-num">${esc(numLabel)}</span>
            <span class="roadmap-title">
              <span class="roadmap-title-line">
                <strong>${esc(s.title)}</strong>
                <span class="chip ${s.status === 'em_andamento' ? 'chip-warn' : s.status === 'concluido' ? 'chip-good' : 'chip-quiet'}">${sectionStatusLabel(s.status)}</span>
              </span>
              <span class="roadmap-progress">
                <span class="progress-track"><span style="width:${s.pct}%"></span></span>
                <span class="progress-num">${s.done}/${s.total}</span>
              </span>
            </span>
            ${icon('chevron', 'roadmap-caret')}
          </summary>
          <div class="roadmap-tasks">${tasks || '<div class="task-row">Sem itens registrados.</div>'}</div>
          ${meta ? `<div class="roadmap-meta">${meta}</div>` : ''}
        </details>`;
    }).join('');
    $('#roadmap').innerHTML = html;
    $('#todo-updated').textContent = d.checklist.updated_at ? `checklist ${timeAgo(d.checklist.updated_at)}` : '—';
  }

  function renderDevSide() {
    const d = state.data;
    const p = d.project;
    $('#next-step-title').textContent = p.focus || '—';
    let detail = p.latest_agent_message || 'A próxima ação está descrita no checklist e no plano do projeto.';
    detail = detail
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ').trim();
    if (detail.length > 300) detail = `${detail.slice(0, 300)}…`;
    $('#next-step-detail').textContent = detail;

    const upcoming = (p.next_steps || []).slice(1, 4);
    $('#next-list').innerHTML = upcoming.length
      ? upcoming.map((s, i) => `<div><span class="idx">${String(i + 2).padStart(2, '0')}</span><span>${esc(s)}</span></div>`).join('')
      : '<div><span class="idx">✓</span><span>Checklist sem próximos itens pendentes.</span></div>';

    const v = d.validation;
    const signals = [];
    if (p.priority && p.priority.total) {
      signals.push(['check', `Prioridade atual: ${p.priority.title.replace(/^Prioridade atual\s*—\s*/, '')} — ${p.priority.done}/${p.priority.total} itens.`]);
    }
    if (d.totals.evidence_extra > 0) signals.push(['alert', 'Checklist pode estar defasado: há evidência técnica gerada além dos itens marcados.']);
    if (v.quality.generic_spaces) signals.push(['alert', `${v.quality.generic_spaces} de ${v.quality.arq_spaces} espaços IFC têm nome genérico “Ambiente”; o vínculo é por geometria.`]);
    if (v.governance.publish_blocked) signals.push(['alert', `${v.governance.pending_gates.length} gates de federação ainda estão abertos.`]);
    if (v.alignment.tld && v.alignment.tld.independent_xy === 0) signals.push(['alert', 'Nenhum controle independente de TLD em XY/Z foi registrado.']);
    if (d.pilot.status !== 'gerado') signals.push(['alert', 'O recorte 3D do ambiente piloto ainda não foi gerado.']);
    if (v.registration.status === 'candidate') signals.push(['check', 'Calibração PDF ↔ IFC coerente com a escala 1:125, mas ainda candidata.']);
    $('#signal-list').innerHTML = signals.slice(0, 5).map(([kind, text]) =>
      `<li>${icon(kind === 'check' ? 'check' : 'alert', kind === 'check' ? 'ok' : '')}<span>${esc(text)}</span></li>`).join('');

    $('#docs-list').innerHTML = (d.docs || []).map(doc => `
      <a class="doc-row" href="${fileHref(doc.path)}" target="_blank" rel="noopener">
        <span class="doc-icon">${icon('file')}</span>
        <span><strong>${esc(doc.label)}</strong><small>${esc(doc.path)} · ${fmtBytes(doc.bytes)}</small></span>
        <time>${timeAgo(doc.mtime)}</time>
      </a>`).join('') || '<div class="doc-row">Nenhum documento encontrado.</div>';
  }

  // ------------------------------------------------------------
  // Render: validação
  // ------------------------------------------------------------
  function renderValidation() {
    const d = state.data;
    const v = d.validation;
    const a = v.alignment;
    const r = v.registration;
    const g = v.governance;

    $('#validation-status').textContent = a.status === 'not_validated' ? 'não validado para publicação' : a.status_label;
    $('#validation-status').className = `chip ${a.publish_as_validated ? 'chip-good' : 'chip-bad'}`;
    $('#gate-count').textContent = `${g.gates_passed}/${g.gates_total}`;
    $('#gates-chip').textContent = `${g.gates_passed}/${g.gates_total} concluídos`;
    $('#gate-text').innerHTML = `O status é <code>${esc(a.status)}</code>. ${g.publish_blocked ? 'Os gates abaixo precisam ser cumpridos antes de liberar o conjunto à equipe.' : 'O conjunto está liberado para publicação.'}`;

    $('#align-matches').textContent = fmtInt(a.matches);
    $('#align-max').textContent = fmtSci(a.max_distance_m);
    $('#align-mean').textContent = fmtSci(a.mean_distance_m);
    $('#align-eligible').textContent = `${a.ant_audit.hits ?? '—'}/${a.ant_audit.eligible ?? '—'}`;
    $('#align-misses').textContent = fmtInt(a.ant_audit.misses ?? 0);
    $('#align-tld').textContent = `${fmtInt(a.tld.independent_xy ?? 0)} XY · ${fmtInt(a.tld.independent_z ?? 0)} Z`;
    $('#align-floor').textContent = `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format((a.floor_delta_m || 0) * 1000)} mm`;
    $('#align-note').textContent = `${a.ant_audit.hits ?? 0} de ${a.ant_audit.eligible ?? 0} painéis ANT elegíveis coincidem; ${a.ant_audit.panels ?? 0} painéis auditados em ${a.ant_audit.ground_spaces ?? 0} espaços do térreo, com ${a.ant_audit.misses ?? 0} falhas. Ainda não é checagem completa de interferências nem prova de CRS.`;

    $('#reg-error').textContent = r.scale_error_pct == null ? '—' : fmtPct(Math.abs(r.scale_error_pct), 4);
    $('#reg-calib').textContent = fmtPt(r.calibration_max_residual_pt);
    $('#reg-control').textContent = fmtPt(r.control_residual_pt);
    $('#reg-unc').textContent = `±${fmtPt(r.uncertainty_pt)}`;
    $('#reg-meters').textContent = fmtMeters(r.control_residual_m);
    $('#reg-area-ifc').textContent = `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(r.area_ifc_m2)} m²`;
    $('#reg-area-pdf').textContent = `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(r.area_pdf_m2)} m²`;
    $('#reg-note').textContent = `Calibração manual exploratória para a viewport/revisão do térreo. O vínculo ${r.pilot_label || 'APTO. 101'} ↔ IfcSpace ${r.pilot_ifc_name || '—'} e o limite clicável ainda exigem aprovação humana.`;

    const pending = g.pending_gates || [];
    $('#gate-list').innerHTML = pending.length
      ? pending.map(text => `<li><span class="gate-box">${icon('close')}</span><span>${esc(text)}</span></li>`).join('')
      : `<li><span class="gate-box done">${icon('check')}</span><span>Todos os gates foram cumpridos.</span></li>`;

    const quality = [];
    if (v.quality.generic_spaces) quality.push(`${v.quality.generic_spaces} de ${v.quality.arq_spaces} espaços do IFC de arquitetura têm nome genérico “Ambiente”.`);
    quality.push(`Zero controles independentes de TLD (XY e Z) no relatório de revisão.`);
    quality.push('O round-trip da matriz prova aritmética, não a exatidão geométrica do alinhamento.');
    quality.push('A diferença de 35 mm no 1º pavimento não justifica uma correção global de Z.');
    quality.push('A calibração PDF ↔ IFC vale apenas para esta viewport e revisão; o 1º pavimento exige calibração própria.');
    $('#quality-list').innerHTML = quality.map(q => `<li>${icon('alert')}<span>${esc(q)}</span></li>`).join('');

    const pilot = d.pilot || { files: [] };
    $('#pilot-status').textContent = pilot.status === 'gerado'
      ? `${pilot.files.length} arquivo(s) · ${fmtBytes(pilot.files.reduce((sum, f) => sum + f.bytes, 0))}`
      : 'pendente · build_pilot.py disponível';
    $('.pilot-dot').classList.toggle('done', pilot.status === 'gerado');

    renderGallery();
  }

  function renderGallery() {
    const gallery = state.data.gallery || [];
    $('#gallery').innerHTML = gallery.map((g, idx) => `
      <button class="gallery-card" type="button" data-index="${idx}" aria-label="Ampliar ${esc(g.title)}">
        <span class="gallery-thumb">
          <img src="${fileHref(g.file)}" alt="${esc(g.title)}" loading="lazy">
          <span class="gallery-tag">${esc(g.tag)}</span>
        </span>
        <span class="gallery-caption"><strong>${esc(g.title)}</strong><span>${esc(g.subtitle)}</span></span>
      </button>`).join('');
    $$('.gallery-card').forEach(card => card.addEventListener('click', () => openLightbox(Number(card.dataset.index))));
  }

  // ------------------------------------------------------------
  // Render: documentos
  // ------------------------------------------------------------
  function renderDocuments() {
    const d = state.data;
    const ifc = d.documents.ifc.map(doc => `
      <article class="doc-card">
        <div class="doc-top">
          <div class="doc-name">
            <span class="doc-badge">${icon('layers')}</span>
            <span><strong>${esc(doc.label)}</strong><small>${esc(doc.file)}</small></span>
          </div>
          <span class="chip chip-quiet">${esc(doc.schema)}</span>
        </div>
        <div class="doc-stats">
          <div class="doc-stat"><span>Entidades</span><strong>${fmtInt(doc.entities)}</strong></div>
          <div class="doc-stat"><span>Produtos</span><strong>${fmtInt(doc.products)}</strong></div>
          <div class="doc-stat"><span>Espaços</span><strong>${fmtInt(doc.spaces)}</strong></div>
          <div class="doc-stat"><span>Pavimentos</span><strong>${fmtInt(doc.storeys.length)}</strong></div>
          <div class="doc-stat"><span>Tamanho</span><strong>${fmtBytes(doc.bytes)}</strong></div>
          <div class="doc-stat"><span>Inspeção</span><strong>${fmtDuration(doc.elapsed_s)}</strong></div>
        </div>
        <div class="element-chips">${doc.top_elements.map(e => `<span class="element-chip">${esc(e.type.replace('Ifc', ''))} ${fmtInt(e.count)}</span>`).join('')}</div>
        <div class="doc-foot">
          <span>${doc.placements ? `${fmtInt(doc.placements)} placements` : 'sem placements'}</span>
          <a href="${fileHref(doc.inspection)}" target="_blank" rel="noopener">inspeção ${icon('external')}</a>
        </div>
      </article>`).join('');

    const pdf = d.documents.pdf.map(doc => `
      <article class="doc-card pdf">
        <div class="pdf-preview"><img src="${fileHref(doc.preview)}" alt="${esc(doc.label)}" loading="lazy"></div>
        <div class="pdf-body">
          <strong>${esc(doc.label)}</strong>
          <small>${esc(doc.file)}</small>
          <div class="pdf-stats">
            <div><span>Spans</span><strong>${fmtInt(doc.spans)}</strong></div>
            <div><span>Rótulos</span><strong>${doc.label_candidates ?? '—'}</strong></div>
            <div><span>Página</span><strong>${doc.width_in}×${doc.height_in} in</strong></div>
          </div>
          <div class="doc-foot">
            <span>${fmtBytes(doc.bytes)}</span>
            <a href="${fileHref(doc.path)}" target="_blank" rel="noopener">abrir PDF ${icon('external')}</a>
          </div>
        </div>
      </article>`).join('');

    $('#doc-grid').innerHTML = ifc + pdf;
  }

  // ------------------------------------------------------------
  // Render: tokens
  // ------------------------------------------------------------
  function renderTokenKpis() {
    const d = state.data;
    const t = d.totals;
    const noncached = Math.max(t.measured_tokens_input - t.measured_tokens_cached, 0);
    const effective = t.measured_tokens ? (t.measured_cost_usd / t.measured_tokens) * 1e6 : 0;

    $('#tk-total').textContent = fmtCompact(t.measured_tokens);
    $('#tk-total-sub').textContent = `${d.sessions.all.length} sessões · ${fmtDuration(t.duration_min * 60)} de janela ativa`;
    $('#tk-input').textContent = fmtCompact(t.measured_tokens_input);
    $('#tk-input-sub').textContent = `${fmtCompact(noncached)} sem cache + ${fmtCompact(t.measured_tokens_cached)} cacheados`;
    $('#tk-cache').textContent = fmtPct(t.cache_hit_pct);
    $('#tk-cache-sub').textContent = `${fmtCompact(t.measured_tokens_cached)} tokens lidos do cache`;
    $('#tk-output').textContent = fmtCompact(t.measured_tokens_output);
    $('#tk-output-sub').textContent = 'inclui raciocínio dos modelos';
    $('#tk-cost').textContent = fmtUsd(t.measured_cost_usd, 4);
    $('#tk-cost-sub').textContent = `≈ ${fmtBrl(t.measured_cost_usd, 2)} · ${fmtUsd(effective, 2)} por 1M tokens`;
  }

  function renderDonut() {
    const d = state.data;
    const t = d.totals;
    const noncached = Math.max(t.measured_tokens_input - t.measured_tokens_cached, 0);
    const total = t.measured_tokens_input + t.measured_tokens_output;
    const segments = [
      { label: 'Entrada não cacheada', value: noncached, color: 'var(--blue)' },
      { label: 'Cache lido', value: t.measured_tokens_cached, color: 'var(--accent-2)' },
      { label: 'Saída + raciocínio', value: t.measured_tokens_output, color: 'var(--warn)' },
    ];
    const r = 62, circ = 2 * Math.PI * r;
    let offset = 0;
    const circles = segments.map(seg => {
      const len = total ? (seg.value / total) * circ : 0;
      const el = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${seg.color}" stroke-width="20"
        stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" />`;
      offset += len;
      return el;
    }).join('');
    $('#token-donut').innerHTML = `<svg viewBox="0 0 160 160" role="img" aria-label="Composição dos tokens">${circles}</svg>`;
    $('#donut-total').textContent = fmtCompact(total);
    $('#token-legend').innerHTML = segments.map(seg => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${seg.color}"></span>
        <span>${seg.label}</span>
        <strong>${fmtCompact(seg.value)}</strong>
        <span class="pct">${total ? fmtPct(seg.value / total * 100) : '—'}</span>
      </div>`).join('');
    const effective = total ? (t.measured_cost_usd / total) * 1e6 : 0;
    const dash = (d.sessions.all || []).filter(s => s.agent === 'OpenCode' && /painel/i.test(s.title || ''));
    const dashTokens = dash.reduce((sum, s) => sum + s.tokens.total, 0);
    const dashCost = dash.reduce((sum, s) => sum + s.cost_usd, 0);
    const dashNote = dashTokens && total
      ? ` A sessão do painel responde por ${fmtPct(dashTokens / total * 100)} dos tokens e ${fmtPct(dashCost / (t.measured_cost_usd || 1) * 100)} do custo.`
      : '';
    $('#token-insight').innerHTML = `Cache hit de <strong>${fmtPct(t.cache_hit_pct)}</strong>. Custo efetivo de <strong>${fmtUsd(effective, 2)}</strong> por 1M de tokens processados, considerando os modelos que realmente rodaram.${dashNote}`;
  }

  function renderSessions() {
    const d = state.data;
    const sessions = [...d.sessions.all].sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
    $('#sessions-count').textContent = `${sessions.length} sessões`;
    $('#session-list').innerHTML = sessions.map(s => {
      const isSub = s.kind === 'subagent';
      const avatarClass = s.agent === 'OpenCode' ? 'oc' : isSub ? 'sub' : '';
      const avatar = s.agent === 'OpenCode' ? 'OC' : isSub ? (s.nickname || 'SA').slice(0, 2).toUpperCase() : 'CX';
      const title = s.title.length > 62 ? `${s.title.slice(0, 62)}…` : s.title;
      const models = (s.model_labels || []).join(' + ');
      const status = s.active ? ' · ativa agora' : '';
      return `
        <div class="session-row">
          <span class="session-avatar ${avatarClass}">${esc(avatar)}</span>
          <span class="session-main"><strong>${esc(title)}</strong><span>${esc(models)} · ${fmtDuration(s.duration_s)}${status}</span></span>
          <span class="session-right"><strong>${fmtUsd(s.cost_usd, 4)}</strong><span>${fmtCompact(s.tokens.total)} tok</span></span>
        </div>`;
    }).join('');
  }

  function renderGantt() {
    const timeline = state.data.sessions.timeline || [];
    if (!timeline.length) { $('#gantt').innerHTML = '<div class="empty-state">Sem sessões registradas.</div>'; return; }
    const starts = timeline.map(s => new Date(s.start).getTime()).filter(n => !Number.isNaN(n));
    const ends = timeline.map(s => new Date(s.end || s.start).getTime()).filter(n => !Number.isNaN(n));
    let min = Math.min(...starts), max = Math.max(...ends);
    const pad = Math.max((max - min) * 0.03, 60 * 1000);
    min -= pad; max += pad;
    const span = Math.max(max - min, 1);
    const pct = t => Math.max(0, Math.min(100, ((new Date(t).getTime() - min) / span) * 100));
    const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);

    const rows = timeline
      .slice()
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''))
      .map(s => {
        const cls = s.agent === 'OpenCode' ? 'opencode' : s.kind === 'subagent' ? 'subagent' : 'codex';
        const label = s.label || s.agent;
        const intervals = (s.intervals && s.intervals.length) ? s.intervals : [[s.start, s.end || s.start]];
        const bars = intervals.map(([a, b]) => {
          const left = pct(a);
          const right = pct(b);
          const width = Math.max(right - left, 0.25);
          return `<span class="gantt-bar ${cls}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${esc(label)} · ${fmtDate(a)} → ${fmtTime(b)}"></span>`;
        }).join('');
        return `
          <div class="gantt-row">
            <div class="gantt-label"><strong>${esc(label)}</strong><span>${esc((s.models || []).join(' + '))} · ${fmtUsd(s.cost_usd, 4)}</span></div>
            <div class="gantt-track">${bars}</div>
          </div>`;
      }).join('');
    const now = Date.now();
    const nowLine = now >= min && now <= max ? `<span class="gantt-now" style="left:${pct(now)}%"></span>` : '';
    $('#gantt').innerHTML = `
      <div class="gantt-scale"><span>agente</span><div class="gantt-scale-track">${ticks.map(t => `<span>${fmtTime(new Date(t).toISOString())}</span>`).join('')}</div></div>
      ${rows}
      <div class="gantt-legend"><span><i class="codex"></i>Codex principal</span><span><i class="subagent"></i>subagente</span><span><i class="opencode"></i>OpenCode</span>${nowLine ? '<span style="margin-left:auto">linha amarela = agora</span>' : ''}</div>`;
  }

  function renderModelSelect() {
    const select = $('#model-select');
    const current = state.modelId;
    select.innerHTML = state.data.pricing.map(p => `
      <option value="${esc(p.id)}" ${p.id === current ? 'selected' : ''}>${esc(p.label)} · ${fmtUsd(p.input, 2)}/${fmtUsd(p.output, 2)} por 1M</option>`).join('');
  }

  function taskRows() {
    const measured = (state.data.tasks_measured || []).map(t => ({
      kind: 'measured', id: t.id, label: t.label, section: t.section,
      input: t.tokens.input, cached: t.tokens.cached, output: t.tokens.output,
      cost: t.cost_usd, models: t.model_labels || [], status: t.status,
    }));
    const planned = plannedTasks().map(t => {
      const cached = Math.round(t.input * state.cachePct / 100);
      return {
        kind: 'planned', id: t.id, label: t.label, section: t.section,
        input: t.input, cached, output: t.output,
        cost: costAt(rateFor(state.modelId), t.input, cached, t.output),
        models: [modelName(state.modelId)], status: 'planejada',
        basis: t.basis,
      };
    });
    return { measured, planned, all: [...measured, ...planned] };
  }

  function renderEstimator() {
    const rows = taskRows();
    const total = rows.all.reduce((sum, r) => sum + r.cost, 0);
    const maxCost = Math.max(...rows.all.map(r => r.cost), 0.000001);
    const html = rows.all.map(r => {
      const share = total ? (r.cost / total) * 100 : 0;
      const isPlanned = r.kind === 'planned';
      const inputCell = isPlanned
        ? `<input class="input-est" type="number" min="0" step="1000" value="${r.input}" data-task="${esc(r.id)}" data-field="input" aria-label="Tokens de entrada de ${esc(r.label)}">`
        : fmtInt(r.input);
      const outputCell = isPlanned
        ? `<input class="input-est" type="number" min="0" step="500" value="${r.output}" data-task="${esc(r.id)}" data-field="output" aria-label="Tokens de saída de ${esc(r.label)}">`
        : fmtInt(r.output);
      return `
        <tr>
          <td>
            <div class="task-cell"><strong>${esc(r.label)}</strong><span>${esc(r.section)}${r.basis ? ` · ${esc(r.basis)}` : ''}</span></div>
          </td>
          <td>
            <span class="origin"><i class="dot ${isPlanned ? 'planned' : 'measured'}"></i>${isPlanned ? 'planejado' : 'medido'}</span>
            <span class="model-mini">${esc((r.models || []).join(' + '))}</span>
          </td>
          <td class="num">${inputCell}</td>
          <td class="num">${fmtInt(r.cached)}</td>
          <td class="num">${outputCell}</td>
          <td class="num cost-cell">${fmtUsd(r.cost, 4)}</td>
          <td>
            <div class="share-bar" title="custo relativo ao maior item (${fmtPct(share)} do total)"><span style="width:${Math.max((r.cost / maxCost) * 100, 1)}%"></span></div>
          </td>
        </tr>`;
    }).join('');
    $('#cost-tbody').innerHTML = html;

    const measured = rows.measured.reduce((a, r) => ({ input: a.input + r.input, cached: a.cached + r.cached, output: a.output + r.output, cost: a.cost + r.cost }), { input: 0, cached: 0, output: 0, cost: 0 });
    const planned = rows.planned.reduce((a, r) => ({ input: a.input + r.input, cached: a.cached + r.cached, output: a.output + r.output, cost: a.cost + r.cost }), { input: 0, cached: 0, output: 0, cost: 0 });
    $('#cost-tfoot').innerHTML = `
      <tr>
        <td>Total do projeto</td>
        <td>${rows.measured.length} medidas · ${rows.planned.length} planejadas</td>
        <td class="num">${fmtInt(measured.input + planned.input)}</td>
        <td class="num">${fmtInt(measured.cached + planned.cached)}</td>
        <td class="num">${fmtInt(measured.output + planned.output)}</td>
        <td class="num cost-cell">${fmtUsd(measured.cost + planned.cost, 4)}</td>
        <td></td>
      </tr>`;
    const rate = rateFor(state.modelId);
    $('#table-note').textContent = `Medido: ${fmtUsd(measured.cost, 4)} com os modelos reais. Planejado: ${fmtUsd(planned.cost, 4)} no ${rate?.label || 'modelo selecionado'} com ${state.cachePct}% de cache. Total: ${fmtUsd(measured.cost + planned.cost, 4)} (${fmtBrl(measured.cost + planned.cost)}).`;
    $('#table-note').title = 'Custos de tabela por 1M tokens. As tarefas planejadas são estimativas editáveis; as medidas vêm dos rollouts e do banco de sessões.';

    $$('#cost-tbody input.input-est').forEach(input => {
      input.addEventListener('change', () => {
        const id = input.dataset.task;
        const field = input.dataset.field;
        const value = Math.max(0, Number(input.value) || 0);
        state.overrides[id] = { ...(state.overrides[id] || {}), [field]: value };
        localStorage.setItem('hto.overrides', JSON.stringify(state.overrides));
        renderEstimator();
        renderCompare();
        renderBudget();
        renderKpis();
      });
    });
  }

  function renderCompare() {
    const w = workload();
    const rows = state.data.pricing.map(p => ({ ...p, totalCost: costAt(p, w.input, w.cached, w.output) }))
      .sort((a, b) => a.totalCost - b.totalCost);
    const min = rows[0]?.totalCost || 0;
    const max = rows[rows.length - 1]?.totalCost || 1;
    $('#compare-list').innerHTML = rows.map(p => {
      const selected = p.id === state.modelId;
      const width = max ? Math.max((p.totalCost / max) * 100, 1) : 1;
      const mult = min ? p.totalCost / min : 1;
      return `
        <button type="button" class="compare-row ${selected ? 'is-selected' : ''}" data-model="${esc(p.id)}">
          <span class="compare-model"><strong>${esc(p.label)}${p.reference ? ' *' : ''}</strong><span>${esc(p.provider)} · ${mult.toFixed(1)}× o mais barato</span></span>
          <span class="compare-bar"><span style="width:${width.toFixed(2)}%"></span></span>
          <span class="compare-cost">${fmtUsd(p.totalCost, 2)}<small>${fmtBrl(p.totalCost)}</small></span>
        </button>`;
    }).join('');
    $$('#compare-list .compare-row').forEach(row => row.addEventListener('click', () => {
      state.modelId = row.dataset.model;
      localStorage.setItem('hto.model', state.modelId);
      $('#model-select').value = state.modelId;
      renderEstimator();
      renderCompare();
      renderBudget();
      showToast(`Modelo de estimativa: ${modelName(state.modelId)}`);
    }));
    const measured = measuredTotals();
    $('#compare-note').textContent = `O trabalho já executado custou ${fmtUsd(measured.cost, 2)} nos modelos reais. Esta comparação recalcula toda a carga (feita + planejada) em um único modelo; por isso o valor no modelo selecionado pode ser menor que o custo medido.`;
  }

  function renderBudget() {
    const d = state.data;
    const measured = d.totals.measured_cost_usd;
    const planned = plannedTotals().cost;
    const total = measured + planned;
    const budget = Math.max(1, state.budget);
    const pct = (total / budget) * 100;
    const over = total > budget;
    const barMax = Math.max(total, budget);
    const measuredPct = Math.min(100, (measured / barMax) * 100);
    const plannedPct = Math.min(100, (planned / barMax) * 100);
    const restPct = Math.max(0, 100 - measuredPct - plannedPct);

    $('#budget-used').textContent = fmtUsd(total, 2);
    $('#budget-of').textContent = `de ${fmtUsd(budget, 2)} (${fmtBrl(budget)})`;
    $('#budget-chip').textContent = over ? `acima do orçamento · ${fmtPct(pct)}` : `${fmtPct(pct)} do orçamento`;
    $('#budget-chip').classList.toggle('over', over);
    $('#budget-bar-measured').style.width = `${measuredPct}%`;
    $('#budget-bar-planned').style.width = `${plannedPct}%`;
    $('#budget-measured').textContent = fmtUsd(measured, 2);
    $('#budget-planned').textContent = fmtUsd(planned, 2);
    $('#budget-rest').textContent = over ? `${fmtUsd(total - budget, 2)} acima` : fmtUsd(budget - total, 2);
    $('#burn-rate').textContent = d.totals.cost_per_hour_usd ? `${fmtUsd(d.totals.cost_per_hour_usd, 2)}/h` : '—';
    $('#budget-projection').textContent = fmtUsd(total, 2);
    $('#budget-note').textContent = `O diagnóstico consumiu ${fmtUsd(measured, 2)} em ${fmtDuration(d.totals.duration_min * 60)} de janela ativa. As ${plannedTasks().length} tarefas planejadas somam ${fmtUsd(planned, 2)} no ${modelName(state.modelId)}. Restante: ${over ? 'orçamento excedido' : fmtUsd(budget - total, 2)}.`;
  }

  // ------------------------------------------------------------
  // Render: atividade e notas
  // ------------------------------------------------------------
  function renderActivity() {
    const d = state.data;
    const iconsMap = { artifact: 'layers', doc: 'book', session: 'cpu', user: 'activity' };
    $('#activity-count').textContent = `${d.activity.length} eventos`;
    $('#activity-timeline').innerHTML = d.activity.map(item => `
      <div class="timeline-item ${esc(item.kind)}">
        <span class="timeline-dot"></span>
        <div class="timeline-time">${fmtDate(item.time)} · ${timeAgo(item.time)}</div>
        <div class="timeline-title">${esc(item.title)}</div>
        <div class="timeline-detail">${item.path ? `<a href="${fileHref(item.path)}" target="_blank" rel="noopener">${esc(item.detail)}</a>` : esc(item.detail)}</div>
      </div>`).join('') || '<div class="empty-state">Sem eventos recentes.</div>';

    const byExt = Object.entries(d.artifacts.by_ext || {}).sort((a, b) => b[1] - a[1]).slice(0, 7);
    const max = Math.max(...byExt.map(([, n]) => n), 1);
    $('#artifact-bars').innerHTML = byExt.map(([ext, n]) => `
      <div class="artifact-bar"><span>.${esc(ext)}</span><span class="track"><span style="width:${(n / max) * 100}%"></span></span><strong>${n}</strong></div>`).join('');
    $('#artifact-total').innerHTML = `<strong>${fmtInt(d.artifacts.count)}</strong> artefatos · <strong>${fmtBytes(d.artifacts.bytes)}</strong> em disco`;
  }

  function renderNotes() {
    const d = state.data;
    $('#notes-list').innerHTML = (d.notes || []).map(n => `<li>${esc(n)}</li>`).join('');
    $('#footer-time').textContent = `coleta ${fmtDate(d.generated_at)} · ${timeAgo(d.generated_at)}`;
  }

  // ------------------------------------------------------------
  // Render completo
  // ------------------------------------------------------------
  function renderAll() {
    renderProject();
    renderKpis();
    renderRoadmap();
    renderDevSide();
    renderValidation();
    renderDocuments();
    renderTokenKpis();
    renderDonut();
    renderSessions();
    renderGantt();
    renderModelSelect();
    renderEstimator();
    renderCompare();
    renderBudget();
    renderActivity();
    renderNotes();
    $('#updated-chip').textContent = `coletado ${timeAgo(state.data.generated_at)} · ${fmtTime(state.data.generated_at)}`;
  }

  // ------------------------------------------------------------
  // Lightbox
  // ------------------------------------------------------------
  function openLightbox(index) {
    const gallery = state.data?.gallery || [];
    if (!gallery.length) return;
    state.galleryIndex = (index + gallery.length) % gallery.length;
    const item = gallery[state.galleryIndex];
    const box = $('#lightbox');
    $('#lightbox-img').src = fileHref(item.file);
    $('#lightbox-img').alt = item.title;
    $('#lightbox-title').textContent = item.title;
    $('#lightbox-sub').textContent = item.subtitle;
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#lightbox-close').focus();
  }
  function closeLightbox() {
    $('#lightbox').hidden = true;
    document.body.style.overflow = '';
  }
  function moveLightbox(delta) {
    const len = state.data?.gallery?.length || 0;
    if (!len) return;
    openLightbox((state.galleryIndex + delta + len) % len);
  }

  // ------------------------------------------------------------
  // Toast / clipboard
  // ------------------------------------------------------------
  let toastTimer;
  function showToast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Resumo copiado para a área de transferência');
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      showToast('Resumo copiado');
    }
  }
  function summaryMarkdown() {
    const d = state.data;
    const p = plannedTotals();
    const measured = d.totals.measured_cost_usd;
    const total = measured + p.cost;
    return [
      '# Piloto HTO — status do desenvolvimento',
      '',
      `- Coleta: ${fmtDate(d.generated_at)}`,
      `- Progresso do checklist: ${d.totals.checklist.done}/${d.totals.checklist.total} (${fmtPct(d.totals.checklist.pct)})${d.totals.evidence_extra ? ` + ${d.totals.evidence_extra} item com evidência técnica` : ''}`,
      `- Foco atual: ${d.project.focus}`,
      `- Documentos: ${d.totals.documents} (${fmtBytes(d.totals.documents_bytes)})`,
      `- Evidências: ${d.totals.artifacts} artefatos (${fmtBytes(d.totals.artifacts_bytes)})`,
      `- Alinhamento: ${d.validation.alignment.matches} matches · status ${d.validation.alignment.status}`,
      `- Gates abertos: ${d.validation.governance.pending_gates.length}`,
      '',
      '## Tokens medidos',
      `- Entrada: ${fmtInt(d.totals.measured_tokens_input)} (cache ${fmtPct(d.totals.cache_hit_pct)})`,
      `- Saída: ${fmtInt(d.totals.measured_tokens_output)}`,
      `- Custo API de tabela: ${fmtUsd(measured, 4)}`,
      '',
      '## Estimativa restante',
      `- Modelo: ${modelName(state.modelId)}`,
      `- Cache assumido: ${state.cachePct}%`,
      `- Custo planejado: ${fmtUsd(p.cost, 4)}`,
      `- Custo total: ${fmtUsd(total, 4)} (${fmtBrl(total)})`,
      '',
      `_${d.notes[0] || ''}_`,
    ].join('\n');
  }

  // ------------------------------------------------------------
  // Carregamento e atualização
  // ------------------------------------------------------------
  async function loadData(manual = false) {
    if (state.loading) return;
    state.loading = true;
    const btn = $('#refresh-btn');
    btn.disabled = true;
    $('#live-text').textContent = 'atualizando…';
    try {
      const response = await fetch('/api/data', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.data = data;
      state.countdown = REFRESH_MS / 1000;
      $('#error-banner').hidden = true;
      renderAll();
      if (manual) showToast('Dados atualizados');
    } catch (error) {
      window.__lastError = error;
      console.error(error);
      $('#error-banner').hidden = false;
      $('#error-text').textContent = state.data
        ? `Erro ao renderizar os dados: ${error.message}`
        : `${error.message}. Verifique se dashboard/serve.py está em execução.`;
      if (!state.data) {
        $('#live-text').textContent = 'sem dados';
      }
    } finally {
      state.loading = false;
      btn.disabled = false;
      updateLivePill();
    }
  }

  function updateLivePill() {
    const editing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    state.paused = document.hidden || editing;
    const pill = $('#live-pill');
    pill.classList.toggle('is-paused', state.paused);
    if (state.loading) $('#live-text').textContent = 'atualizando…';
    else if (document.hidden) $('#live-text').textContent = 'aba oculta';
    else if (editing) $('#live-text').textContent = 'pausado (editando)';
    else $('#live-text').textContent = `ao vivo · ${Math.max(0, state.countdown)}s`;
  }

  function startTicker() {
    setInterval(() => {
      if (document.hidden || state.loading) { updateLivePill(); return; }
      const editing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
      if (editing) { updateLivePill(); return; }
      state.countdown -= 1;
      if (state.countdown <= 0) {
        state.countdown = REFRESH_MS / 1000;
        loadData();
      }
      updateLivePill();
    }, 1000);
  }

  function initTheme() {
    const saved = localStorage.getItem('hto.theme');
    if (saved) document.documentElement.dataset.theme = saved;
    $('#theme-btn').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('hto.theme', next);
    });
  }

  function initControls() {
    $('#refresh-btn').addEventListener('click', () => loadData(true));
    $('#copy-btn').addEventListener('click', () => {
      if (state.data) copyText(summaryMarkdown());
    });
    $('#copy-notes').addEventListener('click', () => {
      if (!state.data) return;
      copyText(`# Notas — Painel HTO\n\n${state.data.notes.map(n => `- ${n}`).join('\n')}`);
    });
    $('#model-select').addEventListener('change', e => {
      state.modelId = e.target.value;
      localStorage.setItem('hto.model', state.modelId);
      renderEstimator();
      renderCompare();
      renderBudget();
      renderKpis();
    });
    const cacheRange = $('#cache-range');
    cacheRange.value = state.cachePct;
    $('#cache-pct-label').textContent = `${state.cachePct}%`;
    cacheRange.addEventListener('input', e => {
      state.cachePct = Number(e.target.value);
      $('#cache-pct-label').textContent = `${state.cachePct}%`;
      localStorage.setItem('hto.cache', String(state.cachePct));
    });
    cacheRange.addEventListener('change', () => {
      renderEstimator();
      renderCompare();
      renderBudget();
      renderKpis();
    });
    const fx = $('#fx-input');
    fx.value = state.fx;
    fx.addEventListener('change', e => {
      state.fx = Math.max(0.01, Number(e.target.value) || 5.42);
      e.target.value = state.fx;
      localStorage.setItem('hto.fx', String(state.fx));
      if (state.data) { renderTokenKpis(); renderKpis(); renderEstimator(); renderBudget(); renderCompare(); }
    });
    const budget = $('#budget-input');
    budget.value = state.budget;
    budget.addEventListener('change', e => {
      state.budget = Math.max(1, Number(e.target.value) || 25);
      e.target.value = state.budget;
      localStorage.setItem('hto.budget', String(state.budget));
      if (state.data) renderBudget();
    });
    $('#reset-estimates').addEventListener('click', () => {
      state.overrides = {};
      state.cachePct = 80;
      state.modelId = 'gpt-6.1-sol';
      localStorage.removeItem('hto.overrides');
      localStorage.setItem('hto.cache', '80');
      localStorage.setItem('hto.model', state.modelId);
      $('#model-select').value = state.modelId;
      $('#cache-range').value = '80';
      $('#cache-pct-label').textContent = '80%';
      if (state.data) {
        renderEstimator(); renderCompare(); renderBudget(); renderKpis(); renderModelSelect();
      }
      showToast('Premissas restauradas');
    });

    $('#lightbox-close').addEventListener('click', closeLightbox);
    $('#lightbox-prev').addEventListener('click', () => moveLightbox(-1));
    $('#lightbox-next').addEventListener('click', () => moveLightbox(1));
    $('#lightbox').addEventListener('click', e => {
      if (e.target === $('#lightbox')) closeLightbox();
    });
    document.addEventListener('keydown', e => {
      if ($('#lightbox').hidden) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') moveLightbox(-1);
      if (e.key === 'ArrowRight') moveLightbox(1);
    });
  }

  function initNav() {
    const links = $$('.nav-link');
    const sections = links.map(link => $(link.getAttribute('href'))).filter(Boolean);
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach(link => link.classList.toggle('is-active', link.getAttribute('href') === `#${entry.target.id}`));
      }
    }, { rootMargin: '-20% 0px -65% 0px', threshold: 0 });
    sections.forEach(section => observer.observe(section));
  }

  function init() {
    initTheme();
    initControls();
    initNav();
    startTicker();
    loadData();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { state.countdown = 3; updateLivePill(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
