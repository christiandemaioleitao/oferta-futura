/* ============================================================
   EBM Inteligência · Oferta Futura — aplicação
   ============================================================ */
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const NAVY = '#0C1F55', NAVY7 = '#1B336E', BLUE = '#3A5AA0', RED = '#E30A12', HAIR = '#DCE2EC', GRAY = '#566076';
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const fmtInt = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('pt-BR');
const fmtDec = (n, d = 1) => (n == null || isNaN(n)) ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const textKey = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const ymLabel = m => m ? MESES[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4) : '—';
const dateBR = s => { if (!s) return null; const d = String(s).slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : s; };
const nowYM = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
/* Status do empreendimento: quem decide é a DATA de lançamento contra o mês atual.
   FonteDataLancamento diz de onde veio a data ('INCORPORADORA', 'EBM', 'JORNAL O POPULAR'),
   não se o produto lançou — lê-la como status marcava de PREVISTO empreendimentos cujo
   lançamento já tinha passado. A fonte só entra como confirmação quando diz LANÇADO. */
const statusEmp = e => {
  const m = (e.dtLancamento || '').slice(0, 7);
  if (m && m <= nowYM()) return 'LANÇADO';
  return textKey(e.fonteDataLancamento || '').includes('LANC') ? 'LANÇADO' : 'PREVISTO';
};

/* ---------- dados ---------- */
let DATA = window.OF_DATA || { empreendimentos: [], historico: [], geradoEm: '', fonte: '' };
let MAPA = window.OF_MAPA || { features: [] };
let filtered = [];
let sortKey = 'dtLancamento', sortAsc = true, searchTerm = '';
/* limite superior é exclusivo: 70 m² cai em 70 – 100, não em 50 – 70 */
const FAIXAS = [
  { id: 'f1', label: 'Até 50 m²', min: 0, max: 50 },
  { id: 'f2', label: '50 – 70 m²', min: 50, max: 70 },
  { id: 'f3', label: '70 – 100 m²', min: 70, max: 100 },
  { id: 'f4', label: '100 – 130 m²', min: 100, max: 130 },
  { id: 'f5', label: '130 – 190 m²', min: 130, max: 190 },
  { id: 'f6', label: '190 – 230 m²', min: 190, max: 230 },
  { id: 'f7', label: '230 – 290 m²', min: 230, max: 290 },
  { id: 'f8', label: '290 – 350 m²', min: 290, max: 350 },
  { id: 'f9', label: '350 m² ou mais', min: 350, max: 1e9 },
];
const state = { from: '', to: '', empreendimento: new Set(), macrozona: new Set(), bairro: new Set(), incorporadora: new Set(), tipo: new Set(), tipologia: new Set(), faixa: new Set() };

function empFaixas(e) {
  const out = new Set();
  (e.tipologias || []).forEach(t => { if (t.area != null) { const f = FAIXAS.find(f => t.area >= f.min && t.area < f.max); if (f) out.add(f.id); } });
  return out;
}
/* comPeriodo=false: aplica todos os filtros menos o de período de lançamento —
   usado pela tabela de incorporadoras, que tem período próprio (protocolo/aprovação) */
function empMatches(e, comPeriodo = true) {
  const m = (e.dtLancamento || '').slice(0, 7);
  if (comPeriodo && state.from && m && m < state.from) return false;
  if (comPeriodo && state.to && m && m > state.to) return false;
  if (state.empreendimento.size && !state.empreendimento.has(e.empreendimento)) return false;
  if (state.macrozona.size && !state.macrozona.has(mzLabel(e.macrozona))) return false;
  if (state.bairro.size && !state.bairro.has(e.bairro)) return false;
  if (state.incorporadora.size && !state.incorporadora.has(e.incorporadora)) return false;
  if (state.tipo.size && !state.tipo.has(e.tipo)) return false;
  if (state.tipologia.size && !(e.tipologias || []).some(t => state.tipologia.has(String(t.tratada != null ? t.tratada : t.tipologia)))) return false;
  if (state.faixa.size) { const fs = empFaixas(e); if (![...state.faixa].some(f => fs.has(f))) return false; }
  return true;
}
const mzLabel = mz => mz == null ? 'SEM MACROZONA' : 'MZ ' + String(mz).replace(/\.0$/, '');

/* ---------- grafismo de rede (manual de marca) ---------- */
function rand(a, b) { return a + Math.random() * (b - a); }
function makeField(el, opts) {
  if (!el) return;
  const W = opts.w, H = opts.h, N = opts.n, col = opts.color, maxd = opts.dist;
  const pts = []; for (let i = 0; i < N; i++) pts.push({ x: rand(0, W), y: rand(0, H) });
  let html = '';
  for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) {
    const dx = pts[a].x - pts[b].x, dy = pts[a].y - pts[b].y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < maxd) html += `<line x1="${pts[a].x.toFixed(1)}" y1="${pts[a].y.toFixed(1)}" x2="${pts[b].x.toFixed(1)}" y2="${pts[b].y.toFixed(1)}" stroke="${col}" stroke-width="1" opacity="${((1 - d / maxd) * opts.lineOp).toFixed(2)}"/>`;
  }
  const redIdx = Math.floor(rand(0, pts.length));
  pts.forEach((p, i) => {
    if (i === redIdx) html += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${RED}"/>`;
    else html += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${rand(1.6, 2.8).toFixed(1)}" fill="${col}" opacity="${opts.dotOp}"/>`;
  });
  el.setAttribute('viewBox', `0 0 ${W} ${H}`);
  el.innerHTML = html;
}

/* ---------- multiselect ---------- */
const MS = {};
function buildMultiselect(key, values) {
  const host = $(`.field[data-ms="${key}"]`);
  if (!host) return;
  let ms = host.querySelector('.ms');
  if (ms) ms.remove();
  ms = document.createElement('div');
  ms.className = 'ms';
  ms.innerHTML = `<button type="button" class="ms__btn"><span class="n">Todos</span><span class="caret">▾</span></button>
    <div class="ms__pop"><input class="ms__search" placeholder="Filtrar..." />
    <div class="ms__list"></div>
    <div class="ms__all"><button type="button" data-a="all">SELECIONAR TUDO</button><button type="button" data-a="none">LIMPAR</button></div></div>`;
  host.appendChild(ms);
  const list = ms.querySelector('.ms__list');
  const render = (q = '') => {
    const qq = textKey(q);
    list.innerHTML = values.filter(v => !qq || textKey(v.label).includes(qq))
      .map(v => `<label><input type="checkbox" value="${escapeHtml(v.id)}" ${state[key].has(v.id) ? 'checked' : ''}/><span>${escapeHtml(v.label)}</span></label>`).join('') || '<label style="color:var(--gray-400)">Nenhum item</label>';
  };
  render();
  const sync = () => {
    const btn = ms.querySelector('.ms__btn .n');
    const sel = [...state[key]];
    btn.textContent = sel.length === 0 ? 'Todos' : sel.length === 1 ? (values.find(v => v.id === sel[0])?.label || sel[0]) : sel.length + ' selecionados';
    ms.classList.toggle('active', sel.length > 0);
  };
  sync();
  ms.querySelector('.ms__btn').onclick = e => { e.stopPropagation(); const was = ms.classList.contains('open'); $$('.ms.open').forEach(x => x.classList.remove('open')); if (!was) { ms.classList.add('open'); ms.querySelector('.ms__search').focus(); } };
  ms.querySelector('.ms__search').oninput = e => render(e.target.value);
  list.onchange = e => { const v = e.target.value; e.target.checked ? state[key].add(v) : state[key].delete(v); sync(); applyAll(); };
  ms.querySelector('.ms__all').onclick = e => {
    const a = e.target.dataset.a; if (!a) return;
    const q = textKey(ms.querySelector('.ms__search').value);
    // SELECIONAR TUDO respeita a busca: adiciona só os itens visíveis, sem perder os já marcados
    if (a === 'all') values.filter(v => !q || textKey(v.label).includes(q)).forEach(v => state[key].add(v.id));
    else state[key].clear();
    render(ms.querySelector('.ms__search').value); sync(); applyAll();
  };
  MS[key] = { sync, render };
}
document.addEventListener('click', () => $$('.ms.open').forEach(x => x.classList.remove('open')));

function uniqueVals(fn) {
  const set = new Map();
  // os sem previsão entram nas opções: dá para filtrar um terreno sem data e vê-lo no mapa
  DATA.empreendimentos.concat(semDataEmps || []).forEach(e => { const v = fn(e); if (v != null && v !== '') set.set(String(v), String(v)); });
  return [...set.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(v => ({ id: v, label: v }));
}
function buildFilters() {
  buildMultiselect('empreendimento', uniqueVals(e => e.empreendimento));
  buildMultiselect('macrozona', uniqueVals(e => mzLabel(e.macrozona)));
  buildMultiselect('bairro', uniqueVals(e => e.bairro));
  buildMultiselect('incorporadora', uniqueVals(e => e.incorporadora));
  buildMultiselect('tipo', uniqueVals(e => e.tipo));
  const tips = new Set();
  DATA.empreendimentos.forEach(e => (e.tipologias || []).forEach(t => tips.add(String(t.tratada != null ? t.tratada : t.tipologia))));
  buildMultiselect('tipologia', [...tips].sort().map(v => ({ id: v, label: rotuloTipologia(v) })));
  buildMultiselect('faixa', FAIXAS.map(f => ({ id: f.id, label: f.label })));
}

function filtersSummaryText() {
  const parts = [];
  if (state.from || state.to) parts.push(`LANÇAMENTO ${state.from ? ymLabel(state.from) : '…'} → ${state.to ? ymLabel(state.to) : '…'}`);
  const names = { empreendimento: 'EMPREENDIMENTO', macrozona: 'MACROZONA', bairro: 'BAIRRO', incorporadora: 'INCORPORADORA', tipo: 'TIPO', tipologia: 'TIPOLOGIA', faixa: 'FAIXA M²' };
  Object.entries(names).forEach(([k, label]) => {
    if (state[k].size) {
      const vals = [...state[k]].map(v => k === 'faixa' ? (FAIXAS.find(f => f.id === v)?.label || v) : v);
      parts.push(`${label}: ${vals.join(', ')}`);
    }
  });
  return parts.length ? parts.join('  ·  ') : 'TODOS OS EMPREENDIMENTOS';
}

/* ---------- medidas: média mensal de vendas (histórico de mercado) ---------- */
function monthsBetween(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }
function salesAverages(emps) {
  const clusters = new Set(emps.map(e => e.cluster).filter(Boolean));
  const hist = (DATA.historico || []).filter(h => clusters.has(h.cluster));
  if (!hist.length) return { avg: null, defl: null, mes: null, n: 0 };
  /* mes = agregado do contexto: unidades vendidas por mês SOMANDO todos os
     empreendimentos do histórico dos clusters filtrados (total vendido ÷ meses
     do intervalo). avg/defl seguem sendo a velocidade média de 1 empreendimento. */
  let totalVend = 0, minM = null, maxM = null;
  hist.forEach(h => {
    h.vend.forEach(([, v]) => { totalVend += v; });
    if (minM == null || h.minM < minM) minM = h.minM;
    if (maxM == null || h.maxM > maxM) maxM = h.maxM;
  });
  const mes = totalVend / Math.max(1, monthsBetween(minM, maxM) + 1);
  let rates = [], ratesD = [];
  hist.forEach(h => {
    const start = (h.dtLancamento && h.dtLancamento.slice(0, 7) > h.minM) ? h.dtLancamento.slice(0, 7) : h.minM;
    const months = Math.max(1, monthsBetween(start, h.maxM) + 1);
    const total = h.vend.reduce((s, [, v]) => s + v, 0);
    rates.push(total / months);
    const lan = h.dtLancamento ? h.dtLancamento.slice(0, 7) : start;
    const totalD = h.vend.filter(([m]) => monthsBetween(lan, m) >= 3).reduce((s, [, v]) => s + v, 0);
    const monthsD = Math.max(1, months - 3);
    ratesD.push(totalD / monthsD);
  });
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  return { avg: mean(rates), defl: mean(ratesD), mes, n: hist.length };
}

/* ---------- aplicação de filtros ---------- */
function applyAll() {
  filtered = DATA.empreendimentos.filter(e => empMatches(e));
  $('#filtersSummary').textContent = filtersSummaryText();
  renderKPIs(); renderMap(); renderCharts(); renderPivot(); renderRadar();
  renderIncorporadoras(); renderConcentracao(); renderSemPrev();
}

function launchWindowLabel(emps) {
  const ms = emps.map(e => (e.dtLancamento || '').slice(0, 7)).filter(Boolean).sort();
  if (!ms.length) return '—';
  const a = ms[0], b = ms[ms.length - 1];
  const ma = MESES[+a.slice(5, 7) - 1], mb = MESES[+b.slice(5, 7) - 1];
  if (a === b) return `${ma} · ${a.slice(0, 4)}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${ma}–${mb} · ${a.slice(0, 4)}`;
  return `${ma}/${a.slice(2, 4)} – ${mb}/${b.slice(2, 4)}`;
}

function renderKPIs() {
  $('#kpiHeaderCount').textContent = filtered.length;
  $('#kpiHeaderWindow').textContent = launchWindowLabel(filtered);
  $('#kpiCount').textContent = filtered.length;
  // mesma régua dos gráficos: com filtro de tipologia/faixa conta as unidades da quebra
  $('#kpiUnits').textContent = fmtInt(filtered.reduce((s, e) => s + unidsLancadas(e), 0));
  const m = salesAverages(filtered);
  $('#kpiAvgSales').textContent = m.mes == null ? '—' : fmtDec(m.mes, 1);
  $('#footUpdated').textContent = 'Atualizado em ' + (dateBR(DATA.geradoEm) || '—') + ' · Fonte: ' + (DATA.fonte || 'base importada');
}

/* ---------- vínculo KMZ ↔ empreendimento ---------- */
function pointInPoly(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function distM(lat1, lng1, lat2, lng2) {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
/* terrenos sem data de lançamento/previsão — o pipeline embute em OF_DATA.semPrevisao
   (campos de lançamento/unidades em branco de propósito: indicadores não os veem);
   o fetch do Neon fica só como fallback para uma base antiga sem o array */
let semDataEmps = (window.OF_DATA && OF_DATA.semPrevisao && OF_DATA.semPrevisao.length) ? OF_DATA.semPrevisao : null;
let semDataOn = !!semDataEmps, semDataLayer = null;
const SEM_DATA_COLOR = '#8A93A6';
async function loadSemDataEmps() {
  if (semDataEmps) return semDataEmps;
  const r = await runNeonSQL('SELECT * FROM "empreendimentos-sem-previsão-lançamento"');
  const numOrNull = v => { const n = parseFloat(v); return isFinite(n) && n !== 0 ? n : null; };
  semDataEmps = (r.rows || []).map(x => ({
    id: 'sd-' + x.id, empreendimento: x.empreendimento, incorporadora: x.incorporadora,
    bairro: x.bairro, cidade: x.cidade, uf: x.uf, tipo: x.tipo, macrozona: x.macrozona,
    lat: numOrNull(x.lat), lng: numOrNull(x.lng),
    logradouro: x.logradouro, complemento: x.complemento,
    areaTerreno: numOrNull(x.area_terreno), totalUnidades: numOrNull(x.total_unidades),
    observacao: x.observacao, linkPortal: x.link_portal,
    projetoProtocolado: String(x.projeto_protocolado) === 'true' || String(x.projeto_protocolado) === 'True',
    projetoAprovado: String(x.projeto_aprovado) === 'true' || String(x.projeto_aprovado) === 'True',
    fonteEmpreendimento: x.fonte_empreendimento, dtLancamento: null, tipologias: [], mensal: [], semData: true,
  }));
  return semDataEmps;
}
/* universo de empreendimentos: os da projeção + os sem previsão, quando a camada está ligada.
   Serve para achar a ficha pelo id — não é lista de exibição, não filtra. */
function allEmps() {
  // ficha, radar sem previsão e vínculo KMZ enxergam os sem-data mesmo com a camada desligada
  return semDataEmps ? DATA.empreendimentos.concat(semDataEmps) : DATA.empreendimentos;
}
/* Terrenos sem previsão ignoram só o filtro de período de lançamento — não têm data.
   Bairro, incorporadora, tipo e macrozona valem normalmente; tipologia e faixa de m²
   excluem esses terrenos, porque um terreno sem tipologia não pode casar com elas. */
function semDataBase() {
  // tabela "sem previsão": segue os filtros (menos o de período), ignora o toggle do mapa
  return (semDataEmps || []).filter(e => empMatches(e, false));
}
/* Só terrenos cujo nome traz a quadra ("QD 65, …", "QD10, …"): é o recorte que o
   cadastro usa para área ainda sem produto definido. Sem o \b final para pegar
   também "QD10" grudado. Vale para a tabela e para os dois PDFs — o relatório
   precisa espelhar o que está na tela. */
const EH_QD = e => /\bQD/.test(textKey(e.empreendimento));
const semPrevTabela = () => semDataBase().filter(EH_QD);
function semDataFiltrados() {
  return semDataOn ? semDataBase() : [];
}
function empById(id) {
  return allEmps().find(x => x.id === id);
}
function renderSemDataLayer() {
  if (!map || !semDataLayer) return;
  semDataLayer.clearLayers();
  semDataFiltrados().forEach(e => {
    if (e.lat == null || e.lng == null) return;
    const mk = L.circleMarker([e.lat, e.lng], { radius: 7, color: '#fff', weight: 2, fillColor: SEM_DATA_COLOR, fillOpacity: .95 });
    mk.bindPopup(`<div class="map-pop"><b>${escapeHtml(e.empreendimento)}</b><span class="mono">${escapeHtml(e.bairro || '')} · SEM PREVISÃO DE LANÇAMENTO</span><button onclick="window.openFichaById('${e.id}')">VER FICHA COMPLETA</button></div>`);
    mk.on('mouseover', function () { this.setStyle({ radius: 9, fillColor: NAVY }); });
    mk.on('mouseout', function () { this.setStyle({ radius: 7, fillColor: SEM_DATA_COLOR }); });
    empMarkers[e.id] = mk;
    mk.addTo(semDataLayer);
  });
}
function linkKmzFeatures() {
  const emps = allEmps().filter(e => e.lat != null && e.lng != null);
  const feats = MAPA.features || [];
  const claimed = { Polygon: new Set(), Point: new Set() }; // emp já vinculado a uma geometria daquele tipo
  // passo 1: vínculos fortes — marcador dentro do polígono ou nome exato
  feats.forEach(f => {
    const p = f.properties = f.properties || {};
    p._empId = null;
    let hit = null;
    if (f.geometry.type === 'Polygon') {
      const ring = f.geometry.coordinates[0];
      hit = emps.find(e => pointInPoly(e.lng, e.lat, ring)) || emps.find(e => textKey(e.empreendimento) === textKey(p.name));
    } else if (f.geometry.type === 'Point') {
      hit = emps.find(e => textKey(e.empreendimento) === textKey(p.name));
    }
    if (hit) { p._empId = hit.id; claimed[f.geometry.type].add(hit.id); }
  });
  // passo 2: proximidade só com empreendimentos ainda sem geometria própria — um terreno do KMZ
  // sem cadastro nos dados não pode "roubar" a ficha do vizinho (ex.: QD 15 TERRAL × QD 21 WV MALDI)
  feats.forEach(f => {
    const p = f.properties;
    if (p._empId || !claimed[f.geometry.type]) return;
    let lat, lng;
    if (f.geometry.type === 'Polygon') {
      const ring = f.geometry.coordinates[0];
      lng = ring.reduce((s, c) => s + c[0], 0) / ring.length; lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    } else { [lng, lat] = f.geometry.coordinates; }
    let best = null, bestD = f.geometry.type === 'Polygon' ? 300 : 250;
    emps.forEach(e => {
      if (claimed[f.geometry.type].has(e.id)) return;
      const d = distM(lat, lng, e.lat, e.lng);
      if (d < bestD) { bestD = d; best = e; }
    });
    if (best) { p._empId = best.id; claimed[f.geometry.type].add(best.id); }
  });
}
function anyFilterActive() { return !!(state.from || state.to || Object.values(state).some(v => v instanceof Set && v.size)); }
function visibleKmzFeatures() {
  const ids = new Set(filtered.map(e => e.id));
  semDataFiltrados().forEach(e => ids.add(e.id));
  const filterOn = anyFilterActive();
  return (MAPA.features || []).filter(f => f.properties._empId ? ids.has(f.properties._empId) : !filterOn);
}

/* ---------- mapa ---------- */
let map, empLayer, terrenoLayer, pontoLayer, bairroLayer, baseTiles, satTiles;
const empMarkers = {}; // id -> L.circleMarker (p/ localizar pelo clique na tabela)
function initMap() {
  map = L.map('map', { scrollWheelZoom: true, zoomAnimation: false, fadeAnimation: false }).setView([-16.68, -49.26], 12);
  baseTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap · &copy; CARTO', crossOrigin: true, maxZoom: 19,
  }).addTo(map);
  satTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri · Maxar, Earthstar Geographics', crossOrigin: true, maxZoom: 19,
  });
  map.createPane('planoDiretor');
  map.getPane('planoDiretor').style.zIndex = 370; // abaixo dos bairros e dos marcadores
  map.createPane('bairros');
  map.getPane('bairros').style.zIndex = 380; // abaixo do overlayPane (400): bairros nunca cobrem marcadores
  empLayer = L.layerGroup().addTo(map);
  terrenoLayer = L.layerGroup().addTo(map);
  pontoLayer = L.layerGroup();
  bairroLayer = L.layerGroup();
  semDataLayer = L.layerGroup();
  // com os sem previsão embutidos no OF_DATA a camada nasce ligada (e filtrável)
  if (semDataOn) { map.addLayer(semDataLayer); const c = $('#lyrSemData'); if (c) c.checked = true; }
  renderBairros();
  $('#lyrEmp').onchange = e => e.target.checked ? map.addLayer(empLayer) : map.removeLayer(empLayer);
  $('#lyrSemData').onchange = async e => {
    semDataOn = e.target.checked;
    if (semDataOn) {
      try { await loadSemDataEmps(); }
      catch (err) { console.error(err); alert('Não consegui carregar os terrenos sem previsão: ' + err.message); e.target.checked = semDataOn = false; return; }
      map.addLayer(semDataLayer);
    } else map.removeLayer(semDataLayer);
    linkKmzFeatures(); // com os sem-data no jogo, terrenos do KMZ deles ganham vínculo por nome
    renderSemDataLayer();
    renderKmzLayers();
    renderRadar();
  };
  $('#lyrTerrenos').onchange = e => e.target.checked ? map.addLayer(terrenoLayer) : map.removeLayer(terrenoLayer);
  $('#lyrPontos').onchange = e => e.target.checked ? map.addLayer(pontoLayer) : map.removeLayer(pontoLayer);
  // opcional: renderBairros() remove o controle quando não há camada de bairros carregada
  const chkBairros = $('#lyrBairros');
  if (chkBairros) chkBairros.onchange = e => e.target.checked ? map.addLayer(bairroLayer) : map.removeLayer(bairroLayer);
  $('#lyrSat').onchange = e => {
    if (e.target.checked) { map.removeLayer(baseTiles); satTiles.addTo(map); }
    else { map.removeLayer(satTiles); baseTiles.addTo(map); }
  };
  renderKmzLayers();
}
/* nomes de bairro: dados usam "SETOR SUL"/"JARDIM GOIAS", KMZ usa "SUL"/"GOIAS" — normaliza os dois lados */
const BAIRRO_STOP = /^(SETOR|SET|JARDIM|JD|VILA|VL|PARQUE|PQ|RESIDENCIAL|RES|CONJUNTO|CONJ|CHACARA|CHACARAS|BAIRRO|FAZENDA|FAZ|LOTEAMENTO|LOT|CIDADE|DA|DO|DAS|DOS|DE)\s+/;
function bairroKey(s) { let k = textKey(s); let p; do { p = k; k = k.replace(BAIRRO_STOP, ''); } while (k !== p && k); return k || textKey(s); }
let bairroRenderer = null;
function renderBairros(keys) {
  bairroLayer.clearLayers();
  const B = window.OF_BAIRROS || { features: [] };
  if (!B.features.length) { $('#lyrBairros')?.closest('label')?.remove(); return; }
  const renderer = bairroRenderer = bairroRenderer || L.canvas({ pane: 'bairros' }); // canvas único: 1149 polígonos sem pesar o SVG nem acumular canvases
  B.features.forEach(f => {
    if (keys && !keys.has(bairroKey(f.name))) return;
    L.polygon(f.coords, { pane: 'bairros', renderer, color: f.color, weight: 1.1, opacity: .75, fillColor: f.color, fillOpacity: .28 })
      .bindTooltip(f.name, { sticky: true, direction: 'top', className: 'bairro-tip' })
      .addTo(bairroLayer);
  });
}
let lastBairroFilterKey = null;
function updateBairroLayer() {
  if (!map) return;
  const key = [...state.bairro].sort().join('|');
  if (key === lastBairroFilterKey) return;
  lastBairroFilterKey = key;
  if (state.bairro.size) {
    renderBairros(new Set([...state.bairro].map(bairroKey)));
    const chk = $('#lyrBairros');
    if (chk) chk.checked = true;
    if (!map.hasLayer(bairroLayer)) map.addLayer(bairroLayer);
  } else {
    renderBairros();
  }
}
function renderKmzLayers() {
  terrenoLayer.clearLayers(); pontoLayer.clearLayers();
  const porId = Object.fromEntries(allEmps().map(e => [e.id, e]));
  visibleKmzFeatures().forEach(f => {
    const p = f.properties || {};
    const emp = p._empId ? porId[p._empId] : null;
    const sub = emp ? escapeHtml(emp.empreendimento) + ' · ' : '';
    if (f.geometry.type === 'Polygon') {
      const latlngs = f.geometry.coordinates[0].map(c => [c[1], c[0]]);
      L.polygon(latlngs, { color: p.stroke || BLUE, weight: 1.6, fillColor: p.fill || BLUE, fillOpacity: .28 })
        .bindPopup(`<div class="map-pop"><b>${escapeHtml(p.name)}</b><span class="mono">${sub}TERRENO</span>${emp ? `<button onclick="window.openFichaById('${emp.id}')">VER FICHA COMPLETA</button>` : ''}</div>`)
        .addTo(terrenoLayer);
    } else if (f.geometry.type === 'Point') {
      const [lng, lat] = f.geometry.coordinates;
      L.circleMarker([lat, lng], { radius: 5, color: '#fff', weight: 1.4, fillColor: p.color || BLUE, fillOpacity: .9 })
        .bindPopup(`<div class="map-pop"><b>${escapeHtml(p.name)}</b><span class="mono">${sub}LOCALIZAÇÃO · KMZ</span></div>`)
        .addTo(pontoLayer);
    }
  });
}
function renderMap() {
  if (!map) return;
  updateBairroLayer();
  renderKmzLayers();
  empLayer.clearLayers();
  const pts = [];
  filtered.forEach(e => {
    if (e.lat == null || e.lng == null) return;
    pts.push([e.lat, e.lng]);
    const isEbm = textKey(e.incorporadora) === 'EBM';
    const base = isEbm ? NAVY : RED, hover = isEbm ? RED : NAVY;
    const mk = L.circleMarker([e.lat, e.lng], { radius: 8, color: '#fff', weight: 2, fillColor: base, fillOpacity: .95 });
    mk.bindPopup(`<div class="map-pop"><b>${escapeHtml(e.empreendimento)}</b><span class="mono">${escapeHtml(e.bairro || '')} · ${ymLabel((e.dtLancamento || '').slice(0, 7))} · ${fmtInt(e.totalUnidades)} UNIDS</span><button onclick="window.openFichaById('${e.id}')">VER FICHA COMPLETA</button></div>`);
    mk.on('mouseover', function () { this.setStyle({ fillColor: hover, radius: 10 }); });
    mk.on('mouseout', function () { this.setStyle({ fillColor: base, radius: 8 }); });
    empMarkers[e.id] = mk;
    mk.addTo(empLayer);
  });
  renderSemDataLayer();
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(.15));
}
/* clique na linha do radar: voa até o empreendimento no mapa e abre o popup */
function locateOnMap(id) {
  const e = empById(id);
  if (!map || !e || e.lat == null || e.lng == null) return;
  document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  map.setView([e.lat, e.lng], Math.max(map.getZoom(), 16));
  const mk = empMarkers[id];
  if (mk) setTimeout(() => mk.openPopup(), 350);
}

