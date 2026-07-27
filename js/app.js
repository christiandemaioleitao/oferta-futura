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
/* status do empreendimento: a fonte da data diz se ja lancou ou ainda e previsao */
const statusEmp = e => textKey(e.fonteDataLancamento || '').includes('LANC') ? 'LANÇADO' : 'PREVISTO';
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
/* comPeriodo=false: aplica todos os filtros menos o de período de lançamento —
   usado pela tabela de incorporadoras, que tem período próprio (protocolo/aprovação) */
function empMatches(e, comPeriodo = true) {
  const m = (e.dtLancamento || '').slice(0, 7);
  if (comPeriodo && state.from && m && m < state.from) return false;
  if (comPeriodo && state.to && m && m > state.to) return false;
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
  if (state.from || state.to) parts.push(`LANÇAMENTO ${state.from ? ymLabel(state.from) : '…'} → ${state.to ? ymLabel(state.to) : '…'}`);
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
  filtered = DATA.empreendimentos.filter(e => empMatches(e));
  $('#filtersSummary').textContent = filtersSummaryText();
  renderKPIs(); renderMap(); renderCharts(); renderPivot(); renderRadar();
  renderIncorporadoras(); renderConcentracao();
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
/* terrenos sem data de lançamento/previsão — vêm do Neon (tabela dedicada) sob demanda */
let semDataEmps = null, semDataOn = false, semDataLayer = null;
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
  return semDataOn && semDataEmps ? DATA.empreendimentos.concat(semDataEmps) : DATA.empreendimentos;
}
/* Terrenos sem previsão ignoram só o filtro de período de lançamento — não têm data.
   Bairro, incorporadora, tipo e macrozona valem normalmente; tipologia e faixa de m²
   excluem esses terrenos, porque um terreno sem tipologia não pode casar com elas. */
function semDataFiltrados() {
  if (!semDataOn || !semDataEmps) return [];
  return semDataEmps.filter(e => empMatches(e, false));
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
const dataLabelsPlugin = {
  id: 'ofDataLabels',
  afterDatasetsDraw(chart) {
    if (!showDataLabels) return;
    const ctx = chart.ctx, n = chart.data.labels.length;
    const step = Math.max(1, Math.ceil(n / 24)); // pula rótulos quando há muitos pontos
    ctx.save();
    ctx.font = "600 9px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      meta.data.forEach((el, i) => {
        if (i % step) return;
        const v = ds.data[i];
        if (v == null || !el) return;
        ctx.fillStyle = NAVY;
        ctx.fillText(fmtInt(v), el.x, el.y - 4);
      });
    });
    ctx.restore();
  }
};
/* o filtro de período recorta também o eixo do tempo: com Jan–Jun/26 selecionado,
   os gráficos mostram só esses meses, e não os 18 meses de projeção de cada produto */
