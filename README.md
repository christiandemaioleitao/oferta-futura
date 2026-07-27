# Oferta Futura — Dashboard EBM Inteligência

Dashboard de acompanhamento da **oferta futura de empreendimentos imobiliários em Goiânia**, no design system do **Manual de Marca EBM Inteligência v1.0** (Azul EBM `#0C1F55`, Vermelho Inteligência `#E30A12`, Sora + IBM Plex Sans/Mono e o grafismo de rede de nós).

Publicado em <https://oferta-futura.vercel.app>. Substitui e evolui o `BI Oferta Futura.pbix`: slicers → filtros, azureMap → Leaflet, tableEx → radar, tooltip → ficha, lineChart → oferta por mês, pivotTable → matriz de tipologias, cards → KPIs.

---

## Como rodar localmente

Site estático, sem build:

```bash
python -m http.server 8123
```

Abrir <http://localhost:8123>. Precisa de internet para as bibliotecas (Leaflet, Chart.js, SheetJS, JSZip, jsPDF) e os tiles do mapa. O chat de IA e a camada "sem previsão" chamam a função `/api/sql` publicada na Vercel — em localhost elas apontam para o domínio de produção.

---

## Arquitetura

```
index.html                 aplicação (single page)
css/style.css              design system
js/app.js                  filtros, mapa, gráficos, PDF, imports, chat, edição
api/sql.js                 função serverless: consulta somente-leitura ao Neon
data/dados_of.js           window.OF_DATA   — empreendimentos + tipologias + série mensal
data/mapa_of.js            window.OF_MAPA   — GeoJSON dos terrenos/pontos do KMZ
data/bairros_of.js         window.OF_BAIRROS — polígonos dos bairros já coloridos
scripts/pipeline_of.py     pipeline: SQL Server + Neon → projeção → Neon + data/
scripts/preprocess.py      monta data/dados_of.js e data/mapa_of.js
scripts/of_common.py       conexões e utilitários compartilhados
scripts/upload_sintese.py  sobe a planilha da síntese para o Neon (uso pontual)
scripts/gen_bairros.py     converte o KMZ de bairros em data/bairros_of.js (sob demanda)
fontes/                    arquivos originais (KMZ, xlsx, pbix, referências de design)
.github/workflows/pipeline-of.yml   execução mensal e manual do pipeline
```

**Fluxo dos dados:**

```
SQL Server (Portal Inteligência)  ─┐
                                   ├─► pipeline_of.py ─► Neon (projecao_of) ─► /api/sql ─► chat de IA
Neon (sintese_consolidada) ────────┘         │
                                             └─► preprocess.py ─► data/*.js ─► dashboard
```

O dashboard lê os arquivos `data/*.js` (rápido, sem servidor). O chat de IA consulta o **Neon direto**, porque precisa de recortes que o JSON pré-agregado não tem.

---

## Pipeline automatizado

Workflow *Pipeline Oferta Futura* (GitHub Actions), **todo dia 30 às 06:00 de Brasília** (`cron: 0 9 30 * *`), ou manualmente em *Actions → Run workflow*.

> Fevereiro não tem dia 30 — nesse mês, rodar manualmente.

Etapas:

1. Lê os empreendimentos do **SQL Server** (tipologias e cadastros ativos, regional GO).
2. Lê a **síntese consolidada do Neon** (histórico de vendas do mercado).
3. Calcula as curvas de venda por cluster, projeta 18 meses de oferta futura e estende a síntese.
4. Grava a master no Neon (`projecao_of`) e a lista de terrenos sem data (`empreendimentos-sem-previsão-lançamento`).
5. Regenera `data/dados_of.js` e `data/mapa_of.js`, commita, e a Vercel publica sozinha.

### Parâmetros

| Variável | Padrão | O que faz |
|---|---|---|
| `OF_LANCTO_INI` | `01/2026` | início da janela de lançamentos considerada |
| `OF_LANCTO_FIM` | `12/2027` | fim da janela |
| `DATA_FIM_PROJ` | `06/2027` | até quando estender a projeção da síntese |
| `FATOR_AJUSTE` | `1.0` | multiplicador aplicado à curva de vendas |
| `OF_IGNORAR_QUEDA` | — | `1` libera a guarda de sanidade (ver abaixo) |

### Credenciais

Secrets do Actions (*Settings → Secrets and variables → Actions*): `NEON_DATABASE_URL`, `SQLSERVER_HOST`, `SQLSERVER_DB`, `SQLSERVER_USER`, `SQLSERVER_PASSWORD`.

Na Vercel, a função `/api/sql` usa `DATABASE_URL` (mesma string do Neon), configurada em *Project → Settings → Environment Variables*.

Localmente, um `.env` na raiz (ignorado pelo git) — ver `.env.example`.

### Guarda de sanidade

Antes de gravar, o pipeline compara o número de empreendimentos da janela com o da execução anterior (guardado em `of_meta`). **Queda maior que 10% aborta a execução.**