/* ---------- gráficos ---------- */
let chartDisp, chartLanc;
Chart.defaults.font.family = "'IBM Plex Mono', monospace";
Chart.defaults.font.size = 10;
Chart.defaults.color = GRAY;
/* rótulos de dados (liga/desliga no dock de configurações) */
let showDataLabels = localStorage.getItem('ofDashboardDataLabels') === '1';
/* mês de referência (ponto vermelho da oferta disponível) — configurável no dock; padrão = mês atual */
let refMonth = localStorage.getItem('ofDashboardRefMonth') || nowYM();
const dataLabelsPlugin = {
  id: 'ofDataLabels',
  afterDatasetsDraw(chart) {
    if (!showDataLabels) return;
    const ctx = chart.ctx, n = chart.data.labels.length;
    const step = Math.max(1, Math.ceil(n / 24)); // pula rótulos quando há muitos pontos
    ctx.save();
    ctx.font = "600 9px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'center';
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;                          // série desligada na legenda
      meta.data.forEach((el, i) => {
        if (i % step) return;
        const v = ds.data[i];
        if (!v || !el) return;                          // zero não vira rótulo
        /* barra: rótulo NA VERTICAL dentro do segmento, em branco. Se a barra for
           mais baixa que o texto rotacionado, fica sem rótulo (melhor sem do que
           esmagado ou vazando para fora do segmento). */
        if (el.base !== undefined) {
          const txt = fmtInt(v);
          const altura = Math.abs(el.base - el.y);
          if (altura < ctx.measureText(txt).width + 8) return;   // não cabe: sem rótulo
          ctx.save();
          ctx.translate(el.x, (el.y + el.base) / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(txt, 0, 0);
          ctx.restore();
        } else {
          ctx.fillStyle = NAVY; ctx.textBaseline = 'bottom';
          ctx.fillText(fmtInt(v), el.x, el.y - 4);
        }
      });
    });
    ctx.restore();
  }
};
/* o filtro de período recorta também o eixo do tempo: com Jan–Jun/26 selecionado,
   os gráficos mostram só esses meses, e não os 18 meses de projeção de cada produto */
const noPeriodo = m => (!state.from || m >= state.from) && (!state.to || m <= state.to);
/* ---------- grão dos gráficos com filtro de quebra ----------
   Tipologia e faixa de m² selecionam UNIDADES, não empreendimentos: filtrando
   "50 – 70 m²" o gráfico conta as unidades de 50-70, e não o estoque inteiro dos
   empreendimentos que têm alguma unidade nessa faixa (era assim antes, e por isso
   o número não fechava com o mesmo filtro na planilha da síntese).
   Os dois filtros juntos usam o cruzamento `tf` gravado pelo pipeline — somar as
   duas quebras contaria as mesmas unidades duas vezes. */
function celDisp(cel) {
  const t = state.tipologia, f = state.faixa;
  if (!t.size && !f.size) return cel.disp || 0;
  if (t.size && f.size) {
    let v = 0;
    Object.entries(cel.tf || {}).forEach(([k, n]) => {
      const p = k.split('|');
      if (t.has(p[0]) && f.has(p[1])) v += n;
    });
    return v;
  }
  const sel = t.size ? t : f, d = (t.size ? cel.tip : cel.fx) || {};
  let v = 0;
  sel.forEach(k => { v += d[k] || 0; });
  return v;
}
/* mesma regra para o lançamento, que é contado pelas tipologias do empreendimento */
function unidsLancadas(e) {
  const t = state.tipologia, f = state.faixa;
  if (!t.size && !f.size) return e.totalUnidades || 0;
  return (e.tipologias || []).reduce((s, x) => {
    const okT = !t.size || t.has(String(x.tratada != null ? x.tratada : x.tipologia));
    const okF = !f.size || f.has(faixaKeyOf(x));
    return s + (okT && okF ? (x.unids || 0) : 0);
  }, 0);
}
function monthlySeries(emps) {
  const acc = {};
  emps.forEach(e => (e.mensal || []).forEach(x => { if (noPeriodo(x.m)) acc[x.m] = (acc[x.m] || 0) + celDisp(x); }));
  return Object.entries(acc).sort((a, b) => a[0].localeCompare(b[0]));
}
function launchSeries(emps) {
  const acc = {};
  emps.forEach(e => { const m = (e.dtLancamento || '').slice(0, 7); if (m && noPeriodo(m)) acc[m] = (acc[m] || 0) + unidsLancadas(e); });
  return Object.entries(acc).sort((a, b) => a[0].localeCompare(b[0]));
}
/* visão Detalhado: quebra por nº de quartos (0 = comercial) ou por faixa de m² */
let detalhado = false, detMode = 'tip';
/* 'sem' = tipologia não informada. Existe pelo mesmo motivo do 'f0' da faixa de m²:
   sem um balde para o desconhecido, essas unidades ou somem do gráfico ou entram
   como COMERCIAL — que é o código 0 de verdade, e aí vira dado inventado. */
const TIP_KEYS = ['1', '2', '3', '4', '0', 'sem'];
const TIP_LABELS = { '0': 'COMERCIAL', '1': '1Q', '2': '2Q', '3': '3Q', '4': '4Q+', sem: 'SEM TIPOLOGIA INFORMADA' };
const TIP_COLORS = { '1': '#9DB2D9', '2': '#5B79B4', '3': '#3A5AA0', '4': '#0C1F55', '0': '#C8102E', sem: '#98A2B3' };
/* rampa navy do claro ao escuro: 9 faixas + o balde de área não informada */
const FAIXA_COLORS = { f1: '#CFDAEE', f2: '#B4C5E3', f3: '#9AB0D7', f4: '#7F9BCB', f5: '#6486BF',
  f6: '#4A6FAF', f7: '#35558F', f8: '#213C73', f9: '#0C1F55', f0: '#98A2B3' };
const tipKeyOf = t => {
  const v = t != null && t.tratada !== undefined ? t.tratada : t;
  if (v == null || v === '') return 'sem';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'sem';
  return n > 0 ? String(Math.min(Math.round(n), 4)) : '0';   // 0 é comercial de verdade
};
/* rótulo de uma tipologia crua ('0', '2', 'Sala Comercial'): 0 é COMERCIAL, não "0Q" */
const rotuloTipologia = v => /^\d+$/.test(String(v)) ? (TIP_LABELS[tipKeyOf(v)] || String(v)) : String(v);
/* 'f0' = área privativa não informada; sem esse balde a quebra por faixa não fecha com o total */
const faixaKeyOf = t => { const a = t && t.area; if (a == null) return 'f0'; const f = FAIXAS.find(f => a >= f.min && a < f.max); return f ? f.id : 'f0'; };
/* configuração da quebra ativa — o pipeline grava as duas em cada mês (campos tip e fx) */
function quebra() {
  return detMode === 'faixa'
    ? { keys: [...FAIXAS.map(f => f.id), 'f0'],
        labels: { ...Object.fromEntries(FAIXAS.map(f => [f.id, f.label.toUpperCase()])), f0: 'SEM ÁREA INFORMADA' },
        colors: FAIXA_COLORS, campo: 'fx', keyOf: faixaKeyOf, semInfo: 'f0' }
    : { keys: TIP_KEYS, labels: TIP_LABELS, colors: TIP_COLORS, campo: 'tip', keyOf: tipKeyOf, semInfo: 'sem' };
}
/* baldes da quebra ativa já cruzados com os filtros de quebra: com filtro na MINHA
   dimensão sobram só os baldes escolhidos; com filtro na OUTRA, cada balde conta só
   a parte que também atende lá (vem do cruzamento `tf`) */
function celQuebra(cel, campo) {
  const meu = campo === 'tip' ? state.tipologia : state.faixa;
  const outro = campo === 'tip' ? state.faixa : state.tipologia;
  const base = cel[campo] || {};
  if (!meu.size && !outro.size) return base;
  const out = {};
  if (outro.size) {
    Object.entries(cel.tf || {}).forEach(([k, n]) => {
      const p = k.split('|'), meuK = campo === 'tip' ? p[0] : p[1], outroK = campo === 'tip' ? p[1] : p[0];
      if ((!meu.size || meu.has(meuK)) && outro.has(outroK)) out[meuK] = (out[meuK] || 0) + n;
    });
    return out;
  }
  Object.entries(base).forEach(([k, v]) => { if (meu.has(k)) out[k] = v; });
  return out;
}
function monthlySeriesTip(emps) { // meses ordenados + série de disponíveis por chave da quebra
  const q = quebra(), acc = {};
  emps.forEach(e => (e.mensal || []).forEach(x => {
    if (!noPeriodo(x.m)) return;
    const cel = acc[x.m] = acc[x.m] || {};
    const dados = celQuebra(x, q.campo);
    if (dados && Object.keys(dados).length) {
      Object.entries(dados).forEach(([k, v]) => { cel[k] = (cel[k] || 0) + v; });
    } else if (!(x[q.campo] && Object.keys(x[q.campo]).length) && celDisp(x)) {
      /* sem quebra gravada (base importada por Excel, p.ex.): vai inteiro para o balde
         "sem informação". Ratear pela participação das tipologias daria um desenho
         convincente e falso — o total continua certo, a distribuição seria inventada.
         Com quebra gravada e filtro ativo, dados vazio significa "nada nessa quebra". */
      cel[q.semInfo] = (cel[q.semInfo] || 0) + celDisp(x);
    }
  }));
  const months = Object.keys(acc).sort();
  return { months, byTip: Object.fromEntries(q.keys.map(k => [k, months.map(m => acc[m][k] || 0)])) };
}
function launchUnitsByTip(e) { // unidades lançadas do empreendimento pela quebra ativa
  const q = quebra(), out = {};
  const t2 = state.tipologia, f2 = state.faixa;
  const passa = t => (!t2.size || t2.has(String(t.tratada != null ? t.tratada : t.tipologia)))
    && (!f2.size || f2.has(faixaKeyOf(t)));
  const tot = (e.tipologias || []).reduce((s, t) => s + (t.unids || 0), 0);
  if (tot) (e.tipologias || []).forEach(t => { const k = q.keyOf(t); if (k && passa(t)) out[k] = (out[k] || 0) + (t.unids || 0); });
  // empreendimento sem tipologia cadastrada: as unidades vão para o balde "sem informação",
  // nos dois modos. Antes caíam em COMERCIAL no modo tipologia e sumiam no modo faixa.
  else if (e.totalUnidades) out[q.semInfo] = e.totalUnidades;
  return out;
}
/* modos de período dos dois gráficos: mês, trimestre, ano, LTM (regras do dashboard
   leadsebm). Lançamento é FLUXO e soma dentro do período; estoque é NÍVEL e não soma
   — ver stockPontos/stockValor. */
let periodoModo = 'month';
const periodKeyOF = (m, mode) => mode === 'year' ? m.slice(0, 4) : mode === 'quarter' ? m.slice(0, 4) + '-T' + Math.ceil(+m.slice(5, 7) / 3) : m;
const periodLabelOF = (k, mode) => mode === 'year' ? k : mode === 'quarter' ? 'T' + k.slice(6) + '/' + k.slice(2, 4) : mode === 'ltm' ? ymLabel(k) + ' LTM' : ymLabel(k);
function ltmLaunchSeries(emps) {
  const monthly = launchSeries(emps);
  const acum = new Map(monthly.map(([m, v]) => [ymIdx(m), v]));
  return monthly.map(([m]) => { const i = ymIdx(m); let s = 0; for (let k = i - 11; k <= i; k++) s += acum.get(k) || 0; return [m, s]; });
}
function launchSeriesByMode(emps, mode) {
  if (mode === 'ltm') return ltmLaunchSeries(emps);
  if (mode === 'month') return launchSeries(emps);
  const acc = {};
  emps.forEach(e => { const m = (e.dtLancamento || '').slice(0, 7); if (m && noPeriodo(m)) { const k = periodKeyOF(m, mode); acc[k] = (acc[k] || 0) + unidsLancadas(e); } });
  return Object.entries(acc).sort((a, b) => a[0].localeCompare(b[0]));
}
const ymIdx = m => +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1);
const idxYm = i => String(Math.floor(i / 12)).padStart(4, '0') + '-' + String(i % 12 + 1).padStart(2, '0');
/* ---------- estoque nos modos de período ----------
   Estoque é POSIÇÃO, não fluxo: somar os meses de um trimestre contaria a mesma
   unidade três vezes. Trimestre e ano mostram o estoque do ÚLTIMO mês do período
   (fechamento) e LTM a média móvel dos 12 meses até ali. Cada ponto guarda o mês
   que representa, para o tooltip abrir a composição do mês certo. */
