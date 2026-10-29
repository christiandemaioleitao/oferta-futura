# Kit de Dashboard — EBM Inteligência

Manual para replicar, em qualquer dashboard novo, os sete recursos que o Oferta Futura já tem:

| # | Recurso | Seção |
|---|---|---|
| 1 | Expandir painel em tela cheia | [§3](#3-expandir-painel-em-tela-cheia) |
| 2 | Dock de configurações (ocultar lápis · rótulos de dados) | [§4](#4-dock-de-configurações) |
| 3 | Edição de texto pelo lápis | [§4.1](#41-lápis-de-edição-de-texto) |
| 4 | Rótulos de dados nos gráficos | [§4.2](#42-rótulos-de-dados-nos-gráficos) |
| 5 | Ordenação das tabelas | [§5](#5-ordenação-das-tabelas) |
| 6 | Largura de coluna arrastável | [§6](#6-largura-de-coluna-arrastável) |
| 7 | Chat de IA sobre o banco | [§7](#7-chat-de-ia-sobre-o-banco) |
| 8 | Exportar a página em PDF (relatório) | [§8](#8-exportar-a-página-em-pdf-relatório) |
| 9 | Exportar apresentação em PDF (slides) | [§9](#9-exportar-apresentação-em-pdf-slides) |

**Nada aqui depende dos dados de oferta futura.** Onde o código toca o seu domínio, há um marcador `👉 TROCAR`. Copie o bloco, troque o que está marcado, siga em frente.

Cada recurso é independente: dá para levar só o "expandir" ou só o chat. As únicas dependências reais estão na [§2](#2-fundação-obrigatória).

---

## 1. Arquitetura que o kit pressupõe

O kit foi escrito para o formato mais simples que existe e que sobrevive a qualquer hospedagem:

```
meu-dashboard/
├── index.html          ← marcação + <script src> das libs
├── css/style.css       ← tokens + componentes
├── js/app.js           ← tudo: estado, filtros, render, exportações
├── data/dados.js       ← window.MEUS_DADOS = {...}  (gerado pelo pipeline)
└── assets/logo-full.png
```

Sem build, sem npm, sem framework. Um `index.html` que abre com duplo clique e funciona igual no Vercel. Isso não é preguiça: é o que permite o dashboard sobreviver anos sem manutenção de dependência, e o que permite qualquer pessoa do time abrir o arquivo e entender o que está acontecendo.

**Bibliotecas por CDN** — só carregue as que o dashboard usar:

```html
<!-- gráficos: §4.2, §8, §9 -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"></script>
<!-- exportar/importar Excel -->
<script src="https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js"></script>
<!-- PDF: §8 e §9 -->
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>
```

Fixe as versões. `@latest` num CDN é um dashboard que quebra sozinho numa terça-feira.

### O padrão de dados

Todo o kit assume duas variáveis globais no `app.js`:

```js
let DATA = window.MEUS_DADOS || { registros: [], geradoEm: '', fonte: '' };  // 👉 TROCAR
let filtered = [];   // o subconjunto que passou nos filtros — é isso que tudo desenha
```

E um único ponto de entrada de re-render:

```js
function applyAll() {
  filtered = DATA.registros.filter(r => registroPassaNosFiltros(r));   // 👉 TROCAR
  renderKPIs(); renderCharts(); renderTabelas();
}
```

Quem muda filtro chama `applyAll()`. Nada mais. Essa disciplina é o que faz os PDFs, o chat e as exportações verem sempre o mesmo recorte que está na tela.

### Cache-buster obrigatório

```html
<link rel="stylesheet" href="css/style.css?v=20260728-1" />
<script src="data/dados.js?v=20260728-1"></script>
<script src="js/app.js?v=20260728-1"></script>
```

Sem o `?v=`, o navegador serve a versão anterior do cache: o arquivo muda, a URL não, e o dashboard mostra dados velhos **sem erro nenhum no console**. Já custou meio dia de investigação. Se houver pipeline, faça ele carimbar o token automaticamente (veja o `atualizar_cache_buster()` do Oferta Futura).

---

## 2. Fundação obrigatória

Cole no topo do `app.js`. Todo o resto do kit depende disso.

```js
'use strict';
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// texto normalizado p/ busca e comparação: sem acento, maiúsculo, sem espaço nas pontas
const textKey = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

const fmtInt = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('pt-BR');
const fmtDec = (n, d = 1) => (n == null || isNaN(n)) ? '—'
  : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
```

> **`escapeHtml` não é opcional.** Todas as tabelas do kit são desenhadas por `innerHTML`. Um nome de cliente com `<` no meio quebra o layout; um nome vindo de fonte externa com `<script>` executa. Passe **todo** texto de dado por `escapeHtml` antes de concatenar.

### Tokens de CSS

No `:root` do `style.css`. Os componentes do kit referenciam essas variáveis — troque os valores, não os nomes.

```css
:root{
  --navy:#0C1F55;        /* 👉 TROCAR: cor primária da marca */
  --navy-700:#1B336E;
  --navy-500:#3A5AA0;
  --red:#E30A12;         /* 👉 TROCAR: cor de destaque/ação */
  --paper:#F4F6F9;       /* fundo da página */
  --paper-2:#E9EDF3;
  --ink:#0E1626;         /* texto principal */
  --gray-600:#566076;
  --gray-400:#97A1B2;
  --hair:#DCE2EC;        /* linha divisória */
  --hair-dark:rgba(255,255,255,.15);
  --maxw:1340px;
  --pad:clamp(16px,3.4vw,44px);
  --font-display:'Sora',sans-serif;
  --font-body:'IBM Plex Sans',sans-serif;
  --font-mono:'IBM Plex Mono',monospace;
  --radius:14px;
  --shadow:0 14px 36px rgba(12,31,85,.08);
}
*{box-sizing:border-box;margin:0;padding:0}
[hidden]{display:none!important}
body{font-family:var(--font-body);background:var(--paper);color:var(--ink);line-height:1.55;-webkit-font-smoothing:antialiased}
.mono{font-family:var(--font-mono)}
.wrap{max-width:var(--maxw);margin:0 auto;padding-left:var(--pad);padding-right:var(--pad)}
```

### A estrutura de card

O kit inteiro gira em torno de um card com cabeçalho. **Todo painel precisa ter esta forma** — é assim que o botão de expandir se instala sozinho:

```html
<section class="card">
  <div class="card__head">
    <div>
      <h2 data-editable>Título do painel</h2>
      <small data-editable>Subtítulo explicando o que se lê aqui</small>
    </div>
    <div class="head-tools">
      <!-- controles próprios do painel; o botão de expandir entra aqui sozinho -->
    </div>
  </div>
  <!-- conteúdo: gráfico, tabela, mapa... -->
</section>
```

```css
.card{background:#fff;border:1px solid var(--hair);border-radius:var(--radius);box-shadow:var(--shadow);padding:20px 22px;margin-bottom:18px}
.card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px;flex-wrap:wrap}
.card__head h2{font-family:var(--font-display);font-weight:700;font-size:19px;color:var(--navy);letter-spacing:-.01em}
.card__head small{display:block;font-size:12.5px;color:var(--gray-600);margin-top:3px}
.head-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}

/* box de gráfico com altura fixa: o Chart.js precisa de um pai com altura definida */
.chart-box{position:relative;height:250px}
.chart-box>canvas{max-width:100%}
```

### Um único listener de ESC

Em vez de cada componente registrar o seu:

```js
let fecharDock = () => {};    // preenchido pelo dock (§4)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (cardExpandido) { alternarExpansao(cardExpandido, cardExpandido.__btn); return; }  // §3
  setAIChatOpen(false); fecharDock();
});
```

A ordem importa: com um painel expandido, ESC restaura o painel e **não** fecha o resto. Um ESC, uma ação.

---

## 3. Expandir painel em tela cheia

Botão em cada card que joga o painel para tela cheia, como no Power BI. Instala-se sozinho em todo `.card` da página — não precisa marcar HTML.

### JS

```js
const EXPAND_SVG  = '<svg viewBox="0 0 24 24" fill="none"><path d="M9 3H3v6M15 21h6v-6M3 3l7 7M21 21l-7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COLAPSE_SVG = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 9h6V3M21 15h-6v6M10 10 3 3M14 14l7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
let cardExpandido = null;

/* Redimensiona depois que o layout novo já valeu. O resize do Chart.js lê o tamanho
   do container e refaz o canvas na densidade da tela — se rodar antes, sai borrado. */
function recalcularVisuais() {
  requestAnimationFrame(() => {
    [chart1, chart2].forEach(c => {          // 👉 TROCAR: seus gráficos
      try {
        if (!c) return;
        // zera a largura antiga antes de medir: senão o canvas segura o container aberto
        c.canvas.style.width = ''; c.canvas.style.height = '';
        c.resize();
      } catch (e) { /* gráfico ainda não criado */ }
    });
    if (typeof map !== 'undefined' && map) map.invalidateSize();   // 👉 se houver mapa Leaflet
  });
}

function alternarExpansao(card, btn) {
  const abrindo = cardExpandido !== card;
  if (cardExpandido) {                        // sempre fecha o anterior primeiro
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
    fundo.onclick = () => alternarExpansao(card, btn);   // clique fora restaura
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
```

### CSS

```css
.expand-btn{background:var(--paper);border:1px solid var(--hair);border-radius:7px;width:28px;height:28px;display:grid;place-items:center;cursor:pointer;color:var(--navy-500);flex:none}
.expand-btn:hover{border-color:var(--navy-500);color:var(--navy)}
.expand-btn svg{width:14px;height:14px}

.card-expanded{position:fixed!important;inset:14px!important;z-index:1300;margin:0!important;overflow:auto;box-shadow:0 30px 90px rgba(12,31,85,.35)}
/* alturas em tela cheia — ajuste para os seus componentes */
.card-expanded .chart-box{height:calc(100vh - 320px);min-height:320px}
.card-expanded .table-scroll{max-height:calc(100vh - 200px)}

/* o desfoque do fundo mora AQUI, nunca num ancestral do card. Leia o aviso abaixo. */
.expand-back{position:fixed;inset:0;background:rgba(12,31,85,.18);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);z-index:1290}
body.has-expanded{overflow:hidden}
```

### ⚠️ Três armadilhas que custaram caro

**1. Nunca use `filter: blur()` num ancestral.** A tentação é `body.has-expanded > *:not(.card-expanded){filter:blur(2px)}`. Dois problemas: `filter` é herdado pelos descendentes, então o card expandido também borra; e pior, um elemento com `filter` vira **bloco de contenção** do `position:fixed` dos filhos — o card expandido é jogado para fora do viewport e some. O desfoque vai no overlay, atrás do card, via `backdrop-filter`.

**2. Faixa `fr` de grid não encolhe sozinha.** Se o card expandido estiver dentro de um grid (`grid-template-columns:1.15fr 1fr`), ao colapsar o canvas ainda carrega a largura da tela cheia. Faixa `fr` tem piso de `min-content`, então o grid **não consegue voltar**: a coluna do gráfico fica com 1.800 px e a vizinha espremida em 240 px. São dois consertos que só funcionam juntos:

```css
.duo{display:grid;grid-template-columns:1.15fr 1fr;gap:18px}
.duo>.card{min-width:0}          /* deixa a faixa encolher abaixo do conteúdo */
.chart-box>canvas{max-width:100%}
```

...mais o `canvas.style.width = ''` antes do `resize()`, que está no `recalcularVisuais()` acima. Só um dos dois não resolve.

**3. `requestAnimationFrame` antes do resize.** Chamar `chart.resize()` na mesma linha do `classList.add` mede o layout antigo e devolve um gráfico borrado.

---

## 4. Dock de configurações

Engrenagem flutuante no canto inferior esquerdo com interruptores de preferência. As preferências ficam no `localStorage`, então sobrevivem ao F5.

### HTML

```html
<div class="settings-dock" id="settingsDock">
  <button class="gear-fab" id="settingsBtn" type="button" title="Menu de configurações" aria-label="Menu de configurações" aria-expanded="false">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm8.2 3.8c0-.5-.1-1-.2-1.5l2-1.5-2-3.5-2.4 1a8.3 8.3 0 0 0-2.6-1.5L14.7 2H9.3L9 5a8.3 8.3 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a8.2 8.2 0 0 0 0 3l-2 1.5 2 3.5 2.4-1A8.3 8.3 0 0 0 9 19l.3 3h5.4l.3-3a8.3 8.3 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5c.1-.5.2-1 .2-1.5Z"></path></svg>
  </button>
  <div class="settings-panel">
    <label class="settings-row"><span><b>Edições</b><small>Ocultar lápis da página</small></span><input class="switch" id="editLockBtn" type="checkbox" title="Ocultar edições" aria-label="Ocultar edições" /></label>
    <label class="settings-row"><span><b>Rótulos de dados</b><small>Valores nos gráficos</small></span><input class="switch" id="dataLabelsBtn" type="checkbox" title="Rótulos de dados" aria-label="Rótulos de dados" /></label>
    <!-- 👉 novos interruptores entram aqui, mesmo formato -->
  </div>
</div>
```

### JS

```js
const PREFIXO = 'meuDashboard';    // 👉 TROCAR: prefixo das chaves de localStorage

function setEditLock(locked) {
  document.body.classList.toggle('edits-locked', locked);
  const btn = $('#editLockBtn');
  if (btn) {
    btn.checked = locked;
    const label = locked ? 'Mostrar edições' : 'Ocultar edições';
    btn.title = label; btn.setAttribute('aria-label', label);
  }
  localStorage.setItem(PREFIXO + 'EditsLocked', locked ? '1' : '0');
}

function initSettingsPanel() {
  const dock = $('#settingsDock'), btn = $('#settingsBtn');
  if (!dock || !btn) return;
  const setOpen = open => { dock.classList.toggle('open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  btn.onclick = e => { e.stopPropagation(); setOpen(!dock.classList.contains('open')); };
  dock.onclick = e => e.stopPropagation();        // clique dentro não fecha
  document.addEventListener('click', () => setOpen(false));
  fecharDock = () => setOpen(false);              // liga no listener de ESC (§2)

  setEditLock(localStorage.getItem(PREFIXO + 'EditsLocked') === '1');
  const lock = $('#editLockBtn');
  if (lock) lock.onchange = () => setEditLock(lock.checked);

  const labels = $('#dataLabelsBtn');
  if (labels) {
    labels.checked = showDataLabels;
    labels.onchange = () => {
      showDataLabels = labels.checked;
      localStorage.setItem(PREFIXO + 'DataLabels', showDataLabels ? '1' : '0');
      renderCharts();                             // 👉 TROCAR: redesenha seus gráficos
    };
  }
}
```

### CSS

```css
.settings-dock{position:fixed;left:24px;bottom:24px;z-index:320;pointer-events:none}
.settings-dock .gear-fab{width:60px;height:60px;border:0;border-radius:50%;background:var(--navy);color:#fff;display:grid;place-items:center;cursor:pointer;box-shadow:0 18px 42px rgba(12,31,85,.28),0 4px 10px rgba(12,31,85,.14);pointer-events:auto;transition:transform .2s ease,background .2s ease}
.settings-dock .gear-fab:hover{background:var(--red);transform:translateY(-2px) scale(1.04)}
.settings-dock.open .gear-fab{background:var(--red)}
.settings-dock .gear-fab svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round}
.settings-panel{display:none;position:absolute;left:0;bottom:74px;width:min(268px,calc(100vw - 32px));padding:10px;border:1px solid rgba(12,31,85,.12);border-radius:14px;background:rgba(255,255,255,.95);backdrop-filter:blur(12px);box-shadow:0 18px 42px rgba(12,31,85,.18);pointer-events:auto}
.settings-dock.open .settings-panel{display:block}
.settings-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px;border-radius:10px;color:var(--navy);cursor:pointer}
.settings-row:hover{background:var(--paper)}
.settings-row span{display:grid;gap:2px}
.settings-row b{font-size:12px;font-family:var(--font-display)}
.settings-row small{font-size:10px;color:var(--gray-600)}

/* interruptor */
.switch{position:relative;height:1.5rem;width:3rem;cursor:pointer;appearance:none;-webkit-appearance:none;border-radius:9999px;background-color:rgba(12,31,85,.22);transition:all .3s ease;box-shadow:inset 0 0 0 1px rgba(12,31,85,.10);flex:0 0 auto}
.switch:checked{background-color:var(--red)}
.switch::before{position:absolute;content:"";left:-.1rem;top:-.05rem;display:block;height:1.6rem;width:1.6rem;cursor:pointer;border:1px solid rgba(12,31,85,.24);border-radius:9999px;background-color:#fff;box-shadow:0 3px 10px rgba(12,31,85,.22);transition:all .3s ease}
.switch:hover::before{box-shadow:0 0 0 8px rgba(12,31,85,.10)}
.switch:checked:hover::before{box-shadow:0 0 0 8px rgba(227,10,18,.14)}
.switch:checked::before{transform:translateX(100%);border-color:var(--red)}
@media(max-width:640px){.settings-dock{left:16px;bottom:16px}.settings-panel{bottom:68px}}
```

> `pointer-events:none` no dock e `auto` só no botão e no painel: o retângulo invisível do container não pode roubar cliques do que está embaixo dele.

---

### 4.1 Lápis de edição de texto

Qualquer texto com `data-editable` ganha um lápis que abre um `prompt()` e grava a edição no `localStorage`. Serve para renomear o dashboard, ajustar subtítulos e adaptar o mesmo arquivo para públicos diferentes sem tocar no código.

```html
<h1 class="top__title" data-editable>Meu Dashboard</h1>
<p class="top__sub" data-editable>Subtítulo · Departamento · Ano</p>
```

```js
// 👉 TROCAR: senha de edição. Isto NÃO é segurança — é um freio contra edição
// acidental por quem só está olhando o painel. Qualquer pessoa lê o código-fonte.
function requireEditPassword() { return prompt('Digite a senha para editar:') === '123'; }

function initEditableText() {
  const nodes = $$('[data-editable]').filter(el => !el.dataset.editReady);
  nodes.forEach((el, i) => {
    // id estável = posição + começo do texto original; sobrevive a recarregamento
    const id = 'txt-' + i + '-' + textKey(el.textContent).slice(0, 24).replace(/\W/g, '');
    const saved = localStorage.getItem(PREFIXO + 'Text:' + id);
    if (saved) el.textContent = saved;
    el.dataset.editReady = '1'; el.dataset.editId = id;

    const wrap = document.createElement('span'); wrap.className = 'editable-wrap';
    const target = document.createElement('span'); target.className = 'editable-target';
    target.textContent = el.textContent;
    const pencil = document.createElement('button');
    pencil.type = 'button'; pencil.className = 'edit-pencil';
    pencil.title = 'Editar texto'; pencil.setAttribute('aria-label', 'Editar texto');
    pencil.textContent = '✎';
    el.textContent = ''; el.appendChild(wrap); wrap.appendChild(target); wrap.appendChild(pencil);

    pencil.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      if (!requireEditPassword()) { alert('Senha incorreta.'); return; }
      target.classList.add('text-editing');
      const next = prompt('Editar texto:', target.textContent);
      target.classList.remove('text-editing');
      if (next === null) return;                       // Cancelar não apaga nada
      target.textContent = next;
      localStorage.setItem(PREFIXO + 'Text:' + id, next);
      if (el.matches('.top__title')) document.title = 'Minha Marca | ' + next;   // 👉 TROCAR
    };
  });
}
```

```css
.editable-wrap{display:inline-flex;align-items:center;gap:5px;max-width:100%;vertical-align:baseline}
.editable-target{min-width:0}
.edit-pencil{width:19px;height:19px;border-radius:999px;font-size:11px;line-height:1;opacity:.3;flex:0 0 auto;border:1px solid rgba(12,31,85,.12);background:rgba(255,255,255,.62);color:var(--navy);cursor:pointer;display:inline-grid;place-items:center;transition:opacity .15s,transform .15s}
.editable-wrap:hover .edit-pencil{opacity:.92;transform:translateY(-1px)}
.edit-pencil:hover{background:#fff;color:var(--red);border-color:rgba(227,10,18,.28)}
/* sobre fundo escuro o lápis inverte */
.top .edit-pencil{color:#fff;background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.18)}
.text-editing{outline:2px solid rgba(227,10,18,.28);outline-offset:3px;border-radius:4px}
/* é isto que o interruptor "Edições" do dock liga e desliga */
.edits-locked .edit-pencil{display:none!important}
.edits-locked .editable-wrap{gap:0}
```

> **Atenção ao ler o texto depois.** Como o lápis embrulha o conteúdo, `$('.top__title').textContent` passa a incluir o `✎`. Ao usar o título em exportações, leia o alvo interno:
> ```js
> const titulo = ($('.top__title .editable-target')?.textContent || $('.top__title')?.textContent || 'Dashboard').trim();
> ```

---

### 4.2 Rótulos de dados nos gráficos

Plugin de Chart.js de ~25 linhas, sem dependência externa. Ligado pelo interruptor do dock, aplica-se a linha e barra (inclusive empilhada).

```js
let showDataLabels = localStorage.getItem(PREFIXO + 'DataLabels') === '1';

const dataLabelsPlugin = {
  id: 'meusRotulos',
  afterDatasetsDraw(chart) {
    if (!showDataLabels) return;
    const ctx = chart.ctx, n = chart.data.labels.length;
    const step = Math.max(1, Math.ceil(n / 24));   // pula rótulos quando há muitos pontos
    ctx.save();
    ctx.font = "600 9px 'IBM Plex Mono', monospace";
    ctx.textAlign = 'center';
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;                     // série desligada na legenda
      meta.data.forEach((el, i) => {
        if (i % step) return;
        const v = ds.data[i];
        if (!v || !el) return;                     // zero não vira rótulo
        /* Barra: o rótulo vai DENTRO do segmento, em branco. Fora dela, os rótulos
           das séries se sobrepõem no topo da pilha e viram borrão.
           Ponto de linha: o rótulo vai acima, na cor da marca. */
        if (el.base !== undefined) {               // BarElement tem .base; PointElement não
          if (Math.abs(el.base - el.y) < 13) return;   // segmento fino: não caberia
          ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
          ctx.fillText(fmtInt(v), el.x, (el.y + el.base) / 2);
        } else {
          ctx.fillStyle = '#0C1F55'; ctx.textBaseline = 'bottom';   // 👉 TROCAR
          ctx.fillText(fmtInt(v), el.x, el.y - 4);
        }
      });
    });
    ctx.restore();
  }
};
```

Registre em **todos** os gráficos — inclusive nos modos alternativos (detalhado, empilhado, comparativo). Esquecer um deles é o defeito mais comum aqui: o interruptor liga e o usuário jura que não funciona.

```js
new Chart($('#meuGrafico'), {
  type: 'bar',
  data: { /* ... */ },
  plugins: [dataLabelsPlugin],       // ← array de plugins locais, irmão de `data` e `options`
  options: { responsive: true, maintainAspectRatio: false, /* ... */ }
});
```

> `maintainAspectRatio: false` + `.chart-box` com altura fixa. Sem os dois, o gráfico cresce sem parar a cada re-render.

---

## 5. Ordenação das tabelas

Regra de BI: **coluna de texto começa em A→Z, coluna numérica começa do maior**, o segundo clique inverte, e valor vazio fica sempre por último — nos dois sentidos. Vazio no topo de uma ordenação decrescente é o tipo de detalhe que faz o usuário desconfiar do painel inteiro.

O padrão pressupõe que a tabela é redesenhada por `innerHTML` a cada ordenação. É mais simples do que reordenar linhas no DOM e não acumula estado escondido.

### JS

```js
/* estado por tabela: qual coluna e em que sentido. 👉 TROCAR pelas suas tabelas */
const ordens = {
  tabelaVendas:  { k: 'valor',  asc: false },
  tabelaClientes:{ k: 'nome',   asc: true  },
};

/* monta o <thead> já com o indicador na coluna ativa.
   cols = [{k:'nome', label:'CLIENTE'}, {k:'valor', label:'VALOR', num:true}, {label:'BARRA', fixa:true}]
   - k     → chave do objeto de dados
   - num   → coluna numérica (começa decrescente)
   - fixa  → coluna decorativa, não ordenável (barra de participação, ícone) */
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
    if (o.k === k) o.asc = !o.asc;                        // mesma coluna: inverte
    else { o.k = k; o.asc = th.dataset.t !== 'num'; }     // coluna nova: texto A→Z, número maior→menor
    redesenhar();
  });
}

/* comparador único. Vazio por último nos dois sentidos — por isso o null é tratado
   ANTES de aplicar o `asc`, e não depois. */
function cmpOrd(a, b, asc) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const d = (typeof a === 'number' && typeof b === 'number')
    ? a - b
    : String(a).localeCompare(String(b), 'pt-BR');   // 'pt-BR' resolve acento e Ç
  return asc ? d : -d;
}
```

### Uso numa tabela simples

```js
function renderTabelaVendas() {
  const o = ordens.tabelaVendas;
  const linhas = [...dadosVendas()].sort((a, b) => cmpOrd(a[o.k], b[o.k], o.asc));
  const cols = [
    { k: 'cliente', label: 'CLIENTE' },
    { k: 'valor',   label: 'VALOR',   num: true },
    { k: 'data',    label: 'DATA' },
  ];
  $('#tabelaVendas').innerHTML = cabecalhoOrdenavel('tabelaVendas', cols)
    + '<tbody>' + linhas.map(l => `<tr>
        <td>${escapeHtml(l.cliente)}</td>
        <td class="num">${fmtInt(l.valor)}</td>
        <td>${escapeHtml(l.data)}</td>
      </tr>`).join('') + '</tbody>';
  ligarOrdenacao('tabelaVendas', renderTabelaVendas);   // religar após cada innerHTML
  ligarLarguras('tabelaVendas');                        // §6
}
```

**Religar sempre.** `innerHTML` destrói os `<th>` antigos e os listeners junto. Toda função de render termina com `ligarOrdenacao` + `ligarLarguras`.

### CSS

```css
.table-scroll{overflow-x:auto}
.pivot{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}
.pivot th{position:sticky;top:0;z-index:2;background:var(--navy);color:#fff;font-family:var(--font-mono);font-weight:500;font-size:10.5px;letter-spacing:.1em;padding:10px 12px;text-align:right;white-space:nowrap}
.pivot th:first-child{text-align:left}
.pivot th.th-sort{cursor:pointer;user-select:none}
.pivot th.th-sort:hover{background:var(--navy-700)}
.pivot td{padding:8px 12px;border-bottom:1px solid var(--hair);text-align:right;font-family:var(--font-mono);font-size:12px;color:var(--ink)}
.pivot td:first-child{text-align:left;font-family:var(--font-body)}
.pivot tr.total td{background:var(--navy);color:#fff;font-weight:600;border-bottom:0}
.sort-ind{font-style:normal;opacity:.85}
```

> `position:sticky` no `<th>` exige que o container role, não a página: envolva a tabela em `<div class="table-scroll">` e dê `max-height` a ele quando quiser cabeçalho fixo na vertical.

### 5.1 Opcional: tabelas em árvore

Se a tabela tiver hierarquia (categoria → subcategoria → item), duas funções resolvem qualquer profundidade.

```js
/* Cada linha carrega o caminho do nó ('0', '0-2', '0-2-1') e a classe do nível.
   Regra única de visibilidade: aparece quando todos os ancestrais estão abertos.
   Nós esperados: { nome, id?, ...valores, filhos: [...] } */
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
    if (corte < 0) return true;                    // nível 0 está sempre à vista
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

/* ordena recursivamente: a coluna clicada ordena os irmãos em todos os níveis */
function ordenarArvore(nos, id, valor) {
  const o = ordens[id];
  const ordena = arr => {
    arr.forEach(n => { if (n.filhos) n.filhos = ordena(n.filhos); });
    return [...arr].sort((a, b) => cmpOrd(valor(a, o.k), valor(b, o.k), o.asc));
  };
  return ordena(nos);
}
```

```css
.pivot tr.n0 td{background:var(--paper);font-weight:600;color:var(--navy)}
.pivot tr.n1 td{color:var(--navy-500)}
.pivot tr.n1 td:first-child{padding-left:26px;font-weight:500}
.pivot tr.n2 td:first-child{padding-left:46px;color:var(--gray-600)}
.pivot tr.tem-filhos td{cursor:pointer}
.pivot tr.tem-filhos td:first-child::before{content:"▸ ";color:var(--red)}
.pivot tr.tem-filhos.open td:first-child::before{content:"▾ "}
.pivot tr.n1,.pivot tr.n2{display:none}
.pivot tr.n1.show,.pivot tr.n2.show{display:table-row}
```

> **Some os acumulados a partir dos filhos, nunca recalcule da base filtrada.** É o que garante que o nível 1 feche com o nível 0 e os dois com o TOTAL GERAL. Recalcular cada nível de forma independente cria divergências de arredondamento que ninguém consegue explicar na reunião.

---

## 6. Largura de coluna arrastável

Alça na borda direita de cada `<th>`. Arrastar redimensiona, duplo clique restaura a tabela inteira.

```js
/* As larguras ficam FORA do DOM, por tabela e por índice de coluna: as tabelas são
   redesenhadas por innerHTML a cada ordenação e a largura precisa sobreviver a isso. */
const larguras = {};

function aplicarLarguras(id) {
  const tabela = $('#' + id), larg = larguras[id];
  if (!tabela || !tabela.tHead || !larg) return;
  tabela.classList.add('col-fixa');
  [...tabela.tHead.rows[0].cells].forEach((th, i) => { if (larg[i]) th.style.width = larg[i] + 'px'; });
}

/* No primeiro arraste, congela a largura ATUAL de todas as colunas e passa a
   table-layout:fixed. Sem isso o navegador redistribui as outras colunas a cada
   pixel arrastado e a tabela "escorrega" debaixo do cursor. */
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
    alca.onclick = ev => ev.stopPropagation();     // soltar a alça não pode ordenar a coluna
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
      // listeners no document, não na alça: o cursor sai da alça no primeiro pixel
      document.addEventListener('mousemove', mover);
      document.addEventListener('mouseup', soltar);
      document.body.classList.add('redimensionando');
    };
    th.appendChild(alca);
  });
}
```

```css
.col-grip{position:absolute;top:0;right:0;width:7px;height:100%;cursor:col-resize;user-select:none}
.col-grip:hover,body.redimensionando .col-grip{background:rgba(255,255,255,.4)}
body.redimensionando{cursor:col-resize;user-select:none}
table.col-fixa{table-layout:fixed}
table.col-fixa td,table.col-fixa th{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
```

> A alça é `position:absolute` dentro do `<th>` — o `.pivot th` precisa de `position:sticky` ou `relative` para servir de referência. O `sticky` da §5 já resolve.

**Quatro decisões que parecem detalhe e não são:**

1. **Largura fora do DOM.** Guardar no `style` do `<th>` funciona até a primeira ordenação, que refaz o `innerHTML` e joga tudo fora.
2. **`stopPropagation` no clique da alça.** Sem isso, todo redimensionamento termina reordenando a tabela.
3. **Listeners no `document`.** O cursor sai da alça de 7 px no primeiro pixel de arraste; listener na própria alça perde o movimento.
4. **Piso de 48 px.** Sem ele dá para arrastar a coluna até zero e perdê-la de vista sem forma de recuperar.

---

## 7. Chat de IA sobre o banco

O chat não recebe os dados no prompt — ele **escreve SQL**, o sistema executa contra o banco e devolve as linhas para o modelo interpretar. É a diferença entre um assistente que inventa números e um que consulta a fonte.

### Arquitetura

```
navegador  →  provedor de IA (chave do usuário, no localStorage dele)
           ←  bloco ```sql ... ```
navegador  →  /api/sql  (função serverless)  →  Postgres (somente leitura)
           ←  linhas em JSON
navegador  →  provedor de IA ("aqui está o resultado, agora responda")
           ←  resposta em texto
```

Até 4 rodadas: o modelo pode encadear consultas se a primeira não bastar.

### 🔒 Regras de segurança inegociáveis

1. **Nunca embuta chave de API no `app.js`.** O arquivo é servido para todo navegador que abre a página. Uma chave já vazou assim neste projeto. A chave é do usuário e mora só no `localStorage` dele.
2. **O endpoint SQL aceita só leitura.** Valide no servidor: apenas `SELECT`/`WITH`, um único comando, limite de linhas, CORS restrito à sua origem. Nunca aceite o SQL do modelo direto no banco com credencial de escrita.
3. **Use um usuário de banco somente leitura**, com acesso apenas às tabelas que o chat pode ver.

### Endpoint serverless (Vercel · `api/sql.js`)

```js
// 👉 esqueleto — adapte à sua hospedagem
export default async function handler(req, res) {
  const origem = req.headers.origin || '';
  if (!/^https:\/\/meu-dashboard\.vercel\.app$/.test(origem)) return res.status(403).json({ error: 'origem não autorizada' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'método não permitido' });

  const sql = String(req.body?.sql || '').trim();
  // só leitura, um comando só
  if (!/^(select|with)\b/i.test(sql)) return res.status(400).json({ error: 'apenas SELECT' });
  if (/;/.test(sql.replace(/;\s*$/, ''))) return res.status(400).json({ error: 'apenas um comando' });

  try {
    const linhas = await consultarBanco(sql);           // conexão SOMENTE LEITURA
    const truncated = linhas.length > 200;
    return res.json({ rows: linhas.slice(0, 200), rowCount: linhas.length, truncated });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
}
```

### HTML

```html
<div class="ai-chat" id="aiChat">
  <div class="chat-popover" role="dialog" aria-label="Chat">
    <div class="ai-key-panel" id="aiKeyPanel" hidden>
      <label>Provedor<select id="aiProvider"></select></label>
      <label>Modelo<select id="aiModel"></select></label>
      <label>Modelo personalizado<input id="aiCustomModel" placeholder="substitui a lista" /></label>
      <label>Chave API<input id="aiApiKey" type="password" autocomplete="off" placeholder="Cole a chave" /></label>
      <button class="btn btn-primary" id="aiSaveKey" type="button">Salvar</button>
      <button class="btn btn-soft" id="aiCancelKey" type="button">Cancelar</button>
    </div>
    <div class="chat-log" id="aiMessages"></div>
  </div>
  <form class="chat-composer" id="chatForm">
    <div class="chat-input-shell">
      <button class="chat-key-button" id="aiKeyBtn" type="button" title="Cadastrar chave" aria-label="Cadastrar chave">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="7.6" cy="12" r="4" stroke="currentColor" stroke-width="2"/><path d="M11.6 12H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 12v3.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
      <textarea class="chat-textarea" id="aiQuestion" rows="1" placeholder="Pergunte à IA..."></textarea>
      <button class="send-button" id="aiAskBtn" type="submit" aria-label="Enviar mensagem">
        <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14m0 0-6-6m6 6-6 6" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </form>
  <button class="chat-toggle" id="aiFab" type="button" aria-label="Abrir chat" aria-expanded="false">
    <svg class="icon-chat" viewBox="0 0 24 24" fill="none"><path d="M7.4 17.8 4 20.2V6.7C4 4.65 5.65 3 7.7 3h8.6C18.35 3 20 4.65 20 6.7v7.4c0 2.05-1.65 3.7-3.7 3.7H7.4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 8h8M8 11.5h5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <svg class="icon-close" viewBox="0 0 24 24" fill="none"><path d="M7 7l10 10M17 7 7 17" stroke="currentColor" stroke-width="2.35" stroke-linecap="round"/></svg>
  </button>
</div>
```

### JS — provedores e configuração

```js
const DEFAULT_AI_PROVIDER = 'openrouter', DEFAULT_AI_MODEL = 'openai/gpt-oss-120b';
const AI_PROVIDERS = {
  openai:     { label: 'OpenAI',     type: 'chat',      endpoint: 'https://api.openai.com/v1/chat/completions',      models: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4o'] },
  deepseek:   { label: 'DeepSeek',   type: 'chat',      endpoint: 'https://api.deepseek.com/chat/completions',        models: ['deepseek-chat', 'deepseek-reasoner'] },
  openrouter: { label: 'OpenRouter', type: 'chat',      endpoint: 'https://openrouter.ai/api/v1/chat/completions',    models: [{ id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' }] },
  gemini:     { label: 'Gemini',     type: 'gemini',    models: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }] },
  anthropic:  { label: 'Anthropic',  type: 'anthropic', endpoint: 'https://api.anthropic.com/v1/messages',            models: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }] },
};

function aiConfig() {
  return {
    provider: localStorage.getItem(PREFIXO + 'AIProvider') || DEFAULT_AI_PROVIDER,
    model:    localStorage.getItem(PREFIXO + 'AIModel')    || DEFAULT_AI_MODEL,
    key:      localStorage.getItem(PREFIXO + 'AIKey')      || '',
  };
}
```

### JS — o prompt (a peça que você mais vai reescrever)

Este é **o coração da adaptação**. A qualidade da resposta é quase toda função da qualidade deste texto. Descreva as tabelas, os tipos, e principalmente **as armadilhas do seu modelo de dados**.

```js
function aiSystemPrompt() {
  return `Você é um analista de dados do departamento X.   // 👉 TROCAR daqui para baixo
Responda em português do Brasil, direto e assertivo, números em pt-BR.

Você tem acesso ao banco Postgres do dashboard. Para responder QUALQUER pergunta sobre dados,
PRIMEIRO consulte o banco: responda APENAS com um bloco \`\`\`sql ... \`\`\` contendo um único
SELECT. O sistema executa e devolve as linhas em JSON; aí você responde ao usuário.
Se precisar, encadeie até 3 consultas. Nunca invente números — use só o que vier do banco.

Tabela principal: minha_tabela — grão = <descreva o grão!>. Colunas:
- coluna_a (text) — o que significa
- coluna_b (numeric) — o que significa, em que unidade
- "ColunaComMaiuscula" (date) — Postgres diferencia caixa: use aspas duplas

ATENÇÃO — <descreva aqui a armadilha do seu grão>. Exemplo real do Oferta Futura:
"cada tipologia se repete em ~18 linhas (uma por mês de projeção). Somar Unids_tipologia
sem filtro multiplica tudo por 18." Padrões corretos:
- <consulta modelo 1>
- <consulta modelo 2>

Limite de 200 linhas por consulta — agregue no SQL.
Se a pergunta fugir do escopo do dashboard, diga que foge do escopo.`;
}

function aiUserContext() {
  // o banco NÃO está filtrado; os filtros da tela vão como contexto para o modelo
  return `Data de referência: ${new Date().toISOString().slice(0, 10)}. ` +
         `Filtros ativos no dashboard (apenas contexto): ${filtersSummaryText() || 'nenhum'}.`;
}
```

> **A seção "ATENÇÃO" é a que separa um chat útil de um que mente com confiança.** Se o seu grão permite dupla contagem, escreva isso em letras garrafais e dê os padrões corretos de consulta. O modelo obedece; ele só não adivinha.

### JS — chamada aos provedores e laço de consulta

```js
const SQL_ENDPOINT = /vercel\.app$/.test(location.hostname) ? '/api/sql' : 'https://meu-dashboard.vercel.app/api/sql';

async function runSQL(sql) {
  const res = await fetch(SQL_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Falha ao consultar o banco.');
  return data;
}

async function callAIProvider(messages) {
  const cfg = aiConfig(), p = AI_PROVIDERS[cfg.provider];
  if (!p || !cfg.key) throw new Error('cadastre uma chave de API no botão de chave antes de perguntar.');

  if (p.type === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.key)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: aiSystemPrompt() }] },
          contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { temperature: .15, maxOutputTokens: 1400 } }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error?.message || 'Falha na API Gemini.');
    return (data.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('\n').trim();
  }
  if (p.type === 'anthropic') {
    const res = await fetch(p.endpoint, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 1400, temperature: .15, system: aiSystemPrompt(), messages }) });
    const data = await res.json(); if (!res.ok) throw new Error(data.error?.message || 'Falha na API Anthropic.');
    return (data.content || []).map(x => x.text || '').join('\n').trim();
  }
  // formato OpenAI-compatível (OpenAI, DeepSeek, OpenRouter, Groq, Together...)
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key };
  if (cfg.provider === 'openrouter') { headers['HTTP-Referer'] = location.href; headers['X-Title'] = 'Meu Dashboard'; }
  const res = await fetch(p.endpoint, { method: 'POST', headers,
    body: JSON.stringify({ model: cfg.model, temperature: .15, max_tokens: 1400,
      messages: [{ role: 'system', content: aiSystemPrompt() }, ...messages] }) });
  const data = await res.json(); if (!res.ok) throw new Error(data.error?.message || data.message || 'Falha na API.');
  return (data.choices?.[0]?.message?.content || '').trim();
}

const extractSQL = text => { const m = /```sql\s*([\s\S]*?)```/i.exec(text || ''); return m ? m[1].trim() : null; };

async function askAI() {
  const input = $('#aiQuestion'), btn = $('#aiAskBtn'), q = input.value.trim();
  if (!q) return;
  setAIChatOpen(true);
  appendAIMessage('user', q);
  input.value = ''; resizeAIQuestion();
  btn.disabled = true;
  const loading = appendAIMessage('bot', 'Analisando…');
  try {
    const messages = [{ role: 'user', content: `${aiUserContext()}\n\nPergunta do usuário: ${q}` }];
    let answer = 'Não recebi resposta da IA.';
    for (let round = 0; round < 4; round++) {
      const out = await callAIProvider(messages);
      const sql = extractSQL(out);
      // sem SQL, ou última rodada: é a resposta final (limpa qualquer bloco sql residual)
      if (!sql || round === 3) { answer = (out || '').replace(/```sql[\s\S]*?```/gi, '').trim() || answer; break; }
      loading.__setText('Consultando o banco de dados…');
      messages.push({ role: 'assistant', content: out });
      let feedback;
      try {
        const r = await runSQL(sql);
        feedback = `Resultado da consulta (${r.rowCount} linhas${r.truncated ? ', truncado em 200 — agregue mais' : ''}):\n${JSON.stringify(r.rows).slice(0, 24000)}`;
      } catch (err) {
        // erro de SQL volta como mensagem: o modelo corrige sozinho na próxima rodada
        feedback = 'Erro na consulta: ' + err.message + '\nCorrija o SQL e tente de novo.';
      }
      messages.push({ role: 'user', content: feedback + '\n\nAgora responda ao usuário (ou envie outro bloco ```sql``` se precisar de mais dados).' });
      loading.__setText('Interpretando os dados…');
    }
    loading.__setText(answer);
  }
  catch (err) { console.error(err); loading.__setText('Não consegui responder: ' + err.message); }
  finally { btn.disabled = false; input.focus(); }
}
```

### JS — mensagens com markdown e botão de copiar

Os modelos devolvem `**negrito**` cru. Sem tratar, o usuário vê os asteriscos.

```js
const COPIAR_SVG = '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

/* markdown mínimo do que os modelos realmente devolvem.
   ESCAPA ANTES de formatar — a resposta vem de fora e vai para innerHTML. */
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
    // clipboard API só existe em contexto seguro; em file:// cai no caminho antigo
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
     então a mensagem guarda o CRU para o botão de copiar e reformata a cada troca */
  div.__setText = t => { div.__texto = t; corpo.innerHTML = mdParaHtml(t); box.scrollTop = box.scrollHeight; };
  div.__setText(text);
  box.appendChild(div); box.scrollTop = box.scrollHeight;
  return div;
}

