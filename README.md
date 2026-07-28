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
data/plano_diretor.js      índice das 22 camadas do Plano Diretor (leve)
data/plano_diretor/        uma camada por arquivo, baixada só quando ligada
scripts/pipeline_of.py     pipeline: SQL Server + Neon → projeção → Neon + data/
scripts/preprocess.py      monta data/dados_of.js e data/mapa_of.js
scripts/of_common.py       conexões e utilitários compartilhados
scripts/upload_sintese.py  sobe a planilha da síntese para o Neon (uso pontual)
scripts/gen_bairros.py     converte o KMZ de bairros em data/bairros_of.js (sob demanda)
scripts/gen_plano_diretor.py  converte o KMZ do Plano Diretor em data/plano_diretor/ (sob demanda)
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

### Nunca use "Re-run jobs" numa execução antiga

O botão **Re-run jobs** do GitHub Actions refaz a execução **no commit original**, não no `main` atual: volta o `pipeline_of.py` daquela época, com os parâmetros padrão daquela época e sem as guardas que vieram depois. Foi assim que a `projecao_of` voltou a ter 70 empreendimentos com janela 04/2026–09/2027 depois de já estar correta — a guarda de sanidade não existia no código re-executado, então nada barrou a escrita.

Para rodar de novo, use **Run workflow** na aba Actions (ou o `workflow_dispatch` com os parâmetros), que sempre pega o `main` atual.

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

### 10. Plano Diretor: 36 MB que não podem chegar ao navegador

O KMZ do Plano Diretor de Goiânia 2022 tem 36 MB de KML e 880 mil vértices. `gen_plano_diretor.py` simplifica cada geometria (Douglas-Peucker, tolerância de ~5,5 m) e arredonda as coordenadas a 5 casas: **130 mil vértices, 86% menor**, imperceptível na escala do mapa.

Cada uma das 22 pastas do KMZ vira um arquivo em `data/plano_diretor/`. A página carrega só o índice; a geometria de uma camada é baixada quando o usuário a liga e fica em cache na memória. Todas desligadas por padrão.

O nome do arquivo é truncado **pelo fim**, não pelo início: quatro pastas começam com "Programas Especiais / Áreas de Programas Especiais de …" e cortar pelo começo fazia as quatro colidirem no mesmo arquivo — as camadas existiam no painel mas mostravam todas a mesma geometria.

### 11. Quebras do modo Detalhado precisam fechar com o total

Os gráficos podem ser quebrados por tipologia (1Q–4Q e comercial) ou por faixa de m². As duas quebras são gravadas pelo pipeline em cada mês (`tip` e `fx`), não rateadas no navegador.

Faixa de m² tem o balde **`f0` — "sem área informada"**. Sem ele, as tipologias sem `AreaPrivativa` sumiam do gráfico e a soma das faixas ficava 434 unidades abaixo do total. Vale a mesma regra da tipologia: um balde para o desconhecido é melhor que descartar a linha.

### 12. O filtro de período recorta o eixo do tempo

Com Jan–Jun/26 selecionado, os gráficos mostram só esses 6 meses — e não os 18 meses de projeção de cada produto lançado na janela. O filtro define a janela de análise inteira, não só quais empreendimentos entram.

### 13. Desempenho por incorporadora tem período próprio

É a única tabela que **não** obedece ao filtro global de período de lançamento — os demais filtros (bairro, incorporadora, tipo, tipologia, macrozona, faixa) ela obedece normalmente.

O recorte dela é sobre **protocolo e aprovação**: com Jan/25 → Jan/26 selecionado, entram os projetos protocolados **ou** aprovados nesse intervalo. As colunas seguem o mesmo critério — `aprovados` = aprovação dentro da janela; `em protocolo` = protocolado na janela e ainda sem aprovação nela. Sem janela, ambas caem no status atual do projeto, e aí as flags `ProjetoProtocolado`/`ProjetoAprovado` valem quando a data está em branco.

"Lançado" é medido contra o **início do período da tabela**: `dtLancamento <= incFrom`. Sem período, a régua é o mês de referência (mês atual). Isso mantém a leitura estável: ao analisar 2027, o que foi lançado em 2026 já é passado.

### 13b. `<input type="month">` não existe em todo navegador

Firefox e Safari não implementam o campo: ele cai para texto, o valor nunca chega em `YYYY-MM` e o filtro de período simplesmente não aplica — sem erro nenhum no console. Onde o navegador não suporta, o campo é trocado por um `<select>` com os meses que existem na base (`campoMes`), e o que o usuário digita passa por `normalizaYM`, que aceita `2026-01`, `01/2026`, `1/2026` e `2026/01`. Vale para os dois filtros de período: lançamento e protocolo/aprovação.