function stockPontos(meses, mode) {
  if (mode !== 'quarter' && mode !== 'year') return meses.map(m => ({ k: m, m }));
  const acc = new Map();
  meses.forEach(m => acc.set(periodKeyOF(m, mode), m));   // meses ordenados: fica o último
  return [...acc.entries()].map(([k, m]) => ({ k, m }));
}
function stockValor(map, p, mode) {
  if (mode !== 'ltm') return map.get(p.m) || 0;
  const i = ymIdx(p.m);
  let soma = 0, n = 0;
  for (let j = i - 11; j <= i; j++) { const v = map.get(idxYm(j)); if (v != null) { soma += v; n++; } }
  return n ? soma / n : 0;
}
function launchSeriesTipByMode(emps, mode) {
  const chaves = quebra().keys;
  const acc = {}; // 'YYYY-MM' -> {chave: unidades}
  emps.forEach(e => {
    const m = (e.dtLancamento || '').slice(0, 7); if (!m || !noPeriodo(m)) return;
    const cel = acc[m] = acc[m] || {};
    Object.entries(launchUnitsByTip(e)).forEach(([k, v]) => { cel[k] = (cel[k] || 0) + v; });
  });
  const months = Object.keys(acc).sort();
  if (mode === 'ltm') {
    const map = new Map(months.map(m => [ymIdx(m), acc[m]]));
    return { keys: months, byTip: Object.fromEntries(chaves.map(k => [k, months.map(m => { const i = ymIdx(m); let s = 0; for (let j = i - 11; j <= i; j++) s += (map.get(j) || {})[k] || 0; return s; })])) };
  }
  const pacc = {};
  months.forEach(m => { const pk = periodKeyOF(m, mode); const cel = pacc[pk] = pacc[pk] || {}; Object.entries(acc[m]).forEach(([k, v]) => { cel[k] = (cel[k] || 0) + v; }); });
  const keys = Object.keys(pacc).sort();
  return { keys, byTip: Object.fromEntries(chaves.map(k => [k, keys.map(pk => pacc[pk][k] || 0)])) };
}
/* listas de empreendimentos p/ tooltip */
const TT_MAX = 12;
function empsLaunchedInPeriod(k, mode) {
  return filtered.filter(e => {
    const m = (e.dtLancamento || '').slice(0, 7); if (!m) return false;
    if (mode === 'ltm') return ymIdx(m) >= ymIdx(k) - 11 && ymIdx(m) <= ymIdx(k);
    return periodKeyOF(m, mode) === k;
  }).sort((a, b) => (b.totalUnidades || 0) - (a.totalUnidades || 0));
}
function launchTooltipList(k, mode) {
  const list = empsLaunchedInPeriod(k, mode).filter(e => unidsLancadas(e) > 0);
  if (!list.length) return [];
  const lines = list.slice(0, TT_MAX).map(e => `${e.empreendimento} · ${fmtInt(unidsLancadas(e))} un.`);
  if (list.length > TT_MAX) lines.push(`… +${list.length - TT_MAX} empreendimentos`);
  lines.push(`TOTAL · ${list.length} emp. · ${fmtInt(list.reduce((s, e) => s + unidsLancadas(e), 0))} un.`);
  return lines;
}
function dispTooltipList(m, emps) {
  const list = (emps || filtered).map(e => { const c = (e.mensal || []).find(x => x.m === m); return { e, d: c ? celDisp(c) : 0 }; })
    .filter(x => x.d > 0).sort((a, b) => b.d - a.d);
  if (!list.length) return [];
  const lines = list.slice(0, TT_MAX).map(x => `${x.e.empreendimento} · ${fmtInt(x.d)} un.`);
  if (list.length > TT_MAX) lines.push(`… +${list.length - TT_MAX} empreendimentos · ${fmtInt(list.slice(TT_MAX).reduce((s, x) => s + x.d, 0))} un.`);
  return lines;
}
/* ---------- mercado (síntese) com dimensões ----------
   Base instalada: os empreendimentos já lançados que formam o estoque do mercado.
   Fica FORA de `empreendimentos` de propósito — nenhum KPI, tabela, filtro ou mapa
   enxerga esses registros; só a curva de estoque os soma.
   O pipeline já tira daqui quem também está na projeção (não conta duas vezes). */
let mercadoEmps = (window.OF_DATA && OF_DATA.mercado) || [];
/* o mercado não obedece ao filtro de PERÍODO DE LANÇAMENTO: são projetos lançados
   no passado, e o período do dashboard é a janela da projeção — aplicá-lo zeraria
   o mercado inteiro, que é justamente o que a curva precisa mostrar. Os cortes de
   bairro, incorporadora, tipo, tipologia, faixa e macrozona valem normalmente. */
const mercadoFiltrado = () => mercadoEmps.filter(e => empMatches(e, false));
const temFiltroEntidade = () => ['empreendimento', 'macrozona', 'bairro', 'incorporadora', 'tipo', 'tipologia', 'faixa'].some(k => state[k].size);
const SUB_MODO = { month: '', quarter: ' · Tri = estoque no fechamento do trimestre',
  year: ' · Ano = estoque no fechamento do ano', ltm: ' · LTM = média móvel de 12 meses' };
/* no modo mês o ponto é o próprio mês; nos outros o tooltip precisa dizer que mês
   está por trás do número, senão "T3/26 · 12.480 un." não se explica */
const rotuloPonto = p => periodoModo === 'month' ? []
  : periodoModo === 'ltm' ? [`MÉDIA DOS ÚLTIMOS 12 MESES · composição de ${ymLabel(p.m)}`]
    : [`POSIÇÃO DE ${ymLabel(p.m)} · fechamento do período`];
function atualizarSubEstoque() {
  const el = $('#dispSub'); if (!el) return;
  el.textContent = 'Estoque projetado: mercado + lançamentos previstos'
    + (temFiltroEntidade() ? ' · no recorte dos filtros' : '')
    + ' · ponto vermelho = mês de referência' + SUB_MODO[periodoModo];
}
function renderCharts() {
  const ref = refMonth;
  const legendCfg = { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 12 } };
  atualizarSubEstoque();
  /* base do estoque = mercado (síntese) + projeção, os dois no recorte dos filtros.
     O eixo vai só até onde a síntese foi projetada (data base +18 meses): a projeção
     de um lançamento no fim da janela segue 18 meses além disso, e sem o corte a soma
     viraria só os lançamentos, despencando de mentira. */
  const janela = new Set((DATA.mercadoMensal || []).map(x => x[0]));
  const mercEmps = mercadoFiltrado();
  const cortar = meses => janela.size ? meses.filter(m => janela.has(m)) : meses;
  if (chartDisp) chartDisp.destroy();
  if (detalhado) {
    const { months, byTip } = monthlySeriesTip(filtered.concat(mercEmps));
    const meses = cortar(months);
    const pontos = stockPontos(meses, periodoModo);
    const q = quebra();
    const refIdx = pontos.findIndex(p => p.m === ref);
    const dsets = q.keys.filter(k => byTip[k].some(v => v > 0)).map(k => {
      const map = new Map(months.map((m, i) => [m, byTip[k][i]]));
      return {
        label: q.labels[k], data: pontos.map(p => Math.round(stockValor(map, p, periodoModo))),
        borderColor: q.colors[k], backgroundColor: q.colors[k], fill: false, tension: .3, borderWidth: 2,
        pointRadius: pontos.map((p, i) => i === refIdx ? 4 : 2), pointBackgroundColor: q.colors[k],
      };
    });
    chartDisp = new Chart($('#chartDisp'), {
      type: 'line',
      data: { labels: pontos.map(p => periodLabelOF(p.k, periodoModo)), datasets: dsets },
      plugins: [dataLabelsPlugin],
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: legendCfg, tooltip: { callbacks: {
          label: c => ` ${c.dataset.label} · ${fmtInt(c.parsed.y)} un.${pontos[c.dataIndex].m === ref ? ' · mês de referência' : ''}`,
          afterBody: items => items.length ? ['', ...rotuloPonto(pontos[items[0].dataIndex]),
            ...dispTooltipList(pontos[items[0].dataIndex].m, filtered.concat(mercEmps))] : [],
        } } },
        scales: { y: { grid: { color: HAIR }, ticks: { callback: v => fmtInt(v) } }, x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 14 } } } }
    });
  } else {
    /* curva ÚNICA: estoque do mercado + estoque dos previstos a lançar, somados mês a
       mês — a projeção de estoque total se o mercado se comportar como a base prevê. */
    const ofMap = new Map(monthlySeries(filtered));
    /* sem o array `mercado` no dados_of.js (base gerada por um pipeline antigo) cai na
       regra velha: série global da síntese, que só vale quando não há filtro de entidade */
    const mercMap = mercadoEmps.length ? new Map(monthlySeries(mercEmps))
      : (temFiltroEntidade() ? new Map() : new Map(DATA.mercadoMensal || []));
    const meses = cortar([...new Set([...ofMap.keys(), ...mercMap.keys()])].sort());
    const pontos = stockPontos(meses, periodoModo);
    const total = new Map(meses.map(m => [m, (ofMap.get(m) || 0) + (mercMap.get(m) || 0)]));
    const serie = pontos.map(p => stockValor(total, p, periodoModo));
    const refIdx = pontos.findIndex(p => p.m === ref);
    chartDisp = new Chart($('#chartDisp'), {
      type: 'line',
      data: { labels: pontos.map(p => periodLabelOF(p.k, periodoModo)), datasets: [{
        label: 'Estoque projetado (mercado + lançamentos)' + (temFiltroEntidade() ? ' · recorte dos filtros' : ''),
        data: serie.map(v => Math.round(v)),
        borderColor: NAVY, backgroundColor: 'rgba(12,31,85,.06)', fill: true, tension: .3, borderWidth: 2,
        pointRadius: pontos.map((p, i) => i === refIdx ? 6 : 2.5),
        pointBackgroundColor: pontos.map((p, i) => i === refIdx ? RED : NAVY),
        pointBorderColor: pontos.map((p, i) => i === refIdx ? '#fff' : NAVY),
        pointBorderWidth: pontos.map((p, i) => i === refIdx ? 2 : 1),
      }]},
      plugins: [dataLabelsPlugin],
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: legendCfg, tooltip: { callbacks: {
        label: c => ' ' + fmtInt(c.parsed.y) + ' unidades' + (pontos[c.dataIndex].m === ref ? ' · mês de referência' : ''),
        afterBody: items => {
          if (!items.length) return [];
          const p = pontos[items[0].dataIndex];
          const partes = [];
          if (mercMap.size) partes.push(`MERCADO (síntese) · ${fmtInt(mercMap.get(p.m) || 0)} un.`,
                                        `LANÇAMENTOS · ${fmtInt(ofMap.get(p.m) || 0)} un.`);
          return ['', ...rotuloPonto(p), ...partes, ...dispTooltipList(p.m, filtered.concat(mercEmps))];
        },
      } } },
        scales: { y: { grid: { color: HAIR }, ticks: { callback: v => fmtInt(v) } }, x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 14 } } } }
    });
  }
  const lref = periodoModo === 'ltm' ? ref : periodKeyOF(ref, periodoModo);
  if (chartLanc) chartLanc.destroy();
  if (detalhado) {
    const { keys, byTip } = launchSeriesTipByMode(filtered, periodoModo);
    const q = quebra();
    const dsets = q.keys.filter(k => byTip[k].some(v => v > 0)).map(k => ({
      label: q.labels[k], data: byTip[k].map(v => Math.round(v)),
      backgroundColor: q.colors[k], borderRadius: 2, maxBarThickness: 26,
    }));
    chartLanc = new Chart($('#chartLanc'), {
      type: 'bar',
      data: { labels: keys.map(k => periodLabelOF(k, periodoModo)), datasets: dsets },
      plugins: [dataLabelsPlugin],
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: legendCfg, tooltip: { callbacks: {
          label: c => ` ${c.dataset.label} · ${fmtInt(c.parsed.y)}${periodoModo === 'ltm' ? ' un. · últimos 12 meses' : ' un. lançadas'}`,
          afterBody: items => items.length ? ['', ...launchTooltipList(keys[items[0].dataIndex], periodoModo)] : [],
        } } },
        scales: { y: { stacked: true, grid: { color: HAIR }, ticks: { callback: v => fmtInt(v) } }, x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 16 } } } }
    });
  } else {
    const lserie = launchSeriesByMode(filtered, periodoModo);
    chartLanc = new Chart($('#chartLanc'), {
      type: 'bar',
      data: { labels: lserie.map(x => periodLabelOF(x[0], periodoModo)), datasets: [{ data: lserie.map(x => Math.round(x[1])), backgroundColor: lserie.map(x => x[0] === lref ? RED : BLUE), borderRadius: 3, maxBarThickness: 26 }] },
      plugins: [dataLabelsPlugin],
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: c => ' ' + fmtInt(c.parsed.y) + (periodoModo === 'ltm' ? ' unidades lançadas · últimos 12 meses' : ' unidades lançadas'),
        afterBody: items => items.length ? ['', ...launchTooltipList(lserie[items[0].dataIndex][0], periodoModo)] : [],
      } } },
        scales: { y: { grid: { color: HAIR }, ticks: { callback: v => fmtInt(v) } }, x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 16 } } } }
    });
  }
}

/* ============================================================
   ORDENAÇÃO DAS TABELAS
   Coluna de texto começa em A→Z; coluna numérica começa do maior
   (padrão de BI). O segundo clique inverte. Vazio fica sempre por último.
   ============================================================ */
const ordens = {
  pivotTable: { k: 'g', asc: true },
  incTable: { k: 'projetos', asc: false },
  concTable: { k: 'unidades', asc: false },
};
function cabecalhoOrdenavel(id, cols) {
  const o = ordens[id];
  return '<thead><tr>' + cols.map(c => {
    if (c.fixa) return `<th>${c.label}</th>`;
    const ind = o.k === c.k ? ` <i class="sort-ind">${o.asc ? '↑' : '↓'}</i>` : '';
    return `<th class="th-sort" data-k="${escapeHtml(c.k)}" data-t="${c.num ? 'num' : 'txt'}">${c.label}${ind}</th>`;
  }).join('') + '</tr></thead>';
}
function ligarOrdenacao(id, redesenhar) {
  $$(`#${id} th.th-sort`).forEach(th => th.onclick = () => {
    const o = ordens[id], k = th.dataset.k;
    if (o.k === k) o.asc = !o.asc; else { o.k = k; o.asc = th.dataset.t !== 'num'; }
    redesenhar();
  });
}
function cmpOrd(a, b, asc) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const d = (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b), 'pt-BR');
  return asc ? d : -d;
}
/* ordena a árvore inteira pela mesma coluna: cada nível ordena entre irmãos */
function ordenarArvore(nos, id, valor) {
  const o = ordens[id];
  const ordena = arr => {
    arr.forEach(n => { if (n.filhos) n.filhos = ordena(n.filhos); });
    return [...arr].sort((a, b) => cmpOrd(valor(a, o.k), valor(b, o.k), o.asc));
  };
  return ordena(nos);
}
/* ---------- largura de coluna arrastável (estilo Power BI) ----------
   As larguras ficam por tabela e por índice de coluna, fora do DOM: as tabelas são
   redesenhadas por innerHTML a cada ordenação e a largura precisa sobreviver a isso.
   Ao arrastar pela primeira vez, congela a largura de todas as colunas e passa a
   table-layout:fixed — sem isso o navegador redistribui tudo a cada arraste. */
const larguras = {};
function aplicarLarguras(id) {
  const tabela = $('#' + id), larg = larguras[id];
  if (!tabela || !tabela.tHead || !larg) return;
  tabela.classList.add('col-fixa');
  [...tabela.tHead.rows[0].cells].forEach((th, i) => { if (larg[i]) th.style.width = larg[i] + 'px'; });
}
function congelarLarguras(id) {
  const tabela = $('#' + id);
  const larg = larguras[id] = larguras[id] || {};
  [...tabela.tHead.rows[0].cells].forEach((th, i) => {
    if (!larg[i]) larg[i] = Math.round(th.getBoundingClientRect().width);
  });
  aplicarLarguras(id);
}
function ligarLarguras(id) {
  const tabela = $('#' + id);
  if (!tabela || !tabela.tHead) return;
  aplicarLarguras(id);
  [...tabela.tHead.rows[0].cells].forEach((th, i) => {
    if (th.querySelector('.col-grip')) return;
    const alca = document.createElement('span');
    alca.className = 'col-grip';
    alca.title = 'Arraste para mudar a largura · duplo clique restaura';
    alca.onclick = ev => ev.stopPropagation();          // não ordenar ao soltar a alça
    alca.ondblclick = ev => {
      ev.stopPropagation();
      delete larguras[id];
      tabela.classList.remove('col-fixa');
      [...tabela.tHead.rows[0].cells].forEach(c => { c.style.width = ''; });
    };
    alca.onmousedown = ev => {
      ev.preventDefault(); ev.stopPropagation();
      congelarLarguras(id);
      const x0 = ev.clientX, w0 = larguras[id][i];
      const mover = e => { larguras[id][i] = Math.max(48, w0 + e.clientX - x0); aplicarLarguras(id); };
      const soltar = () => {
        document.removeEventListener('mousemove', mover);
        document.removeEventListener('mouseup', soltar);
        document.body.classList.remove('redimensionando');
      };
      document.addEventListener('mousemove', mover);
      document.addEventListener('mouseup', soltar);
      document.body.classList.add('redimensionando');
    };
    th.appendChild(alca);
  });
}

/* ---------- tabelas em árvore (2 ou 3 níveis) ----------
   Cada linha carrega o caminho do nó ('0', '0-2', '0-2-1') e a classe do nível.
   Uma linha aparece quando todos os seus ancestrais estão abertos — a regra é a
   mesma para qualquer profundidade, então tipo→incorporadora→empreendimento e
   incorporadora→empreendimento usam o mesmo código. */
function linhasArvore(nos, celulas, caminho = []) {
  let html = '';
  nos.forEach((no, i) => {
    const trilha = [...caminho, i], nivel = caminho.length;
    const cls = 'n' + nivel + ((no.filhos && no.filhos.length) ? ' tem-filhos' : '');
    const idAttr = no.id != null ? ` data-id="${escapeHtml(String(no.id))}"` : '';
    html += `<tr class="${cls}" data-path="${trilha.join('-')}"${idAttr}>${celulas(no, nivel)}</tr>`;
    html += linhasArvore(no.filhos || [], celulas, trilha);
  });
  return html;
}
function ligarArvore(id, aoClicarFolha) {
  const linhas = $$(`#${id} tr[data-path]`);
  const porPath = Object.fromEntries(linhas.map(tr => [tr.dataset.path, tr]));
  const visivel = tr => {
    const p = tr.dataset.path, corte = p.lastIndexOf('-');
    if (corte < 0) return true;                      // nível 0 está sempre à vista
    const pai = porPath[p.slice(0, corte)];
    return !!pai && pai.classList.contains('open') && visivel(pai);
  };
  const atualizar = () => linhas.forEach(tr => tr.classList.toggle('show', visivel(tr)));
  linhas.forEach(tr => tr.onclick = ev => {
    ev.stopPropagation();
    if (tr.classList.contains('tem-filhos')) { tr.classList.toggle('open'); atualizar(); return; }
    if (aoClicarFolha && tr.dataset.id) aoClicarFolha(tr.dataset.id);
  });
  atualizar();
}

/* ---------- pivot: unidades por tipologia ----------
   Hierarquia tipo de empreendimento → incorporadora → empreendimento.
   O seletor de nível (drill) re-agrega a tabela começando na dimensão escolhida. */
let pivotNivel = 0;   // 0=tipo, 1=incorporadora, 2=empreendimento
/* a montagem dos dados fica separada do desenho porque o PDF reaproveita a mesma
   árvore — o relatório precisa sair idêntico ao que está na tela */
function dadosPivot() {
  const cols = [...new Set(filtered.flatMap(e => (e.tipologias || []).map(t => String(t.tratada != null ? t.tratada : t.tipologia))))].sort();
  const cell = (e, c) => (e.tipologias || []).filter(t => String(t.tratada != null ? t.tratada : t.tipologia) === c).reduce((s, t) => s + (t.unids || 0), 0);
  const somar = filhos => Object.fromEntries(cols.map(c => [c, filhos.reduce((s, f) => s + f.vals[c], 0)]));
  const total = vals => cols.reduce((s, c) => s + vals[c], 0);
  const noEmp = e => {
    const vals = Object.fromEntries(cols.map(c => [c, cell(e, c)]));
    return { nome: e.empreendimento || '—', id: e.id, vals, total: total(vals) };
  };
  const agrupar = (emps, chave, montarFilhos) => {
    const acc = {};
    emps.forEach(e => (acc[chave(e)] = acc[chave(e)] || []).push(e));
    return Object.entries(acc).map(([nome, grupo]) => {
      const filhos = montarFilhos(grupo);
      const vals = somar(filhos);
      return { nome, vals, total: total(vals), filhos };
    });
  };
  const porInc = emps => agrupar(emps, e => e.incorporadora || '—', g => g.map(noEmp));
  const linhas = pivotNivel === 2 ? filtered.map(noEmp)
    : pivotNivel === 1 ? porInc(filtered)
      : agrupar(filtered, e => e.tipo || '—', porInc);
  const valor = (r, k) => k === 'g' ? r.nome : k === 'total' ? r.total : r.vals[k];
  const gtot = Object.fromEntries(cols.map(c => [c, linhas.reduce((s, l) => s + l.vals[c], 0)]));
  const gsum = linhas.reduce((s, l) => s + l.total, 0);
  const rotulo = ['TIPO / INCORPORADORA / EMPREENDIMENTO', 'INCORPORADORA / EMPREENDIMENTO', 'EMPREENDIMENTO'][pivotNivel];
  return { cols, linhas: ordenarArvore(linhas, 'pivotTable', valor), gtot, gsum, rotulo };
}
function renderPivot() {
  const { cols, linhas: ordenadas, gtot, gsum, rotulo } = dadosPivot();
  const celula = v => v ? fmtInt(v) : '·';
  const celulas = (n, nivel) => `<td>${escapeHtml(n.nome)}</td>`
    + cols.map(c => `<td>${celula(n.vals[c])}</td>`).join('')
    + `<td>${nivel === 0 ? `<b>${fmtInt(n.total)}</b>` : fmtInt(n.total)}</td>`;
  const html = cabecalhoOrdenavel('pivotTable', [
    { k: 'g', label: rotulo },
    ...cols.map(c => ({ k: c, label: escapeHtml(rotuloTipologia(c)), num: true })),
    { k: 'total', label: 'TOTAL', num: true },
  ]) + '<tbody>' + linhasArvore(ordenadas, celulas)
    + `<tr class="total"><td>TOTAL GERAL</td>${cols.map(c => `<td>${fmtInt(gtot[c])}</td>`).join('')}<td>${fmtInt(gsum)}</td></tr></tbody>`;
  $('#pivotTable').innerHTML = html;
  ligarArvore('pivotTable', locateOnMap);
  ligarOrdenacao('pivotTable', renderPivot);
  ligarLarguras('pivotTable');
}