const noPeriodo = m => (!state.from || m >= state.from) && (!state.to || m <= state.to);
function monthlySeries(emps) {
  const acc = {};
  emps.forEach(e => (e.mensal || []).forEach(x => { if (noPeriodo(x.m)) acc[x.m] = (acc[x.m] || 0) + x.disp; }));
  return Object.entries(acc).sort((a, b) => a[0].localeCompare(b[0]));
}
function launchSeries(emps) {
  const acc = {};
  emps.forEach(e => { const m = (e.dtLancamento || '').slice(0, 7); if (m && noPeriodo(m)) acc[m] = (acc[m] || 0) + (e.totalUnidades || 0); });
  return Object.entries(acc).sort((a, b) => a[0].localeCompare(b[0]));
}
/* visão Detalhado: quebra por nº de quartos (0 = comercial) ou por faixa de m² */
let detalhado = false, detMode = 'tip';
const TIP_KEYS = ['1', '2', '3', '4', '0'];
const TIP_LABELS = { '0': 'COMERCIAL', '1': '1Q', '2': '2Q', '3': '3Q', '4': '4Q+' };
const TIP_COLORS = { '1': '#9DB2D9', '2': '#5B79B4', '3': '#3A5AA0', '4': '#0C1F55', '0': '#C8102E' };
const FAIXA_COLORS = { f1: '#C3D0E8', f2: '#9DB2D9', f3: '#6E8CC4', f4: '#3A5AA0', f5: '#1B336E', f6: '#0C1F55', f0: '#98A2B3' };
const tipKeyOf = t => { const n = Number(t != null && t.tratada != null ? t.tratada : t); return Number.isFinite(n) && n > 0 ? String(Math.min(Math.round(n), 4)) : '0'; };
/* 'f0' = área privativa não informada; sem esse balde a quebra por faixa não fecha com o total */
const faixaKeyOf = t => { const a = t && t.area; if (a == null) return 'f0'; const f = FAIXAS.find(f => a >= f.min && a < f.max); return f ? f.id : 'f0'; };
/* configuração da quebra ativa — o pipeline grava as duas em cada mês (campos tip e fx) */
function quebra() {
  return detMode === 'faixa'
    ? { keys: [...FAIXAS.map(f => f.id), 'f0'],
        labels: { ...Object.fromEntries(FAIXAS.map(f => [f.id, f.label.toUpperCase()])), f0: 'SEM ÁREA INFORMADA' },
        colors: FAIXA_COLORS, campo: 'fx', keyOf: faixaKeyOf }
    : { keys: TIP_KEYS, labels: TIP_LABELS, colors: TIP_COLORS, campo: 'tip', keyOf: tipKeyOf };
}
function monthlySeriesTip(emps) { // meses ordenados + série de disponíveis por chave da quebra
  const q = quebra(), acc = {};
  emps.forEach(e => (e.mensal || []).forEach(x => {
    if (!noPeriodo(x.m)) return;
    const cel = acc[x.m] = acc[x.m] || {};
    const dados = x[q.campo];
    if (dados && Object.keys(dados).length) {
      Object.entries(dados).forEach(([k, v]) => { cel[k] = (cel[k] || 0) + v; });
    } else if (x.disp) { // sem quebra gravada: rateia pela participação das tipologias
      const tot = (e.tipologias || []).reduce((s, t) => s + (t.unids || 0), 0);
      (e.tipologias || []).forEach(t => {
        const k = q.keyOf(t); if (!k) return;
        cel[k] = (cel[k] || 0) + x.disp * (tot ? (t.unids || 0) / tot : 0);
      });
    }
  }));
  const months = Object.keys(acc).sort();
  return { months, byTip: Object.fromEntries(q.keys.map(k => [k, months.map(m => acc[m][k] || 0)])) };
}
function launchUnitsByTip(e) { // unidades lançadas do empreendimento pela quebra ativa
  const q = quebra(), out = {};
  const tot = (e.tipologias || []).reduce((s, t) => s + (t.unids || 0), 0);
  if (tot) (e.tipologias || []).forEach(t => { const k = q.keyOf(t); if (k) out[k] = (out[k] || 0) + (t.unids || 0); });
  else if (e.totalUnidades && detMode === 'tip') out['0'] = e.totalUnidades;
  return out;
}
/* modos do gráfico de lançamentos: mês, trimestre, ano, LTM (regras do dashboard leadsebm) */
let lancMode = 'month';
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
  emps.forEach(e => { const m = (e.dtLancamento || '').slice(0, 7); if (m) { const k = periodKeyOF(m, mode); acc[k] = (acc[k] || 0) + (e.totalUnidades || 0); } });
  return Object.entries(acc).sort((a, b) => a[0].localeCompare(b[0]));
}
const ymIdx = m => +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1);
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
  const list = empsLaunchedInPeriod(k, mode);
  if (!list.length) return [];
  const lines = list.slice(0, TT_MAX).map(e => `${e.empreendimento} · ${fmtInt(e.totalUnidades)} un.`);
  if (list.length > TT_MAX) lines.push(`… +${list.length - TT_MAX} empreendimentos`);
  lines.push(`TOTAL · ${list.length} emp. · ${fmtInt(list.reduce((s, e) => s + (e.totalUnidades || 0), 0))} un.`);
  return lines;
}
function dispTooltipList(m) {
  const list = filtered.map(e => ({ e, d: ((e.mensal || []).find(x => x.m === m) || {}).disp || 0 }))
    .filter(x => x.d > 0).sort((a, b) => b.d - a.d);
  if (!list.length) return [];
  const lines = list.slice(0, TT_MAX).map(x => `${x.e.empreendimento} · ${fmtInt(x.d)} un.`);
  if (list.length > TT_MAX) lines.push(`… +${list.length - TT_MAX} empreendimentos · ${fmtInt(list.slice(TT_MAX).reduce((s, x) => s + x.d, 0))} un.`);
  return lines;
}
function renderCharts() {
  const ref = nowYM();
  const legendCfg = { display: true, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, padding: 12 } };
  if (chartDisp) chartDisp.destroy();
  if (detalhado) {
    const { months, byTip } = monthlySeriesTip(filtered);
    const refIdx = months.indexOf(ref);
    const q = quebra();
    const dsets = q.keys.filter(k => byTip[k].some(v => v > 0)).map(k => ({
      label: q.labels[k], data: byTip[k].map(v => Math.round(v)),
      borderColor: q.colors[k], backgroundColor: q.colors[k], fill: false, tension: .3, borderWidth: 2,
      pointRadius: months.map((m, i) => i === refIdx ? 4 : 2), pointBackgroundColor: q.colors[k],
    }));
    chartDisp = new Chart($('#chartDisp'), {
      type: 'line',
      data: { labels: months.map(ymLabel), datasets: dsets },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: legendCfg, tooltip: { callbacks: {
          label: c => ` ${c.dataset.label} · ${fmtInt(c.parsed.y)} un.${months[c.dataIndex] === ref ? ' · mês de referência' : ''}`,
          afterBody: items => items.length ? ['', ...dispTooltipList(months[items[0].dataIndex])] : [],
        } } },
        scales: { y: { grid: { color: HAIR }, ticks: { callback: v => fmtInt(v) } }, x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 14 } } } }
    });
  } else {
    const serie = monthlySeries(filtered);
    const refIdx = serie.findIndex(x => x[0] === ref);
    chartDisp = new Chart($('#chartDisp'), {
      type: 'line',
      data: { labels: serie.map(x => ymLabel(x[0])), datasets: [{
        label: 'Unidades disponíveis', data: serie.map(x => Math.round(x[1])),
        borderColor: NAVY, backgroundColor: 'rgba(12,31,85,.06)', fill: true, tension: .3, borderWidth: 2,
        pointRadius: serie.map((x, i) => i === refIdx ? 6 : 2.5),
        pointBackgroundColor: serie.map((x, i) => i === refIdx ? RED : NAVY),
        pointBorderColor: serie.map((x, i) => i === refIdx ? '#fff' : NAVY),
        pointBorderWidth: serie.map((x, i) => i === refIdx ? 2 : 1),
      }]},
      plugins: [dataLabelsPlugin],
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: c => ' ' + fmtInt(c.parsed.y) + ' unidades' + (serie[c.dataIndex][0] === ref ? ' · mês de referência' : ''),
        afterBody: items => items.length ? ['', ...dispTooltipList(serie[items[0].dataIndex][0])] : [],
      } } },
        scales: { y: { grid: { color: HAIR }, ticks: { callback: v => fmtInt(v) } }, x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 14 } } } }
    });
  }
  const lref = lancMode === 'ltm' ? ref : periodKeyOF(ref, lancMode);
  if (chartLanc) chartLanc.destroy();
  if (detalhado) {
    const { keys, byTip } = launchSeriesTipByMode(filtered, lancMode);
    const q = quebra();
    const dsets = q.keys.filter(k => byTip[k].some(v => v > 0)).map(k => ({
      label: q.labels[k], data: byTip[k].map(v => Math.round(v)),
      backgroundColor: q.colors[k], borderRadius: 2, maxBarThickness: 26,
    }));
    chartLanc = new Chart($('#chartLanc'), {
      type: 'bar',
      data: { labels: keys.map(k => periodLabelOF(k, lancMode)), datasets: dsets },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: legendCfg, tooltip: { callbacks: {
          label: c => ` ${c.dataset.label} · ${fmtInt(c.parsed.y)}${lancMode === 'ltm' ? ' un. · últimos 12 meses' : ' un. lançadas'}`,
          afterBody: items => items.length ? ['', ...launchTooltipList(keys[items[0].dataIndex], lancMode)] : [],
        } } },
        scales: { y: { stacked: true, grid: { color: HAIR }, ticks: { callback: v => fmtInt(v) } }, x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 16 } } } }
    });
  } else {
    const lserie = launchSeriesByMode(filtered, lancMode);
    chartLanc = new Chart($('#chartLanc'), {
      type: 'bar',
      data: { labels: lserie.map(x => periodLabelOF(x[0], lancMode)), datasets: [{ data: lserie.map(x => Math.round(x[1])), backgroundColor: lserie.map(x => x[0] === lref ? RED : BLUE), borderRadius: 3, maxBarThickness: 26 }] },
      plugins: [dataLabelsPlugin],
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: c => ' ' + fmtInt(c.parsed.y) + (lancMode === 'ltm' ? ' unidades lançadas · últimos 12 meses' : ' unidades lançadas'),
        afterBody: items => items.length ? ['', ...launchTooltipList(lserie[items[0].dataIndex][0], lancMode)] : [],
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
/* ordena grupos e, dentro de cada grupo, as folhas pela mesma coluna */
function ordenarHierarquia(linhas, id, valor) {
  const o = ordens[id];
  linhas.forEach(l => l.filhos && l.filhos.sort((a, b) => cmpOrd(valor(a, o.k), valor(b, o.k), o.asc)));
  return [...linhas].sort((a, b) => cmpOrd(valor(a, o.k), valor(b, o.k), o.asc));
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

/* linhas group/leaf: o clique no grupo abre e fecha os empreendimentos */
function ligarHierarquia(id) {
  $$(`#${id} tr.group`).forEach(tr => tr.onclick = () => {
    tr.classList.toggle('open');
    $$(`#${id} tr.leaf[data-g="${tr.dataset.g}"]`).forEach(l => l.classList.toggle('show', tr.classList.contains('open')));
  });
}

/* ---------- pivot: unidades por tipologia ---------- */
function renderPivot() {
  const cols = [...new Set(filtered.flatMap(e => (e.tipologias || []).map(t => String(t.tratada != null ? t.tratada : t.tipologia))))].sort();
  const groups = {};
  filtered.forEach(e => { (groups[e.tipo || '—'] = groups[e.tipo || '—'] || []).push(e); });
  const cell = (e, c) => (e.tipologias || []).filter(t => String(t.tratada != null ? t.tratada : t.tipologia) === c).reduce((s, t) => s + (t.unids || 0), 0);
  const linhas = Object.entries(groups).map(([g, emps]) => {
    const filhos = emps.map(e => {
      const vals = Object.fromEntries(cols.map(c => [c, cell(e, c)]));
      return { nome: e.empreendimento || '—', vals, total: cols.reduce((s, c) => s + vals[c], 0) };
    });
    const vals = Object.fromEntries(cols.map(c => [c, filhos.reduce((s, f) => s + f.vals[c], 0)]));
    return { nome: g, vals, total: cols.reduce((s, c) => s + vals[c], 0), filhos };
  });
  const valor = (r, k) => k === 'g' ? r.nome : k === 'total' ? r.total : r.vals[k];
  const ordenadas = ordenarHierarquia(linhas, 'pivotTable', valor);
  const gtot = Object.fromEntries(cols.map(c => [c, linhas.reduce((s, l) => s + l.vals[c], 0)]));
  const gsum = linhas.reduce((s, l) => s + l.total, 0);
  const celula = v => v ? fmtInt(v) : '·';
  let html = cabecalhoOrdenavel('pivotTable', [
    { k: 'g', label: 'TIPO / EMPREENDIMENTO' },
    ...cols.map(c => ({ k: c, label: escapeHtml(/^\d+$/.test(c) ? c + 'Q' : c), num: true })),
    { k: 'total', label: 'TOTAL', num: true },
  ]) + '<tbody>';
  ordenadas.forEach((l, gi) => {
    html += `<tr class="group" data-g="${gi}"><td>${escapeHtml(l.nome)}</td>${cols.map(c => `<td>${celula(l.vals[c])}</td>`).join('')}<td><b>${fmtInt(l.total)}</b></td></tr>`;
    l.filhos.forEach(f => {
      html += `<tr class="leaf" data-g="${gi}"><td>${escapeHtml(f.nome)}</td>${cols.map(c => `<td>${celula(f.vals[c])}</td>`).join('')}<td>${fmtInt(f.total)}</td></tr>`;
    });
  });
  html += `<tr class="total"><td>TOTAL GERAL</td>${cols.map(c => `<td>${fmtInt(gtot[c])}</td>`).join('')}<td>${fmtInt(gsum)}</td></tr></tbody>`;
  $('#pivotTable').innerHTML = html;
  ligarHierarquia('pivotTable');
  ligarOrdenacao('pivotTable', renderPivot);
  ligarLarguras('pivotTable');
}

/* ---------- radar (tabela) ---------- */
const LINK_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M10 14a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.6 1.59" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 10a5 5 0 0 0-7.07 0l-2.83 2.83a5 5 0 0 0 7.07 7.07l1.59-1.59" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function sortedRows() {
  let rows = filtered;
  rows = rows.concat(semDataFiltrados());
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
  const lanc = textKey(e.fonteDataLancamento || '').includes('LANC');
  $('#fBadges').innerHTML = (lanc ? '<span class="badge badge--red">LANÇADO</span>' : e.semData ? '<span class="badge badge--red" style="background:#8A93A6">SEM PREVISÃO</span>' : '<span class="badge badge--red" style="background:var(--navy-500)">PREVISTO</span>')
    + (e.projetoProtocolado ? '<span class="badge badge--outline">PROJETO</span>' : '');
  $('#fInc').textContent = e.incorporadora || '—';
  // campo vazio é campo vazio: não inventar fonte (aqui havia um 'PROJETO' fixo)
  $('#fFonteTip').textContent = e.fonteTipologia || '—';
  $('#fFonteLan').textContent = e.fonteDataLancamento || '—';
  $('#fFontePrev').textContent = e.fontePrevisao || '—';
  const tips = (e.tipologias || []).slice().sort((a, b) => (a.area || 0) - (b.area || 0));
  $('#fTips').innerHTML = tips.map(t => `<tr><td>${escapeHtml(t.tipologia || (t.tratada + 'Q'))}</td><td class="td-num">${fmtInt(t.unids)}</td><td class="td-num">${t.area != null ? fmtDec(t.area, 0) + ' m²' : '—'}</td></tr>`).join('') || '<tr><td colspan="3" style="color:var(--gray-400)">Sem tipologias informadas</td></tr>';
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
          <td>${statusEmp(e)}</td>
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
    <div class="k accent"><span>MÉDIA MENSAL VENDAS</span><b>${m.avg == null ? '—' : fmtDec(m.avg, 1)}</b></div>
  </div>`;
}
function deckTableHtml(emps, max = 11, semPrevisao) {
  if (semPrevisao) {
    const rows = [...emps].sort((a, b) => (b.areaTerreno || 0) - (a.areaTerreno || 0));
    const shown = rows.slice(0, max);
    return `<table class="pdf-table"><thead><tr><th>TERRENO</th><th>INCORPORADORA</th><th>BAIRRO</th><th>ENDEREÇO</th><th class="r">M² TERRENO</th><th class="r">UNIDS EST.</th><th>PROJETO</th></tr></thead>
      <tbody>${shown.map(e => `<tr><td><b>${escapeHtml(e.empreendimento)}</b></td><td>${escapeHtml(e.incorporadora || '—')}</td><td>${escapeHtml(e.bairro || '—')}</td><td>${escapeHtml((e.logradouro || '—').slice(0, 40))}</td><td class="r">${fmtInt(e.areaTerreno)}</td><td class="r">${e.totalUnidades ? fmtInt(e.totalUnidades) : '—'}</td><td>${e.projetoAprovado ? 'APROVADO' : e.projetoProtocolado ? 'PROTOCOLADO' : '—'}</td></tr>`).join('')}</tbody></table>
      ${rows.length > max ? `<p class="mono" style="font-size:9.5px;color:${GRAY};margin-top:8px">+ ${rows.length - max} terreno(s) — lista completa no dashboard.</p>` : ''}`;
  }
  const rows = [...emps].sort((a, b) => (a.dtLancamento || '').localeCompare(b.dtLancamento || ''));
  const shown = rows.slice(0, max);
  return `<table class="pdf-table"><thead><tr><th>EMPREENDIMENTO</th><th>LANÇAMENTO</th><th>INCORPORADORA</th><th>BAIRRO</th><th class="r">M² TERRENO</th><th class="r">TOTAL UNIDS</th><th>STATUS</th></tr></thead>
    <tbody>${shown.map(e => `<tr><td><b>${escapeHtml(e.empreendimento)}</b></td><td>${mesAno((e.dtLancamento || '').slice(0, 7))}</td><td>${escapeHtml(e.incorporadora || '—')}</td><td>${escapeHtml(e.bairro || '—')}</td><td class="r">${fmtInt(e.areaTerreno)}</td><td class="r">${fmtInt(e.totalUnidades)}</td><td>${statusEmp(e)}</td></tr>`).join('')}</tbody></table>
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
    // terrenos monitorados sem data: entram na apresentação mesmo sem tipologia/lançamento
    status.textContent = 'BUSCANDO TERRENOS SEM PREVISÃO…';
    let semPrev = [];
    try { semPrev = await loadSemDataEmps(); }
    catch (err) { console.warn('terrenos sem previsão indisponíveis', err); }
    if (semPrev.length) {
      const porBairro = {};
      semPrev.forEach(e => (porBairro[e.bairro || '—'] = porBairro[e.bairro || '—'] || []).push(e));
      const ordenados = Object.entries(porBairro).sort((a, b) => b[1].length - a[1].length);
      const TOP = 8;  // sem isso seriam dezenas de slides, um por bairro
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
          ${deckKpisHtml(c.emps, c.semPrevisao)}
          ${deckTableHtml(c.emps, 11, c.semPrevisao)}
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
    ['Média mensal vendas (mercado)', m.avg == null ? '—' : +m.avg.toFixed(2)],
    ['Média mensal vendas deflacionada', m.defl == null ? '—' : +m.defl.toFixed(2)],
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
function appendAIMessage(role, text) {
  const box = $('#aiMessages'); if (!box) return;
  const div = document.createElement('div');
  div.className = 'ai-msg ' + (role === 'user' ? 'ai-user' : 'ai-bot');
  div.textContent = text;
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
  return `Mês de referência: ${nowYM()}. Filtros ativos no dashboard (apenas contexto; o banco não está filtrado): ${filtersSummaryText() || 'nenhum'}.`;
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
      loading.textContent = 'Consultando o banco de dados…';
      messages.push({ role: 'assistant', content: out });
      let feedback;
      try {
        const r = await runNeonSQL(sql);
        feedback = `Resultado da consulta (${r.rowCount} linhas${r.truncated ? ', truncado em 200 — agregue mais' : ''}):\n${JSON.stringify(r.rows).slice(0, 24000)}`;
      } catch (err) { feedback = 'Erro na consulta: ' + err.message + '\nCorrija o SQL e tente de novo.'; }
      messages.push({ role: 'user', content: feedback + '\n\nAgora responda ao usuário (ou envie outro bloco ```sql``` se precisar de mais dados).' });
      loading.textContent = 'Interpretando os dados…';
    }
    loading.textContent = answer;
  }
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
      nome: e.empreendimento || '—', id: e.id, projetos: 1, unidades: e.totalUnidades || 0,
      protocolo: emProtocolo ? 1 : 0, aprovados: aprovado ? 1 : 0, lancados: lancado ? 1 : 0,
      medianaAprov: prazo, mediaAprov: prazo, amostra: prazo != null ? 1 : null,
    });
  });
  return Object.values(acc).map(a => ({
    ...a, medianaAprov: mediana(a.prazos), mediaAprov: media(a.prazos), amostra: a.prazos.length || null,
  }));
}
function renderIncorporadoras() {
  const alvo = $('#incTable'); if (!alvo) return;
  const linhas = ordenarHierarquia(statsIncorporadoras(baseIncorporadoras()), 'incTable', (r, k) => k === 'nome' ? r.nome : r[k]);
  const meses = d => d == null ? '—' : (d / 30.44).toFixed(1).replace('.', ',') + ' m';
  const marca = v => v ? `<b>${v}</b>` : '·';
  const tot = linhas.reduce((s, l) => ({
    projetos: s.projetos + l.projetos, unidades: s.unidades + l.unidades,
    protocolo: s.protocolo + l.protocolo, aprovados: s.aprovados + l.aprovados,
    lancados: s.lancados + l.lancados, prazos: s.prazos.concat(l.prazos),
  }), { projetos: 0, unidades: 0, protocolo: 0, aprovados: 0, lancados: 0, prazos: [] });
  const sub = $('#incSub');
  if (sub) sub.textContent = incJanela()
    ? `Projetos protocolados ou aprovados entre ${incFrom ? ymLabel(incFrom) : '…'} e ${incTo ? ymLabel(incTo) : '…'} · não obedece ao filtro de período de lançamento · lançado = lançamento até ${ymLabel(rEguaLancamento())}`
    : `Toda a base, sem recorte de período · lançado = lançamento até ${ymLabel(rEguaLancamento())} · tempo de aprovação = protocolo → aprovação`;
  const cols = [
    { k: 'nome', label: 'INCORPORADORA / EMPREENDIMENTO' },
    { k: 'projetos', label: 'PROJETOS', num: true }, { k: 'unidades', label: 'UNIDADES', num: true },
    { k: 'protocolo', label: 'EM PROTOCOLO', num: true }, { k: 'aprovados', label: 'APROVADOS', num: true },
    { k: 'lancados', label: 'LANÇADOS', num: true },
    { k: 'medianaAprov', label: 'APROV. MEDIANA', num: true }, { k: 'mediaAprov', label: 'APROV. MÉDIA', num: true },
    { k: 'amostra', label: 'AMOSTRA', num: true },
  ];
  let html = cabecalhoOrdenavel('incTable', cols) + '<tbody>';
  linhas.forEach((l, gi) => {
    html += `<tr class="group" data-g="${gi}">
      <td>${escapeHtml(l.nome)}</td>
      <td class="num">${fmtInt(l.projetos)}</td>
      <td class="num">${fmtInt(l.unidades)}</td>
      <td class="num">${l.protocolo ? `<span class="pill pill--wait">${l.protocolo}</span>` : '<span class="pill pill--none">0</span>'}</td>
      <td class="num">${l.aprovados ? `<span class="pill pill--ok">${l.aprovados}</span>` : '<span class="pill pill--none">0</span>'}</td>
      <td class="num">${fmtInt(l.lancados)}</td>
      <td class="num">${meses(l.medianaAprov)}</td>
      <td class="num">${meses(l.mediaAprov)}</td>
      <td class="num">${l.amostra || '—'}</td>
    </tr>`;
    l.filhos.forEach(f => {
      html += `<tr class="leaf" data-g="${gi}" data-id="${escapeHtml(String(f.id ?? ''))}">
        <td>${escapeHtml(f.nome)}</td>
        <td class="num">·</td>
        <td class="num">${fmtInt(f.unidades)}</td>
        <td class="num">${marca(f.protocolo)}</td>
        <td class="num">${marca(f.aprovados)}</td>
        <td class="num">${marca(f.lancados)}</td>
        <td class="num">${meses(f.medianaAprov)}</td>
        <td class="num">${meses(f.mediaAprov)}</td>
        <td class="num">${f.amostra || '—'}</td>
      </tr>`;
    });
  });
  html += `<tr class="tot-row">
      <td>TOTAL · ${linhas.length} incorporadoras</td>
      <td class="num">${fmtInt(tot.projetos)}</td><td class="num">${fmtInt(tot.unidades)}</td>
      <td class="num">${fmtInt(tot.protocolo)}</td><td class="num">${fmtInt(tot.aprovados)}</td>
      <td class="num">${fmtInt(tot.lancados)}</td>
      <td class="num">${meses(mediana(tot.prazos))}</td><td class="num">${meses(media(tot.prazos))}</td>
      <td class="num">${tot.prazos.length || '—'}</td>
    </tr></tbody>`;
  alvo.innerHTML = html;
  ligarHierarquia('incTable');
  ligarOrdenacao('incTable', renderIncorporadoras);
  ligarLarguras('incTable');
  $$('#incTable tr.leaf[data-id]').forEach(tr => tr.onclick = ev => { ev.stopPropagation(); locateOnMap(tr.dataset.id); });
}

