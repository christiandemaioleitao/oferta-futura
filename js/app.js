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
const textKey = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const ymLabel = m => m ? MESES[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4) : '—';
const dateBR = s => { if (!s) return null; const d = String(s).slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : s; };
const nowYM = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

/* ---------- dados ---------- */
let DATA = window.OF_DATA || { empreendimentos: [], historico: [], geradoEm: '', fonte: '' };
let MAPA = window.OF_MAPA || { features: [] };
let filtered = [];
let sortKey = 'dtLancamento', sortAsc = true, searchTerm = '';
const FAIXAS = [
  { id: 'f1', label: 'Até 50 m²', min: 0, max: 50 },
  { id: 'f2', label: '50 – 70 m²', min: 50, max: 70 },
  { id: 'f3', label: '70 – 90 m²', min: 70, max: 90 },
  { id: 'f4', label: '90 – 120 m²', min: 90, max: 120 },
  { id: 'f5', label: '120 – 160 m²', min: 120, max: 160 },
  { id: 'f6', label: '160 m² ou mais', min: 160, max: 1e9 },
];
const state = { from: '', to: '', macrozona: new Set(), bairro: new Set(), incorporadora: new Set(), tipo: new Set(), tipologia: new Set(), faixa: new Set() };

function empFaixas(e) {
  const out = new Set();
  (e.tipologias || []).forEach(t => { if (t.area != null) { const f = FAIXAS.find(f => t.area >= f.min && t.area < f.max); if (f) out.add(f.id); } });
  return out;
}
function empMatches(e) {
  const m = (e.dtLancamento || '').slice(0, 7);
  if (state.from && m && m < state.from) return false;
  if (state.to && m && m > state.to) return false;
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
    state[key].clear();
    if (a === 'all') values.forEach(v => state[key].add(v.id));
    render(ms.querySelector('.ms__search').value); sync(); applyAll();
  };
  MS[key] = { sync, render };
}
document.addEventListener('click', () => $$('.ms.open').forEach(x => x.classList.remove('open')));