/* ---------- radar (tabela) ---------- */
const LINK_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M10 14a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.6 1.59" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 10a5 5 0 0 0-7.07 0l-2.83 2.83a5 5 0 0 0 7.07 7.07l1.59-1.59" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function sortedRows() {
  // só a projeção: os sem previsão têm a própria tabela no fim do dashboard
  let rows = filtered;
  if (searchTerm) { const q = textKey(searchTerm); rows = rows.filter(e => [e.empreendimento, e.bairro, e.incorporadora].some(v => textKey(v).includes(q))); }
  return [...rows].sort((a, b) => cmpOrd(a[sortKey], b[sortKey], sortAsc));
}
function renderRadar() {
  const rows = sortedRows();
  $('#radarBody').innerHTML = rows.map(e => `<tr data-id="${e.id}">
    <td class="td-center">${e.linkPortal ? `<a class="link-ico" href="${escapeHtml(e.linkPortal)}" target="_blank" rel="noopener" title="Abrir no portal" onclick="event.stopPropagation()">${LINK_SVG}</a>` : `<span class="link-ico off">${LINK_SVG}</span>`}</td>
    <td class="td-center">${e.linkProjeto ? `<a class="link-ico" href="${escapeHtml(e.linkProjeto)}" target="_blank" rel="noopener" title="Acompanhamento do projeto" onclick="event.stopPropagation()">${LINK_SVG}</a>` : `<span class="link-ico off">${LINK_SVG}</span>`}</td>
    <td><span class="rt-name">${escapeHtml(e.empreendimento)}</span></td>
    <td class="rt-date">${(e.dtLancamento || '—').slice(0, 7)}</td>
    <td class="rt-txt">${escapeHtml(e.incorporadora || '—')}</td>
    <td class="rt-txt">${escapeHtml(e.bairro || '—')}</td>
    <td class="rt-num">${fmtInt(e.areaTerreno)}</td>
    <td class="rt-num">${fmtInt(e.totalUnidades)}</td>
  </tr>`).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:30px">Nenhum empreendimento para os filtros atuais.</td></tr>`;
  $$('#radarBody tr[data-id]').forEach(tr => {
    tr.querySelector('.rt-name')?.addEventListener('click', () => openFichaModal(tr.dataset.id));
    tr.addEventListener('click', ev => { if (ev.target.closest('a, .rt-name')) return; locateOnMap(tr.dataset.id); });
  });
  const ind = $('#radarTable .sort-ind'); if (ind) ind.remove();
  const th = $(`#radarTable th[data-sort="${sortKey}"]`);
  if (th) th.insertAdjacentHTML('beforeend', ` <i class="sort-ind">${sortAsc ? '↑' : '↓'}</i>`);
}
$('#radarSearch')?.addEventListener('input', e => { searchTerm = e.target.value; renderRadar(); });
$$('#radarTable th[data-sort]').forEach(th => th.onclick = () => {
  const k = th.dataset.sort;
  /* texto e data começam em A→Z / mais antigo; número começa do maior */
  if (sortKey === k) sortAsc = !sortAsc; else { sortKey = k; sortAsc = !th.classList.contains('th-num'); }
  renderRadar();
});

/* ---------- radar dos sem previsão (última tabela do dashboard) ---------- */
let spSortKey = 'empreendimento', spSortAsc = true, spSearch = '';
function renderSemPrev() {
  const body = $('#semPrevBody'); if (!body) return;
  let rows = semPrevTabela();
  if (spSearch) { const q = textKey(spSearch); rows = rows.filter(e => [e.empreendimento, e.bairro, e.incorporadora].some(v => textKey(v).includes(q))); }
  rows = [...rows].sort((a, b) => cmpOrd(a[spSortKey], b[spSortKey], spSortAsc));
  const sub = $('#semPrevCount');
  if (sub) sub.textContent = rows.length + ' terreno' + (rows.length === 1 ? '' : 's') + ' monitorado' + (rows.length === 1 ? '' : 's');
  body.innerHTML = rows.map(e => `<tr data-id="${e.id}">
    <td class="td-center">${e.linkPortal ? `<a class="link-ico" href="${escapeHtml(e.linkPortal)}" target="_blank" rel="noopener" title="Abrir no portal" onclick="event.stopPropagation()">${LINK_SVG}</a>` : `<span class="link-ico off">${LINK_SVG}</span>`}</td>
    <td class="td-center">${e.linkProjeto ? `<a class="link-ico" href="${escapeHtml(e.linkProjeto)}" target="_blank" rel="noopener" title="Acompanhamento do projeto" onclick="event.stopPropagation()">${LINK_SVG}</a>` : `<span class="link-ico off">${LINK_SVG}</span>`}</td>
    <td><span class="rt-name">${escapeHtml(e.empreendimento)}</span></td>
    <td class="rt-txt">${escapeHtml(e.incorporadora || '—')}</td>
    <td class="rt-txt">${escapeHtml(e.bairro || '—')}</td>
    <td class="rt-num">${fmtInt(e.areaTerreno)}</td>
    <td class="rt-date">${dateBR(e.dataProtocolo) || (e.projetoProtocolado ? 'Protocolado' : '—')}</td>
    <td class="rt-date">${dateBR(e.dataAprovacao) || (e.projetoAprovado ? 'Aprovado' : '—')}</td>
  </tr>`).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:30px">Nenhum terreno sem previsão para os filtros atuais.</td></tr>`;
  $$('#semPrevBody tr[data-id]').forEach(tr => {
    tr.querySelector('.rt-name')?.addEventListener('click', () => openFichaModal(tr.dataset.id));
    tr.addEventListener('click', ev => { if (ev.target.closest('a, .rt-name')) return; locateOnMap(tr.dataset.id); });
  });
  const ind = $('#semPrevTable .sort-ind'); if (ind) ind.remove();
  const th = $(`#semPrevTable th[data-sort="${spSortKey}"]`);
  if (th) th.insertAdjacentHTML('beforeend', ` <i class="sort-ind">${spSortAsc ? '↑' : '↓'}</i>`);
}
$('#semPrevSearch')?.addEventListener('input', e => { spSearch = e.target.value; renderSemPrev(); });
$$('#semPrevTable th[data-sort]').forEach(th => th.onclick = () => {
  const k = th.dataset.sort;
  if (spSortKey === k) spSortAsc = !spSortAsc; else { spSortKey = k; spSortAsc = !th.classList.contains('th-num'); }
  renderSemPrev();
});

/* ---------- ficha (tooltip redesign) ---------- */
function elapsedLabel(from, to) {
  if (!from) return null;
  const a = new Date(from.slice(0, 10)), b = to ? new Date(to.slice(0, 10)) : new Date();
  let months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  let days = b.getDate() - a.getDate();
  if (days < 0) { months -= 1; days += 30; }
  if (months < 0) return null;
  const mm = months > 0 ? `${months} ${months === 1 ? 'mês' : 'meses'}` : '';
  const dd = `${days} ${days === 1 ? 'dia' : 'dias'}`;
  return mm ? `${mm} e ${dd}` : dd;
}
function fillFicha(e) {
  $('#fName').textContent = e.empreendimento || '—';
  $('#fLoc').textContent = [e.bairro, [e.cidade, e.uf].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const lanc = statusEmp(e) === 'LANÇADO';
  $('#fBadges').innerHTML = (lanc ? '<span class="badge badge--red">LANÇADO</span>' : e.semData ? '<span class="badge badge--red" style="background:#8A93A6">SEM PREVISÃO</span>' : '<span class="badge badge--red" style="background:var(--navy-500)">PREVISTO</span>')
    + (e.projetoProtocolado ? '<span class="badge badge--outline">PROJETO</span>' : '');
  $('#fInc').textContent = e.incorporadora || '—';
  /* a data de lançamento do cadastro é sempre mês/ano (o pipeline fixa o dia 1);
     mostrar "01/03/2026" prometeria um dia que a fonte não tem */
  const ml = (e.dtLancamento || '').slice(0, 7);
  $('#fDtLanc').textContent = ml ? ml.slice(5, 7) + '/' + ml.slice(0, 4) : '—';
  $('#fTotalUnids').textContent = e.totalUnidades != null ? fmtInt(e.totalUnidades) : '—';
  $('#fAreaTerreno').textContent = e.areaTerreno != null ? fmtInt(e.areaTerreno) + ' m²' : '—';
  // campo vazio é campo vazio: não inventar fonte (aqui havia um 'PROJETO' fixo)
  $('#fFonteTip').textContent = e.fonteTipologia || '—';
  $('#fFonteLan').textContent = e.fonteDataLancamento || '—';
  // fonte da PREVISÃO só faz sentido enquanto o lançamento é previsão: empreendimento
  // já lançado esconde o campo (ex.: "estimado 1 mês após o meeting" num produto no mercado)
  $('#fFontePrev').textContent = e.fontePrevisao || '—';
  $('#fFontePrev').parentElement.hidden = lanc;
  const tips = (e.tipologias || []).slice().sort((a, b) => (a.area || 0) - (b.area || 0));
  // sem rótulo no cadastro, cai no mesmo dicionário dos gráficos: 0 é COMERCIAL,
  // não "0Q" — e tipologia não informada fica em branco em vez de virar quartos
  const rotuloTip = t => t.tipologia || TIP_LABELS[tipKeyOf(t)] || '—';
  $('#fTips').innerHTML = tips.map(t => `<tr><td>${escapeHtml(rotuloTip(t))}</td><td class="td-num">${fmtInt(t.unids)}</td><td class="td-num">${t.area != null ? fmtDec(t.area, 0) + ' m²' : '—'}</td></tr>`).join('') || '<tr><td colspan="3" style="color:var(--gray-400)">Sem tipologias informadas</td></tr>';
  const proto = dateBR(e.dataProtocolo);
  $('#fProto').textContent = proto || '—';
  // sem protocolo não há o que analisar: aprovação fica em branco; com protocolo e sem aprovação = em análise
  $('#fAprov').textContent = dateBR(e.dataAprovacao) || (!proto ? '—' : e.projetoAprovado ? 'Aprovado' : 'Em análise');
  const el = elapsedLabel(e.dataProtocolo, e.dataAprovacao);
  const elBox = $('#fElapsed');
  if (el) { elBox.hidden = false; elBox.querySelector('span').textContent = 'Tempo decorrido · ' + el; } else elBox.hidden = true;
  $('#fEnd').textContent = [e.logradouro, e.complemento, [e.cidade, e.uf].filter(Boolean).join(' · ')].filter(Boolean).join(', ') || '—';
  $('#fPav').textContent = e.descPavimentos || '—';
  $('#fFonteEmp').textContent = e.fonteEmpreendimento || '—';
  $('#fUpdated').textContent = 'Atualizado em ' + (dateBR(DATA.geradoEm) || '—');
  makeField($('#fichaNet'), { w: 500, h: 150, n: 12, color: '#AEBFDE', dist: 170, lineOp: .5, dotOp: .6 });
}
function openFichaModal(id) {
  const e = empById(id);
  if (!e) return;
  const f = $('#ficha');
  fillFicha(e);
  f.hidden = false;
  const fw = Math.min(760, window.innerWidth * .94);
  f.style.width = fw + 'px';
  f.style.left = (window.innerWidth - fw) / 2 + 'px';
  f.style.top = Math.max(16, (window.innerHeight - Math.min(f.scrollHeight, window.innerHeight * .88)) / 2) + 'px';
}
window.openFichaById = id => openFichaModal(id);
const fecharFicha = () => { $('#ficha').hidden = true; };
$('#fClose').onclick = fecharFicha;
/* ESC fecha tudo que estiver aberto — um único listener em vez de um por componente */
let fecharDock = () => {};
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (cardExpandido) { alternarExpansao(cardExpandido, cardExpandido.__btn); return; }
  fecharFicha(); setAIChatOpen(false); fecharDock();
});

/* ---------- importação KMZ ---------- */
function kmlColor(c) { return (c && c.length === 8) ? '#' + c.slice(6, 8) + c.slice(4, 6) + c.slice(2, 4) : null; }
function parseKml(kmlText) {
  const dom = new DOMParser().parseFromString(kmlText, 'text/xml');
  const styles = {}, stylemaps = {};
  dom.querySelectorAll('Style[id]').forEach(st => {
    styles[st.getAttribute('id')] = {
      fill: kmlColor(st.querySelector('PolyStyle > color')?.textContent.trim()),
      stroke: kmlColor(st.querySelector('LineStyle > color')?.textContent.trim()),
      icon: kmlColor(st.querySelector('IconStyle > color')?.textContent.trim()),
    };
  });
  dom.querySelectorAll('StyleMap[id]').forEach(sm => {
    [...sm.querySelectorAll('Pair')].forEach(p => {
      if (p.querySelector('key')?.textContent === 'normal') stylemaps[sm.getAttribute('id')] = (p.querySelector('styleUrl')?.textContent || '').replace('#', '');
    });
  });
  const resolve = url => { let sid = (url || '').replace('#', ''); const seen = new Set(); while (stylemaps[sid] && !seen.has(sid)) { seen.add(sid); sid = stylemaps[sid]; } return styles[sid] || {}; };
  const feats = [];
  dom.querySelectorAll('Placemark').forEach(pm => {
    const name = pm.querySelector(':scope > name')?.textContent.trim() || '';
    let folder = '', p = pm.parentElement;
    while (p) { if (p.tagName === 'Folder') { folder = p.querySelector(':scope > name')?.textContent.trim() || ''; break; } p = p.parentElement; }
    const stl = resolve(pm.querySelector('styleUrl')?.textContent);
    const parseCoords = t => (t || '').trim().split(/\s+/).map(tok => tok.split(',').map(Number)).filter(c => c.length >= 2);
    const pt = pm.querySelector('Point > coordinates');
    const poly = pm.querySelector('Polygon outerBoundaryIs coordinates') || pm.querySelector('Polygon coordinates');
    if (pt) {
      const c = parseCoords(pt.textContent)[0];
      if (c) feats.push({ type: 'Feature', properties: { name, folder, kind: 'ponto', color: stl.icon }, geometry: { type: 'Point', coordinates: [c[0], c[1]] } });
    } else if (poly) {
      const c = parseCoords(poly.textContent).map(x => [x[0], x[1]]);
      if (c.length >= 3) feats.push({ type: 'Feature', properties: { name, folder, kind: 'terreno', fill: stl.fill, stroke: stl.stroke }, geometry: { type: 'Polygon', coordinates: [c] } });
    }
  });
  return { type: 'FeatureCollection', features: feats };
}
async function importKmz(file) {
  const st = $('#importStatus');
  st.textContent = 'LENDO ' + file.name.toUpperCase() + '…';
  try {
    let kmlText;
    if (/\.kml$/i.test(file.name)) kmlText = await file.text();
    else {
      const zip = await JSZip.loadAsync(file);
      const entry = Object.values(zip.files).find(f => /\.kml$/i.test(f.name));
      if (!entry) throw new Error('KMZ sem arquivo KML interno');
      kmlText = await entry.async('text');
    }
    MAPA = parseKml(kmlText);
    linkKmzFeatures();
    renderKmzLayers();
    st.textContent = `MAPA ATUALIZADO · ${MAPA.features.length} GEOMETRIAS DO KMZ`;
  } catch (err) {
    console.error(err);
    st.textContent = 'ERRO AO IMPORTAR KMZ: ' + err.message;
  }
}
$('#btnImportKmz').onclick = () => $('#fileKmz').click();
$('#fileKmz').onchange = e => { if (e.target.files[0]) importKmz(e.target.files[0]); e.target.value = ''; };

/* ---------- helpers compartilhados pelos dois PDFs ----------
   Nenhuma tabela é truncada: o que não cabe numa página vira a próxima, e o título
   ganha o sufixo (1/3, 2/3, 3/3) pedido no relatório. */
const paginar = (itens, porPagina) => {
  const total = Math.max(1, Math.ceil(itens.length / porPagina));
  return Array.from({ length: total }, (_, i) => ({
    itens: itens.slice(i * porPagina, (i + 1) * porPagina), n: i + 1, total,
  }));
};
const sufixoPag = p => p.total > 1 ? ` (${p.n}/${p.total})` : '';
/* achata a árvore das tabelas hierárquicas preservando o nível, para indentar no PDF */
function achatarArvore(nos, nivel = 0, out = []) {
  (nos || []).forEach(n => { out.push({ no: n, nivel }); achatarArvore(n.filhos, nivel + 1, out); });
  return out;
}
const recuo = nivel => nivel ? ` style="padding-left:${9 + nivel * 15}px"` : '';
const pdfTabela = (cols, corpo) => `<table class="pdf-table"><thead><tr>${
  cols.map(c => `<th${c.r ? ' class="r"' : ''}>${c.label}</th>`).join('')}</tr></thead><tbody>${corpo}</tbody></table>`;
const pdfCabecalho = (num, titulo, sub) => `<div class="pdf-h"><span class="n">${num}</span><h2>${escapeHtml(titulo)}</h2></div>`
  + (sub ? `<p class="mono" style="font-size:10px;letter-spacing:.12em;color:${GRAY};margin:-14px 0 16px">${escapeHtml(sub.toUpperCase())}</p>` : '');
/* grafismo de rede da marca na capa: sobre o navy escuro só aparece num azul mais
   claro que o fundo — com NAVY7 a trama sumia no PDF */
const capaTrama = el => makeField(el, { w: 1123, h: 794, n: 68, color: '#4C6CB4', dist: 290, lineOp: .8, dotOp: .95 });

