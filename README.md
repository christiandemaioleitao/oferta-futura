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
| **Importar Excel** | Botão *Importar Excel* lê a base `Projecao_OF.xlsx` (mesmo esquema de colunas) e reconstrói todo o dashboard no navegador. |
| **Importar KMZ** | Botão *Importar KMZ* lê o `.kmz`/`.kml` (Google Earth) e redesenha terrenos (polígonos) e localizações (pontos) com as cores originais. |
| **Mapa georreferenciado** | Leaflet com 3 camadas: empreendimentos da oferta futura (filtráveis, popup com ficha), terrenos do KMZ e localizações do KMZ. |
| **Radar de empreendimentos** | Tabela no novo design (links de portal/projeto, ordenação por coluna, busca). *Hover* em uma linha abre o tooltip de ficha; clique no nome fixa a ficha em modal. |
| **Ficha do empreendimento** | Tooltip no novo design: origem e produto, tipologias, protocolo → aprovação com tempo decorrido, endereço, pavimentos e fonte. |
| **Edição pelo lápis ✎** | Títulos e textos têm lápis de edição (portado do leadsebm2.0). Senha: `123`. As edições persistem no `localStorage`. |
| **Chat de IA** | Botão flutuante abre o chat (portado do leadsebm2.0). Suporta OpenAI, Anthropic, Gemini, Mistral, DeepSeek, Groq, Together e OpenRouter. A IA responde com base no contexto JSON do dashboard **já filtrado**. Chave própria via botão de chave (senha `123`). |

## Estrutura

```
index.html          aplicação (single page)
css/style.css       design system (manual de marca)
js/app.js           lógica: filtros, mapa, gráficos, PDF, imports, chat IA, lápis
data/dados_of.js    base pré-processada (69 empreendimentos + histórico de mercado)
data/mapa_of.js     GeoJSON do KMZ (395 geometrias)
assets/             logos oficiais EBM Inteligência
scripts/preprocess.py  regenera data/ a partir do .xlsx e .kmz
fontes/             arquivos originais (xlsx, kmz, pbix, designs de referência)
```

Para atualizar a base commitada no repositório:

```bash
python scripts/preprocess.py "caminho/Projecao_OF.xlsx" "caminho/Oferta Futura - 2026.kmz"
```

## Medidas

- **Média mensal de vendas (mercado):** média, entre os projetos históricos dos mesmos *clusters* dos empreendimentos filtrados, de `unidades vendidas ÷ meses de comercialização`.
- **Média mensal deflacionada:** mesma conta excluindo os 3 primeiros meses após o lançamento de cada projeto (remove o pico de lançamento).
- **Ponto vermelho no gráfico:** mês de referência (mês atual), como no BI original (`PontoMesReferencia`).

## Origem

Replica e evolui o `BI Oferta Futura.pbix` (Power BI): slicers → filtros, azureMap → Leaflet, tableEx → radar, tooltip de resumo → ficha, lineChart → oferta disponível por mês, pivotTable → matriz de tipologias, cards → KPIs.