function uniqueVals(fn) {
  const set = new Map();
  DATA.empreendimentos.forEach(e => { const v = fn(e); if (v != null && v !== '') set.set(String(v), String(v)); });
  return [...set.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(v => ({ id: v, label: v }));
}
function buildFilters() {
  buildMultiselect('macrozona', uniqueVals(e => mzLabel(e.macrozona)));
  buildMultiselect('bairro', uniqueVals(e => e.bairro));
  buildMultiselect('incorporadora', uniqueVals(e => e.incorporadora));
  buildMultiselect('tipo', uniqueVals(e => e.tipo));
  const tips = new Set();
  DATA.empreendimentos.forEach(e => (e.tipologias || []).forEach(t => tips.add(String(t.tratada != null ? t.tratada : t.tipologia))));
  buildMultiselect('tipologia', [...tips].sort().map(v => ({ id: v, label: /^\d+$/.test(v) ? v + ' quartos' : v })));
  buildMultiselect('faixa', FAIXAS.map(f => ({ id: f.id, label: f.label })));
}

function filtersSummaryText() {
  const parts = [];
  if (state.from || state.to) parts.push(`LANÇAMENTO ${state.from || '…'} → ${state.to || '…'}`);
  const names = { macrozona: 'MACROZONA', bairro: 'BAIRRO', incorporadora: 'INCORPORADORA', tipo: 'TIPO', tipologia: 'TIPOLOGIA', faixa: 'FAIXA M²' };
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
  if (!hist.length) return { avg: null, defl: null, n: 0 };
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
  return { avg: mean(rates), defl: mean(ratesD), n: hist.length };
}

/* ---------- aplicação de filtros ---------- */
function applyAll() {
  filtered = DATA.empreendimentos.filter(empMatches);
  $('#filtersSummary').textContent = filtersSummaryText();
  renderKPIs(); renderMap(); renderCharts(); renderPivot(); renderRadar();
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
  $('#kpiUnits').textContent = fmtInt(filtered.reduce((s, e) => s + (e.totalUnidades || 0), 0));
  $('#kpiLand').textContent = fmtInt(filtered.reduce((s, e) => s + (e.areaTerreno || 0), 0));
  const m = salesAverages(filtered);
  $('#kpiAvgSales').textContent = m.avg == null ? '—' : fmtDec(m.avg, 1);
  $('#kpiAvgSalesDefl').textContent = m.defl == null ? '—' : fmtDec(m.defl, 1);
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
function linkKmzFeatures() {
  const emps = DATA.empreendimentos.filter(e => e.lat != null && e.lng != null);
  (MAPA.features || []).forEach(f => {
    const p = f.properties = f.properties || {};
    p._empId = null;
    if (f.geometry.type === 'Polygon') {
      const ring = f.geometry.coordinates[0];
      let hit = emps.find(e => pointInPoly(e.lng, e.lat, ring));
      if (!hit) hit = emps.find(e => textKey(e.empreendimento) === textKey(p.name));
      if (!hit) {
        const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length, cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
        let bestD = 300;
        emps.forEach(e => { const d = distM(cy, cx, e.lat, e.lng); if (d < bestD) { bestD = d; hit = e; } });
      }
      if (hit) p._empId = hit.id;
    } else if (f.geometry.type === 'Point') {
      const [lng, lat] = f.geometry.coordinates;
      const byName = emps.find(e => textKey(e.empreendimento) === textKey(p.name));
      if (byName) { p._empId = byName.id; return; }
      let best = null, bestD = 250;
      emps.forEach(e => { const d = distM(lat, lng, e.lat, e.lng); if (d < bestD) { bestD = d; best = e; } });
      if (best) p._empId = best.id;
    }
  });
}
function anyFilterActive() { return !!(state.from || state.to || Object.values(state).some(v => v instanceof Set && v.size)); }
let forceKmzFilter = false; // durante capturas da apresentação, esconde geometrias sem vínculo
function visibleKmzFeatures() {
  const ids = new Set(filtered.map(e => e.id));
  const filterOn = forceKmzFilter || anyFilterActive();
  return (MAPA.features || []).filter(f => f.properties._empId ? ids.has(f.properties._empId) : !filterOn);
}

/* ---------- mapa ---------- */
let map, empLayer, terrenoLayer, pontoLayer, baseTiles, screenshoter;
function initMap() {
  map = L.map('map', { scrollWheelZoom: true, zoomAnimation: false, fadeAnimation: false }).setView([-16.68, -49.26], 12);
  baseTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap · &copy; CARTO', crossOrigin: true, maxZoom: 19,
  }).addTo(map);
  if (window.SimpleMapScreenshoter || L.simpleMapScreenshoter) {
    try { screenshoter = L.simpleMapScreenshoter({ hidden: true, mimeType: 'image/jpeg' }).addTo(map); } catch (e) { console.warn('screenshoter indisponível', e); }
  }
  empLayer = L.layerGroup().addTo(map);
  terrenoLayer = L.layerGroup().addTo(map);
  pontoLayer = L.layerGroup();
  $('#lyrEmp').onchange = e => e.target.checked ? map.addLayer(empLayer) : map.removeLayer(empLayer);
  $('#lyrTerrenos').onchange = e => e.target.checked ? map.addLayer(terrenoLayer) : map.removeLayer(terrenoLayer);
  $('#lyrPontos').onchange = e => e.target.checked ? map.addLayer(pontoLayer) : map.removeLayer(pontoLayer);
  renderKmzLayers();
}
function renderKmzLayers() {
  terrenoLayer.clearLayers(); pontoLayer.clearLayers();
  const empById = Object.fromEntries(DATA.empreendimentos.map(e => [e.id, e]));
  visibleKmzFeatures().forEach(f => {
    const p = f.properties || {};
    const emp = p._empId ? empById[p._empId] : null;
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
  renderKmzLayers();
  empLayer.clearLayers();
  const pts = [];
  filtered.forEach(e => {
    if (e.lat == null || e.lng == null) return;
    pts.push([e.lat, e.lng]);
    const mk = L.circleMarker([e.lat, e.lng], { radius: 8, color: '#fff', weight: 2, fillColor: RED, fillOpacity: .95 });
    mk.bindPopup(`<div class="map-pop"><b>${escapeHtml(e.empreendimento)}</b><span class="mono">${escapeHtml(e.bairro || '')} · ${ymLabel((e.dtLancamento || '').slice(0, 7))} · ${fmtInt(e.totalUnidades)} UNIDS</span><button onclick="window.openFichaById('${e.id}')">VER FICHA COMPLETA</button></div>`);
    mk.on('mouseover', function () { this.setStyle({ fillColor: NAVY, radius: 10 }); });
    mk.on('mouseout', function () { this.setStyle({ fillColor: RED, radius: 8 }); });
    mk.addTo(empLayer);
  });
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(.15));
}

/* ---------- gráficos ---------- */
let chartDisp, chartLanc;
Chart.defaults.font.family = "'IBM Plex Mono', monospace";
Chart.defaults.font.size = 10;
Chart.defaults.color = GRAY;
function monthlySeries(emps) {
  const acc = {};
  emps.forEach(e => (e.mensal || []).forEach(x => { acc[x.m] = (acc[x.m] || 0) + x.disp; }));
  return Object.entries(acc).sort((a, b) => a[0].localeCompare(b[0]));
}
function launchSeries(emps) {
  const acc = {};
  emps.forEach(e => { const m = (e.dtLancamento || '').slice(0, 7); if (m) acc[m] = (acc[m] || 0) + (e.totalUnidades || 0); });
  return Object.entries(acc).sort((a, b) => a[0].localeCompare(b[0]));
}
function renderCharts() {
  const serie = monthlySeries(filtered);
  const labels = serie.map(x => ymLabel(x[0]));
  const ref = nowYM();
  const refIdx = serie.findIndex(x => x[0] === ref);
  if (chartDisp) chartDisp.destroy();
  chartDisp = new Chart($('#chartDisp'), {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Unidades disponíveis', data: serie.map(x => Math.round(x[1])),
      borderColor: NAVY, backgroundColor: 'rgba(12,31,85,.06)', fill: true, tension: .3, borderWidth: 2,
      pointRadius: serie.map((x, i) => i === refIdx ? 6 : 2.5),
      pointBackgroundColor: serie.map((x, i) => i === refIdx ? RED : NAVY),
      pointBorderColor: serie.map((x, i) => i === refIdx ? '#fff' : NAVY),
      pointBorderWidth: serie.map((x, i) => i === refIdx ? 2 : 1),
    }]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmtInt(c.parsed.y) + ' unidades' + (serie[c.dataIndex][0] === ref ? ' · mês de referência' : '') } } },
      scales: { y: { grid: { color: HAIR }, ticks: { callback: v => fmtInt(v) } }, x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 14 } } } }
  });
  const lserie = launchSeries(filtered);
  if (chartLanc) chartLanc.destroy();
  chartLanc = new Chart($('#chartLanc'), {
    type: 'bar',
    data: { labels: lserie.map(x => ymLabel(x[0])), datasets: [{ data: lserie.map(x => Math.round(x[1])), backgroundColor: lserie.map(x => x[0] === ref ? RED : BLUE), borderRadius: 3, maxBarThickness: 26 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmtInt(c.parsed.y) + ' unidades lançadas' } } },
      scales: { y: { grid: { color: HAIR }, ticks: { callback: v => fmtInt(v) } }, x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 16 } } } }
  });
}