/* ---------- exportação PDF ---------- */
async function exportPdf() {
  const overlay = $('#pdfOverlay'), status = $('#pdfStatus');
  overlay.hidden = false;
  try {
    status.textContent = 'MONTANDO RELATÓRIO…';
    await ensureLogo();
    const stage = $('#pdfStage');
    stage.innerHTML = '';
    const m = salesAverages(filtered);
    const today = new Date().toLocaleDateString('pt-BR');
    const title = ($('.top__title .editable-target')?.textContent || $('.top__title')?.textContent || 'Oferta Futura').trim();
    let pag = 1;
    const add = html => {
      const el = document.createElement('div');
      el.className = 'pdf-page';
      el.innerHTML = html + `<div class="pdf-foot"><span>EBM Inteligência · Dados que orientam decisões</span><span>${today} · pág. ${++pag}</span></div>`;
      stage.appendChild(el);
    };
    // ---- capa ----
    const cover = document.createElement('div');
    cover.className = 'pdf-page pdf-cover';
    cover.innerHTML = `<svg class="pdf-net" id="pdfNet" preserveAspectRatio="xMidYMid slice"></svg>
      <div style="position:relative">
        <div style="display:inline-block;background:#fff;border-radius:12px;padding:14px 20px;margin-bottom:34px"><img src="${logoSrc()}" style="height:46px;width:100px;display:inline" /></div>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="pdf-meta">
        <div>Emitido em<b>${today}</b></div>
        <div>Empreendimentos<b>${filtered.length}</b></div>
        <div>Janela<b>${launchWindowLabel(filtered)}</b></div>
      </div>`;
    stage.appendChild(cover);
    capaTrama(cover.querySelector('#pdfNet'));
    // ---- 01 síntese (os filtros saíram da capa e vivem aqui) ----
    const chips = filtersSummaryText().split('  ·  ').map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('');
    add(pdfCabecalho('01', 'Síntese da oferta filtrada')
      + `<div class="pdf-kpis">
        <div class="k"><span>EMPREENDIMENTOS</span><b>${filtered.length}</b></div>
        <div class="k"><span>TOTAL DE UNIDADES</span><b>${fmtInt(filtered.reduce((s, e) => s + (e.totalUnidades || 0), 0))}</b></div>
        <div class="k"><span>ÁREA DE TERRENO M²</span><b>${fmtInt(filtered.reduce((s, e) => s + (e.areaTerreno || 0), 0))}</b></div>
        <div class="k accent"><span>UNIDS VENDIDAS/MÊS</span><b>${m.mes == null ? '—' : fmtDec(m.mes, 1)}</b></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><p class="mono" style="font-size:10px;letter-spacing:.14em;color:${GRAY};margin-bottom:8px">OFERTA DISPONÍVEL POR MÊS</p><img class="pdf-img" src="${chartDisp.toBase64Image('image/png', 1)}" /></div>
        <div><p class="mono" style="font-size:10px;letter-spacing:.14em;color:${GRAY};margin-bottom:8px">UNIDADES LANÇADAS POR MÊS</p><img class="pdf-img" src="${chartLanc.toBase64Image('image/png', 1)}" /></div>
      </div>
      <p class="mono" style="font-size:9.5px;letter-spacing:.1em;color:${GRAY};margin-top:18px">FILTROS APLICADOS</p>
      <div class="pdf-filters" style="margin-top:8px">${chips}</div>`);
    // ---- 02 mapa ----
    status.textContent = 'CAPTURANDO O MAPA…';
    const mapaImg = await captureMapFor(filtered);
    add(pdfCabecalho('02', 'Mapa georreferenciado', `${filtered.length} empreendimentos · terrenos do filtro em destaque`)
      + (mapaImg ? `<img class="pdf-img" src="${mapaImg}" />`
        : `<div style="height:520px;border:1px dashed ${HAIR};border-radius:10px;display:grid;place-items:center;color:${GRAY}" class="mono">MAPA INDISPONÍVEL</div>`));
    // ---- 03 radar de empreendimentos ----
    status.textContent = 'MONTANDO AS TABELAS…';
    const colsRadar = [{ label: 'EMPREENDIMENTO' }, { label: 'LANÇAMENTO' }, { label: 'INCORPORADORA' }, { label: 'BAIRRO' },
      { label: 'MACROZONA' }, { label: 'M² TERRENO', r: true }, { label: 'TOTAL UNIDS', r: true }, { label: 'STATUS' }];
    paginar(sortedRows(), 16).forEach(p => add(
      pdfCabecalho('03', 'Radar de empreendimentos' + sufixoPag(p))
      + pdfTabela(colsRadar, p.itens.map(e => `<tr>
        <td><b>${escapeHtml(e.empreendimento)}</b></td>
        <td>${(e.dtLancamento || '—').slice(0, 7)}</td>
        <td>${escapeHtml(e.incorporadora || '—')}</td>
        <td>${escapeHtml(e.bairro || '—')}</td>
        <td>${escapeHtml(mzLabel(e.macrozona))}</td>
        <td class="r">${fmtInt(e.areaTerreno)}</td>
        <td class="r">${fmtInt(e.totalUnidades)}</td>
        <td>${statusEmp(e)}</td></tr>`).join(''))));
    // ---- 04 unidades por tipologia ----
    const dp = dadosPivot();
    const colsPivot = [{ label: dp.rotulo }, ...dp.cols.map(c => ({ label: escapeHtml(rotuloTipologia(c)), r: true })), { label: 'TOTAL', r: true }];
    paginar(achatarArvore(dp.linhas), 18).forEach(p => add(
      pdfCabecalho('04', 'Unidades por tipologia' + sufixoPag(p), 'matriz tipo de empreendimento × dormitórios')
      + pdfTabela(colsPivot, p.itens.map(({ no, nivel }) => `<tr>
        <td${recuo(nivel)}>${nivel ? escapeHtml(no.nome) : `<b>${escapeHtml(no.nome)}</b>`}</td>
        ${dp.cols.map(c => `<td class="r">${no.vals[c] ? fmtInt(no.vals[c]) : '·'}</td>`).join('')}
        <td class="r">${fmtInt(no.total)}</td></tr>`).join('')
        + (p.n === p.total ? `<tr><td><b>TOTAL GERAL</b></td>${dp.cols.map(c => `<td class="r"><b>${fmtInt(dp.gtot[c])}</b></td>`).join('')}<td class="r"><b>${fmtInt(dp.gsum)}</b></td></tr>` : ''))));
    // ---- 05 desempenho por incorporadora ----
    const di = dadosIncorporadoras();
    paginar(achatarArvore(di.linhas), 18).forEach(p => add(
      pdfCabecalho('05', 'Desempenho por incorporadora' + sufixoPag(p), di.legenda)
      + pdfTabela(INC_COLS_PDF, p.itens.map(({ no, nivel }) => `<tr>
        <td${recuo(nivel)}>${no.ehEmp ? escapeHtml(no.nome) : `<b>${escapeHtml(no.nome)}</b>`}</td>
        <td class="r">${no.ehEmp ? '·' : fmtInt(no.projetos)}</td>
        <td class="r">${fmtInt(no.unidades)}</td>
        <td class="r">${no.protocolo || '·'}</td>
        <td class="r">${no.aprovados || '·'}</td>
        <td class="r">${no.lancados || '·'}</td>
        <td>${no.ehEmp ? (dateBR(no.dataProtocolo) || '—') : ''}</td>
        <td>${no.ehEmp ? (dateBR(no.dataAprovacao) || '—') : ''}</td>
        <td class="r">${incMeses(no.medianaAprov)}</td>
        <td class="r">${incMeses(no.mediaAprov)}</td></tr>`).join('')
        + (p.n === p.total ? `<tr><td><b>TOTAL</b></td><td class="r"><b>${fmtInt(di.tot.projetos)}</b></td><td class="r"><b>${fmtInt(di.tot.unidades)}</b></td>
          <td class="r"><b>${fmtInt(di.tot.protocolo)}</b></td><td class="r"><b>${fmtInt(di.tot.aprovados)}</b></td><td class="r"><b>${fmtInt(di.tot.lancados)}</b></td>
          <td></td><td></td><td class="r"><b>${incMeses(mediana(di.tot.prazos))}</b></td><td class="r"><b>${incMeses(media(di.tot.prazos))}</b></td></tr>` : ''))));
    // ---- 06 concentração ----
    const dc = dadosConcentracao();
    const colsConc = [{ label: dc.rotulo }, { label: 'EMPREEND.', r: true }, { label: 'UNIDADES', r: true },
      { label: '% DO TOTAL', r: true }, { label: dc.colDim.label, r: true }, { label: 'M² MÉDIO', r: true }, { label: 'M² TERRENO', r: true }];
    const pctConc = v => v.toFixed(1).replace('.', ',') + '%';
    paginar(achatarArvore(dc.linhas), 18).forEach(p => add(
      pdfCabecalho('06', 'Concentração por ' + dc.rotulo.split(' / ')[0].toLowerCase() + sufixoPag(p), 'onde a oferta futura se acumula')
      + pdfTabela(colsConc, p.itens.map(({ no, nivel }) => `<tr>
        <td${recuo(nivel)}>${nivel ? escapeHtml(no.nome) : `<b>${escapeHtml(no.nome)}</b>`}</td>
        <td class="r">${no.emps == null ? '·' : fmtInt(no.emps)}</td>
        <td class="r">${fmtInt(no.unidades)}</td>
        <td class="r">${pctConc(no.pct)}</td>
        <td class="r">${no.dim == null ? '·' : (typeof no.dim === 'number' ? fmtInt(no.dim) : escapeHtml(no.dim))}</td>
        <td class="r">${no.m2 == null ? '—' : fmtDec(no.m2, 0)}</td>
        <td class="r">${fmtInt(no.area)}</td></tr>`).join('')
        + (p.n === p.total ? `<tr><td><b>TOTAL</b></td><td class="r"><b>${fmtInt(filtered.length)}</b></td><td class="r"><b>${fmtInt(dc.totUn)}</b></td>
          <td class="r"><b>100,0%</b></td><td class="r"><b>${dc.totDim}</b></td><td></td>
          <td class="r"><b>${fmtInt(filtered.reduce((s, e) => s + (e.areaTerreno || 0), 0))}</b></td></tr>` : ''))));
    // ---- 07 radar sem previsão ----
    const semPrev = semPrevTabela();
    if (semPrev.length) {
      const colsSem = [{ label: 'TERRENO' }, { label: 'INCORPORADORA' }, { label: 'BAIRRO' }, { label: 'ENDEREÇO' },
        { label: 'M² TERRENO', r: true }, { label: 'PROTOCOLO' }, { label: 'APROVAÇÃO' }];
      paginar([...semPrev].sort((a, b) => cmpOrd(a[spSortKey], b[spSortKey], spSortAsc)), 16).forEach(p => add(
        pdfCabecalho('07', 'Radar sem previsão de lançamento' + sufixoPag(p), 'terrenos monitorados sem data prevista · não entram nos indicadores')
        + pdfTabela(colsSem, p.itens.map(e => `<tr>
          <td><b>${escapeHtml(e.empreendimento)}</b></td>
          <td>${escapeHtml(e.incorporadora || '—')}</td>
          <td>${escapeHtml(e.bairro || '—')}</td>
          <td>${escapeHtml((e.logradouro || '—').slice(0, 38))}</td>
          <td class="r">${fmtInt(e.areaTerreno)}</td>
          <td>${dateBR(e.dataProtocolo) || (e.projetoProtocolado ? 'Protocolado' : '—')}</td>
          <td>${dateBR(e.dataAprovacao) || (e.projetoAprovado ? 'Aprovado' : '—')}</td></tr>`).join(''))));
    }
    // renderizar
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await decodeStageImages(stage);
    const pagesEls = [...stage.children];
    for (let i = 0; i < pagesEls.length; i++) {
      status.textContent = `RENDERIZANDO PÁGINA ${i + 1}/${pagesEls.length}…`;
      const canvas = await html2canvas(pagesEls[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, 297, 210);
    }
    pdf.save(`Oferta_Futura_Relatorio_${new Date().toISOString().slice(0, 10)}.pdf`);
    stage.innerHTML = '';
  } catch (err) {
    console.error(err);
    alert('Falha ao gerar o PDF: ' + err.message);
  } finally {
    overlay.hidden = true;
  }
}
$('#btnExportPdf').onclick = exportPdf;

/* ---------- exportação PDF Apresentação ---------- */
let LOGO_DATA = null; // logo em data-URL p/ render confiável no html2canvas
function ensureLogo() {
  if (LOGO_DATA) return Promise.resolve();
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        LOGO_DATA = c.toDataURL('image/png');
      } catch (e) { console.warn(e); }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = 'assets/logo-full.png';
  });
}
ensureLogo();
const logoSrc = () => LOGO_DATA || 'assets/logo-full.png';
const MESES_MIN = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesAno = m => m ? MESES_MIN[+m.slice(5, 7) - 1] + '/' + m.slice(0, 4) : '—';
function periodoLabel() {
  let a = state.from, b = state.to;
  if (!a || !b) {
    const ms = filtered.map(e => (e.dtLancamento || '').slice(0, 7)).filter(Boolean).sort();
    if (!a) a = ms[0]; if (!b) b = ms[ms.length - 1];
  }
  if (!a && !b) return '—';
  return `${mesAno(a)} – ${mesAno(b)}`;
}
/* mapa estático em canvas (web mercator + tiles CARTO) — captura determinística p/ slides */
const lngToX = (lng, z) => (lng + 180) / 360 * 256 * 2 ** z;
const latToY = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z; };
function loadTile(url) {
  return new Promise(res => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => res(img); img.onerror = () => res(null); img.src = url; });
}
/* Proporção da caixa do slide (1015 × 560 px de área útil): capturar nessa mesma
   proporção evita que o object-fit corte pontos das bordas. */