Isso existe porque uma rodada com janela errada derruba dezenas de projetos sem erro nenhum — o dashboard simplesmente aparece com metade da base. Se a queda for real, rodar de novo com `OF_IGNORAR_QUEDA=1`.

### Regenerar à mão

```bash
python scripts/pipeline_of.py
```

Ou, a partir de um Excel já pronto no esquema da master:

```bash
python scripts/preprocess.py "fontes/Projecao_OF.xlsx" "fontes/Oferta Futura - 2026.kmz"
```

---

## Tratamento de dados — as peculiaridades

Esta seção existe porque quase todo bug de número neste projeto veio de um destes pontos.

### 1. A tabela `projecao_of` tem dois grãos misturados

| | `id_tipologia` | Grão | O que é |
|---|---|---|---|
| **Oferta futura** | preenchido | tipologia × mês | projeção dos lançamentos da janela |
| **Síntese de mercado** | `NULL` | produto × mês | histórico + projeção dos empreendimentos já no mercado |

**Toda consulta precisa escolher um lado.** Somar as duas partes mistura projeção com histórico.

### 2. Cada tipologia se repete em ~18 linhas

A projeção gera uma linha por mês de vida do produto. Somar `Unids_tipologia` ou `TotalUnidades` sem filtrar multiplica tudo por ~18 — foi assim que o chat de IA já respondeu "90.036 unidades" onde o certo era 5.002.

Padrões corretos:

```sql
-- unidades lançadas por incorporadora em 2027
SELECT incorporadora, SUM("Unids_tipologia") AS unidades
FROM projecao_of
WHERE id_tipologia IS NOT NULL AND lancamento = 'sim'
  AND EXTRACT(YEAR FROM "dtlançamento") = 2027
GROUP BY 1 ORDER BY unidades DESC;

-- oferta disponível por mês
SELECT data, SUM(unidadesdisponiveis)
FROM projecao_of WHERE id_tipologia IS NOT NULL GROUP BY data;

-- total de unidades de um empreendimento: MAX, nunca SUM
SELECT empreendimento, MAX("TotalUnidades") FROM projecao_of GROUP BY 1;
```

`lancamento = 'sim'` marca a linha do mês de lançamento — é o filtro que reduz o produto ao seu registro único.

### 3. `tipologia_tratada`: 0 é comercial, não "sem dado"

O cadastro grava a tipologia como texto livre (`3Q c/1S`, `>4S`, `STUDIO`). O pipeline converte para número de quartos por um dicionário (`MAPA_TIPOLOGIA`), com estas regras:

- `STUDIO` e `1Q` → 1; variantes de 4 quartos e `>4S` → 4 (teto em 4).
- **`PerfilTipologia` nulo cai para `NumeroQuartos`** (cadastro incompleto), limitado a 4.
- **`0` significa comercial de verdade** — sala, loja, lote. Não é ausência de dado.

Por isso a limpeza de zeros nunca é aplicada à coluna `tipologia`: apagar o `0` destruiria o marcador de comercial. Nas linhas da síntese, `tipologia_tratada` vem da coluna numérica `tipologia` da própria síntese.

### 4. Data de lançamento: real com fallback para previsão

`dtlançamento = DataLancamento` e, se nulo, `DataPrevisaoLancamento`. Ambas normalizadas para o **dia 1 do mês** — todo o dashboard raciocina em meses, nunca em dias.

Cadastro sem nenhuma das duas datas **fica fora da projeção** e vai para a tabela `empreendimentos-sem-previsão-lançamento`, exibida no dashboard só quando o usuário liga o checkbox *SEM PREVISÃO*.

### 5. Nulos: uma única normalização no fim

As três origens (SQL Server, Excel, síntese) escrevem vazio de jeitos diferentes: `NaN`, `'nan'`, `''`, `'-'`, `'None'`. A função `aplicar_ajustes_finais` converte tudo para `NULL` de verdade numa passada só — sem isso, `IS NULL` no Postgres não encontra nada e o chat responde errado.

**O `0` só conta como vazio nas colunas listadas em `COLS_ZERO_VAZIO`** (observação, logradouro, protocolo, IPTU…), onde o cadastro grava literalmente zero para "não informado". Fora dessa lista, zero é dado.

> Histórico: um `fillna(0)` global no merge das curvas zerava datas e flags de projeto. A ficha exibia `0` como data de protocolo em 28 dos 93 empreendimentos, e `projetoProtocolado` virava `false` nos mesmos 28. O `fillna` hoje é aplicado só às 18 colunas de curva.

### 6. Datas-texto num formato único

`DataProtocoloProjeto`, `DataAprovacao` e afins trafegam como texto. A síntese entregava `2024-12-18 00:00:00` e o SQL Server `2024-11-13` — dois formatos na mesma ficha. O pipeline normaliza todas para ISO `AAAA-MM-DD`.

Regra da ficha: **sem data de protocolo, a aprovação fica em branco**; com protocolo e sem aprovação, mostra "Em análise".