/* ---------- pivot ---------- */
function renderPivot() {
  const cols = [...new Set(filtered.flatMap(e => (e.tipologias || []).map(t => String(t.tratada != null ? t.tratada : t.tipologia))))].sort();
  const groups = {};
  filtered.forEach(e => { (groups[e.tipo || '—'] = groups[e.tipo || '—'] || []).push(e); });
  const cell = (e, c) => (e.tipologias || []).filter(t => String(t.tratada != null ? t.tratada : t.tipologia) === c).reduce((s, t) => s + (t.unids || 0), 0);
  let html = `<thead><tr><th>TIPO / EMPREENDIMENTO</th>${cols.map(c => `<th>${escapeHtml(/^\d+$/.test(c) ? c + 'Q' : c)}</th>`).join('')}<th>TOTAL</th></tr></thead><tbody>`;
  const gtot = Object.fromEntries(cols.map(c => [c, 0])); let gsum = 0;
  Object.keys(groups).sort().forEach((g, gi) => {
    const emps = groups[g];
    const tot = Object.fromEntries(cols.map(c => [c, emps.reduce((s, e) => s + cell(e, c), 0)]));
    const sum = Object.values(tot).reduce((s, x) => s + x, 0); gsum += sum;
    cols.forEach(c => gtot[c] += tot[c]);
    html += `<tr class="group" data-g="${gi}"><td>${escapeHtml(g)}</td>${cols.map(c => `<td>${tot[c] ? fmtInt(tot[c]) : '·'}</td>`).join('')}<td><b>${fmtInt(sum)}</b></td></tr>`;
    emps.sort((a, b) => (a.empreendimento || '').localeCompare(b.empreendimento || '')).forEach(e => {
      const rsum = cols.reduce((s, c) => s + cell(e, c), 0);
      html += `<tr class="leaf" data-g="${gi}"><td>${escapeHtml(e.empreendimento)}</td>${cols.map(c => { const v = cell(e, c); return `<td>${v ? fmtInt(v) : '·'}</td>`; }).join('')}<td>${fmtInt(rsum)}</td></tr>`;
    });
  });
  html += `<tr class="total"><td>TOTAL GERAL</td>${cols.map(c => `<td>${fmtInt(gtot[c])}</td>`).join('')}<td>${fmtInt(gsum)}</td></tr></tbody>`;
  $('#pivotTable').innerHTML = html;
  $$('#pivotTable tr.group').forEach(tr => tr.onclick = () => {
    tr.classList.toggle('open');
    $$(`#pivotTable tr.leaf[data-g="${tr.dataset.g}"]`).forEach(l => l.classList.toggle('show', tr.classList.contains('open')));
  });
}

/* ---------- radar (tabela) ---------- */
const LINK_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M10 14a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.6 1.59" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 10a5 5 0 0 0-7.07 0l-2.83 2.83a5 5 0 0 0 7.07 7.07l1.59-1.59" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function sortedRows() {
  let rows = filtered;
  if (searchTerm) { const q = textKey(searchTerm); rows = rows.filter(e => [e.empreendimento, e.bairro, e.incorporadora].some(v => textKey(v).includes(q))); }
  const dir = sortAsc ? 1 : -1;
  return [...rows].sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (va == null) return 1; if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb), 'pt-BR') * dir;
  });
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
    tr.addEventListener('mouseenter', () => showFichaTip(tr));
    tr.addEventListener('mouseleave', scheduleHideFicha);
    tr.querySelector('.rt-name')?.addEventListener('click', () => openFichaModal(tr.dataset.id));
  });
  const ind = $('#radarTable .sort-ind'); if (ind) ind.remove();
  const th = $(`#radarTable th[data-sort="${sortKey}"]`);
  if (th) th.insertAdjacentHTML('beforeend', ` <i class="sort-ind">${sortAsc ? '↑' : '↓'}</i>`);
}
$('#radarSearch')?.addEventListener('input', e => { searchTerm = e.target.value; renderRadar(); });
$$('#radarTable th[data-sort]').forEach(th => th.onclick = () => {
  const k = th.dataset.sort;
  if (sortKey === k) sortAsc = !sortAsc; else { sortKey = k; sortAsc = true; }
  renderRadar();
});