const MAPA_W = 2030, MAPA_H = 1120;
async function captureMapFor(emps, W = MAPA_W, H = MAPA_H) {
  const ids = new Set(emps.map(e => e.id));
  const polys = (MAPA.features || []).filter(f => f.geometry.type === 'Polygon' && ids.has(f.properties._empId));
  const pts = emps.filter(e => e.lat != null && e.lng != null);
  if (!pts.length && !polys.length) return null;
  // bbox
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  const feed = (lat, lng) => { minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng); };
  pts.forEach(e => feed(e.lat, e.lng));
  polys.forEach(f => f.geometry.coordinates[0].forEach(c => feed(c[1], c[0])));
  /* margem só o suficiente para o marcador não encostar na borda — antes eram 16%,
     que jogavam o mapa longe quando os pontos estavam concentrados */
  const padLat = Math.max((maxLat - minLat) * .04, .0016), padLng = Math.max((maxLng - minLng) * .04, .0016);
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
  /* zoom FRACIONÁRIO: o bbox passa a encostar exatamente na borda. Com zoom só
     inteiro sobrava até 2× de folga e o recorte saía pequeno no meio do slide.
     Os tiles vêm do zoom inteiro logo acima e são reduzidos por `s` (≤ 1, nunca
     amplia — ampliar borraria o mapa). */
  const spanX0 = lngToX(maxLng, 0) - lngToX(minLng, 0);
  const spanY0 = latToY(minLat, 0) - latToY(maxLat, 0);
  const zf = Math.max(3, Math.min(18, Math.min(Math.log2(W / spanX0), Math.log2(H / spanY0))));
  const z = Math.min(18, Math.ceil(zf));
  const s = 2 ** (zf - z);                       // fator de redução dos tiles
  const Wm = W / s, Hm = H / s;                  // janela visível em pixels do zoom z
  const cx = (lngToX(minLng, z) + lngToX(maxLng, z)) / 2, cy = (latToY(maxLat, z) + latToY(minLat, z)) / 2;
  const x0 = cx - Wm / 2, y0 = cy - Hm / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#E9EDF3'; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.scale(s, s);
  ctx.translate(-x0, -y0);
  // tiles
  const t0x = Math.floor(x0 / 256), t1x = Math.floor((x0 + Wm) / 256), t0y = Math.floor(y0 / 256), t1y = Math.floor((y0 + Hm) / 256);
  const jobs = [];
  for (let tx = t0x; tx <= t1x; tx++) for (let ty = t0y; ty <= t1y; ty++) {
    if (tx < 0 || ty < 0 || tx >= 2 ** z || ty >= 2 ** z) continue;
    jobs.push(loadTile(`https://a.basemaps.cartocdn.com/light_all/${z}/${tx}/${ty}@2x.png`).then(img => {
      if (img) ctx.drawImage(img, tx * 256, ty * 256, 256, 256);
    }));
  }
  await Promise.all(jobs);
  // terrenos (polígonos do KMZ vinculados ao filtro)
  polys.forEach(f => {
    const p = f.properties;
    ctx.beginPath();
    f.geometry.coordinates[0].forEach((c, i) => {
      const x = lngToX(c[0], z), y = latToY(c[1], z);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = (p.fill || BLUE) + '55';
    ctx.strokeStyle = p.stroke || p.fill || BLUE;
    ctx.lineWidth = 3 / s;                       // espessura constante na imagem final
    ctx.fill(); ctx.stroke();
  });
  // empreendimentos (marcadores vermelhos)
  pts.forEach(e => {
    ctx.beginPath(); ctx.arc(lngToX(e.lng, z), latToY(e.lat, z), 11 / s, 0, Math.PI * 2);
    ctx.fillStyle = RED; ctx.fill();
    ctx.lineWidth = 3.5 / s; ctx.strokeStyle = '#fff'; ctx.stroke();
  });
  ctx.restore();
  // atribuição
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(W - 300, H - 32, 300, 32);
  ctx.fillStyle = '#566076'; ctx.font = '16px IBM Plex Sans, sans-serif';
  ctx.fillText('© OpenStreetMap · © CARTO', W - 286, H - 10);
  return canvas.toDataURL('image/jpeg', .92);
}
async function decodeStageImages(stage) {
  await Promise.all([...stage.querySelectorAll('img')].map(i => i.decode ? i.decode().catch(() => {}) : Promise.resolve()));
}
function deckKpisHtml(emps, semPrevisao) {
  const areaTot = fmtInt(emps.reduce((s, e) => s + (e.areaTerreno || 0), 0));
  if (semPrevisao) {  // sem data e sem tipologia: o que se sabe é terreno e incorporadora
    const comUnid = emps.filter(e => e.totalUnidades);
    return `<div class="pdf-kpis" style="grid-template-columns:repeat(4,1fr)">
      <div class="k"><span>TERRENOS MONITORADOS</span><b>${emps.length}</b></div>
      <div class="k"><span>ÁREA DE TERRENO M²</span><b>${areaTot}</b></div>
      <div class="k"><span>INCORPORADORAS</span><b>${new Set(emps.map(e => e.incorporadora).filter(Boolean)).size}</b></div>
      <div class="k accent"><span>COM ESTIMATIVA DE UNIDS</span><b>${comUnid.length}</b></div>
    </div>`;
  }
  const m = salesAverages(emps);
  return `<div class="pdf-kpis" style="grid-template-columns:repeat(4,1fr)">
    <div class="k"><span>EMPREENDIMENTOS</span><b>${emps.length}</b></div>
    <div class="k"><span>TOTAL DE UNIDADES</span><b>${fmtInt(emps.reduce((s, e) => s + (e.totalUnidades || 0), 0))}</b></div>
    <div class="k"><span>ÁREA DE TERRENO M²</span><b>${areaTot}</b></div>
    <div class="k accent"><span>UNIDS VENDIDAS/MÊS</span><b>${m.mes == null ? '—' : fmtDec(m.mes, 1)}</b></div>
  </div>`;
}
/* ordem de exibição do corte — a paginação vem depois, para que a sequência
   1/3 → 3/3 siga a mesma ordem que apareceria numa lista única */
const deckOrdenar = (emps, semPrevisao) => semPrevisao
  ? [...emps].sort((a, b) => (b.areaTerreno || 0) - (a.areaTerreno || 0))
  : [...emps].sort((a, b) => (a.dtLancamento || '').localeCompare(b.dtLancamento || ''));
/* nada de "+ N no dashboard": o slide recebe exatamente as linhas da sua página */
function deckTableHtml(emps, semPrevisao) {
  if (semPrevisao) {
    return `<table class="pdf-table"><thead><tr><th>TERRENO</th><th>INCORPORADORA</th><th>BAIRRO</th><th>ENDEREÇO</th><th class="r">M² TERRENO</th><th class="r">UNIDS EST.</th><th>PROJETO</th></tr></thead>
      <tbody>${emps.map(e => `<tr><td><b>${escapeHtml(e.empreendimento)}</b></td><td>${escapeHtml(e.incorporadora || '—')}</td><td>${escapeHtml(e.bairro || '—')}</td><td>${escapeHtml((e.logradouro || '—').slice(0, 40))}</td><td class="r">${fmtInt(e.areaTerreno)}</td><td class="r">${e.totalUnidades ? fmtInt(e.totalUnidades) : '—'}</td><td>${e.projetoAprovado ? 'APROVADO' : e.projetoProtocolado ? 'PROTOCOLADO' : '—'}</td></tr>`).join('')}</tbody></table>`;
  }
  return `<table class="pdf-table"><thead><tr><th>EMPREENDIMENTO</th><th>LANÇAMENTO</th><th>INCORPORADORA</th><th>BAIRRO</th><th class="r">M² TERRENO</th><th class="r">TOTAL UNIDS</th><th>STATUS</th></tr></thead>
    <tbody>${emps.map(e => `<tr><td><b>${escapeHtml(e.empreendimento)}</b></td><td>${mesAno((e.dtLancamento || '').slice(0, 7))}</td><td>${escapeHtml(e.incorporadora || '—')}</td><td>${escapeHtml(e.bairro || '—')}</td><td class="r">${fmtInt(e.areaTerreno)}</td><td class="r">${fmtInt(e.totalUnidades)}</td><td>${statusEmp(e)}</td></tr>`).join('')}</tbody></table>`;
}
function deckFoot(page, periodo) {
  return `<div class="pdf-foot"><span>EBM Inteligência · Oferta Futura GO · ${escapeHtml(periodo)}</span><span>pág. ${page}</span></div>`;
}
async function exportDeck() {
  const overlay = $('#pdfOverlay'), status = $('#pdfStatus');
  overlay.hidden = false;
  try {
    await ensureLogo();
    const stage = $('#pdfStage');
    stage.innerHTML = '';
    const periodo = periodoLabel();
    const isAM = e => textKey(e.tipo || '').replace(/\s+/g, '') === 'APART-MAP';
    // ---- definição dos blocos ----
    const mzs = [...new Set(filtered.map(e => mzLabel(e.macrozona)))].sort();
    const am = filtered.filter(isAM);
    const tipos = [...new Set(filtered.map(e => e.tipo || '—'))].sort();
    const blocks = [];
    if (filtered.length) blocks.push({
      num: '01', title: 'Macrozonas', desc: `Oferta futura por macrozona · ${periodo}`,
      scope: filtered,
      cuts: mzs.map(mz => ({ title: mz, sub: 'Macrozona', emps: filtered.filter(e => mzLabel(e.macrozona) === mz) })),
    });
    if (am.length) blocks.push({
      num: '02', title: 'Faixas de metragem — Apart-MAP', desc: `Segmento Apart-MAP por faixa de área privativa · ${periodo}`,
      scope: am,
      cuts: FAIXAS.map(f => ({ title: f.label, sub: 'Faixa de m² · Apart-MAP', emps: am.filter(e => empFaixas(e).has(f.id)) })).filter(c => c.emps.length),
    });
    if (filtered.length) blocks.push({
      num: '03', title: 'Segmentos', desc: `Oferta futura por segmento de produto · ${periodo}`,
      scope: filtered,
      cuts: tipos.map(t => ({ title: t, sub: 'Segmento', emps: filtered.filter(e => (e.tipo || '—') === t) })).filter(c => c.emps.length),
    });
    // terrenos monitorados sem data: entram na apresentação mesmo sem tipologia/lançamento
    status.textContent = 'BUSCANDO TERRENOS SEM PREVISÃO…';
    let semPrev = [];
    try { await loadSemDataEmps(); semPrev = semPrevTabela(); }
    catch (err) { console.warn('terrenos sem previsão indisponíveis', err); }
    if (semPrev.length) {
      const porBairro = {};
      semPrev.forEach(e => (porBairro[e.bairro || '—'] = porBairro[e.bairro || '—'] || []).push(e));
      const ordenados = Object.entries(porBairro).sort((a, b) => b[1].length - a[1].length);
      const TOP = 8;  // consolida a cauda num corte só; nenhum terreno é descartado
      const cuts = ordenados.slice(0, TOP).map(([b, emps]) => ({ title: b, sub: 'Bairro · sem previsão', emps, semPrevisao: true }));
      const resto = ordenados.slice(TOP).flatMap(([, emps]) => emps);
      if (resto.length) cuts.push({ title: 'Demais bairros', sub: `${ordenados.length - TOP} bairros · sem previsão`, emps: resto, semPrevisao: true });
      blocks.push({
        num: '04', title: 'Terrenos sem previsão de lançamento',
        desc: 'Terrenos monitorados sem data de lançamento ou previsão definida',
        scope: semPrev, semPrevisao: true, cuts,
      });
    }
    // ---- capa ----
    const cover = document.createElement('div');
    cover.className = 'pdf-page pdf-cover';
    cover.innerHTML = `<svg class="pdf-net" id="deckNet" preserveAspectRatio="xMidYMid slice"></svg>
      <div style="position:relative">
        <div style="display:inline-block;background:#fff;border-radius:12px;padding:14px 20px;margin-bottom:40px"><img src="${logoSrc()}" style="height:46px;width:100px;display:inline" /></div>
        <h1>Oferta Futura GO</h1>
        <p class="mono" style="position:relative;font-size:17px;color:#AEBFDE;margin-top:16px">Período: ${escapeHtml(periodo)}</p>
      </div>
      <div class="pdf-meta">
        <div>Emitido em<b>${new Date().toLocaleDateString('pt-BR')}</b></div>
        <div>Empreendimentos<b>${filtered.length}</b></div>
      </div>`;
    stage.appendChild(cover);
    capaTrama(cover.querySelector('#deckNet'));
    // ---- blocos: slide de mapa + N slides por corte (nada é truncado) ----
    let pageNo = 1;
    for (const b of blocks) {
      status.textContent = `CAPTURANDO MAPA — ${b.title.toUpperCase()}…`;
      const img = await captureMapFor(b.scope);
      pageNo++;
      const mapSlide = document.createElement('div');
      mapSlide.className = 'pdf-page';
      mapSlide.innerHTML = `<div class="pdf-h"><span class="n">${b.num}</span><h2>${escapeHtml(b.title)}</h2></div>
        <p class="mono" style="font-size:10.5px;letter-spacing:.1em;color:${GRAY};margin:-12px 0 14px">${escapeHtml(b.desc.toUpperCase())} · ${b.scope.length} EMPREENDIMENTOS · TERRENOS DO FILTRO EM DESTAQUE</p>
        ${img ? `<img class="pdf-img" src="${img}" style="height:560px;object-fit:cover" />` : `<div style="height:560px;border:1px dashed ${HAIR};border-radius:10px;display:grid;place-items:center;color:${GRAY}" class="mono">MAPA INDISPONÍVEL</div>`}
        ${deckFoot(pageNo, periodo)}`;
      stage.appendChild(mapSlide);
      for (const c of b.cuts) {
        paginar(deckOrdenar(c.emps, c.semPrevisao), 11).forEach(p => {
          pageNo++;
          const s = document.createElement('div');
          s.className = 'pdf-page';
          s.innerHTML = `<div class="pdf-h"><span class="n">${b.num}</span><h2>${escapeHtml(c.title)}${sufixoPag(p)}<small style="display:block;font-family:var(--font-mono);font-weight:400;font-size:11px;letter-spacing:.14em;color:${GRAY};margin-top:6px">${escapeHtml(c.sub.toUpperCase())} · PERÍODO ${escapeHtml(periodo).toUpperCase()} · ${c.emps.length} NO CORTE</small></h2></div>
            ${deckKpisHtml(c.emps, c.semPrevisao)}
            ${deckTableHtml(p.itens, c.semPrevisao)}
            ${deckFoot(pageNo, periodo)}`;
          stage.appendChild(s);
        });
      }
    }
    // ---- renderização ----
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await decodeStageImages(stage);
    const pagesEls = [...stage.children];
    for (let i = 0; i < pagesEls.length; i++) {
      status.textContent = `RENDERIZANDO SLIDE ${i + 1}/${pagesEls.length}…`;
      const canvas = await html2canvas(pagesEls[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', .9), 'JPEG', 0, 0, 297, 210);
    }
    pdf.save(`Oferta_Futura_Apresentacao_${new Date().toISOString().slice(0, 10)}.pdf`);
    stage.innerHTML = '';
  } catch (err) {
    console.error(err);
    alert('Falha ao gerar a apresentação: ' + err.message);
  } finally {
    $('#pdfOverlay').hidden = true;
  }
}
$('#btnExportDeck').onclick = exportDeck;

/* ---------- exportação Excel ---------- */
function exportXlsx() {
  const st = $('#importStatus');
  const wb = XLSX.utils.book_new();
  const m = salesAverages(filtered);
    // Resumo
  const resumo = [
    ['Relatório', 'Oferta Futura — EBM Inteligência'],
    ['Emitido em', new Date().toLocaleString('pt-BR')],
    ['Fonte da base', DATA.fonte || '—'],
    ['Filtros ativos', filtersSummaryText()],
    [],
    ['Empreendimentos', filtered.length],
    ['Total de unidades', filtered.reduce((s, e) => s + (e.totalUnidades || 0), 0)],
    ['Área de terreno (m²)', Math.round(filtered.reduce((s, e) => s + (e.areaTerreno || 0), 0))],
    ['Unids vendidas/mês (contexto do filtro)', m.mes == null ? '—' : +m.mes.toFixed(2)],
    ['Média mensal por empreendimento (clusters)', m.avg == null ? '—' : +m.avg.toFixed(2)],
    ['Média mensal por empreendimento deflacionada', m.defl == null ? '—' : +m.defl.toFixed(2)],
    ['Janela de lançamento', launchWindowLabel(filtered)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Resumo');
  // Radar
  const radar = sortedRows().map(e => ({
    'Empreendimento': e.empreendimento, 'Lançamento': (e.dtLancamento || '').slice(0, 7), 'Status': statusEmp(e),
    'Incorporadora': e.incorporadora, 'Bairro': e.bairro, 'Macrozona': mzLabel(e.macrozona), 'Tipo': e.tipo,
    'M² Terreno': e.areaTerreno, 'Total Unidades': e.totalUnidades, 'Cluster': e.cluster,
    'Protocolo': e.dataProtocolo || '', 'Aprovação': (e.dataAprovacao || '').slice(0, 10),
    'Endereço': [e.logradouro, e.complemento].filter(Boolean).join(', '), 'Cidade': e.cidade, 'UF': e.uf,
    'Fonte Empreendimento': e.fonteEmpreendimento, 'Fonte Data Lançamento': e.fonteDataLancamento,
    'Link Portal': e.linkPortal || '', 'Link Projeto': e.linkProjeto || '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(radar), 'Radar');
  // Tipologias
  const tip = filtered.flatMap(e => (e.tipologias || []).map(t => ({
    'Empreendimento': e.empreendimento, 'Incorporadora': e.incorporadora, 'Bairro': e.bairro,
    'Tipologia': t.tipologia, 'Dormitórios': t.tratada, 'Unidades': t.unids, 'Área privativa (m²)': t.area,
  })));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tip), 'Tipologias');
  // Oferta mensal (agregada + por empreendimento)
  // mesma composição da curva do dashboard: mercado (síntese) + lançamentos previstos
  const mkAgg = new Map(monthlySeries(mercadoFiltrado()));
  const agg = monthlySeries(filtered).map(([mes, disp]) => ({
    'Mês': mes, 'Lançamentos previstos': Math.round(disp),
    'Mercado (síntese)': Math.round(mkAgg.get(mes) || 0),
    'Unidades disponíveis (total)': Math.round(disp + (mkAgg.get(mes) || 0)),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(agg), 'Oferta mensal');
  const porEmp = filtered.flatMap(e => (e.mensal || []).map(x => ({
    'Empreendimento': e.empreendimento, 'Mês': x.m, 'Disponíveis': x.disp, 'Vendidas no mês': x.vend, 'Distratadas no mês': x.distr,
  })));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porEmp), 'Oferta por empreendimento');
  XLSX.writeFile(wb, `Oferta_Futura_Dados_${new Date().toISOString().slice(0, 10)}.xlsx`);
  if (st) st.textContent = `EXCEL EXPORTADO · ${filtered.length} EMPREENDIMENTOS`;
}
$('#btnExportXlsx').onclick = exportXlsx;

/* ---------- exportação KMZ ---------- */
function hexToKml(hex, alpha) { // #rrggbb -> aabbggrr
  const h = (hex || '#3A5AA0').replace('#', '');
  return alpha + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
}
const xmlEsc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
async function exportKmz() {
  const st = $('#importStatus');
  const feats = visibleKmzFeatures();
  const porId = Object.fromEntries(allEmps().map(e => [e.id, e]));
  const pmPoly = [], pmPoint = [];
  feats.forEach((f, i) => {
    const p = f.properties, emp = p._empId ? porId[p._empId] : null;
    const desc = emp ? `${emp.empreendimento} · ${emp.incorporadora || ''} · ${emp.bairro || ''} · Lançamento ${(emp.dtLancamento || '—').slice(0, 7)}` : (p.folder || '');
    if (f.geometry.type === 'Polygon') {
      const coords = f.geometry.coordinates[0].map(c => `${c[0]},${c[1]},0`).join(' ');
      pmPoly.push(`<Placemark><name>${xmlEsc(p.name)}</name><description>${xmlEsc(desc)}</description>
<Style><LineStyle><color>${hexToKml(p.stroke || p.fill, 'ff')}</color><width>2</width></LineStyle><PolyStyle><color>${hexToKml(p.fill || p.stroke, '96')}</color></PolyStyle></Style>
<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`);
    } else if (f.geometry.type === 'Point') {
      const [lng, lat] = f.geometry.coordinates;
      pmPoint.push(`<Placemark><name>${xmlEsc(p.name)}</name><description>${xmlEsc(desc)}</description>
<Style><IconStyle><color>${hexToKml(p.color, 'ff')}</color><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>
<Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark>`);
    }
  });
  // empreendimentos filtrados (marcadores vermelhos da oferta futura)
  const pmEmp = filtered.filter(e => e.lat != null && e.lng != null).map(e => `<Placemark><name>${xmlEsc(e.empreendimento)}</name>
<description>${xmlEsc([e.incorporadora, e.bairro, 'Lançamento ' + (e.dtLancamento || '—').slice(0, 7), fmtInt(e.totalUnidades) + ' unidades'].filter(Boolean).join(' · '))}</description>
<Style><IconStyle><color>ff120ae3</color><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle></Style>
<Point><coordinates>${e.lng},${e.lat},0</coordinates></Point></Placemark>`);
  const docName = 'Oferta Futura — ' + (anyFilterActive() ? filtersSummaryText() : 'todos os empreendimentos');
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEsc(docName)}</name>
<Folder><name>Oferta Futura (empreendimentos)</name>${pmEmp.join('\n')}</Folder>
<Folder><name>Terrenos</name>${pmPoly.join('\n')}</Folder>
<Folder><name>Localizações</name>${pmPoint.join('\n')}</Folder>
</Document></kml>`;
  const zip = new JSZip();
  zip.file('doc.kml', kml);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Oferta_Futura_Mapa_${new Date().toISOString().slice(0, 10)}.kmz`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  if (st) st.textContent = `KMZ EXPORTADO · ${pmEmp.length} EMPREENDIMENTOS · ${pmPoly.length} TERRENOS · ${pmPoint.length} LOCALIZAÇÕES`;
}
$('#btnExportKmz').onclick = exportKmz;

/* ---------- limpar filtros ---------- */
$('#btnClearFilters').onclick = () => {
  state.from = state.to = '';
  $('#fltFrom').value = $('#fltTo').value = '';
  Object.keys(state).forEach(k => state[k] instanceof Set && state[k].clear());
  Object.values(MS).forEach(m => { m.render(); m.sync(); });
  applyAll();
};
/* ---------- campos de mês ----------
   Firefox e Safari não implementam <input type="month">: o campo cai para texto,
   o valor nunca chega em YYYY-MM e o filtro de período simplesmente não aplica.
   Nesses navegadores o campo vira um select com os meses que existem na base. */
const suportaInputMes = (() => { const i = document.createElement('input'); i.setAttribute('type', 'month'); return i.type === 'month'; })();
/* aceita 2026-01, 01/2026, 1/2026, 2026/01 — cobre o que o usuário digita no fallback texto */
function normalizaYM(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  let m = /^(\d{4})[-/.](\d{1,2})$/.exec(s);
  if (!m) { const b = /^(\d{1,2})[-/.](\d{4})$/.exec(s); if (b) m = [null, b[2], b[1]]; }
  if (!m) return '';
  const mes = +m[2];
  return mes >= 1 && mes <= 12 ? `${m[1]}-${String(mes).padStart(2, '0')}` : '';
}
function mesesDe(datas) {
  const set = new Set();
  DATA.empreendimentos.forEach(e => datas.forEach(k => { const m = (e[k] || '').slice(0, 7); if (/^\d{4}-\d{2}$/.test(m)) set.add(m); }));
  return [...set].sort();
}
/* devolve o elemento efetivo do campo (input nativo ou select do fallback) */
function campoMes(id, meses) {
  const el = $('#' + id);
  if (!el || suportaInputMes) return el;
  const sel = document.createElement('select');
  sel.id = id; sel.className = el.className;
  sel.innerHTML = '<option value="">—</option>' + meses.map(m => `<option value="${m}">${ymLabel(m)}</option>`).join('');
  el.replaceWith(sel);
  return sel;
}
/* change cobre o seletor nativo e o select; input cobre quem digita sem sair do campo */
function ligarCampoMes(el, aplicar) {
  if (!el) return;
  const handler = () => { const v = normalizaYM(el.value); if (el.value && !v) return; aplicar(v); };
  el.addEventListener('change', handler);
  el.addEventListener('input', handler);
}
const MESES_LANC = mesesDe(['dtLancamento']);
ligarCampoMes(campoMes('fltFrom', MESES_LANC), v => { state.from = v; applyAll(); });
ligarCampoMes(campoMes('fltTo', MESES_LANC), v => { state.to = v; applyAll(); });

/* ============================================================
   Edição de textos com lápis (portado de leadsebm2.0)
   ============================================================ */
function requireEditPassword() { return prompt('Digite a senha para editar:') === '123'; }
function initEditableText() {
  const nodes = $$('[data-editable]').filter(el => !el.dataset.editReady);
  nodes.forEach((el, i) => {
    const id = 'txt-' + i + '-' + textKey(el.textContent).slice(0, 24).replace(/\W/g, '');
    const saved = localStorage.getItem('ofDashboardText:' + id);
    if (saved) el.textContent = saved;
    el.dataset.editReady = '1'; el.dataset.editId = id;
    const wrap = document.createElement('span'); wrap.className = 'editable-wrap';
    const target = document.createElement('span'); target.className = 'editable-target'; target.textContent = el.textContent;
    const pencil = document.createElement('button');
    pencil.type = 'button'; pencil.className = 'edit-pencil'; pencil.title = 'Editar texto'; pencil.setAttribute('aria-label', 'Editar texto'); pencil.textContent = '✎';
    el.textContent = ''; el.appendChild(wrap); wrap.appendChild(target); wrap.appendChild(pencil);
    pencil.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      if (!requireEditPassword()) { alert('Senha incorreta.'); return; }
      target.classList.add('text-editing');
      const next = prompt('Editar texto:', target.textContent);
      target.classList.remove('text-editing');
      if (next === null) return;
      target.textContent = next;
      localStorage.setItem('ofDashboardText:' + id, next);
      if (el.matches('.top__title')) document.title = 'EBM Inteligência | ' + next;
    };
  });
  const h1 = $('.top__title .editable-target');
  if (h1) document.title = 'EBM Inteligência | ' + h1.textContent;
}

/* ============================================================
   Chat de IA integrado (portado de leadsebm2.0)
   ============================================================ */
/* nunca embutir chave de API aqui: este arquivo é servido ao navegador.
   A chave é do usuário e fica só no localStorage dele (botão de chave no chat). */
const DEFAULT_AI_PROVIDER = 'openrouter', DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';
const AI_PROVIDERS = {
  openai: { label: 'OpenAI', type: 'chat', endpoint: 'https://api.openai.com/v1/chat/completions', models: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4o', 'gpt-4.1'] },
  deepseek: { label: 'DeepSeek', type: 'chat', endpoint: 'https://api.deepseek.com/chat/completions', models: ['deepseek-chat', 'deepseek-reasoner'] },
  mistral: { label: 'Mistral', type: 'chat', endpoint: 'https://api.mistral.ai/v1/chat/completions', models: ['mistral-small-latest', 'mistral-large-latest', 'open-mistral-nemo'] },
  openrouter: { label: 'OpenRouter', type: 'chat', endpoint: 'https://openrouter.ai/api/v1/chat/completions', models: [{ id: 'xiaomi/mimo-v2.5', label: 'MiMo v2.5 · Xiaomi' }, { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash' }, { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B · free' }, { id: 'minimax/minimax-m3', label: 'MiniMax M3' }, { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B · OpenAI' }] },
  gemini: { label: 'Gemini', type: 'gemini', models: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }, { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }] },
  anthropic: { label: 'Anthropic', type: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', models: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }, { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }, { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }] },
  groq: { label: 'Groq', type: 'chat', endpoint: 'https://api.groq.com/openai/v1/chat/completions', models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  together: { label: 'Together AI', type: 'chat', endpoint: 'https://api.together.xyz/v1/chat/completions', models: ['meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1', 'deepseek-ai/deepseek-coder-33b-instruct'] },
};
function aiConfig() {
  return {
    provider: localStorage.getItem('ofDashboardAIProvider') || DEFAULT_AI_PROVIDER,
    model: localStorage.getItem('ofDashboardAIModel') || DEFAULT_AI_MODEL,
    key: localStorage.getItem('ofDashboardAIKey') || '',
  };
}
function fillAIModels(provider, selected = '') {
  const sel = $('#aiModel'), custom = $('#aiCustomModel'), p = AI_PROVIDERS[provider] || AI_PROVIDERS.openai;
  if (!sel) return;
  const opts = (p.models || []).map(m => typeof m === 'string' ? { id: m, label: m } : m);
  sel.innerHTML = opts.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.label || o.id)}</option>`).join('');
  const ids = opts.map(o => o.id);
  if (selected && ids.includes(selected)) { sel.value = selected; if (custom) custom.value = ''; }
  else if (selected && custom) custom.value = selected;
}
function resizeAIQuestion() { const q = $('#aiQuestion'); if (!q) return; q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 120) + 'px'; }
function setAIChatOpen(open) {
  const widget = $('#aiChat'), fab = $('#aiFab');
  if (!widget) return;
  widget.classList.toggle('is-open', open);
  if (fab) { fab.setAttribute('aria-expanded', open ? 'true' : 'false'); fab.setAttribute('aria-label', open ? 'Fechar chat' : 'Abrir chat'); }
  if (open) setTimeout(() => $('#aiQuestion')?.focus(), 120);
}
/* markdown mínimo do que os modelos realmente devolvem: negrito, itálico, código e
   listas. Escapa antes de formatar — a resposta vem de fora e vai para innerHTML. */
const COPIAR_SVG = '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function mdParaHtml(texto) {
  return escapeHtml(texto)
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (m, c) => `<pre>${c.replace(/\n$/, '')}</pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/^\s*[-*]\s+/gm, '• ');
}
async function copiarTexto(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    // clipboard API só existe em contexto seguro; no file:// cai no caminho antigo
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
function appendAIMessage(role, text) {
  const box = $('#aiMessages'); if (!box) return;
  const div = document.createElement('div');
  div.className = 'ai-msg ' + (role === 'user' ? 'ai-user' : 'ai-bot');
  const corpo = document.createElement('div');
  corpo.className = 'ai-msg__body';
  div.appendChild(corpo);
  const copiar = document.createElement('button');
  copiar.type = 'button'; copiar.className = 'ai-copy';
  copiar.title = 'Copiar'; copiar.setAttribute('aria-label', 'Copiar mensagem');
  copiar.innerHTML = COPIAR_SVG;
  copiar.onclick = async ev => {
    ev.stopPropagation();
    copiar.classList.toggle('ok', await copiarTexto(div.__texto || ''));
    copiar.title = copiar.classList.contains('ok') ? 'Copiado' : 'Não consegui copiar';
    setTimeout(() => { copiar.classList.remove('ok'); copiar.title = 'Copiar'; }, 1600);
  };
  div.appendChild(copiar);
  /* o texto do bot é reescrito enquanto a resposta anda ("consultando o banco…"),
     então a mensagem guarda o cru para o botão de copiar e reformata a cada troca */
  div.__setText = t => { div.__texto = t; corpo.innerHTML = mdParaHtml(t); box.scrollTop = box.scrollHeight; };
  div.__setText(text);
  box.appendChild(div); box.scrollTop = box.scrollHeight;
  return div;
}
/* o chat consulta o banco Neon (fonte da verdade) via /api/sql — não o JSON do dashboard */
const SQL_ENDPOINT = /vercel\.app$/.test(location.hostname) ? '/api/sql' : 'https://oferta-futura.vercel.app/api/sql';
function aiSystemPrompt() {
  return `Você é um analista de inteligência de mercado imobiliário da EBM Incorporadora (Goiânia). Responda em português do Brasil, direto e assertivo, números em pt-BR.

Você tem acesso ao banco Postgres (Neon) do dashboard Oferta Futura. Para responder QUALQUER pergunta sobre dados, PRIMEIRO consulte o banco: responda APENAS com um bloco \`\`\`sql ... \`\`\` contendo um único SELECT (Postgres). O sistema executa e devolve as linhas em JSON; aí você responde ao usuário. Se precisar, encadeie até 3 consultas. Nunca invente números — use só o que vier do banco.

Tabela principal: projecao_of — grão = tipologia × mês (projeção). Linhas com id_tipologia NOT NULL = projeção da OFERTA FUTURA (lançamentos previstos 2026-2027); linhas com id_tipologia NULL = histórico/projeção do mercado (síntese). Colunas principais (Postgres diferencia maiúsculas — use aspas duplas nos nomes com maiúscula ou especiais):
- empreendimento, incorporadora, bairro, cidade, macrozona (text)
- "TipoEmpreendimento" (ex.: 'APART - MAP', 'APART - ECO'), cluster, tipologia, tipologia_tratada (0=comercial, 1-4=quartos)
- "dtlançamento" (date, mês de lançamento), data (date, mês da linha), lancamento ('sim' quando data = mês do lançamento)
- "TotalUnidades" (unidades do empreendimento; repetida por linha — use MAX/DISTINCT), "Unids_tipologia" (unidades da tipologia), "AreaPrivativa" (m²)
- unidadesdisponiveis, unidadesvendidasmes, unidadesdistratadasmes (por tipologia × mês)
- "AreaTerreno", "Latitude", "Longitude", "Cidade.Uf", consideracao_OF, "LinkPortal"
ATENÇÃO — cada tipologia se repete em ~18 linhas (uma por mês de projeção). Somar "Unids_tipologia" ou "TotalUnidades" sem filtro multiplica tudo por 18. Padrões corretos:
- Unidades lançadas (por ano/incorporadora/bairro...): WHERE id_tipologia IS NOT NULL AND lancamento='sim' e SUM("Unids_tipologia") — ex.: SELECT incorporadora, SUM("Unids_tipologia") u FROM projecao_of WHERE id_tipologia IS NOT NULL AND lancamento='sim' AND EXTRACT(YEAR FROM "dtlançamento")=2027 GROUP BY 1 ORDER BY u DESC
- Oferta disponível por mês: SELECT data, SUM(unidadesdisponiveis) FROM projecao_of WHERE id_tipologia IS NOT NULL GROUP BY data
- Total de unidades de um empreendimento: MAX("TotalUnidades") por empreendimento (nunca SUM)
- Contar empreendimentos: COUNT(DISTINCT empreendimento)
Limite de 200 linhas por consulta — agregue no SQL.

Também existe sintese_consolidada (mercado histórico bruto). Se a pergunta fugir do mercado imobiliário/dados do dashboard, diga que foge do escopo.`;
}
function aiUserContext() {
  return `Mês de referência: ${refMonth}. Filtros ativos no dashboard (apenas contexto; o banco não está filtrado): ${filtersSummaryText() || 'nenhum'}.`;
}
async function runNeonSQL(sql) {
  const res = await fetch(SQL_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Falha ao consultar o banco.');
  return data;
}
async function callAIProvider(messages) {
  const cfg = aiConfig(), p = AI_PROVIDERS[cfg.provider];
  if (!p || !cfg.key) throw new Error('cadastre uma chave de API no botão de chave (🔑) antes de perguntar.');
  if (p.type === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: aiSystemPrompt() }] }, contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), generationConfig: { temperature: .15, maxOutputTokens: 1400 } }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error?.message || 'Falha na API Gemini.');
    return (data.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('\n').trim();
  }
  if (p.type === 'anthropic') {
    const res = await fetch(p.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: cfg.model, max_tokens: 1400, temperature: .15, system: aiSystemPrompt(), messages }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error?.message || 'Falha na API Anthropic.');
    return (data.content || []).map(x => x.text || '').join('\n').trim();
  }
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key };
  if (cfg.provider === 'openrouter') { headers['HTTP-Referer'] = location.href || 'file://oferta-futura'; headers['X-Title'] = 'Oferta Futura EBM'; }
  const res = await fetch(p.endpoint, { method: 'POST', headers, body: JSON.stringify({ model: cfg.model, temperature: .15, max_tokens: 1400, messages: [{ role: 'system', content: aiSystemPrompt() }, ...messages] }) });
  const data = await res.json(); if (!res.ok) throw new Error(data.error?.message || data.message || 'Falha na API selecionada.');
  return (data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '').trim();
}
const extractSQL = text => { const m = /```sql\s*([\s\S]*?)```/i.exec(text || ''); return m ? m[1].trim() : null; };
async function askAI() {
  const input = $('#aiQuestion'), btn = $('#aiAskBtn'), q = input.value.trim();
  if (!q) return;
  setAIChatOpen(true);
  appendAIMessage('user', q);
  input.value = ''; resizeAIQuestion();
  btn.disabled = true;
  const loading = appendAIMessage('bot', 'Analisando a oferta futura…');
  try {
    const messages = [{ role: 'user', content: `${aiUserContext()}\n\nPergunta do usuário: ${q}` }];
    let answer = 'Não recebi resposta da IA.';
    for (let round = 0; round < 4; round++) {
      const out = await callAIProvider(messages);
      const sql = extractSQL(out);
      if (!sql || round === 3) { answer = (out || '').replace(/```sql[\s\S]*?```/gi, '').trim() || answer; break; }
      loading.__setText('Consultando o banco de dados…');
      messages.push({ role: 'assistant', content: out });
      let feedback;
      try {
        const r = await runNeonSQL(sql);
        feedback = `Resultado da consulta (${r.rowCount} linhas${r.truncated ? ', truncado em 200 — agregue mais' : ''}):\n${JSON.stringify(r.rows).slice(0, 24000)}`;
      } catch (err) { feedback = 'Erro na consulta: ' + err.message + '\nCorrija o SQL e tente de novo.'; }
      messages.push({ role: 'user', content: feedback + '\n\nAgora responda ao usuário (ou envie outro bloco ```sql``` se precisar de mais dados).' });
      loading.__setText('Interpretando os dados…');
    }
    loading.__setText(answer);
  }
  catch (err) { console.error(err); loading.__setText('Não consegui responder: ' + err.message); }
  finally { btn.disabled = false; input.focus(); }
}
function initAIChat() {
  const provider = $('#aiProvider'), model = $('#aiModel'), custom = $('#aiCustomModel'), key = $('#aiApiKey'), panel = $('#aiKeyPanel'), btn = $('#aiKeyBtn'), save = $('#aiSaveKey'), cancel = $('#aiCancelKey'), ask = $('#aiAskBtn'), question = $('#aiQuestion'), fab = $('#aiFab'), form = $('#chatForm');
  if (!provider || !btn) return;
  provider.innerHTML = Object.entries(AI_PROVIDERS).map(([id, p]) => `<option value="${id}">${p.label}</option>`).join('');
  const saved = aiConfig();
  provider.value = AI_PROVIDERS[saved.provider] ? saved.provider : DEFAULT_AI_PROVIDER;
  fillAIModels(provider.value, saved.model);
  key.value = saved.key;
  provider.onchange = () => { fillAIModels(provider.value); if (custom) custom.value = ''; };
  if (fab) fab.onclick = () => setAIChatOpen(!$('#aiChat').classList.contains('is-open'));
  btn.onclick = () => { if (!requireEditPassword()) { alert('Senha incorreta.'); return; } setAIChatOpen(true); panel.hidden = false; key.focus(); };
  cancel.onclick = () => { panel.hidden = true; question.focus(); };
  save.onclick = () => {
    const chosen = (custom.value || model.value || '').trim();
    if (!key.value.trim()) { alert('Informe a chave da API.'); return; }
    localStorage.setItem('ofDashboardAIProvider', provider.value);
    localStorage.setItem('ofDashboardAIModel', chosen);
    localStorage.setItem('ofDashboardAIKey', key.value.trim());
    panel.hidden = true;
    appendAIMessage('bot', `Chave salva para ${AI_PROVIDERS[provider.value].label} / ${chosen}.`);
  };
  if (form) form.onsubmit = e => { e.preventDefault(); askAI(); };
  ask.onclick = e => { e.preventDefault(); askAI(); };
  question.addEventListener('input', resizeAIQuestion);
  question.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(); } if (e.key === 'Escape') setAIChatOpen(false); });
  resizeAIQuestion();
}