### 13c. Ordenação e hierarquia das tabelas

Toda tabela ordena pelo cabeçalho: coluna de texto começa em A→Z, coluna numérica começa do maior (padrão de BI), e o segundo clique inverte. Valor vazio fica sempre por último, nos dois sentidos — `cmpOrd`.

Três tabelas são hierárquicas, e a profundidade muda por tabela:

| Tabela | Hierarquia |
|---|---|
| Unidades por tipologia | tipo → incorporadora → empreendimento |
| Concentração por bairro | bairro (ou macrozona) → incorporadora → empreendimento |
| Desempenho por incorporadora | incorporadora → empreendimento |

Um único par de funções serve as três, em qualquer profundidade: `linhasArvore()` desenha as linhas marcando cada uma com o caminho do nó (`0`, `0-2`, `0-2-1`) e a classe do nível (`n0`/`n1`/`n2`), e `ligarArvore()` decide a visibilidade por uma regra só — *uma linha aparece quando todos os seus ancestrais estão abertos*. Fechar um grupo esconde os netos junto, e reabrir devolve a expansão que estava lá antes. `ordenarArvore()` ordena recursivamente: a coluna clicada ordena os irmãos em todos os níveis. Clicar num empreendimento centraliza ele no mapa.

O acumulado de cada nó é somado a partir dos filhos, nunca recalculado da base filtrada — é o que garante que nível 1 feche com nível 0 e os dois com o TOTAL GERAL.

### 13i. Campo vazio é campo vazio — nada de valor inventado

A ficha mostrava `FONTE DA TIPOLOGIA: PROJETO` sempre que o campo vinha em branco, por causa de um `|| 'PROJETO'` que estava lá desde o primeiro commit do dashboard. Era um dado fabricado com cara de dado real, e o pior: existe um empreendimento em que `PROJETO` é o valor verdadeiro, então não dava para distinguir um do outro olhando a tela.

Regra: em campo de exibição, o *fallback* é sempre `—`. Se um valor faz sentido como padrão, ele tem que vir do pipeline e ficar gravado na base, nunca ser inventado na hora de desenhar a tela. Para uma categoria, o padrão é um balde explícito de desconhecido (`SEM TIPOLOGIA INFORMADA`, `SEM ÁREA INFORMADA`, `SEM MACROZONA`), nunca uma categoria real.

A varredura que veio depois desse achado encontrou mais quatro:

1. **`0Q` no lugar de `COMERCIAL`.** `tipologia_tratada = 0` é comercial, mas a ficha, a matriz de unidades por tipologia e o filtro montavam o rótulo concatenando `valor + 'Q'` — saía "0Q" e "0 quartos". Agora os três usam o mesmo dicionário `TIP_LABELS` dos gráficos, via `rotuloTipologia()`.
2. **Unidades sem tipologia viravam COMERCIAL.** Empreendimento sem nenhuma tipologia cadastrada tinha o total jogado no balde `'0'` no modo Tipologias — e sumia no modo Faixa de m². Agora vai para `SEM TIPOLOGIA INFORMADA` nos dois modos.
3. **`tratada` nulo virava COMERCIAL.** `tipKeyOf` mandava qualquer valor não numérico para `'0'`. Agora só um `0` de verdade é comercial; nulo e vazio vão para o balde de desconhecido.
4. **Rateio da quebra mensal.** Quando o mês não trazia a quebra gravada (base importada por Excel), o front distribuía as disponíveis pela participação das tipologias. O total ficava certo e a distribuição era inventada — um desenho convincente e falso. Agora o mês inteiro cai no balde de desconhecido.

### 13j. "Lançado" vem da data, não do campo de procedência

`FonteDataLancamento` responde *de onde veio a data* — os valores reais na base são `LANÇADO`, `INCORPORADORA`, `EBM`, `JORNAL O POPULAR` e, em 54 dos 87 empreendimentos, vazio. O `statusEmp` tratava esse campo como status: só marcava `LANÇADO` quem tivesse a palavra "LANC" ali, e todo o resto virava `PREVISTO`.

O resultado era um dashboard afirmando 19 lançados quando 35 já tinham data de lançamento no passado — inclusive projetos com lançamento em fev/26 aparecendo como "previsto" em jul/26. O campo não erra; ele só não responde essa pergunta.

Agora quem decide é a data contra o mês de referência: `dtLancamento <= mês atual` → `LANÇADO`. A fonte entra apenas como confirmação, para o caso de um cadastro afirmar o lançamento antes da data chegar. Vale para o selo da ficha, a coluna STATUS do Excel e a do PDF de apresentação.