function resizeAIQuestion() {
  const q = $('#aiQuestion'); if (!q) return;
  q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 120) + 'px';
}

function setAIChatOpen(open) {
  const widget = $('#aiChat'), fab = $('#aiFab');
  if (!widget) return;
  widget.classList.toggle('is-open', open);
  if (fab) { fab.setAttribute('aria-expanded', open ? 'true' : 'false'); fab.setAttribute('aria-label', open ? 'Fechar chat' : 'Abrir chat'); }
  if (open) setTimeout(() => $('#aiQuestion')?.focus(), 120);
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

function initAIChat() {
  const provider = $('#aiProvider'), model = $('#aiModel'), custom = $('#aiCustomModel'), key = $('#aiApiKey'),
        panel = $('#aiKeyPanel'), btn = $('#aiKeyBtn'), save = $('#aiSaveKey'), cancel = $('#aiCancelKey'),
        ask = $('#aiAskBtn'), question = $('#aiQuestion'), fab = $('#aiFab'), form = $('#chatForm');
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
    localStorage.setItem(PREFIXO + 'AIProvider', provider.value);
    localStorage.setItem(PREFIXO + 'AIModel', chosen);
    localStorage.setItem(PREFIXO + 'AIKey', key.value.trim());
    panel.hidden = true;
    appendAIMessage('bot', `Chave salva para ${AI_PROVIDERS[provider.value].label} / ${chosen}.`);
  };
  if (form) form.onsubmit = e => { e.preventDefault(); askAI(); };
  ask.onclick = e => { e.preventDefault(); askAI(); };
  question.addEventListener('input', resizeAIQuestion);
  question.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(); }   // Enter envia, Shift+Enter quebra linha
    if (e.key === 'Escape') setAIChatOpen(false);
  });
  resizeAIQuestion();
}
```

### CSS

```css
.ai-chat{position:fixed;right:24px;bottom:24px;z-index:360;display:flex;align-items:flex-end;gap:12px}
.chat-composer{position:relative;width:min(560px,calc(100vw - 112px));padding:2px;border-radius:999px;overflow:hidden;opacity:0;transform:translateX(14px) scale(.96);pointer-events:none;transition:opacity .32s ease,transform .32s ease}
.ai-chat.is-open .chat-composer{opacity:1;transform:translateX(0) scale(1);pointer-events:auto}
/* halo animado no foco — puramente decorativo, pode remover */
.chat-composer::before{content:"";position:absolute;inset:-120%;background:conic-gradient(from 0deg,transparent 0deg,transparent 42deg,rgba(174,191,222,.95) 86deg,rgba(227,10,18,.88) 128deg,rgba(12,31,85,.95) 178deg,rgba(174,191,222,.98) 226deg,transparent 286deg,transparent 360deg);filter:blur(10px);opacity:0;animation:auroraFlow 5.2s linear infinite;transition:opacity .32s ease}
.ai-chat.is-open .chat-composer:focus-within::before{opacity:1}
@keyframes auroraFlow{to{transform:rotate(360deg)}}
.chat-input-shell{position:relative;z-index:1;display:flex;align-items:center;gap:10px;width:100%;min-height:58px;padding:8px 8px 8px 13px;border-radius:999px;background:rgba(255,255,255,.96);border:1px solid rgba(174,191,222,.52);box-shadow:0 18px 44px rgba(12,31,85,.14),inset 0 1px 0 rgba(255,255,255,.9);backdrop-filter:blur(18px)}
.chat-textarea{position:relative;z-index:2;width:100%;min-height:28px;max-height:120px;border:0;outline:0;resize:none;overflow-y:auto;background:transparent;color:var(--navy);font-family:var(--font-body);font-size:15px;line-height:1.45;padding:5px 0}
.send-button,.chat-key-button{position:relative;z-index:2;flex:0 0 auto;border:0;border-radius:50%;cursor:pointer;display:grid;place-items:center;transition:transform .24s ease,background .24s ease,box-shadow .24s ease}
.send-button{width:42px;height:42px;background:var(--navy);color:#fff;box-shadow:0 10px 22px rgba(12,31,85,.24)}
.send-button:hover{background:var(--red);transform:translateY(-2px)}
.send-button:disabled{opacity:.58;cursor:progress}
.chat-key-button{width:34px;height:34px;background:rgba(12,31,85,.07);color:var(--navy)}
.chat-toggle{width:60px;height:60px;border:0;border-radius:50%;cursor:pointer;display:grid;place-items:center;background:linear-gradient(145deg,#0C1F55,#112B73);color:#fff;box-shadow:0 18px 36px rgba(12,31,85,.28);transition:transform .28s ease,background .28s ease;flex:0 0 auto}
.ai-chat.is-open .chat-toggle{background:var(--red);transform:rotate(90deg)}
.icon-close{display:none}
.ai-chat.is-open .icon-chat{display:none}
.ai-chat.is-open .icon-close{display:block}

.chat-popover{position:absolute;right:72px;bottom:72px;width:min(560px,calc(100vw - 112px));display:grid;gap:8px;opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .25s ease,transform .25s ease}
.ai-chat.is-open .chat-popover{opacity:1;transform:none;pointer-events:auto}
.chat-log{display:flex;flex-direction:column;gap:8px;max-height:min(320px,calc(100vh - 190px));overflow:auto}
.chat-log:empty{display:none}
.chat-log .ai-msg{position:relative;max-width:100%;font-size:12.5px;padding:10px 30px 10px 12px;box-shadow:0 12px 30px rgba(12,31,85,.16)}
.chat-log .ai-bot{background:rgba(255,255,255,.96);color:var(--navy);border:1px solid rgba(174,191,222,.52);border-radius:16px 16px 16px 5px}
.chat-log .ai-user{align-self:flex-end;color:#fff;background:linear-gradient(135deg,var(--navy-500),var(--navy));border-radius:16px 16px 5px 16px}
.ai-msg__body{white-space:pre-wrap;overflow-wrap:anywhere}
.ai-msg__body strong{font-weight:700}
.ai-msg__body code{font-family:var(--font-mono);font-size:11.5px;background:rgba(12,31,85,.08);border-radius:4px;padding:1px 4px}
.ai-msg__body pre{white-space:pre-wrap;font-family:var(--font-mono);font-size:11px;background:rgba(12,31,85,.07);border-radius:7px;padding:8px 10px;margin:6px 0}
.ai-user .ai-msg__body code,.ai-user .ai-msg__body pre{background:rgba(255,255,255,.18)}
.ai-copy{position:absolute;top:6px;right:6px;width:22px;height:22px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:inherit;opacity:.32;cursor:pointer;transition:opacity .15s ease,background .15s ease}
.ai-copy svg{width:13px;height:13px}
.ai-msg:hover .ai-copy{opacity:.8}
.ai-copy:hover{opacity:1;background:rgba(12,31,85,.09)}
.ai-copy.ok{opacity:1;color:var(--red)}
.ai-key-panel{display:grid;grid-template-columns:repeat(2,minmax(140px,1fr));gap:9px;padding:13px;border-radius:14px;background:rgba(255,255,255,.97);border:1px solid rgba(174,191,222,.52);box-shadow:0 18px 44px rgba(12,31,85,.14)}
.ai-key-panel[hidden]{display:none}
.ai-key-panel label{display:grid;gap:4px;font-family:var(--font-mono);font-size:10px;letter-spacing:.08em;color:var(--gray-600);text-transform:uppercase}
.ai-key-panel input,.ai-key-panel select{border:1px solid rgba(174,191,222,.62);border-radius:7px;background:#fff;color:var(--navy);padding:7px 9px;font-family:var(--font-body);font-size:12.5px}
@media(max-width:640px){.ai-chat{right:16px;bottom:16px;left:16px;gap:10px}.chat-composer{width:100%}.chat-popover{right:66px;bottom:66px;width:calc(100vw - 98px)}.ai-key-panel{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.chat-composer,.chat-toggle,.send-button{transition:none}.chat-composer::before{animation:none}}
```

---

## 8. Exportar a página em PDF (relatório)

Monta páginas A4 paisagem num palco invisível, transforma cada uma em imagem com `html2canvas` e junta no `jsPDF`. O PDF reflete **o recorte filtrado no momento do clique**.

### Como funciona

1. Um `#pdfStage` fora da tela, com largura fixa de **1123 px** (A4 paisagem a 96 dpi).
2. Cada página é uma `div.pdf-page` de 1123 × 794.
3. Os gráficos entram como imagem via `chart.toBase64Image()` — muito mais confiável que deixar o `html2canvas` capturar um `<canvas>` vivo.
4. `html2canvas` a `scale: 2` (nitidez de retina), depois JPEG a 92 % para o arquivo não explodir.

### HTML

```html
<div id="pdfStage" aria-hidden="true"></div>
<div class="pdf-overlay" id="pdfOverlay" hidden>
  <div class="pdf-overlay__box"><div class="spinner"></div><p class="mono" id="pdfStatus">GERANDO RELATÓRIO…</p></div>
</div>
```

### JS

```js
/* logo em data-URL: o html2canvas frequentemente não espera o carregamento de <img src="arquivo">
   e a capa sai sem marca. Converter uma vez, no início, resolve de vez. */
let LOGO_DATA = null;
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
    img.onerror = () => resolve();     // sem logo o relatório sai mesmo assim
    img.src = 'assets/logo-full.png';  // 👉 TROCAR
  });
}
ensureLogo();
const logoSrc = () => LOGO_DATA || 'assets/logo-full.png';

/* garante que toda imagem do palco terminou de decodificar antes da captura */
async function decodeStageImages(stage) {
  await Promise.all([...stage.querySelectorAll('img')].map(i => i.decode ? i.decode().catch(() => {}) : Promise.resolve()));
}

async function exportPdf() {
  const overlay = $('#pdfOverlay'), status = $('#pdfStatus');
  overlay.hidden = false;
  try {
    status.textContent = 'MONTANDO RELATÓRIO…';
    await ensureLogo();
    const stage = $('#pdfStage');
    stage.innerHTML = '';
    const today = new Date().toLocaleDateString('pt-BR');
    const title = ($('.top__title .editable-target')?.textContent || 'Meu Dashboard').trim();
    const chips = filtersSummaryText().split('  ·  ').map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('');

    // ---- capa ----
    const cover = document.createElement('div');
    cover.className = 'pdf-page pdf-cover';
    cover.innerHTML = `
      <div style="position:relative">
        <div style="display:inline-block;background:#fff;border-radius:12px;padding:14px 20px;margin-bottom:34px"><img src="${logoSrc()}" style="height:46px;display:inline" /></div>
        <div class="eyebrow">MINHA MARCA — RELATÓRIO EXECUTIVO</div>
        <h1>${escapeHtml(title)}</h1>
        <div class="pdf-filters">${chips}</div>
      </div>
      <div class="pdf-meta">
        <div>Documento<b>Relatório</b></div>
        <div>Emitido em<b>${today}</b></div>
        <div>Registros<b>${filtered.length}</b></div>
      </div>`;                                                    // 👉 TROCAR o conteúdo
    stage.appendChild(cover);

    // ---- página de síntese: KPIs + gráficos ----
    const p2 = document.createElement('div');
    p2.className = 'pdf-page';
    p2.innerHTML = `<div class="pdf-h"><span class="n">01</span><h2>Síntese</h2></div>
      <div class="pdf-kpis">
        <div class="k"><span>REGISTROS</span><b>${filtered.length}</b></div>
        <div class="k accent"><span>TOTAL</span><b>${fmtInt(totalDoRecorte())}</b></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><p class="mono" style="font-size:10px;letter-spacing:.14em;color:#566076;margin-bottom:8px">GRÁFICO 1</p><img class="pdf-img" src="${chart1.toBase64Image('image/png', 1)}" /></div>
        <div><p class="mono" style="font-size:10px;letter-spacing:.14em;color:#566076;margin-bottom:8px">GRÁFICO 2</p><img class="pdf-img" src="${chart2.toBase64Image('image/png', 1)}" /></div>
      </div>
      <div class="pdf-foot"><span>Minha Marca</span><span>${today} · pág. 2</span></div>`;   // 👉 TROCAR
    stage.appendChild(p2);

    // ---- tabela paginada: 16 linhas por página cabem no A4 paisagem ----
    const rows = linhasOrdenadas();          // 👉 TROCAR
    const perPage = 16;
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    for (let p = 0; p < pages; p++) {
      const chunk = rows.slice(p * perPage, (p + 1) * perPage);
      const pg = document.createElement('div');
      pg.className = 'pdf-page';
      pg.innerHTML = `<div class="pdf-h"><span class="n">02</span><h2>Detalhamento ${pages > 1 ? `· ${p + 1}/${pages}` : ''}</h2></div>
        <table class="pdf-table"><thead><tr><th>CAMPO A</th><th>CAMPO B</th><th class="r">VALOR</th></tr></thead>
        <tbody>${chunk.map(r => `<tr>
          <td><b>${escapeHtml(r.campoA)}</b></td>
          <td>${escapeHtml(r.campoB || '—')}</td>
          <td class="r">${fmtInt(r.valor)}</td>
        </tr>`).join('')}</tbody></table>
        <div class="pdf-foot"><span>Minha Marca</span><span>${today} · pág. ${p + 3}</span></div>`;
      stage.appendChild(pg);
    }

    // ---- renderizar ----
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await decodeStageImages(stage);
    const pagesEls = [...stage.children];
    for (let i = 0; i < pagesEls.length; i++) {
      status.textContent = `RENDERIZANDO PÁGINA ${i + 1}/${pagesEls.length}…`;
      const canvas = await html2canvas(pagesEls[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, 297, 210);   // A4 paisagem em mm
    }
    pdf.save(`Relatorio_${new Date().toISOString().slice(0, 10)}.pdf`);
    stage.innerHTML = '';
  } catch (err) {
    console.error(err);
    alert('Falha ao gerar o PDF: ' + err.message);
  } finally {
    overlay.hidden = true;      // o finally é obrigatório: erro sem ele deixa o overlay travado
  }
}
$('#btnExportPdf').onclick = exportPdf;
```

### CSS do PDF

```css
#pdfStage{position:fixed;left:-99999px;top:0;width:1123px;background:#fff}
.pdf-page{width:1123px;min-height:794px;background:#fff;position:relative;padding:46px 54px;font-family:var(--font-body);color:var(--ink);display:flex;flex-direction:column}
.pdf-cover{background:var(--navy);color:#fff;justify-content:space-between}
.pdf-cover h1{position:relative;font-family:var(--font-display);font-weight:800;font-size:54px;line-height:1.02;margin-top:18px}
.pdf-cover .eyebrow{position:relative;font-family:var(--font-mono);font-size:12px;letter-spacing:.24em;color:#AEBFDE}
.pdf-cover .pdf-meta{position:relative;display:flex;gap:44px;border-top:1px solid var(--hair-dark);padding-top:22px}
.pdf-cover .pdf-meta div{font-family:var(--font-mono);font-size:11.5px;color:#AEBFDE;line-height:1.8}
.pdf-cover .pdf-meta b{display:block;color:#fff;font-weight:500}
.pdf-filters{position:relative;margin-top:26px;display:flex;flex-wrap:wrap;gap:8px}
.pdf-filters .chip{font-family:var(--font-mono);font-size:10.5px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.24);border-radius:999px;padding:6px 13px;color:#fff}
.pdf-h{display:flex;align-items:baseline;gap:14px;border-bottom:1px solid var(--hair);padding-bottom:12px;margin-bottom:22px}
.pdf-h .n{font-family:var(--font-mono);font-size:12px;color:var(--red)}
.pdf-h h2{font-family:var(--font-display);font-weight:700;font-size:24px;color:var(--navy)}
.pdf-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:26px}
.pdf-kpis .k{border:1px solid var(--hair);border-radius:10px;padding:13px 15px}
.pdf-kpis .k span{font-family:var(--font-mono);font-size:9px;letter-spacing:.14em;color:var(--gray-600)}
.pdf-kpis .k b{display:block;font-family:var(--font-display);font-size:23px;color:var(--navy);margin-top:5px}
.pdf-kpis .k.accent b{color:var(--red)}
.pdf-img{width:100%;border:1px solid var(--hair);border-radius:10px}
.pdf-foot{position:absolute;left:54px;right:54px;bottom:20px;display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:9.5px;color:var(--gray-400);border-top:1px solid var(--hair);padding-top:8px}
.pdf-table{width:100%;border-collapse:collapse;font-size:10.5px}
.pdf-table th{background:var(--navy);color:#fff;font-family:var(--font-mono);font-weight:500;font-size:8.5px;letter-spacing:.1em;padding:8px 9px;text-align:left}
.pdf-table th.r{text-align:right}
.pdf-table td{padding:6.5px 9px;border-bottom:1px solid var(--hair);font-family:var(--font-mono);font-size:9.5px}
.pdf-table td.r{text-align:right}
.pdf-table tr:nth-child(even) td{background:#F8FAFC}
.pdf-overlay{position:fixed;inset:0;z-index:500;background:rgba(12,31,85,.55);backdrop-filter:blur(4px);display:grid;place-items:center}
.pdf-overlay[hidden]{display:none}
.pdf-overlay__box{background:#fff;border-radius:14px;padding:30px 40px;display:grid;place-items:center;gap:16px;box-shadow:0 30px 80px rgba(0,0,0,.35)}
.spinner{width:34px;height:34px;border-radius:50%;border:3px solid var(--hair);border-top-color:var(--red);animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
```

### Números que não são arbitrários

| Valor | Por quê |
|---|---|
| `1123 × 794` px | A4 paisagem a 96 dpi. Mudou para retrato? `794 × 1123` e `addImage(..., 210, 297)`. |
| `297 × 210` mm | A4 paisagem em milímetros, no `addImage`. |
| `scale: 2` | Nitidez em tela retina. `3` dobra o tempo e o tamanho sem ganho visível. |
| `jpeg, .92` | PNG deixa o arquivo 4–5× maior sem diferença perceptível em página com texto. |
| 16 linhas/página | Cabe no A4 paisagem com esse tamanho de fonte. Ajuste se mudar a tipografia. |
| `useCORS: true` | Sem isso, imagem de outro domínio sai em branco. |

---

## 9. Exportar apresentação em PDF (slides)

Mesma máquina do §8, propósito diferente: em vez de uma tabela longa, **um slide por recorte** — por região, por faixa, por segmento. É o material que vai para a reunião.

A estrutura que funciona é uma lista de **blocos**, cada bloco com seus **cortes**:

```js
async function exportDeck() {
  const overlay = $('#pdfOverlay'), status = $('#pdfStatus');
  overlay.hidden = false;
  try {
    await ensureLogo();
    const stage = $('#pdfStage');
    stage.innerHTML = '';
    const periodo = periodoLabel();      // 👉 TROCAR: rótulo do recorte atual

    // ---- 👉 TROCAR: defina os blocos do SEU domínio ----
    const regioes  = [...new Set(filtered.map(r => r.regiao))].sort();
    const segmentos = [...new Set(filtered.map(r => r.segmento))].sort();
    const blocks = [];
    if (filtered.length) blocks.push({
      num: '01', title: 'Regiões', desc: `Distribuição por região · ${periodo}`,
      scope: filtered,
      cuts: regioes.map(x => ({ title: x, sub: 'Região', emps: filtered.filter(r => r.regiao === x) })),
    });
    if (filtered.length) blocks.push({
      num: '02', title: 'Segmentos', desc: `Distribuição por segmento · ${periodo}`,
      scope: filtered,
      cuts: segmentos.map(x => ({ title: x, sub: 'Segmento', emps: filtered.filter(r => r.segmento === x) })),
    });

    // ---- montagem: capa, divisória de bloco, um slide por corte ----
    let pagina = 1;
    // (capa igual à do §8)
    blocks.forEach(b => {
      const divisoria = document.createElement('div');
      divisoria.className = 'pdf-page';
      divisoria.innerHTML = `<div class="pdf-h"><span class="n">${b.num}</span><h2>${escapeHtml(b.title)}</h2></div>
        <p class="mono">${escapeHtml(b.desc)}</p>
        ${deckKpisHtml(b.scope)}
        ${deckFoot(++pagina, periodo)}`;
      stage.appendChild(divisoria);

      b.cuts.forEach(cut => {
        if (!cut.emps.length) return;              // corte vazio não vira slide
        const pg = document.createElement('div');
        pg.className = 'pdf-page';
        pg.innerHTML = `<div class="pdf-h"><span class="n">${escapeHtml(cut.sub)}</span><h2>${escapeHtml(cut.title)}</h2></div>
          ${deckKpisHtml(cut.emps)}
          ${deckTableHtml(cut.emps, 11)}
          ${deckFoot(++pagina, periodo)}`;
        stage.appendChild(pg);
      });
    });

    // ---- renderizar: idêntico ao §8 ----
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await decodeStageImages(stage);
    const pagesEls = [...stage.children];
    for (let i = 0; i < pagesEls.length; i++) {
      status.textContent = `RENDERIZANDO SLIDE ${i + 1}/${pagesEls.length}…`;
      const canvas = await html2canvas(pagesEls[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, 297, 210);
    }
    pdf.save(`Apresentacao_${new Date().toISOString().slice(0, 10)}.pdf`);
    stage.innerHTML = '';
  } catch (err) { console.error(err); alert('Falha ao gerar a apresentação: ' + err.message); }
  finally { overlay.hidden = true; }
}
$('#btnExportDeck').onclick = exportDeck;
```

Os três auxiliares que se repetem em todo slide — escreva uma vez, use em todos:

```js
function deckKpisHtml(registros) {                 // 👉 TROCAR os KPIs
  return `<div class="pdf-kpis" style="grid-template-columns:repeat(4,1fr)">
    <div class="k"><span>REGISTROS</span><b>${registros.length}</b></div>
    <div class="k"><span>TOTAL</span><b>${fmtInt(registros.reduce((s, r) => s + (r.valor || 0), 0))}</b></div>
    <div class="k"><span>CATEGORIAS</span><b>${new Set(registros.map(r => r.categoria).filter(Boolean)).size}</b></div>
    <div class="k accent"><span>MÉDIA</span><b>${fmtDec(registros.reduce((s, r) => s + (r.valor || 0), 0) / (registros.length || 1), 1)}</b></div>
  </div>`;
}

function deckTableHtml(registros, max = 11) {      // 👉 TROCAR as colunas
  const rows = [...registros].sort((a, b) => (b.valor || 0) - (a.valor || 0));
  const shown = rows.slice(0, max);
  return `<table class="pdf-table"><thead><tr><th>NOME</th><th>CATEGORIA</th><th class="r">VALOR</th></tr></thead>
    <tbody>${shown.map(r => `<tr><td><b>${escapeHtml(r.nome)}</b></td><td>${escapeHtml(r.categoria || '—')}</td><td class="r">${fmtInt(r.valor)}</td></tr>`).join('')}</tbody></table>
    ${rows.length > max ? `<p class="mono" style="font-size:9.5px;color:#566076;margin-top:8px">+ ${rows.length - max} registro(s) — lista completa no dashboard.</p>` : ''}`;
}

function deckFoot(page, periodo) {
  return `<div class="pdf-foot"><span>Minha Marca · ${escapeHtml(periodo)}</span><span>pág. ${page}</span></div>`;   // 👉 TROCAR
}
```

**Regras que fazem a apresentação ser apresentável:**

- **Um assunto por slide.** Se precisou rolar, virou relatório.
- **Corte vazio não vira slide.** Nada mata mais rápido uma apresentação do que quatro slides seguidos escritos "sem registros".
- **Máximo ~11 linhas por tabela**, com "+ N registros" no rodapé. O slide dá a leitura; o detalhe está no dashboard.
- **Numere as páginas desde a montagem** (`++pagina`), não depois. Reordenar blocos depois quebra a numeração.

---

## 10. Ordem de inicialização

No fim do `app.js`, nesta ordem:

```js
buildFilters();          // 👉 monta os filtros a partir dos dados
initCharts();            // 👉 cria os gráficos vazios (ou deixe o applyAll criar)
applyAll();              // primeiro render completo
initEditableText();      // §4.1 — depois do render: precisa dos textos já na tela
initAIChat();            // §7
initSettingsPanel();     // §4  — depois do initEditableText: aplica o estado do lápis
initExpandir();          // §3  — por último: varre .card já montados
ligarLarguras('minhaTabelaEstatica');   // §6 — tabelas com <thead> fixo no HTML
```

**A ordem não é decorativa.** `initSettingsPanel` aplica `edits-locked` sobre os lápis que o `initEditableText` acabou de criar; `initExpandir` varre os `.card` que já existem. Inverter faz o dashboard abrir com preferência ignorada.

Tabelas desenhadas por `innerHTML` religam `ligarOrdenacao` + `ligarLarguras` dentro da própria função de render. Só tabelas com `<thead>` escrito no HTML precisam da chamada aqui.

---

## 11. Camada PORTAL no mapa (coordenadas do Portal da Inteligência)

`data/portal_coordenadas.js` é um **snapshot manual** (`window.OF_PORTAL_COORDS` = `[idPortal, [[lat,lng],...]]`) dos vértices cadastrados na seção "Coordenadas" de cada empreendimento do Portal da Inteligência — não vem do pipeline (o pipeline fala com o SQL Server; o portal precisa de login próprio). Fluxo de atualização: exportar os vértices do portal (login BOT1-DS) e regerar o arquivo.

- O front casa pelo `idPortal` com os registros do dashboard (`empreendimentos` + `semPrevisao`); registro sem correspondência não desenha.
- Camada `PORTAL` (checkbox no seletor do mapa, nasce desligada): contornos em verde-teal, sempre **no recorte dos filtros ativos** — sem filtro, mostra todos; mesma regra das camadas KMZ (`anyFilterActive` + ids de `filtered` + `semDataFiltrados`).
- O arquivo é servido pela API protegida: o nome precisa estar na whitelist de `api/secure-data.js`.
- Portal grava vértices com **vírgula decimal** (binder pt-BR) e rejeita o vértice de fechamento duplicado — já normalizado no snapshot (ponto → vírgula invertida ao exportar; dedupe do último = primeiro).

## 12. Checklist de montagem

Ao criar um dashboard novo:

- [ ] Estrutura de pastas do §1 e as libs de CDN com **versão fixa**
- [ ] `?v=` em todo CSS, JS e arquivo de dados
- [ ] Fundação do §2 no topo do `app.js`
- [ ] `PREFIXO` de `localStorage` **único por dashboard** — dois dashboards no mesmo domínio com o mesmo prefixo trocam preferências entre si
- [ ] Tokens de cor da §2 trocados para a marca
- [ ] Todo painel na forma `.card > .card__head + conteúdo`
- [ ] `escapeHtml` em **todo** texto de dado que entra em `innerHTML`
- [ ] `applyAll()` como único ponto de re-render
- [ ] Ordem de inicialização do §10
- [ ] Nenhuma chave de API no código-fonte
- [ ] Endpoint SQL somente leitura, com CORS restrito e limite de linhas
- [ ] Prompt do sistema descrevendo o **grão** e as armadilhas de dupla contagem
- [ ] Testar o expandir/restaurar de cada card e conferir se o grid volta ao normal
- [ ] Gerar os dois PDFs com filtro aplicado e com filtro limpo
- [ ] Console sem nenhum erro

---

## 13. Princípios que valem mais que o código

Cinco coisas aprendidas no Oferta Futura, custando tempo real:

**1. Campo vazio é campo vazio.** Nunca use `valor || 'ALGUMA COISA'` para exibir dado. A ficha do Oferta Futura mostrou `FONTE: PROJETO` para 48 de 87 registros por causa de um `|| 'PROJETO'` — e havia um registro em que `PROJETO` era o valor verdadeiro, então não dava para distinguir olhando a tela. O fallback de exibição é sempre `—`. Para categoria, use um balde explícito de desconhecido (`SEM CATEGORIA INFORMADA`), nunca uma categoria real.

**2. Nunca rateie o que você não sabe.** Se falta a quebra de um mês, jogue o total num balde de desconhecido. Distribuir pela participação das outras categorias produz um gráfico bonito, com total correto e distribuição inventada. É o pior tipo de erro: convincente.

**3. Um campo responde uma pergunta só.** `FonteDataLancamento` diz *de onde veio a data*, não *se lançou*. Lê-lo como status fez o dashboard afirmar 19 lançados quando eram 35. Antes de usar um campo para uma pergunta nova, confirme que ele responde exatamente essa pergunta.

**4. Cache silencioso mente.** Arquivo de dados sem `?v=` novo faz o dashboard mostrar a base da semana passada, sem erro, sem aviso. Carimbe sempre.

**5. Guarda de sanidade no pipeline.** Se a nova carga tem 10 % menos registros que a anterior, **aborte e não publique**. Deixe uma variável de escape para quando a queda for real e conhecida, e imprima os parâmetros das duas execuções na mensagem de erro — quem lê precisa saber na hora se a queda era esperada.

---

*Referência viva: `oferta-futura/` — todos os trechos aqui foram extraídos de código em produção. O `README.md` daquele repositório documenta os tratamentos de dados e as decisões de modelagem.*