/* ============================================================
   Plano Diretor de Goiânia 2022 — camadas sob demanda
   O KMZ original tem 36 MB; cada camada virou um arquivo próprio, baixado
   só quando o usuário a liga e mantido em cache na memória depois disso.
   ============================================================ */
const PD = window.OF_PLANO_DIRETOR || { base: '', camadas: [] };
const pdCache = {};                 // id -> formas já baixadas
const pdAtivas = new Map();         // id -> L.LayerGroup no mapa
let pdRenderer = null;

async function pdCarregar(cam) {
  if (pdCache[cam.id]) return pdCache[cam.id];
  const res = await fetch(`${PD.base}${cam.arq}?v=20260727e`);
  if (!res.ok) throw new Error(`falha ao baixar ${cam.nome} (${res.status})`);
  const dados = await res.json();
  pdCache[cam.id] = dados.formas || [];
  return pdCache[cam.id];
}
function pdDesenhar(cam, formas) {
  pdRenderer = pdRenderer || L.canvas({ pane: 'planoDiretor' });
  const grupo = L.layerGroup();
  formas.forEach(f => {
    const comum = { pane: 'planoDiretor', renderer: pdRenderer, color: cam.cor, weight: f.t ? 1 : 2.2, opacity: .9 };
    const geo = f.t
      ? L.polygon(f.p, { ...comum, fillColor: cam.cor, fillOpacity: .2 })
      : L.polyline(f.p, comum);
    geo.bindTooltip(`${f.n || cam.nome}<br><span class="mono" style="font-size:10px;opacity:.75">${cam.nome}</span>`,
      { sticky: true, className: 'bairro-tip' });
    geo.addTo(grupo);
  });
  grupo.addTo(map);
  pdAtivas.set(cam.id, grupo);
}
function pdStatus() {
  const el = $('#pdStatus'); if (!el) return;
  const n = pdAtivas.size;
  const formas = [...pdAtivas.keys()].reduce((s, id) => s + (pdCache[id] || []).length, 0);
  el.textContent = n ? `${n} camada${n > 1 ? 's' : ''} ativa${n > 1 ? 's' : ''} · ${fmtInt(formas)} geometrias` : 'nenhuma camada ativa';
}
async function pdAlternar(cam, ligar, item) {
  if (ligar) {
    if (pdAtivas.has(cam.id)) return;
    item?.classList.add('loading');
    try { pdDesenhar(cam, await pdCarregar(cam)); }
    catch (err) { console.error(err); alert(err.message); const c = item?.querySelector('input'); if (c) c.checked = false; }
    finally { item?.classList.remove('loading'); }
  } else {
    const g = pdAtivas.get(cam.id);
    if (g) { map.removeLayer(g); pdAtivas.delete(cam.id); }
  }
  pdStatus();
}
function initPlanoDiretor() {
  const painel = $('#pdPanel'), botao = $('#pdToggle'), grupos = $('#pdGroups');
  if (!painel || !botao || !PD.camadas.length) { botao?.remove(); painel?.remove(); return; }
  botao.onclick = () => {
    const aberto = painel.hidden;
    painel.hidden = !aberto;
    botao.setAttribute('aria-expanded', aberto ? 'true' : 'false');
  };
  const porGrupo = {};
  PD.camadas.forEach(c => (porGrupo[c.grupo] = porGrupo[c.grupo] || []).push(c));
  grupos.innerHTML = Object.entries(porGrupo).map(([g, cams]) => `
    <div class="pd-group" data-g="${escapeHtml(g)}">
      <div class="pd-group__head"><b>${escapeHtml(g.toUpperCase())}</b><button type="button" data-all="${escapeHtml(g)}">TODAS</button></div>
      ${cams.map(c => `<label class="pd-item" data-id="${c.id}" title="${escapeHtml(c.nome)} · ${c.formas} geometrias · ${c.kb} KB">
        <input type="checkbox" /><i style="background:${c.cor}"></i><span>${escapeHtml(c.nome)}</span></label>`).join('')}
    </div>`).join('');
  const porId = Object.fromEntries(PD.camadas.map(c => [c.id, c]));
  $$('#pdGroups .pd-item').forEach(item => {
    const cam = porId[item.dataset.id];
    item.querySelector('input').onchange = e => pdAlternar(cam, e.target.checked, item);
  });
  $$('#pdGroups [data-all]').forEach(btn => btn.onclick = () => {
    const itens = $$(`.pd-group[data-g="${CSS.escape(btn.dataset.all)}"] .pd-item`);
    const ligarTodas = itens.some(i => !i.querySelector('input').checked);
    itens.forEach(i => { const c = i.querySelector('input'); if (c.checked !== ligarTodas) { c.checked = ligarTodas; pdAlternar(porId[i.dataset.id], ligarTodas, i); } });
  });
  $('#pdClear').onclick = () => {
    $$('#pdGroups .pd-item').forEach(i => {
      const c = i.querySelector('input');
      if (c.checked) { c.checked = false; pdAlternar(porId[i.dataset.id], false, i); }
    });
  };
}

/* ---------- expandir card (estilo Power BI) ---------- */
const EXPAND_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M9 3H3v6M15 21h6v-6M3 3l7 7M21 21l-7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COLAPSE_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 9h6V3M21 15h-6v6M10 10 3 3M14 14l7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
let cardExpandido = null;
/* redimensiona depois que o layout novo já valeu: o resize do Chart.js lê o tamanho
   do container e refaz o canvas na densidade da tela — se rodar antes, sai borrado */