Isso é diferente da régua da tabela por incorporadora ([13. Desempenho por incorporadora](#13-desempenho-por-incorporadora-tem-período-próprio)), que compara com o **início do período filtrado** de propósito, para a leitura não mudar conforme o recorte.

### 13f. Terrenos sem previsão ignoram só o filtro de período

Eles não têm data de lançamento, então o filtro de período não se aplica — mas todos os outros sim: bairro, incorporadora, tipo e macrozona filtram normalmente (`semDataFiltrados()` chama o mesmo `empMatches(e, false)` da tabela de incorporadoras). Tipologia e faixa de m² **excluem** esses terrenos, e isso é intencional: um terreno sem tipologia cadastrada não pode casar com um filtro de tipologia, e fingir que casa inflaria a contagem.

Vale para os três lugares onde eles aparecem: as linhas do radar, os marcadores cinza do mapa e as geometrias do KMZ.

### 13g. Coluna do canvas trava o grid ao voltar da tela cheia

Ao expandir um card do `.duo`, o Chart.js estica o canvas para a largura da tela. Ao colapsar, o canvas ainda carrega essa largura, e como faixa `fr` tem piso de `min-content`, o grid não conseguia encolher: a coluna do gráfico ficava com 1.877 px e a do mapa espremida em 239 px. São dois consertos que só funcionam juntos — `min-width: 0` nos cards do `.duo`, para a faixa poder encolher abaixo do conteúdo, e limpar `canvas.style.width/height` antes do `resize()`, para o canvas não segurar o container aberto enquanto o Chart.js mede.

### 13h. Largura de coluna arrastável

Cada tabela guarda as larguras em `larguras[idTabela][índice]`, fora do DOM — as tabelas são refeitas por `innerHTML` a cada ordenação e a largura precisa sobreviver a isso. No primeiro arraste, todas as colunas têm a largura atual congelada e a tabela passa a `table-layout: fixed`; sem isso o navegador redistribui as outras colunas a cada pixel arrastado. Duplo clique na alça restaura a tabela inteira.

### 13k. Rótulo de dados: dentro da barra, fora do ponto

O interruptor de rótulos vale para os quatro gráficos — oferta disponível e lançamentos, nos modos Total e Detalhado. O desenho muda conforme o elemento: em ponto de linha o número vai acima; em barra (única ou empilhada) vai **dentro**, em branco e centralizado no segmento. Fora dela, os rótulos das cinco séries se empilham no mesmo topo e viram borrão. Segmento com menos de 13 px de altura não recebe rótulo — não caberia — e valor zero nunca recebe.

### 13l. Guarda de queda: estreitar a janela de propósito também aborta

`checar_variacao` barra a publicação quando a janela devolve mais de 10 % a menos de empreendimentos que a execução anterior. Ela não distingue erro de intenção, e é assim de propósito: um `01/2026` digitado como `03/2026` some com dezenas de projetos sem erro nenhum. Estreitar a janela de propósito cai na mesma trava.

Por isso a mensagem de aborto imprime os parâmetros das duas execuções, lado a lado — se a janela mudou, a queda é esperada. O escape é o campo **ignorar_queda** no formulário do workflow (`OF_IGNORAR_QUEDA=1` quando rodado à mão). O agendamento mensal nunca ignora: só a execução manual pode liberar.

### 13e. O `?v=` do index.html é carimbado pelo pipeline

Os arquivos de dados são servidos com `?v=<carimbo>`. Se o pipeline reescreve `data/dados_of.js` e o `?v=` continua o mesmo, o navegador serve a versão anterior do cache — o dashboard mostra a base da execução passada sem erro nenhum. Por isso `atualizar_cache_buster()` reescreve o token com a data e hora da execução no fim do pipeline, e o workflow commita o `index.html` junto com os dados. Em mudança só de código, o token é bumpado à mão no commit.

### 13d. O desfoque do "expandir" fica no overlay, não num ancestral

`filter: blur()` num ancestral desfoca também o card expandido — e, pior, transforma o ancestral em bloco de contenção do `position: fixed`, jogando o card para fora do viewport. Por isso o desfoque é `backdrop-filter` no `.expand-back`, que fica atrás do card. O `resize()` dos gráficos roda dentro de um `requestAnimationFrame`, depois que o layout novo já valeu — se rodar antes, o canvas é refeito no tamanho antigo e sai borrado.

### 14. Médias de venda do mercado

- **Média mensal:** entre os projetos históricos dos mesmos *clusters* dos empreendimentos filtrados, `unidades vendidas ÷ meses de comercialização`.
- **Média deflacionada:** mesma conta ignorando os 3 primeiros meses após o lançamento (tira o pico). Saiu do painel e do PDF a pedido; continua na aba Resumo do Excel exportado, porque lá é dado bruto, não leitura de tela.
- **Clusters:** `apart-map-1Q` a `apart-map-4Qmaior` (por nº de quartos), `apart-eco`, `outros`. É o cluster que liga um empreendimento novo à curva de venda do mercado.

### 15. Ponto vermelho e LTM

O ponto vermelho do gráfico é o **mês de referência** (mês atual), como o `PontoMesReferencia` do BI. No modo LTM, cada ponto é a soma móvel dos 12 meses anteriores.

---

## Funcionalidades

| | |
|---|---|
| **Filtros** | Período, bairro, incorporadora, tipo, tipologia, macrozona e faixa de m² (multi-seleção com busca; "selecionar todos" respeita a busca). Tudo recalcula em tempo real. |
| **Mapa** | Leaflet com empreendimentos (EBM em azul, demais em vermelho), terrenos e localizações do KMZ, bairros coloridos e camada de satélite. Com filtro ativo, só aparecem as geometrias dos empreendimentos filtrados. |
| **Sem previsão** | Checkbox que traz do Neon os terrenos monitorados **sem data de lançamento**: marcadores cinza, linhas no radar e ficha completa. Obedecem a todos os filtros menos o de período — que não se aplica, já que não têm data. |
| **Gráficos** | Oferta disponível por mês e lançamentos por mês (Mês/Tri/Ano/LTM), recortados pelo período filtrado. O botão **Detalhado** abre duas quebras: **Tipologias** (1Q–4Q e comercial) ou **Faixa de m²**; a tooltip lista os empreendimentos do período com suas unidades. |
| **Plano Diretor** | Painel com as 22 camadas do Plano Diretor de Goiânia 2022, agrupadas em Estrutura, Densidade, Ambiental e Programas. Desligadas por padrão; dá para ligar uma, um grupo inteiro ou todas. Cada camada só é baixada quando ligada. |
| **Expandir** | Todo painel tem botão de expandir para tela cheia (estilo Power BI). `ESC` restaura. |
| **Por incorporadora** | Projetos, unidades, quantos em protocolo, aprovados e lançados, além do tempo de aprovação (mediana e média). Tem **período próprio** de protocolo/aprovação e ignora o filtro global de período de lançamento. Abre por empreendimento. |
| **Concentração** | Onde a oferta se acumula, por bairro ou macrozona: empreendimentos, unidades, participação, incorporadoras distintas e m² médio. Abre por empreendimento. |
| **Tabelas** | Todas ordenam pelo cabeçalho (texto A→Z, número do maior; segundo clique inverte) e têm **largura de coluna arrastável** pela borda direita do cabeçalho — duplo clique restaura. As hierárquicas abrem os empreendimentos do grupo, e o clique numa linha de empreendimento centraliza o mapa. |
| **Radar** | Primeira tabela da página, com busca e ordenação. Clique no **nome** abre a ficha; clique na **linha** centraliza o empreendimento no mapa. |
| **Ficha** | Origem e produto, tipologias, protocolo → aprovação com tempo decorrido, endereço, pavimentos e fonte. |
| **Exportar** | PDF (relatório), PDF Apresentação (deck por macrozona, faixa, segmento e **terrenos sem previsão de lançamento**), Excel (5 abas) e KMZ — todos respeitando os filtros. |
| **Importar** | Excel no esquema da master e KMZ/KML do Google Earth, reconstruindo o dashboard no navegador. |
| **Chat de IA** | Consulta o Neon: o modelo escreve o SQL, o dashboard executa via `/api/sql` e devolve as linhas (até 3 consultas encadeadas). Suporta OpenAI, Anthropic, Gemini, Mistral, DeepSeek, Groq, Together e OpenRouter, com campo para digitar qualquer id de modelo. |
| **Edição ✎** | Títulos e textos editáveis (senha `123`), persistidos no `localStorage`. O dock de configurações liga/desliga os lápis e os rótulos dos gráficos. |

### Segurança

- **Nunca commitar chave de API em `js/app.js`** — o arquivo é servido ao navegador. A chave do chat é do usuário e fica só no `localStorage` dele.
- `/api/sql` aceita apenas `SELECT`/`WITH`, uma instrução por chamada, no máximo 200 linhas, e só responde às origens do próprio site.
- A senha `123` protege a edição de textos no navegador; não é controle de acesso.