/* ---------- ficha (tooltip redesign) ---------- */
let fichaTimer = null, fichaModal = false;
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
  const lanc = textKey(e.fonteDataLancamento || '').includes('LANC');
  $('#fBadges').innerHTML = (lanc ? '<span class="badge badge--red">LANÇADO</span>' : '<span class="badge badge--red" style="background:var(--navy-500)">PREVISTO</span>')
    + (e.projetoProtocolado ? '<span class="badge badge--outline">PROJETO</span>' : '');
  $('#fInc').textContent = e.incorporadora || '—';
  $('#fFonteTip').textContent = e.fonteTipologia || 'PROJETO';
  $('#fFonteLan').textContent = e.fonteDataLancamento || '—';
  $('#fFontePrev').textContent = e.fontePrevisao || '—';
  const tips = (e.tipologias || []).slice().sort((a, b) => (a.area || 0) - (b.area || 0));
  $('#fTips').innerHTML = tips.map(t => `<tr><td>${escapeHtml(t.tipologia || (t.tratada + 'Q'))}</td><td class="td-num">${fmtInt(t.unids)}</td><td class="td-num">${t.area != null ? fmtDec(t.area, 0) + ' m²' : '—'}</td></tr>`).join('') || '<tr><td colspan="3" style="color:var(--gray-400)">Sem tipologias informadas</td></tr>';
  $('#fProto').textContent = dateBR(e.dataProtocolo) || '—';
  $('#fAprov').textContent = dateBR(e.dataAprovacao) || (e.projetoAprovado ? 'Aprovado' : 'Em análise');
  const el = elapsedLabel(e.dataProtocolo, e.dataAprovacao);
  const elBox = $('#fElapsed');
  if (el) { elBox.hidden = false; elBox.querySelector('span').textContent = 'Tempo decorrido · ' + el; } else elBox.hidden = true;
  $('#fEnd').textContent = [e.logradouro, e.complemento, [e.cidade, e.uf].filter(Boolean).join(' · ')].filter(Boolean).join(', ') || '—';
  $('#fPav').textContent = e.descPavimentos || '—';
  $('#fFonteEmp').textContent = e.fonteEmpreendimento || '—';
  $('#fUpdated').textContent = 'Atualizado em ' + (dateBR(DATA.geradoEm) || '—');
  makeField($('#fichaNet'), { w: 500, h: 150, n: 12, color: '#AEBFDE', dist: 170, lineOp: .5, dotOp: .6 });
}
function showFichaTip(tr) {
  if (fichaModal) return;
  clearTimeout(fichaTimer);
  const e = DATA.empreendimentos.find(x => x.id === tr.dataset.id);
  if (!e) return;
  const f = $('#ficha');
  fillFicha(e);
  f.hidden = false; f.classList.add('as-tip');
  const r = tr.getBoundingClientRect(), fw = Math.min(760, window.innerWidth * .94);
  let left = Math.min(Math.max(r.left + 40, 12), window.innerWidth - fw - 12);
  f.style.left = left + 'px';
  f.style.width = fw + 'px';
  const fh = Math.min(f.scrollHeight, window.innerHeight * .88);
  let top = r.bottom + 10;
  if (top + fh > window.innerHeight - 10) top = Math.max(10, r.top - fh - 10);
  f.style.top = top + 'px';
}
function scheduleHideFicha() { if (fichaModal) return; clearTimeout(fichaTimer); fichaTimer = setTimeout(() => { $('#ficha').hidden = true; }, 120); }
function openFichaModal(id) {
  const e = DATA.empreendimentos.find(x => x.id === id);
  if (!e) return;
  fichaModal = true;
  const f = $('#ficha');
  fillFicha(e);
  f.hidden = false; f.classList.remove('as-tip');
  const fw = Math.min(760, window.innerWidth * .94);
  f.style.width = fw + 'px';
  f.style.left = (window.innerWidth - fw) / 2 + 'px';
  f.style.top = Math.max(16, (window.innerHeight - Math.min(f.scrollHeight, window.innerHeight * .88)) / 2) + 'px';
}
window.openFichaById = id => openFichaModal(id);
$('#fClose').onclick = () => { fichaModal = false; $('#ficha').hidden = true; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') { fichaModal = false; $('#ficha').hidden = true; } });

/* ---------- importação Excel ---------- */
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function cleanCell(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).replace(/_x000D_/g, '').trim();
  return (s === '' || s === '-' || s === 'nan') ? null : s;
}
function ymOf(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 7);
  const s = cleanCell(v); return s ? s.slice(0, 7) : null;
}
function rebuildFromRows(rows, fileName) {
  const emps = {}, tipsSeen = {}, mensal = {}, hist = {};
  rows.forEach(r => {
    const eid = r['id_empreendimento'];
    if (eid == null || eid === '') {
      const hname = cleanCell(r['empreendimento']); const m = ymOf(r['data']);
      if (!hname || !m) return;
      const h = hist[hname] = hist[hname] || { empreendimento: hname, cluster: cleanCell(r['cluster']), bairro: cleanCell(r['bairro']), tipo: cleanCell(r['TipoEmpreendimento']), macrozona: cleanCell(r['macrozona']), dtLancamento: cleanCell(r['dtlançamento'] ?? r['dtlancamento']), vendMap: {}, minM: m, maxM: m };
      if (m < h.minM) h.minM = m; if (m > h.maxM) h.maxM = m;
      const v = num(r['unidadesvendidasmes']) || 0;
      if (v) h.vendMap[m] = (h.vendMap[m] || 0) + v;
      return;
    }
    const id = String(eid);
    if (!emps[id]) emps[id] = {
      id, empreendimento: cleanCell(r['empreendimento']), cidade: cleanCell(r['cidade']), uf: cleanCell(r['Cidade.Uf']),
      bairro: cleanCell(r['bairro']), incorporadora: cleanCell(r['incorporadora']), incorpOUconsorcio: cleanCell(r['incorpOUconsorcio']),
      tipo: cleanCell(r['TipoEmpreendimento']), macrozona: cleanCell(r['macrozona']), lat: num(r['Latitude']), lng: num(r['Longitude']),
      logradouro: cleanCell(r['Logradouro']), complemento: cleanCell(r['Complemento']), areaTerreno: num(r['AreaTerreno']),
      totalUnidades: num(r['TotalUnidades']), dtLancamento: cleanCell(r['dtlançamento'] ?? r['dtlancamento']), descPavimentos: cleanCell(r['descPavimentos']),
      mcmv: cleanCell(r['MCMV']), terrenoTapumado: !!r['TerrenoTapumado'], projetoProtocolado: !!r['ProjetoProtocolado'], projetoAprovado: !!r['ProjetoAprovado'],
      idProtocolo: cleanCell(r['IdProtocoloProjeto']), dataProtocolo: cleanCell(r['DataProtocoloProjeto']), dataAprovacao: cleanCell(r['DataAprovacao']),
      linkProjeto: cleanCell(r['LinkDoProjeto']), linkPortal: cleanCell(r['LinkPortal']),
      fonteEmpreendimento: cleanCell(r['FonteEmpreendimento']), fonteDataLancamento: cleanCell(r['FonteDataLancamento']),
      fonteTipologia: cleanCell(r['FonteTipologia']), fontePrevisao: cleanCell(r['FonteDataPrevisaoLancamento']),
      cluster: cleanCell(r['cluster']), consideracaoOF: cleanCell(r['consideracao_OF']), lancamento: cleanCell(r['lancamento']),
      tipologias: [], mensal: [],
    };
    const tk = id + '|' + r['id_tipologia'];
    if (!tipsSeen[tk]) { tipsSeen[tk] = 1; emps[id].tipologias.push({ tipologia: cleanCell(r['tipologia']), tratada: r['tipologia_tratada'] ?? null, unids: num(r['Unids_tipologia']) || 0, area: num(r['AreaPrivativa']) }); }
    const m = ymOf(r['data']);
    if (m) {
      const mm = mensal[id] = mensal[id] || {};
      const cel = mm[m] = mm[m] || { m, disp: 0, vend: 0, distr: 0 };
      cel.disp += num(r['unidadesdisponiveis']) || 0;
      cel.vend += num(r['unidadesvendidasmes']) || 0;
      cel.distr += num(r['unidadesdistratadasmes']) || 0;
    }
  });
  Object.entries(mensal).forEach(([id, mm]) => { emps[id].mensal = Object.values(mm).sort((a, b) => a.m.localeCompare(b.m)); });
  const historico = Object.values(hist).map(h => ({ empreendimento: h.empreendimento, cluster: h.cluster, bairro: h.bairro, tipo: h.tipo, macrozona: h.macrozona, dtLancamento: h.dtLancamento, minM: h.minM, maxM: h.maxM, vend: Object.entries(h.vendMap).sort((a, b) => a[0].localeCompare(b[0])) }));
  return { geradoEm: new Date().toISOString().slice(0, 10), fonte: fileName, empreendimentos: Object.values(emps), historico };
}
function importXlsx(file) {
  const st = $('#importStatus');
  st.textContent = 'LENDO ' + file.name.toUpperCase() + '…';
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
      if (!rows.length) throw new Error('planilha vazia');
      DATA = rebuildFromRows(rows, file.name);
      linkKmzFeatures();
      buildFilters(); Object.keys(state).forEach(k => state[k] instanceof Set && state[k].clear());
      applyAll();
      st.textContent = `BASE ATUALIZADA · ${DATA.empreendimentos.length} EMPREENDIMENTOS · ${rows.length.toLocaleString('pt-BR')} LINHAS`;
    } catch (err) {
      console.error(err);
      st.textContent = 'ERRO AO IMPORTAR: ' + err.message;
    }
  };
  reader.readAsArrayBuffer(file);
}

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
$('#btnImportXlsx').onclick = () => $('#fileXlsx').click();
$('#btnImportKmz').onclick = () => $('#fileKmz').click();
$('#fileXlsx').onchange = e => { if (e.target.files[0]) importXlsx(e.target.files[0]); e.target.value = ''; };
$('#fileKmz').onchange = e => { if (e.target.files[0]) importKmz(e.target.files[0]); e.target.value = ''; };

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
    const chips = filtersSummaryText().split('  ·  ').map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('');
    // capa
    const cover = document.createElement('div');
    cover.className = 'pdf-page pdf-cover';
    cover.innerHTML = `<svg class="pdf-net" id="pdfNet" preserveAspectRatio="xMidYMid slice"></svg>
      <div style="position:relative">
        <div style="display:inline-block;background:#fff;border-radius:12px;padding:14px 20px;margin-bottom:34px"><img src="${logoSrc()}" style="height:46px;width:100px;display:inline" /></div>
        <div class="eyebrow">EBM INTELIGÊNCIA — RELATÓRIO EXECUTIVO</div>
        <h1>${escapeHtml(title)}</h1>
        <div class="pdf-filters">${chips}</div>
      </div>
      <div class="pdf-meta">
        <div>Documento<b>Relatório de Oferta Futura</b></div>
        <div>Emitido em<b>${today}</b></div>
        <div>Empreendimentos<b>${filtered.length}</b></div>
        <div>Janela<b>${launchWindowLabel(filtered)}</b></div>
      </div>`;
    stage.appendChild(cover);
    makeField(cover.querySelector('#pdfNet'), { w: 1123, h: 794, n: 40, color: NAVY7, dist: 240, lineOp: .3, dotOp: .4 });
    // página síntese
    const p2 = document.createElement('div');
    p2.className = 'pdf-page';
    p2.innerHTML = `<div class="pdf-h"><span class="n">01</span><h2>Síntese da oferta filtrada</h2></div>
      <div class="pdf-kpis">
        <div class="k"><span>EMPREENDIMENTOS</span><b>${filtered.length}</b></div>
        <div class="k"><span>TOTAL DE UNIDADES</span><b>${fmtInt(filtered.reduce((s, e) => s + (e.totalUnidades || 0), 0))}</b></div>
        <div class="k"><span>ÁREA DE TERRENO M²</span><b>${fmtInt(filtered.reduce((s, e) => s + (e.areaTerreno || 0), 0))}</b></div>
        <div class="k accent"><span>MÉDIA MENSAL VENDAS</span><b>${m.avg == null ? '—' : fmtDec(m.avg, 1)}</b></div>
        <div class="k"><span>MÉDIA MENSAL DEFL.</span><b>${m.defl == null ? '—' : fmtDec(m.defl, 1)}</b></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><p class="mono" style="font-size:10px;letter-spacing:.14em;color:${GRAY};margin-bottom:8px">OFERTA DISPONÍVEL POR MÊS</p><img class="pdf-img" src="${chartDisp.toBase64Image('image/png', 1)}" /></div>
        <div><p class="mono" style="font-size:10px;letter-spacing:.14em;color:${GRAY};margin-bottom:8px">UNIDADES LANÇADAS POR MÊS</p><img class="pdf-img" src="${chartLanc.toBase64Image('image/png', 1)}" /></div>
      </div>
      <div class="pdf-foot"><span>EBM Inteligência · Dados que orientam decisões</span><span>${today} · pág. 2</span></div>`;
    stage.appendChild(p2);
    // tabela paginada
    const rows = sortedRows();
    const perPage = 16;
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    for (let p = 0; p < pages; p++) {
      const chunk = rows.slice(p * perPage, (p + 1) * perPage);
      const pg = document.createElement('div');
      pg.className = 'pdf-page';
      pg.innerHTML = `<div class="pdf-h"><span class="n">02</span><h2>Radar de empreendimentos ${pages > 1 ? `· ${p + 1}/${pages}` : ''}</h2></div>
        <table class="pdf-table"><thead><tr><th>EMPREENDIMENTO</th><th>LANÇAMENTO</th><th>INCORPORADORA</th><th>BAIRRO</th><th>MACROZONA</th><th class="r">M² TERRENO</th><th class="r">TOTAL UNIDS</th><th>STATUS</th></tr></thead>
        <tbody>${chunk.map(e => `<tr>
          <td><b>${escapeHtml(e.empreendimento)}</b></td>
          <td>${(e.dtLancamento || '—').slice(0, 7)}</td>
          <td>${escapeHtml(e.incorporadora || '—')}</td>
          <td>${escapeHtml(e.bairro || '—')}</td>
          <td>${escapeHtml(mzLabel(e.macrozona))}</td>
          <td class="r">${fmtInt(e.areaTerreno)}</td>
          <td class="r">${fmtInt(e.totalUnidades)}</td>
          <td>${textKey(e.fonteDataLancamento || '').includes('LANC') ? 'LANÇADO' : 'PREVISTO'}</td>
        </tr>`).join('')}</tbody></table>
        <div class="pdf-foot"><span>EBM Inteligência · Dados que orientam decisões</span><span>${today} · pág. ${p + 3}</span></div>`;
      stage.appendChild(pg);
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
async function captureMapFor(emps, W = 1560, H = 900) {
  const ids = new Set(emps.map(e => e.id));
  const polys = (MAPA.features || []).filter(f => f.geometry.type === 'Polygon' && ids.has(f.properties._empId));
  const pts = emps.filter(e => e.lat != null && e.lng != null);
  if (!pts.length && !polys.length) return null;
  // bbox
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  const feed = (lat, lng) => { minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng); };
  pts.forEach(e => feed(e.lat, e.lng));
  polys.forEach(f => f.geometry.coordinates[0].forEach(c => feed(c[1], c[0])));
  const padLat = Math.max((maxLat - minLat) * .16, .004), padLng = Math.max((maxLng - minLng) * .16, .004);
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
  // zoom que encaixa o bbox
  let z = 16;
  while (z > 3 && (lngToX(maxLng, z) - lngToX(minLng, z) > W || latToY(minLat, z) - latToY(maxLat, z) > H)) z--;
  const cx = (lngToX(minLng, z) + lngToX(maxLng, z)) / 2, cy = (latToY(maxLat, z) + latToY(minLat, z)) / 2;
  const x0 = cx - W / 2, y0 = cy - H / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#E9EDF3'; ctx.fillRect(0, 0, W, H);
  // tiles
  const t0x = Math.floor(x0 / 256), t1x = Math.floor((x0 + W) / 256), t0y = Math.floor(y0 / 256), t1y = Math.floor((y0 + H) / 256);
  const jobs = [];
  for (let tx = t0x; tx <= t1x; tx++) for (let ty = t0y; ty <= t1y; ty++) {
    if (tx < 0 || ty < 0 || tx >= 2 ** z || ty >= 2 ** z) continue;
    jobs.push(loadTile(`https://a.basemaps.cartocdn.com/light_all/${z}/${tx}/${ty}@2x.png`).then(img => {
      if (img) ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0, 256, 256);
    }));
  }
  await Promise.all(jobs);
  const px = (lng, lat) => [lngToX(lng, z) - x0, latToY(lat, z) - y0];
  // terrenos (polígonos do KMZ vinculados ao filtro)
  polys.forEach(f => {
    const p = f.properties;
    ctx.beginPath();
    f.geometry.coordinates[0].forEach((c, i) => { const [x, y] = px(c[0], c[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = (p.fill || BLUE) + '55';
    ctx.strokeStyle = p.stroke || p.fill || BLUE;
    ctx.lineWidth = 2.4;
    ctx.fill(); ctx.stroke();
  });
  // empreendimentos (marcadores vermelhos)
  pts.forEach(e => {
    const [x, y] = px(e.lng, e.lat);
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = RED; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
  });
  // atribuição
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(W - 250, H - 26, 250, 26);
  ctx.fillStyle = '#566076'; ctx.font = '13px IBM Plex Sans, sans-serif';
  ctx.fillText('© OpenStreetMap · © CARTO', W - 238, H - 8);
  return canvas.toDataURL('image/jpeg', .9);
}
async function decodeStageImages(stage) {
  await Promise.all([...stage.querySelectorAll('img')].map(i => i.decode ? i.decode().catch(() => {}) : Promise.resolve()));
}
function deckKpisHtml(emps) {
  const m = salesAverages(emps);
  return `<div class="pdf-kpis" style="grid-template-columns:repeat(4,1fr)">
    <div class="k"><span>EMPREENDIMENTOS</span><b>${emps.length}</b></div>
    <div class="k"><span>TOTAL DE UNIDADES</span><b>${fmtInt(emps.reduce((s, e) => s + (e.totalUnidades || 0), 0))}</b></div>
    <div class="k"><span>ÁREA DE TERRENO M²</span><b>${fmtInt(emps.reduce((s, e) => s + (e.areaTerreno || 0), 0))}</b></div>
    <div class="k accent"><span>MÉDIA MENSAL VENDAS</span><b>${m.avg == null ? '—' : fmtDec(m.avg, 1)}</b></div>
  </div>`;
}
function deckTableHtml(emps, max = 11) {
  const rows = [...emps].sort((a, b) => (a.dtLancamento || '').localeCompare(b.dtLancamento || ''));
  const shown = rows.slice(0, max);
  return `<table class="pdf-table"><thead><tr><th>EMPREENDIMENTO</th><th>LANÇAMENTO</th><th>INCORPORADORA</th><th>BAIRRO</th><th class="r">M² TERRENO</th><th class="r">TOTAL UNIDS</th><th>STATUS</th></tr></thead>
    <tbody>${shown.map(e => `<tr><td><b>${escapeHtml(e.empreendimento)}</b></td><td>${mesAno((e.dtLancamento || '').slice(0, 7))}</td><td>${escapeHtml(e.incorporadora || '—')}</td><td>${escapeHtml(e.bairro || '—')}</td><td class="r">${fmtInt(e.areaTerreno)}</td><td class="r">${fmtInt(e.totalUnidades)}</td><td>${textKey(e.fonteDataLancamento || '').includes('LANC') ? 'LANÇADO' : 'PREVISTO'}</td></tr>`).join('')}</tbody></table>
    ${rows.length > max ? `<p class="mono" style="font-size:9.5px;color:${GRAY};margin-top:8px">+ ${rows.length - max} empreendimento(s) — lista completa no dashboard.</p>` : ''}`;
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
    // ---- capa ----
    const cover = document.createElement('div');
    cover.className = 'pdf-page pdf-cover';
    cover.innerHTML = `<svg class="pdf-net" id="deckNet" preserveAspectRatio="xMidYMid slice"></svg>
      <div style="position:relative">
        <div style="display:inline-block;background:#fff;border-radius:12px;padding:14px 20px;margin-bottom:40px"><img src="${logoSrc()}" style="height:46px;width:100px;display:inline" /></div>
        <div class="eyebrow">EBM INTELIGÊNCIA — APRESENTAÇÃO EXECUTIVA</div>
        <h1>Oferta Futura GO</h1>
        <p class="mono" style="position:relative;font-size:17px;color:#AEBFDE;margin-top:16px">Período: ${escapeHtml(periodo)}</p>
      </div>
      <div class="pdf-meta">
        <div>Documento<b>Apresentação de Oferta Futura</b></div>
        <div>Emitido em<b>${new Date().toLocaleDateString('pt-BR')}</b></div>
        <div>Empreendimentos<b>${filtered.length}</b></div>
        <div>Blocos<b>${blocks.map(b => b.title.split(' — ')[0]).join(' · ')}</b></div>
      </div>`;
    stage.appendChild(cover);
    makeField(cover.querySelector('#deckNet'), { w: 1123, h: 794, n: 40, color: NAVY7, dist: 240, lineOp: .3, dotOp: .4 });
    // ---- blocos: slide de mapa + 1 slide por corte ----
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
        pageNo++;
        const s = document.createElement('div');
        s.className = 'pdf-page';
        s.innerHTML = `<div class="pdf-h"><span class="n">${b.num}</span><h2>${escapeHtml(c.title)}<small style="display:block;font-family:var(--font-mono);font-weight:400;font-size:11px;letter-spacing:.14em;color:${GRAY};margin-top:6px">${escapeHtml(c.sub.toUpperCase())} · PERÍODO ${escapeHtml(periodo).toUpperCase()}</small></h2></div>
          ${deckKpisHtml(c.emps)}
          ${deckTableHtml(c.emps)}
          ${deckFoot(pageNo, periodo)}`;
        stage.appendChild(s);
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
    forceKmzFilter = false;
    $('#pdfOverlay').hidden = true;
  }
}
$('#btnExportDeck').onclick = exportDeck;

/* ---------- exportação Excel ---------- */
function exportXlsx() {
  const st = $('#importStatus');
  const wb = XLSX.utils.book_new();
  const m = salesAverages(filtered);
  const status = e => textKey(e.fonteDataLancamento || '').includes('LANC') ? 'LANÇADO' : 'PREVISTO';
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
    ['Média mensal vendas (mercado)', m.avg == null ? '—' : +m.avg.toFixed(2)],
    ['Média mensal vendas deflacionada', m.defl == null ? '—' : +m.defl.toFixed(2)],
    ['Janela de lançamento', launchWindowLabel(filtered)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Resumo');
  // Radar
  const radar = sortedRows().map(e => ({
    'Empreendimento': e.empreendimento, 'Lançamento': (e.dtLancamento || '').slice(0, 7), 'Status': status(e),
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
  const agg = monthlySeries(filtered).map(([mes, disp]) => ({ 'Mês': mes, 'Unidades disponíveis (total)': Math.round(disp) }));
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
  const empById = Object.fromEntries(DATA.empreendimentos.map(e => [e.id, e]));
  const pmPoly = [], pmPoint = [];
  feats.forEach((f, i) => {
    const p = f.properties, emp = p._empId ? empById[p._empId] : null;
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
$('#fltFrom').onchange = e => { state.from = e.target.value; applyAll(); };
$('#fltTo').onchange = e => { state.to = e.target.value; applyAll(); };

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
const DEFAULT_AI_PROVIDER = 'mistral', DEFAULT_AI_MODEL = 'mistral-large-latest', DEFAULT_AI_KEY = 'JoBnridIgcpzb2xC039xbOL50IfhrU9x';
const AI_PROVIDERS = {
  openai: { label: 'OpenAI', type: 'chat', endpoint: 'https://api.openai.com/v1/chat/completions', models: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4o', 'gpt-4.1'] },
  deepseek: { label: 'DeepSeek', type: 'chat', endpoint: 'https://api.deepseek.com/chat/completions', models: ['deepseek-chat', 'deepseek-reasoner'] },
  mistral: { label: 'Mistral', type: 'chat', endpoint: 'https://api.mistral.ai/v1/chat/completions', models: ['mistral-small-latest', 'mistral-large-latest', 'open-mistral-nemo'] },
  openrouter: { label: 'OpenRouter', type: 'chat', endpoint: 'https://openrouter.ai/api/v1/chat/completions', models: [{ id: 'z-ai/glm-5.2', label: 'GLM 5.2 · Z.ai' }, { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro' }, { id: 'openai/gpt-5.5', label: 'GPT-5.5 · OpenAI' }, { id: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7' }, { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' }, { id: 'qwen/qwen3.7-max', label: 'Qwen3.7 Max' }, { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' }] },
  gemini: { label: 'Gemini', type: 'gemini', models: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }, { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }] },
  anthropic: { label: 'Anthropic', type: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages', models: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }, { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }, { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }] },
  groq: { label: 'Groq', type: 'chat', endpoint: 'https://api.groq.com/openai/v1/chat/completions', models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  together: { label: 'Together AI', type: 'chat', endpoint: 'https://api.together.xyz/v1/chat/completions', models: ['meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1', 'deepseek-ai/deepseek-coder-33b-instruct'] },
};
function aiConfig() {
  const key = localStorage.getItem('ofDashboardAIKey');
  if (!key) return { provider: DEFAULT_AI_PROVIDER, model: DEFAULT_AI_MODEL, key: DEFAULT_AI_KEY };
  return { provider: localStorage.getItem('ofDashboardAIProvider') || DEFAULT_AI_PROVIDER, model: localStorage.getItem('ofDashboardAIModel') || DEFAULT_AI_MODEL, key };
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
function appendAIMessage(role, text) {
  const box = $('#aiMessages'); if (!box) return;
  const div = document.createElement('div');
  div.className = 'ai-msg ' + (role === 'user' ? 'ai-user' : 'ai-bot');
  div.textContent = text;
  box.appendChild(div); box.scrollTop = box.scrollHeight;
  return div;
}
function buildDashboardContext() {
  const m = salesAverages(filtered);
  return {
    dashboard: 'Oferta Futura — EBM Inteligência',
    fonte: DATA.fonte, atualizado_em: DATA.geradoEm, mes_referencia: nowYM(),
    filtros_ativos: filtersSummaryText(),
    total_empreendimentos_filtrados: filtered.length,
    total_unidades: filtered.reduce((s, e) => s + (e.totalUnidades || 0), 0),
    area_terreno_m2: Math.round(filtered.reduce((s, e) => s + (e.areaTerreno || 0), 0)),
    media_mensal_vendas_mercado: m.avg, media_mensal_vendas_deflacionada: m.defl, projetos_historicos_usados_na_media: m.n,
    oferta_disponivel_por_mes: monthlySeries(filtered).map(([mes, disp]) => ({ mes, unidades_disponiveis: Math.round(disp) })),
    unidades_lancadas_por_mes: launchSeries(filtered).map(([mes, u]) => ({ mes, unidades: Math.round(u) })),
    empreendimentos: filtered.map(e => ({
      empreendimento: e.empreendimento, incorporadora: e.incorporadora, bairro: e.bairro, macrozona: mzLabel(e.macrozona),
      tipo: e.tipo, lancamento_previsto: (e.dtLancamento || '').slice(0, 7), total_unidades: e.totalUnidades,
      area_terreno_m2: e.areaTerreno, cluster: e.cluster, status: textKey(e.fonteDataLancamento || '').includes('LANC') ? 'LANÇADO' : 'PREVISTO',
      protocolo: e.dataProtocolo, aprovacao: e.dataAprovacao,
      tipologias: (e.tipologias || []).map(t => ({ tipologia: t.tipologia, unids: t.unids, area_m2: t.area })),
    })),
  };
}
function aiSystemPrompt() {
  return 'Você é um analista de inteligência de mercado imobiliário da EBM Incorporadora (Goiânia). Responda em português do Brasil, de forma direta e assertiva, com números formatados em pt-BR, baseando-se EXCLUSIVAMENTE no JSON de contexto do dashboard Oferta Futura enviado junto à pergunta. O contexto reflete os filtros ativos do usuário. Se a pergunta fugir de oferta futura, lançamentos, empreendimentos, incorporadoras, bairros, tipologias, unidades, vendas de mercado ou dados do dashboard, diga que foge do escopo. Não invente dados ausentes.';
}
async function callAIProvider(question) {
  const cfg = aiConfig(), p = AI_PROVIDERS[cfg.provider];
  if (!p || !cfg.key) throw new Error('Cadastre uma chave de API antes de perguntar.');
  const context = JSON.stringify(buildDashboardContext()).slice(0, 52000);
  const user = `Pergunta do usuário: ${question}\n\nContexto JSON do dashboard:\n${context}`;
  if (p.type === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: aiSystemPrompt() }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: .15, maxOutputTokens: 900 } }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error?.message || 'Falha na API Gemini.');
    return (data.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('\n').trim();
  }
  if (p.type === 'anthropic') {
    const res = await fetch(p.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify({ model: cfg.model, max_tokens: 900, temperature: .15, system: aiSystemPrompt(), messages: [{ role: 'user', content: user }] }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error?.message || 'Falha na API Anthropic.');
    return (data.content || []).map(x => x.text || '').join('\n').trim();
  }
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key };
  if (cfg.provider === 'openrouter') { headers['HTTP-Referer'] = location.href || 'file://oferta-futura'; headers['X-Title'] = 'Oferta Futura EBM'; }
  const res = await fetch(p.endpoint, { method: 'POST', headers, body: JSON.stringify({ model: cfg.model, temperature: .15, max_tokens: 900, messages: [{ role: 'system', content: aiSystemPrompt() }, { role: 'user', content: user }] }) });
  const data = await res.json(); if (!res.ok) throw new Error(data.error?.message || data.message || 'Falha na API selecionada.');
  return (data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '').trim();
}
async function askAI() {
  const input = $('#aiQuestion'), btn = $('#aiAskBtn'), q = input.value.trim();
  if (!q) return;
  setAIChatOpen(true);
  appendAIMessage('user', q);
  input.value = ''; resizeAIQuestion();
  btn.disabled = true;
  const loading = appendAIMessage('bot', 'Analisando a oferta futura…');
  try { loading.textContent = await callAIProvider(q) || 'Não recebi resposta da IA.'; }
  catch (err) { console.error(err); loading.textContent = 'Não consegui responder: ' + err.message; }
  finally { btn.disabled = false; input.focus(); }
}
function initAIChat() {
  const provider = $('#aiProvider'), model = $('#aiModel'), custom = $('#aiCustomModel'), key = $('#aiApiKey'), panel = $('#aiKeyPanel'), btn = $('#aiKeyBtn'), save = $('#aiSaveKey'), cancel = $('#aiCancelKey'), ask = $('#aiAskBtn'), question = $('#aiQuestion'), fab = $('#aiFab'), form = $('#chatForm');
  if (!provider || !btn) return;
  provider.innerHTML = Object.entries(AI_PROVIDERS).map(([id, p]) => `<option value="${id}">${p.label}</option>`).join('');
  const saved = aiConfig();
  provider.value = AI_PROVIDERS[saved.provider] ? saved.provider : DEFAULT_AI_PROVIDER;
  fillAIModels(provider.value, saved.model);
  key.value = saved.key === DEFAULT_AI_KEY ? '' : saved.key;
  provider.onchange = () => { fillAIModels(provider.value); if (custom) custom.value = ''; };
  if (fab) fab.onclick = () => setAIChatOpen(!$('#aiChat').classList.contains('is-open'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setAIChatOpen(false); });
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

/* ---------- init ---------- */
makeField($('#headerNet'), { w: 1400, h: 190, n: 30, color: NAVY7, dist: 220, lineOp: .5, dotOp: .55 });
linkKmzFeatures();
buildFilters();
initMap();
applyAll();
initEditableText();
initAIChat();
const ficha = $('#ficha');
ficha.addEventListener('mouseenter', () => clearTimeout(fichaTimer));
ficha.addEventListener('mouseleave', scheduleHideFicha);