function recalcularVisuais() {
  requestAnimationFrame(() => {
    [chartDisp, chartLanc].forEach(c => {
      try {
        if (!c) return;
        // zera a largura antiga antes de medir: senão o canvas segura o container aberto
        c.canvas.style.width = ''; c.canvas.style.height = '';
        c.resize();
      } catch (e) { /* gráfico ainda não criado */ }
    });
    if (map) map.invalidateSize();
  });
}
function alternarExpansao(card, btn) {
  const abrindo = cardExpandido !== card;
  if (cardExpandido) {
    cardExpandido.classList.remove('card-expanded');
    cardExpandido.__btn.innerHTML = EXPAND_SVG;
    cardExpandido.__btn.title = 'Expandir';
    cardExpandido = null;
    $('.expand-back')?.remove();
    document.body.classList.remove('has-expanded');
  }
  if (abrindo) {
    const fundo = document.createElement('div');
    fundo.className = 'expand-back';
    fundo.onclick = () => alternarExpansao(card, btn);
    document.body.appendChild(fundo);
    card.classList.add('card-expanded');
    card.__btn = btn;
    btn.innerHTML = COLAPSE_SVG;
    btn.title = 'Restaurar';
    document.body.classList.add('has-expanded');
    cardExpandido = card;
  }
  recalcularVisuais();
}
function initExpandir() {
  $$('.card, .filters').forEach(card => {
    const head = card.querySelector('.card__head, .filters__head');
    if (!head || card.querySelector(':scope > .card__head .expand-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'expand-btn'; btn.title = 'Expandir';
    btn.setAttribute('aria-label', 'Expandir painel');
    btn.innerHTML = EXPAND_SVG;
    btn.onclick = e => { e.stopPropagation(); alternarExpansao(card, btn); };
    let alvo = head.querySelector('.head-tools');
    if (!alvo) { alvo = document.createElement('div'); alvo.className = 'head-tools'; head.appendChild(alvo); }
    alvo.appendChild(btn);
  });
}

/* ---------- desempenho por incorporadora ---------- */
const diasEntre = (a, b) => (!a || !b) ? null : Math.round((new Date(b.slice(0, 10)) - new Date(a.slice(0, 10))) / 86400000);
const mediana = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y), i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const media = arr => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null;
/* Esta é a única tabela que ignora o filtro global de período de lançamento:
   ela tem período próprio, medido sobre as datas de protocolo e de aprovação. */
let incFrom = '', incTo = '';
const incJanela = () => !!(incFrom || incTo);
const dentroInc = d => { const m = (d || '').slice(0, 7); return !!m && (!incFrom || m >= incFrom) && (!incTo || m <= incTo); };
/* "lançado" usa o início do período da tabela: lançamento anterior a ele já aconteceu.
   Sem período, a régua é o mês de referência (mês atual). */
const rEguaLancamento = () => incFrom || nowYM();
const jaLancado = e => { const m = (e.dtLancamento || '').slice(0, 7); return !!m && m <= rEguaLancamento(); };
/* com período: conta o que aconteceu dentro da janela.
   sem período: cai no status atual (as flags do banco valem quando falta a data) */
function estagioProjeto(e) {
  const aprovado = incJanela() ? dentroInc(e.dataAprovacao) : (!!e.dataAprovacao || !!e.projetoAprovado);
  const protocolado = incJanela() ? dentroInc(e.dataProtocolo) : (!!e.dataProtocolo || !!e.projetoProtocolado);
  return { aprovado, emProtocolo: protocolado && !aprovado };
}
function baseIncorporadoras() {
  return DATA.empreendimentos.filter(e => empMatches(e, false))
    .filter(e => !incJanela() || dentroInc(e.dataProtocolo) || dentroInc(e.dataAprovacao));
}
function statsIncorporadoras(emps) {
  const acc = {};
  emps.forEach(e => {
    const nome = e.incorporadora || '—';
    const a = acc[nome] = acc[nome] || { nome, projetos: 0, unidades: 0, protocolo: 0, aprovados: 0, lancados: 0, prazos: [], filhos: [] };
    const { aprovado, emProtocolo } = estagioProjeto(e);
    const lancado = jaLancado(e);
    const d = diasEntre(e.dataProtocolo, e.dataAprovacao);
    const prazo = (d != null && d >= 0) ? d : null;
    a.projetos += 1;
    a.unidades += e.totalUnidades || 0;
    if (aprovado) a.aprovados += 1;
    if (emProtocolo) a.protocolo += 1;
    if (lancado) a.lancados += 1;
    if (prazo != null) a.prazos.push(prazo);
    a.filhos.push({
      nome: e.empreendimento || '—', id: e.id, ehEmp: true, projetos: 1, unidades: e.totalUnidades || 0,
      protocolo: emProtocolo ? 1 : 0, aprovados: aprovado ? 1 : 0, lancados: lancado ? 1 : 0,
      dataProtocolo: e.dataProtocolo || null, dataAprovacao: e.dataAprovacao || null,
      medianaAprov: prazo, mediaAprov: prazo,
    });
  });
  return Object.values(acc).map(a => ({
    ...a, medianaAprov: mediana(a.prazos), mediaAprov: media(a.prazos),
  }));
}
let incNivel = 0;   // 0=incorporadora (com drill p/ empreendimentos), 1=empreendimento (lista plana)
const incMeses = d => d == null ? '—' : (d / 30.44).toFixed(1).replace('.', ',') + ' m';
const INC_COLS_PDF = [
  { label: 'INCORPORADORA / EMPREENDIMENTO' }, { label: 'PROJETOS', r: true }, { label: 'UNIDADES', r: true },
  { label: 'EM PROTOCOLO', r: true }, { label: 'APROVADOS', r: true }, { label: 'LANÇADOS', r: true },
  { label: 'DATA PROTOCOLO' }, { label: 'DATA APROVAÇÃO' }, { label: 'APROV. MEDIANA', r: true }, { label: 'APROV. MÉDIA', r: true },
];
function dadosIncorporadoras() {
  const stats = statsIncorporadoras(baseIncorporadoras());
  const linhas = ordenarArvore(incNivel ? stats.flatMap(a => a.filhos) : stats, 'incTable', (r, k) => k === 'nome' ? r.nome : r[k]);
  const tot = linhas.reduce((s, l) => ({
    projetos: s.projetos + l.projetos, unidades: s.unidades + l.unidades,
    protocolo: s.protocolo + l.protocolo, aprovados: s.aprovados + l.aprovados,
    lancados: s.lancados + l.lancados,
    prazos: s.prazos.concat(l.prazos || (l.medianaAprov != null ? [l.medianaAprov] : [])),
  }), { projetos: 0, unidades: 0, protocolo: 0, aprovados: 0, lancados: 0, prazos: [] });
  /* a janela é OU, não E: basta o protocolo OU a aprovação cair no período para o
     empreendimento entrar (ver baseIncorporadoras) */
  const legenda = incJanela()
    ? `Projetos protocolados OU aprovados entre ${incFrom ? ymLabel(incFrom) : '…'} e ${incTo ? ymLabel(incTo) : '…'} · basta uma das duas datas cair no período · não obedece ao filtro de período de lançamento · lançado = lançamento até ${ymLabel(rEguaLancamento())}`
    : `Toda a base, sem recorte de período · lançado = lançamento até ${ymLabel(rEguaLancamento())} · tempo de aprovação = protocolo → aprovação`;
  return { linhas, tot, legenda };
}
function renderIncorporadoras() {
  const alvo = $('#incTable'); if (!alvo) return;
  const { linhas, tot, legenda } = dadosIncorporadoras();
  const meses = incMeses;
  const marca = v => v ? `<b>${v}</b>` : '·';
  const sub = $('#incSub');
  if (sub) sub.textContent = legenda;
  const cols = [
    { k: 'nome', label: incNivel ? 'EMPREENDIMENTO' : 'INCORPORADORA / EMPREENDIMENTO' },
    { k: 'projetos', label: 'PROJETOS', num: true }, { k: 'unidades', label: 'UNIDADES', num: true },
    { k: 'protocolo', label: 'EM PROTOCOLO', num: true }, { k: 'aprovados', label: 'APROVADOS', num: true },
    { k: 'lancados', label: 'LANÇADOS', num: true },
    /* datas só existem na linha de empreendimento; no nível incorporadora a célula fica em branco.
       Ordenar por elas ordena os empreendimentos DENTRO de cada incorporadora (ISO ordena como texto). */
    { k: 'dataProtocolo', label: 'DATA PROTOCOLO' }, { k: 'dataAprovacao', label: 'DATA APROVAÇÃO' },
    { k: 'medianaAprov', label: 'APROV. MEDIANA', num: true }, { k: 'mediaAprov', label: 'APROV. MÉDIA', num: true },
  ];
  /* linha de empreendimento (ehEmp) tem o mesmo visual em qualquer nível:
     no drill dentro da incorporadora ou na lista plana do nível Empreend. */
  const celulas = l => `
      <td>${escapeHtml(l.nome)}</td>
      <td class="num">${l.ehEmp ? '·' : fmtInt(l.projetos)}</td>
      <td class="num">${fmtInt(l.unidades)}</td>
      <td class="num">${l.ehEmp ? marca(l.protocolo) : (l.protocolo ? `<span class="pill pill--wait">${l.protocolo}</span>` : '<span class="pill pill--none">0</span>')}</td>
      <td class="num">${l.ehEmp ? marca(l.aprovados) : (l.aprovados ? `<span class="pill pill--ok">${l.aprovados}</span>` : '<span class="pill pill--none">0</span>')}</td>
      <td class="num">${l.ehEmp ? marca(l.lancados) : fmtInt(l.lancados)}</td>
      <td class="num">${l.ehEmp ? (dateBR(l.dataProtocolo) || '—') : ''}</td>
      <td class="num">${l.ehEmp ? (dateBR(l.dataAprovacao) || '—') : ''}</td>
      <td class="num">${meses(l.medianaAprov)}</td>
      <td class="num">${meses(l.mediaAprov)}</td>`;
  const html = cabecalhoOrdenavel('incTable', cols) + '<tbody>' + linhasArvore(linhas, celulas)
    + `<tr class="tot-row">
      <td>TOTAL · ${linhas.length} ${incNivel ? 'empreendimentos' : 'incorporadoras'}</td>
      <td class="num">${fmtInt(tot.projetos)}</td><td class="num">${fmtInt(tot.unidades)}</td>
      <td class="num">${fmtInt(tot.protocolo)}</td><td class="num">${fmtInt(tot.aprovados)}</td>
      <td class="num">${fmtInt(tot.lancados)}</td>
      <td></td><td></td>
      <td class="num">${meses(mediana(tot.prazos))}</td><td class="num">${meses(media(tot.prazos))}</td>
    </tr></tbody>`;
  alvo.innerHTML = html;
  ligarArvore('incTable', locateOnMap);
  ligarOrdenacao('incTable', renderIncorporadoras);
  ligarLarguras('incTable');
}

/* ---------- concentração por bairro / macrozona / incorporadora / empreendimento ----------
   O seg escolhe o nível topo da hierarquia: bairro e macrozona mantêm o drill
   geografia → incorporadora → empreendimento; incorporadora re-agrega a tabela
   inteira (share de mercado por incorporadora, drill p/ empreendimentos);
   empreendimento é a lista plana com o share individual. */
let concMode = 'bairro';
function dadosConcentracao() {
  const chaveGeo = e => concMode === 'macrozona' ? mzLabel(e.macrozona) : (e.bairro || '—');
  const geoLabel = concMode === 'macrozona' ? 'MACROZONA' : 'BAIRRO';
  const areaMedia = areas => {
    const u = areas.reduce((s, [, n]) => s + n, 0);
    return u ? areas.reduce((s, [a, n]) => s + a * n, 0) / u : null;
  };
  /* m² médio é ponderado pelas unidades de cada tipologia — a média das médias
     dos empreendimentos daria outro número */
  const tiposDe = emps => emps.flatMap(e => (e.tipologias || []).filter(t => t.area != null && t.unids).map(t => [t.area, t.unids]));
  const somaUn = emps => emps.reduce((s, e) => s + (e.totalUnidades || 0), 0);
  const somaArea = emps => emps.reduce((s, e) => s + (e.areaTerreno || 0), 0);
  const totUn = somaUn(filtered) || 1;
  /* dim = coluna que muda com o nível: nº de incorporadoras (geografia),
     nº de bairros (incorporadora) ou o bairro do empreendimento (lista plana) */
  const noEmp = (e, dim) => ({
    nome: e.empreendimento || '—', id: e.id, emps: null, unidades: e.totalUnidades || 0,
    pct: (e.totalUnidades || 0) * 100 / totUn, dim,
    m2: areaMedia(tiposDe([e])), area: e.areaTerreno || 0,
  });
  const noGrupo = (nome, emps, dim, filhos) => ({
    nome, emps: emps.length, unidades: somaUn(emps), pct: somaUn(emps) * 100 / totUn,
    dim, m2: areaMedia(tiposDe(emps)), area: somaArea(emps), filhos,
  });
  const agrupa = (emps, chave) => {
    const acc = {};
    emps.forEach(e => (acc[chave(e)] = acc[chave(e)] || []).push(e));
    return Object.entries(acc);
  };
  const porInc = (emps, dimDe) => agrupa(emps, e => e.incorporadora || '—')
    .map(([inc, g]) => noGrupo(inc, g, dimDe ? dimDe(g) : null, g.map(e => noEmp(e, null))));
  let linhasBrutas, colDim, totDim, unidadeTotal, rotulo;
  if (concMode === 'empreendimento') {
    linhasBrutas = filtered.map(e => noEmp(e, e.bairro || '—'));
    colDim = { k: 'dim', label: 'BAIRRO' };
    totDim = fmtInt(new Set(filtered.map(e => e.bairro || '—')).size) + ' bairros';
    unidadeTotal = 'empreendimentos';
    rotulo = 'EMPREENDIMENTO';
  } else if (concMode === 'incorporadora') {
    linhasBrutas = porInc(filtered, g => new Set(g.map(e => e.bairro || '—')).size);
    colDim = { k: 'dim', label: 'BAIRROS', num: true };
    totDim = fmtInt(new Set(filtered.map(e => e.bairro || '—')).size);
    unidadeTotal = 'incorporadoras';
    rotulo = 'INCORPORADORA / EMPREENDIMENTO';
  } else {
    linhasBrutas = agrupa(filtered, chaveGeo).map(([k, g]) =>
      noGrupo(k, g, new Set(g.map(e => e.incorporadora).filter(Boolean)).size, porInc(g, null)));
    colDim = { k: 'dim', label: 'INCORPORADORAS', num: true };
    totDim = fmtInt(new Set(filtered.map(e => e.incorporadora).filter(Boolean)).size);
    unidadeTotal = concMode === 'macrozona' ? 'macrozonas' : 'bairros';
    rotulo = geoLabel + ' / INCORPORADORA / EMPREENDIMENTO';
  }
  const maior = Math.max(...linhasBrutas.map(l => l.unidades), 1);
  const linhas = ordenarArvore(linhasBrutas, 'concTable', (r, k) => r[k]);
  return { linhas, maior, colDim, totDim, unidadeTotal, rotulo, totUn };
}
function renderConcentracao() {
  const alvo = $('#concTable'); if (!alvo) return;
  const { linhas, maior, colDim, totDim, unidadeTotal, rotulo, totUn } = dadosConcentracao();
  const pct = v => v.toFixed(1).replace('.', ',') + '%';
  const barra = v => `<td class="conc-bar"><i style="width:${Math.max(2, Math.min(100, v * 100 / maior))}%"></i></td>`;
  const dimCel = d => d == null ? '·' : (typeof d === 'number' ? fmtInt(d) : escapeHtml(d));
  const celulas = l => `
      <td>${escapeHtml(l.nome)}</td>
      <td class="num">${l.emps == null ? '·' : fmtInt(l.emps)}</td>
      <td class="num">${fmtInt(l.unidades)}</td>
      <td class="num">${pct(l.pct)}</td>${barra(l.unidades)}
      <td class="num">${dimCel(l.dim)}</td>
      <td class="num">${l.m2 == null ? '—' : fmtDec(l.m2, 0)}</td>
      <td class="num">${fmtInt(l.area)}</td>`;
  const html = cabecalhoOrdenavel('concTable', [
    { k: 'nome', label: rotulo },
    { k: 'emps', label: 'EMPREEND.', num: true }, { k: 'unidades', label: 'UNIDADES', num: true },
    { k: 'pct', label: '% DO TOTAL', num: true }, { label: 'PARTICIPAÇÃO', fixa: true },
    colDim, { k: 'm2', label: 'M² MÉDIO', num: true },
    { k: 'area', label: 'M² TERRENO', num: true },
  ]) + '<tbody>' + linhasArvore(linhas, celulas)
    + `<tr class="tot-row">
      <td>TOTAL · ${linhas.length} ${unidadeTotal}</td>
      <td class="num">${fmtInt(filtered.length)}</td>
      <td class="num">${fmtInt(totUn)}</td>
      <td class="num">100,0%</td><td></td>
      <td class="num">${totDim}</td>
      <td class="num"></td>
      <td class="num">${fmtInt(filtered.reduce((s, e) => s + (e.areaTerreno || 0), 0))}</td>
    </tr></tbody>`;
  alvo.innerHTML = html;
  ligarArvore('concTable', locateOnMap);
  ligarOrdenacao('concTable', renderConcentracao);
  ligarLarguras('concTable');
}

/* ---------- configurações (dock flutuante, padrão leadsebm) ---------- */
function setEditLock(locked) {
  document.body.classList.toggle('edits-locked', locked);
  const btn = $('#editLockBtn');
  if (btn) { btn.checked = locked; const label = locked ? 'Mostrar edições' : 'Ocultar edições'; btn.title = label; btn.setAttribute('aria-label', label); }
  localStorage.setItem('ofDashboardEditsLocked', locked ? '1' : '0');
}
function initSettingsPanel() {
  const dock = $('#settingsDock'), btn = $('#settingsBtn');
  if (!dock || !btn) return;
  const setOpen = open => { dock.classList.toggle('open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  btn.onclick = e => { e.stopPropagation(); setOpen(!dock.classList.contains('open')); };
  dock.onclick = e => e.stopPropagation();
  document.addEventListener('click', () => setOpen(false));
  fecharDock = () => setOpen(false);
  setEditLock(localStorage.getItem('ofDashboardEditsLocked') === '1');
  const lock = $('#editLockBtn');
  if (lock) lock.onchange = () => setEditLock(lock.checked);
  const labels = $('#dataLabelsBtn');
  if (labels) {
    labels.checked = showDataLabels;
    labels.onchange = () => {
      showDataLabels = labels.checked;
      localStorage.setItem('ofDashboardDataLabels', showDataLabels ? '1' : '0');
      renderCharts();
    };
  }
  const refInput = $('#refMonthInput');
  if (refInput) {
    refInput.value = refMonth;
    refInput.onchange = () => {
      refMonth = refInput.value || nowYM();
      refInput.value = refMonth;
      localStorage.setItem('ofDashboardRefMonth', refMonth);
      renderCharts();
    };
  }
}

/* ---------- upload da síntese (envia a planilha para o Neon) ----------
   O navegador não fala com o Postgres; manda em lotes para /api/upload-sintese,
   que grava numa staging e troca atômica pela tabela viva. Espelha as colunas de
   scripts/upload_sintese.py. A senha vai no corpo (HTTPS) e é conferida no servidor. */
const SINTESE_COLS = ['cidade', 'bairro', 'incorporadora', 'tipoempreendimento', 'empreendimento',
  'datainobr', 'datahabt', 'regional', 'consorcio', 'totalunidades', 'privativa',
  'unidadesvendidasmes', 'unidadesdistratadasmes', 'unidadesdisponiveis', 'percevolucaoobra',
  'tipologia', 'precounidade', 'datalancamento', 'data', 'macroregiao', 'latitude', 'longitude', 'lancou'];
const SINTESE_DATE = new Set(['datainobr', 'datahabt', 'datalancamento', 'data']);
const SINTESE_NUM = new Set(['totalunidades', 'privativa', 'unidadesvendidasmes', 'unidadesdistratadasmes',
  'unidadesdisponiveis', 'percevolucaoobra', 'tipologia', 'precounidade', 'macroregiao', 'latitude', 'longitude']);
const SINTESE_CHUNK = 1000;

function coDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}-01`;   // mm/aaaa -> 1o do mês (igual pandas)
  m = s.match(/^(\d{4})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-01`;      // aaaa-mm -> 1o do mês
  const d = new Date(s); return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function coNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}
function coText(v) { if (v == null) return null; const s = String(v).trim(); return s === '' ? null : s; }

/* cidades acompanhadas — precisa bater com CIDADES em scripts/converter_download_layout.py */
const SINTESE_CIDADES = new Set(['GOIANIA', 'APARECIDA DE GOIANIA']);

function planilhaParaLinhas(rowsAoA) {
  if (!rowsAoA.length) throw new Error('Planilha vazia.');
  const header = rowsAoA[0].map(h => textKey(h).toLowerCase().replace(/\s+/g, ''));
  const idx = {};
  SINTESE_COLS.forEach(c => { idx[c] = header.indexOf(c.toLowerCase()); });
  const faltando = SINTESE_COLS.filter(c => idx[c] < 0);
  if (faltando.length) throw new Error('Colunas ausentes: ' + faltando.join(', '));
  // export bruto do Brain (DownloadLayout): tem colunas de controle além das 23.
  // Nele aplicamos o mesmo filtro de cidades do converter_download_layout.py —
  // subir as 20 cidades pro banco distorce curvas e estoque (aconteceu uma vez).
  const ehBrain = header.includes('importadorlayoutid') || header.includes('linkimagem');
  const linhas = [];
  let foraCidade = 0;
  for (let r = 1; r < rowsAoA.length; r++) {
    const row = rowsAoA[r];
    if (!row || row.every(c => c == null || c === '')) continue; // pula linha em branco
    if (ehBrain && !SINTESE_CIDADES.has(textKey(row[idx.cidade]))) { foraCidade++; continue; }
    linhas.push(SINTESE_COLS.map(c => {
      const v = row[idx[c]];
      return SINTESE_DATE.has(c) ? coDate(v) : SINTESE_NUM.has(c) ? coNum(v) : coText(v);
    }));
  }
  if (!linhas.length) throw new Error('Nenhuma linha de dados encontrada.');
  return { linhas, ehBrain, foraCidade };
}

/* parser de CSV próprio (com aspas). O SheetJS convertia "01/04/2026" em 4 de
   janeiro (padrão americano) e corrompeu as datas da base inteira uma vez —
   texto do CSV agora chega intacto ao coDate, que trata dd/mm corretamente. */
function csvParaAoA(texto) {
  if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
  const linha1 = texto.slice(0, texto.indexOf('\n'));
  const sep = (linha1.match(/;/g) || []).length >= (linha1.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cel = '', dentro = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (dentro) {
      if (ch === '"') { if (texto[i + 1] === '"') { cel += '"'; i++; } else dentro = false; }
      else cel += ch;
    } else if (ch === '"') dentro = true;
    else if (ch === sep) { row.push(cel); cel = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      row.push(cel); cel = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cel += ch;
  }
  if (cel !== '' || row.length) { row.push(cel); rows.push(row); }
  return rows;
}

async function postUpload(payload) {
  const r = await fetch('/api/upload-sintese', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
  return j;
}

async function enviarSintese(senha, file, setStatus) {
  setStatus('Lendo planilha…', '');
  let aoa;
  if (/\.csv$/i.test(file.name)) {
    // CSV nunca passa pelo SheetJS: as datas dd/mm viravam mm/dd (americano)
    aoa = csvParaAoA(await file.text());
  } else {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true, blankrows: false });
  }
  const { linhas, ehBrain, foraCidade } = planilhaParaLinhas(aoa);
  const total = linhas.length;
  if (ehBrain) setStatus(`Export do Brain detectado: ${fmtInt(foraCidade)} linhas de outras cidades descartadas.`, '');
  // a coluna 'data' da síntese é sempre o dia 1º do mês; qualquer outra coisa é
  // parser trocando dia/mês (já corrompeu a base uma vez) — aborta antes do banco
  const iData = SINTESE_COLS.indexOf('data');
  const foraDia1 = linhas.filter(l => l[iData] && !/-01$/.test(l[iData])).length;
  if (foraDia1 > total * 0.02)
    throw new Error(`${fmtInt(foraDia1)} linhas com 'data' fora do dia 1º — datas suspeitas, upload abortado.`);

  setStatus(`Preparando envio de ${fmtInt(total)} linhas…`, '');
  await postUpload({ senha, action: 'init' });
  for (let i = 0; i < total; i += SINTESE_CHUNK) {
    const lote = linhas.slice(i, i + SINTESE_CHUNK);
    await postUpload({ senha, action: 'chunk', rows: lote });
    setStatus(`Enviando… ${fmtInt(Math.min(i + lote.length, total))}/${fmtInt(total)}`, '');
  }
  const fim = await postUpload({ senha, action: 'commit', arquivo: file.name, total });
  setStatus(`✓ ${fmtInt(fim.linhas)} linhas no banco.\nBase bruta atualizada — rode o pipeline para recalcular o dashboard.`, 'ok');
}

function initSinteseUpload() {
  const btn = $('#uploadSinteseBtn'), panel = $('#uploadSintesePanel');
  if (!btn || !panel) return;
  const senha = $('#uploadSenha'), pick = $('#uploadPick'), file = $('#uploadFile'), status = $('#uploadStatus');
  const setStatus = (msg, cls) => { status.textContent = msg; status.className = 'upload-status mono' + (cls ? ' ' + cls : ''); };
  btn.onclick = e => { e.stopPropagation(); panel.hidden = !panel.hidden; if (!panel.hidden) senha.focus(); };
  panel.onclick = e => e.stopPropagation();
  pick.onclick = () => {
    if (!senha.value.trim()) { setStatus('Digite a senha antes de escolher a planilha.', 'err'); senha.focus(); return; }
    setStatus('', ''); file.value = ''; file.click();
  };
  file.onchange = async () => {
    const f = file.files && file.files[0]; if (!f) return;
    pick.disabled = true; senha.disabled = true;
    try { await enviarSintese(senha.value.trim(), f, setStatus); }
    catch (err) { setStatus('✕ ' + (err.message || err), 'err'); }
    finally { pick.disabled = false; senha.disabled = false; file.value = ''; }
  };
}

/* ---------- init ---------- */
makeField($('#headerNet'), { w: 1400, h: 190, n: 30, color: NAVY7, dist: 220, lineOp: .5, dotOp: .55 });
linkKmzFeatures();
buildFilters();
initMap();
applyAll();
initEditableText();
initAIChat();
initSettingsPanel();
initSinteseUpload();
initPlanoDiretor();
initExpandir();
ligarLarguras('radarTable');   // thead do radar é estático; as demais religam a cada render
const MESES_PROJ = mesesDe(['dataProtocolo', 'dataAprovacao']);
ligarCampoMes(campoMes('incFrom', MESES_PROJ), v => { incFrom = v; renderIncorporadoras(); });
ligarCampoMes(campoMes('incTo', MESES_PROJ), v => { incTo = v; renderIncorporadoras(); });
$('#incClear').onclick = () => { incFrom = incTo = ''; $('#incFrom').value = $('#incTo').value = ''; renderIncorporadoras(); };
$$('#concMode button').forEach(b => b.onclick = () => {
  concMode = b.dataset.c;
  $$('#concMode button').forEach(x => x.classList.toggle('active', x === b));
  renderConcentracao();
});
$$('#pivotNivel button').forEach(b => b.onclick = () => {
  pivotNivel = +b.dataset.n;
  $$('#pivotNivel button').forEach(x => x.classList.toggle('active', x === b));
  renderPivot();
});
$$('#incNivel button').forEach(b => b.onclick = () => {
  incNivel = +b.dataset.n;
  $$('#incNivel button').forEach(x => x.classList.toggle('active', x === b));
  renderIncorporadoras();
});
/* um só estado de período para os dois gráficos: os dois segs (estoque e lançamentos)
   comandam a mesma variável e refletem a escolha um do outro */
$$('#dispMode button, #lancMode button').forEach(b => b.onclick = () => {
  periodoModo = b.dataset.mode;
  $$('#dispMode button, #lancMode button').forEach(x => x.classList.toggle('active', x.dataset.mode === periodoModo));
  renderCharts();
});
$$('#viewMode button').forEach(b => b.onclick = () => {
  detalhado = b.dataset.view === 'det';
  $$('#viewMode button').forEach(x => x.classList.toggle('active', x === b));
  $('#detMode').hidden = !detalhado; // o seletor de quebra só aparece no modo Detalhado
  renderCharts();
});
$$('#detMode button').forEach(b => b.onclick = () => {
  detMode = b.dataset.det;
  $$('#detMode button').forEach(x => x.classList.toggle('active', x === b));
  renderCharts();
});