### 7. `macrozona` é texto, e vinha em dois formatos

SQL Server devolve `'1005'`, a síntese devolve `'1005.0'` (a coluna é numérica lá). Sem normalizar, o mesmo território vira dois grupos num `GROUP BY`. O pipeline remove o `.0` na gravação; o front ainda exibe como `MZ 1005`.

### 8. Nomes de bairro: prefixo removido dos dois lados

Os dados dizem `SETOR SUL` e `JARDIM GOIÁS`; o KMZ diz `SUL` e `GOIÁS`. A função `bairroKey()` remove recursivamente prefixos genéricos (`SETOR`, `JARDIM`, `VILA`, `PARQUE`, `RESIDENCIAL`, `CHÁCARA`, `DA/DO/DE`…) dos dois lados antes de comparar. Acentuação é removida por `textKey()` via `NFD` + faixa `̀-ͯ` — mantida **escapada** no código de propósito: escrita com os caracteres combinantes literais, ela é invisível e qualquer re-encoding a quebra em silêncio.

### 9. Chaveamento KMZ ↔ empreendimento, em dois passos

Cada geometria do KMZ recebe um `_empId`:

1. **Vínculo forte** — marcador do empreendimento dentro do polígono, ou nome exato (normalizado). Vincula e "reserva" aquele empreendimento.
2. **Proximidade** — só para geometrias que sobraram, e **só com empreendimentos ainda não reservados** (raio de 300 m para polígono, 250 m para ponto).

A reserva do passo 1 é o que impede um terreno sem cadastro de roubar a ficha do vizinho: o polígono `QD 15, PEDRO LUDOVICO - TERRAL` ficava a 170 m do `QD 21 - WV MALDI` e exibia a ficha errada.

Geometria que não casa com ninguém aparece sem ficha — melhor que ficha errada.

### 10. Médias de venda do mercado

- **Média mensal:** entre os projetos históricos dos mesmos *clusters* dos empreendimentos filtrados, `unidades vendidas ÷ meses de comercialização`.
- **Média deflacionada:** mesma conta ignorando os 3 primeiros meses após o lançamento (tira o pico).
- **Clusters:** `apart-map-1Q` a `apart-map-4Qmaior` (por nº de quartos), `apart-eco`, `outros`. É o cluster que liga um empreendimento novo à curva de venda do mercado.

### 11. Ponto vermelho e LTM

O ponto vermelho do gráfico é o **mês de referência** (mês atual), como o `PontoMesReferencia` do BI. No modo LTM, cada ponto é a soma móvel dos 12 meses anteriores.

---

## Funcionalidades

| | |
|---|---|
| **Filtros** | Período, bairro, incorporadora, tipo, tipologia, macrozona e faixa de m² (multi-seleção com busca; "selecionar todos" respeita a busca). Tudo recalcula em tempo real. |
| **Mapa** | Leaflet com empreendimentos (EBM em azul, demais em vermelho), terrenos e localizações do KMZ, bairros coloridos e camada de satélite. Com filtro ativo, só aparecem as geometrias dos empreendimentos filtrados. |
| **Sem previsão** | Checkbox que traz do Neon os terrenos monitorados **sem data de lançamento**: marcadores cinza, linhas no radar e ficha completa. |
| **Gráficos** | Oferta disponível por mês e lançamentos por mês (Mês/Tri/Ano/LTM). O botão **Detalhado** quebra os dois por nº de quartos (1Q–4Q e comercial); a tooltip lista os empreendimentos do período com suas unidades. |
| **Radar** | Tabela com busca e ordenação. Clique no **nome** abre a ficha; clique na **linha** centraliza o empreendimento no mapa. |
| **Ficha** | Origem e produto, tipologias, protocolo → aprovação com tempo decorrido, endereço, pavimentos e fonte. |
| **Exportar** | PDF (relatório), PDF Apresentação (deck por macrozona/faixa/segmento), Excel (5 abas) e KMZ — todos respeitando os filtros. |
| **Importar** | Excel no esquema da master e KMZ/KML do Google Earth, reconstruindo o dashboard no navegador. |
| **Chat de IA** | Consulta o Neon: o modelo escreve o SQL, o dashboard executa via `/api/sql` e devolve as linhas (até 3 consultas encadeadas). Suporta OpenAI, Anthropic, Gemini, Mistral, DeepSeek, Groq, Together e OpenRouter, com campo para digitar qualquer id de modelo. |
| **Edição ✎** | Títulos e textos editáveis (senha `123`), persistidos no `localStorage`. O dock de configurações liga/desliga os lápis e os rótulos dos gráficos. |

### Segurança

- **Nunca commitar chave de API em `js/app.js`** — o arquivo é servido ao navegador. A chave do chat é do usuário e fica só no `localStorage` dele.
- `/api/sql` aceita apenas `SELECT`/`WITH`, uma instrução por chamada, no máximo 200 linhas, e só responde às origens do próprio site.
- A senha `123` protege a edição de textos no navegador; não é controle de acesso.
