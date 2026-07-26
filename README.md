# Oferta Futura — Dashboard EBM Inteligência

Dashboard web de acompanhamento da **oferta futura de empreendimentos imobiliários em Goiânia**, construído com o design system do **Manual de Marca EBM Inteligência v1.0** (Azul EBM `#0C1F55`, Vermelho Inteligência `#E30A12`, tipografia Sora + IBM Plex Sans/Mono e o grafismo de rede de nós).

## Como usar

É um site estático — basta abrir o `index.html` em um navegador (ou servir a pasta):

```bash
python -m http.server 8123
# abrir http://localhost:8123
```

> Requer internet para carregar as bibliotecas (Leaflet, Chart.js, SheetJS, JSZip, jsPDF) e os tiles do mapa.

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| **Filtros** | Período de lançamento, macrozona, bairro, incorporadora, tipo, tipologia e faixa de m² (multi-seleção com busca). Tudo recalcula em tempo real: KPIs, mapa, gráficos, matriz e tabela. |
| **Exportar PDF** | Botão *Exportar PDF* gera relatório A4 paisagem respeitando os filtros ativos: capa com logo + chips de filtros, página de síntese (KPIs + gráficos) e radar paginado. |
| **PDF Apresentação** | Botão *PDF Apresentação* gera um deck de slides: capa "Oferta Futura GO" com o período filtrado, e três blocos — 1 slide por **macrozona**, 1 por **faixa de metragem** (segmento Apart-MAP) e 1 por **segmento** — cada bloco aberto por um slide com o **mapa dos terrenos** daquele recorte. |
| **Exportar Excel** | Botão *Exportar Excel* baixa um `.xlsx` com os dados filtrados em 5 abas: Resumo (KPIs + filtros), Radar, Tipologias, Oferta mensal e Oferta por empreendimento. |
| **Exportar KMZ** | Botão *Exportar KMZ* baixa o mapa **conforme o filtro**: marcadores dos empreendimentos filtrados + terrenos e localizações do KMZ vinculados a eles (abre no Google Earth/Maps). |
| **Importar Excel** | Botão *Importar Excel* lê a base `Projecao_OF.xlsx` (mesmo esquema de colunas) e reconstrói todo o dashboard no navegador. |
| **Importar KMZ** | Botão *Importar KMZ* lê o `.kmz`/`.kml` (Google Earth) e redesenha terrenos (polígonos) e localizações (pontos) com as cores originais. |
| **Mapa georreferenciado** | Leaflet com 3 camadas: empreendimentos da oferta futura (filtráveis, popup com ficha), terrenos do KMZ e localizações do KMZ. Cada geometria do KMZ é **vinculada ao empreendimento** (polígono que contém o ponto, nome igual ou proximidade ≤300 m): com filtro ativo, o mapa mostra apenas os terrenos/localizações dos empreendimentos filtrados. |
| **Radar de empreendimentos** | Tabela no novo design (links de portal/projeto, ordenação por coluna, busca). Clique no **nome do empreendimento** abre a ficha; `ESC` fecha. |
| **Ficha do empreendimento** | Tooltip no novo design: origem e produto, tipologias, protocolo → aprovação com tempo decorrido, endereço, pavimentos e fonte. |
| **Edição pelo lápis ✎** | Títulos e textos têm lápis de edição (portado do leadsebm2.0). Senha: `123`. As edições persistem no `localStorage`. |
| **Chat de IA** | Botão flutuante abre o chat (portado do leadsebm2.0). Suporta OpenAI, Anthropic, Gemini, Mistral, DeepSeek, Groq, Together e OpenRouter. A IA responde com base no contexto JSON do dashboard **já filtrado**. Chave própria via botão de chave (senha `123`). |

## Estrutura

```
index.html          aplicação (single page)
css/style.css       design system (manual de marca)
js/app.js           lógica: filtros, mapa, gráficos, PDF, imports, chat IA, lápis
data/dados_of.js    base pré-processada (empreendimentos OF + histórico de mercado)
data/mapa_of.js     GeoJSON do KMZ (395 geometrias)
assets/             logos oficiais EBM Inteligência
scripts/preprocess.py    regenera data/ a partir do .xlsx e .kmz
scripts/pipeline_of.py   pipeline automatizado (SQL Server + Neon → projeção → Neon + data/)
scripts/upload_sintese.py  sobe a planilha da síntese para o Neon
fontes/             arquivos originais (xlsx, kmz, pbix, designs de referência)
.github/workflows/pipeline-of.yml  execução diária/manual do pipeline
```

## Pipeline automatizado de dados

O dashboard é atualizado **sem intervenção manual** pelo workflow *Pipeline Oferta Futura* (GitHub Actions — diário às 06:00 de Brasília, ou manual em *Actions → Run workflow*, onde dá para mudar janela de lançamentos, data final da projeção e fator):

1. Lê os **empreendimentos OF direto do SQL Server** do Portal Inteligência de Mercado (tipologias e cadastros ativos, regional GO) — substitui a planilha `empreendimentos_OF.xlsx`.
2. Lê a **síntese consolidada do Neon** (tabela `sintese_consolidada`). Para subir uma nova versão da síntese: `python scripts/upload_sintese.py "sintese_consolidada.xlsx"`.
3. Reproduz a lógica do `script_consolidado_OF.v2.py`: curvas de venda por cluster → projeção OF de 18 meses → extensão da síntese → tabela master unificada.
4. Grava a master no Neon (tabela `projecao_of`) e regenera `data/dados_of.js` + `data/mapa_of.js`.
5. Commita os dados atualizados → o Vercel faz o deploy automático → **o dashboard passa a exibir os dados novos**.

Credenciais ficam em *Settings → Secrets and variables → Actions* (`NEON_DATABASE_URL`, `SQLSERVER_HOST`, `SQLSERVER_DB`, `SQLSERVER_USER`, `SQLSERVER_PASSWORD`) e, localmente, em um arquivo `.env` na raiz (ignorado pelo git).

Para regenerar a base manualmente a partir de um Excel:

```bash
python scripts/preprocess.py "caminho/Projecao_OF.xlsx" "caminho/Oferta Futura - 2026.kmz"
```

## Medidas

- **Média mensal de vendas (mercado):** média, entre os projetos históricos dos mesmos *clusters* dos empreendimentos filtrados, de `unidades vendidas ÷ meses de comercialização`.
- **Média mensal deflacionada:** mesma conta excluindo os 3 primeiros meses após o lançamento de cada projeto (remove o pico de lançamento).
- **Ponto vermelho no gráfico:** mês de referência (mês atual), como no BI original (`PontoMesReferencia`).

## Origem

Replica e evolui o `BI Oferta Futura.pbix` (Power BI): slicers → filtros, azureMap → Leaflet, tableEx → radar, tooltip de resumo → ficha, lineChart → oferta disponível por mês, pivotTable → matriz de tipologias, cards → KPIs.