/* ---------- concentração por bairro / macrozona ---------- */
let concMode = 'bairro';
function renderConcentracao() {
  const alvo = $('#concTable'); if (!alvo) return;
  const chave = e => concMode === 'macrozona' ? mzLabel(e.macrozona) : (e.bairro || '—');
  const acc = {};
  filtered.forEach(e => {
    const k = chave(e);
    const a = acc[k] = acc[k] || { k, emps: 0, unidades: 0, area: 0, incs: new Set(), areas: [], itens: [] };
    a.itens.push(e);
    a.emps += 1;
    a.unidades += e.totalUnidades || 0;
    a.area += e.areaTerreno || 0;
    if (e.incorporadora) a.incs.add(e.incorporadora);
    (e.tipologias || []).forEach(t => { if (t.area != null && t.unids) a.areas.push([t.area, t.unids]); });
  });
  const areaMedia = areas => {
    const u = areas.reduce((s, [, n]) => s + n, 0);
    return u ? areas.reduce((s, [a, n]) => s + a * n, 0) / u : null;
  };
  const totUn = Object.values(acc).reduce((s, l) => s + l.unidades, 0) || 1;
  const linhasBrutas = Object.values(acc).map(l => ({
    nome: l.k, emps: l.emps, unidades: l.unidades, pct: l.unidades * 100 / totUn,
    incs: l.incs.size, m2: areaMedia(l.areas), area: l.area,
    filhos: l.itens.map(e => ({
      nome: e.empreendimento || '—', id: e.id, emps: null, unidades: e.totalUnidades || 0,
      pct: (e.totalUnidades || 0) * 100 / totUn, incs: e.incorporadora || null,
      m2: areaMedia((e.tipologias || []).filter(t => t.area != null && t.unids).map(t => [t.area, t.unids])),
      area: e.areaTerreno || 0,
    })),
  }));
  const linhas = ordenarHierarquia(linhasBrutas, 'concTable', (r, k) => r[k]);
  const maior = Math.max(...linhasBrutas.map(l => l.unidades), 1);
  const pct = v => v.toFixed(1).replace('.', ',') + '%';
  const barra = v => `<td class="conc-bar"><i style="width:${Math.max(2, Math.min(100, v * 100 / maior))}%"></i></td>`;
  let html = cabecalhoOrdenavel('concTable', [
    { k: 'nome', label: (concMode === 'macrozona' ? 'MACROZONA' : 'BAIRRO') + ' / EMPREENDIMENTO' },
    { k: 'emps', label: 'EMPREEND.', num: true }, { k: 'unidades', label: 'UNIDADES', num: true },
    { k: 'pct', label: '% DO TOTAL', num: true }, { label: 'PARTICIPAÇÃO', fixa: true },
    { k: 'incs', label: 'INCORPORADORAS', num: true }, { k: 'm2', label: 'M² MÉDIO', num: true },
    { k: 'area', label: 'M² TERRENO', num: true },
  ]) + '<tbody>';
  linhas.forEach((l, gi) => {
    html += `<tr class="group" data-g="${gi}">
      <td>${escapeHtml(l.nome)}</td>
      <td class="num">${fmtInt(l.emps)}</td>
      <td class="num">${fmtInt(l.unidades)}</td>
      <td class="num">${pct(l.pct)}</td>${barra(l.unidades)}
      <td class="num">${fmtInt(l.incs)}</td>
      <td class="num">${l.m2 == null ? '—' : fmtDec(l.m2, 0)}</td>
      <td class="num">${fmtInt(l.area)}</td>
    </tr>`;
    l.filhos.forEach(f => {
      html += `<tr class="leaf" data-g="${gi}" data-id="${escapeHtml(String(f.id ?? ''))}">
        <td>${escapeHtml(f.nome)}</td>
        <td class="num">·</td>
        <td class="num">${fmtInt(f.unidades)}</td>
        <td class="num">${pct(f.pct)}</td>${barra(f.unidades)}
        <td class="cell-txt">${escapeHtml(f.incs || '—')}</td>
        <td class="num">${f.m2 == null ? '—' : fmtDec(f.m2, 0)}</td>
        <td class="num">${fmtInt(f.area)}</td>
      </tr>`;
    });
  });
  html += `<tr class="tot-row">
      <td>TOTAL · ${linhas.length} ${concMode === 'macrozona' ? 'macrozonas' : 'bairros'}</td>
      <td class="num">${fmtInt(filtered.length)}</td>
      <td class="num">${fmtInt(totUn)}</td>
      <td class="num">100,0%</td><td></td>
      <td class="num">${fmtInt(new Set(filtered.map(e => e.incorporadora).filter(Boolean)).size)}</td>
      <td class="num"></td>
      <td class="num">${fmtInt(filtered.reduce((s, e) => s + (e.areaTerreno || 0), 0))}</td>
    </tr></tbody>`;
  alvo.innerHTML = html;
  ligarHierarquia('concTable');
  ligarOrdenacao('concTable', renderConcentracao);
  ligarLarguras('concTable');
  $$('#concTable tr.leaf[data-id]').forEach(tr => tr.onclick = ev => { ev.stopPropagation(); locateOnMap(tr.dataset.id); });
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
$$('#lancMode button').forEach(b => b.onclick = () => {
  lancMode = b.dataset.mode;
  $$('#lancMode button').forEach(x => x.classList.toggle('active', x === b));
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
