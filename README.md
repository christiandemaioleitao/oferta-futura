# Oferta Futura — Dashboard EBM Inteligência

Dashboard de acompanhamento da **oferta futura de empreendimentos imobiliários em Goiânia**, no design system do **Manual de Marca EBM Inteligência v1.0** (Azul EBM `#0C1F55`, Vermelho Inteligência `#E30A12`, Sora + IBM Plex Sans/Mono e o grafismo de rede de nós).

Publicado em <https://oferta-futura.vercel.app>. Substitui e evolui o `BI Oferta Futura.pbix`: slicers → filtros, azureMap → Leaflet, tableEx → radar, tooltip → ficha, lineChart → oferta por mês, pivotTable → matriz de tipologias, cards → KPIs.

---

## Como rodar localmente

O frontend continua em HTML/JavaScript, com build que publica apenas os arquivos
públicos. O login e os dados dependem das funções Node da Vercel:

```bash
npm ci
npm test
npm run build
# Para executar o site com as funções e as variáveis SG configuradas:
npx vercel dev
```

Precisa de internet para as bibliotecas (Leaflet, Chart.js, SheetJS, JSZip, jsPDF)
e os tiles do mapa. As APIs usam sempre a mesma origem e a sessão SG da aba.
Um servidor de arquivos como `python -m http.server` não fornece autenticação;
não publique a raiz do repositório dessa forma.

## Controle de acesso SG

**Acesso público temporário (27/10/2026):** por solicitação do responsável,
`SG_AUTH_DISABLED=true` em Production permite abrir o dashboard e ler seus dados
sem login, sem depender do banco SG ou do Neon Auth. A senha administrativa das
ações de escrita e os controles de origem/caminho continuam ativos. Para reativar
o SG, configurar as credenciais e autorizações abaixo, remover essa variável
(ou definir `false`) e fazer redeploy. Sem essa opção explícita, o SG é obrigatório.

Adaptado da skill `sg-integracao-seguranca` para HTML + funções Vercel, conforme
`references/projetos-nao-next.md`. O identificador deste app é **oferta_futura**.
O usuário entra com e-mail `@ebm.com.br`, recebe um OTP de seis dígitos pelo Neon
Auth e só acessa o dashboard se tiver uma autorização ativa no SG.

- `lib/security*.mjs`: núcleo SG, banco e guard Node. Cookie `__Host-ebm-sg-session`
  em produção, `HttpOnly`, `Secure`, `SameSite=Lax`, token aleatório de 32 bytes e
  somente hash SHA-256 no banco. Sessões expiradas, revogadas ou com acesso
  desativado deixam de passar na checagem do servidor.
- `/api/security/state`, `request-otp`, `verify-otp`, `logout`: fluxo de acesso.
  A solicitação responde da mesma forma para e-mails corporativos autorizados e
  não autorizados. O logout revoga a sessão antes de remover o cookie.
- Todas as rotas de dados usam `requireApiSession(req, res)` como primeira
  instrução. A senha administrativa continua necessária para editar, importar
  síntese ou iniciar o pipeline; a sessão não substitui essa senha.
- `dist/` recebe somente HTML, CSS, JS de interface e logos. `data/**`,
  `sintese_schema.json`, `fontes/**`, bibliotecas do servidor e documentos internos
  não são arquivos estáticos públicos. `/data/*` e o schema são encaminhados à
  API autenticada `api/secure-data.js`, que aceita uma lista restrita de caminhos.
- O gate carrega os dados apenas após validar a sessão. O navegador verifica a
  sessão ao voltar à aba e a cada minuto; as APIs verificam em toda requisição.
  Logout também remove a chave pessoal da IA do armazenamento local.
- `npm run build` executa `scripts/audit-security.mjs` antes e depois do build.
  Falta de guard, dados na saída pública ou segredo embutido interrompem o build.

### Ativação no SG e na Vercel

Usar exclusivamente o projeto Neon **SG - Segurança** já administrado pela equipe
responsável, com o usuário **sg_app**. Este repositório não cria tabelas `sg.*`.
O administrador deve conferir o esquema/índice existente descrito na skill e
liberar os e-mails desejados para `oferta_futura`, usando
`scripts/liberar_acesso.sql` como modelo. Nenhum e-mail é liberado automaticamente.

Definir na Vercel, em Production e Preview: **SG_DATABASE_URL**, **APP_KEY**
(`oferta_futura`), **CORPORATE_EMAIL_DOMAIN** (`ebm.com.br`), **NEON_AUTH_URL**,
**APP_ORIGIN** e **SESSION_TTL_HOURS** (padrão 12, máximo 168). Os nomes estão em
`.env.security.example`; nunca versionar valores reais. Usar a origem correta
em cada ambiente, cadastrá-la entre as origens confiáveis do Neon Auth e fazer
redeploy. Sem configuração SG válida, a integração falha fechada.

O limite de tentativas/consumo de OTP depende do Neon Auth; não há um contador
distribuído adicional neste app. Código público e logos continuam acessíveis,
mas os dados do dashboard exigem sessão. Dados já baixados por um usuário não
podem ser recuperados do seu computador após revogação. Para não manter cópias
antigas públicas, a equipe Vercel também deve proteger ou remover os deployments
anteriores que serviam dados sem SG. O CSP atual impede uso em iframe; liberar
um portal em iframe requer ajuste explícito de `frame-ancestors` e dos cookies.

---

## Arquitetura

```
index.html                 aplicação (single page)
css/style.css              design system
js/app.js                  filtros, mapa, gráficos, PDF, imports, chat, edição
api/sql.js                 função serverless: consulta somente-leitura ao Neon
api/config.js              função serverless: config compartilhada (textos e mapa importado)
api/upload-sintese.js      função serverless: substitui sintese_consolidada no Neon
api/atualizar-portal.js    função serverless: inicia e acompanha o pipeline do Portal
api/security/[action].js  endpoints SG: estado, OTP, verificação e logout
api/secure-data.js        dados do dashboard e schema, somente com sessão SG
lib/security*.mjs         núcleo SG, integração com o banco SG e guard das APIs
js/security-gate.js       tela de acesso e carregamento autenticado do dashboard
scripts/build-site.mjs    gera dist com uma lista explícita de arquivos públicos
scripts/audit-security.mjs auditoria obrigatória do SG no build
data/dados_of.js           window.OF_DATA   — empreendimentos + tipologias + série mensal
data/mapa_of.js            window.OF_MAPA   — GeoJSON dos terrenos/pontos do KMZ
data/bairros_of.js         window.OF_BAIRROS — polígonos dos bairros já coloridos
data/plano_diretor.js      índice das 22 camadas do Plano Diretor (leve)
data/plano_diretor/        uma camada por arquivo, baixada só quando ligada
scripts/pipeline_of.py     pipeline: SQL Server + Neon → projeção → Neon + data/
scripts/preprocess.py      biblioteca do pipeline: monta data/dados_of.js e data/mapa_of.js
scripts/of_common.py       conexões e utilitários compartilhados
scripts/upload_sintese.py  sobe a planilha da síntese para o Neon (uso pontual)
scripts/converter_download_layout.py  export DownloadLayout do Brain → fontes/sintese_consolidada.csv.gz
scripts/gen_bairros.py     converte o KMZ de bairros em data/bairros_of.js (sob demanda)
scripts/gen_plano_diretor.py  converte o KMZ do Plano Diretor em data/plano_diretor/ (sob demanda)
fontes/                    arquivos originais (KMZ, pbix, síntese, referências de design)
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
| `OF_DATA_BASE` | `01/2026` | data base (mm/aaaa) — dela saem todos os prazos |
| `FATOR_AJUSTE` | `1.0` | multiplicador aplicado à curva de vendas |
| `OF_IGNORAR_QUEDA` | — | `1` libera a guarda de sanidade (ver abaixo) |

**A data base é o único parâmetro de período.** Os três prazos que o pipeline usava
antes viravam três campos independentes no formulário, e um deles fora de sincronia
com os outros dois produzia uma projeção incoerente sem avisar. Agora todos saem da
mesma data, amarrados aos 18 meses da curva de venda:

| Prazo | Valor |
|---|---|
| Início da janela de lançamentos | a própria data base |
| Fim da janela de lançamentos | data base + 18 meses (mês inteiro) |
| Fim da projeção da síntese | data base + 18 meses |

Com `OF_DATA_BASE=03/2026`: janela **03/2026 → 09/2027**. A data base aceita `mm/aaaa`
ou `aaaa-mm`; qualquer outra coisa aborta o pipeline antes de tocar no banco.

O fim da janela cobre o **mês inteiro**, não o dia 1º: um lançamento em 20/09/2027
pertence a setembro e entra. Antes a comparação era contra o dia 1º e um lançamento
com dia preenchido no cadastro caía fora do último mês em silêncio.

### Credenciais

Secrets do Actions (*Settings → Secrets and variables → Actions*): `NEON_DATABASE_URL`, `SQLSERVER_HOST`, `SQLSERVER_DB`, `SQLSERVER_USER`, `SQLSERVER_PASSWORD`.

Na Vercel, a função `/api/sql` usa `DATABASE_URL` (mesma string do Neon), configurada em *Project → Settings → Environment Variables*.

O botão **Atualizar base da síntese** (dock de configurações → `/api/upload-sintese`) exige mais uma variável na Vercel: `SINTESE_UPLOAD_SENHA`. É a senha que o botão pede antes do upload; sem ela o endpoint recusa qualquer escrita (fica desligado). Use uma senha forte — é um endpoint público que substitui a tabela `sintese_consolidada` inteira. Ver §16.

Localmente, um `.env` na raiz (ignorado pelo git) — ver `.env.example`.

### Atualizar pelo dashboard

Em **⚙️ Configurações → Dados do Portal → Atualizar**, informe a mesma senha
administrativa do upload da síntese e clique em **Iniciar atualização**. O botão
executa o workflow `pipeline-of.yml` no `main`, reutilizando data base e fator da
última projeção (`of_meta.projecao_parametros`) e mantendo a guarda de sanidade.
Sem esses metadados, o pipeline aborta e pede uma execução manual com parâmetros
explícitos, para não trocar o recorte silenciosamente.
Uma execução que já esteja na fila ou rodando é acompanhada
sem solicitar outra. A planilha da síntese continua sendo atualizada separadamente.

Configure na **Vercel** `GITHUB_ACTIONS_TOKEN`: token fine-grained restrito a
`christiandemaioleitao/oferta-futura`, com **Actions: leitura e escrita**.
`SINTESE_UPLOAD_SENHA` também precisa estar configurada. O token fica somente no
servidor; nunca cole credenciais no JavaScript ou nos arquivos do repositório.
As credenciais SQL existentes permanecem nos secrets do GitHub Actions.

O painel mostra a fila, o processamento e a publicação. Depois do sucesso do
pipeline, só recarrega quando o site servir `data/atualizacao.json` com o ID da
execução (ou de uma mais recente), publicado no mesmo commit dos dados. Assim,
a conclusão do cálculo não é confundida com a conclusão do deploy da Vercel.
Se ocorrer falha de rede ou a espera ultrapassar 20 minutos, **Verificar andamento**
retoma a consulta da execução sem iniciar outra. Falhas do pipeline aparecem no painel.

Verificação das APIs e do SG: `npm test`.
Verificação dos parâmetros (com as dependências do pipeline): `python tests/test_parametros_portal.py`.

Auditoria dos dados reais, sem alterar o banco:
`python scripts/verificar_importacao.py --saida relatorio-importacao.json`.
Compara o arquivo publicado com o Neon: IDs, campos cadastrais, tipologias,
séries mensais, quebras de estoque, mercado, terrenos sem previsão e metadados
da síntese. O relatório distingue consistência da base de atualização: retorna
código 1 se houver divergência ou upload da síntese posterior ao recálculo.
Não acessa diretamente o SQL Server e não comprova a atualização da fonte do Portal.
Depois da ativação do SG, a auditoria precisa de uma sessão válida: forneça o
header Cookie em `SG_SESSION_COOKIE` no ambiente do processo. O script não imprime
esse valor; nunca inclua cookies no repositório, em relatórios ou em mensagens.

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

Único caminho. O atalho antigo — `preprocess.py` lendo `fontes/Projecao_OF.xlsx` —
foi removido junto com o Excel: era um retrato congelado da master, e regenerar o
dashboard a partir dele republicava dados velhos sem nenhum aviso.

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

As faixas são nove, com limite superior **exclusivo** (70 m² cai em 70–100, não em 50–70):

| | | | | | | | | |
|---|---|---|---|---|---|---|---|---|
| `f1` | `f2` | `f3` | `f4` | `f5` | `f6` | `f7` | `f8` | `f9` |
| < 50 | 50–70 | 70–100 | 100–130 | 130–190 | 190–230 | 230–290 | 290–350 | > 350 |

> **A lista existe em dois lugares e os dois precisam mudar juntos:** `FAIXAS` em `js/app.js` (rótulos, filtro e cores) e `FAIXAS` em `scripts/preprocess.py` (o balde `fx` gravado em cada mês). Mexer só no front deixa o gráfico Detalhado lendo chaves que não existem nos dados — sem erro no console, só faixas vazias. **Depois de mudar as faixas, rode o pipeline**: os baldes já gravados são os antigos até a próxima execução.

### 12. O filtro de período recorta o eixo do tempo

Com Jan–Jun/26 selecionado, os gráficos mostram só esses 6 meses — e não os 18 meses de projeção de cada produto lançado na janela. O filtro define a janela de análise inteira, não só quais empreendimentos entram.

### 13. Desempenho por incorporadora tem período próprio

É a única tabela que **não** obedece ao filtro global de período de lançamento — os demais filtros (bairro, incorporadora, tipo, tipologia, macrozona, faixa) ela obedece normalmente.

O recorte dela é sobre **protocolo e aprovação**, e é um **OU**, não um E: com Jan/25 → Jan/26 selecionado, entra todo projeto cujo protocolo **ou** cuja aprovação caia no intervalo — basta uma das duas datas (`baseIncorporadoras`). Conferido na base de ago/2026 com a janela 2026: 23 projetos entram, sendo 5 só por protocolo, 16 só por aprovação e 2 pelos dois. As colunas seguem o mesmo critério — `aprovados` = aprovação dentro da janela; `em protocolo` = protocolado na janela e ainda sem aprovação nela. Sem janela, ambas caem no status atual do projeto, e aí as flags `ProjetoProtocolado`/`ProjetoAprovado` valem quando a data está em branco.

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

**A tabela (e os dois PDFs) mostra só terrenos com "QD" no nome** — `QD 65, PARQUE OESTE INDUSTRIAL`, `QD10, RES VILLAGE CAMPOS VERDES`. É o recorte que o cadastro usa para área ainda sem produto definido; o resto da lista são frentes e glebas de outra natureza. São 142 dos 163 registros. O casamento é `\bQD` sem o `\b` final de propósito: `QD10` vem grudado em parte da base. **O mapa continua mostrando todos** — um terreno monitorado é um terreno monitorado, e escondê-lo do mapa esconderia ocupação real do território.

### 13g. Coluna do canvas trava o grid ao voltar da tela cheia

Ao expandir um card do `.duo`, o Chart.js estica o canvas para a largura da tela. Ao colapsar, o canvas ainda carrega essa largura, e como faixa `fr` tem piso de `min-content`, o grid não conseguia encolher: a coluna do gráfico ficava com 1.877 px e a do mapa espremida em 239 px. São dois consertos que só funcionam juntos — `min-width: 0` nos cards do `.duo`, para a faixa poder encolher abaixo do conteúdo, e limpar `canvas.style.width/height` antes do `resize()`, para o canvas não segurar o container aberto enquanto o Chart.js mede.

### 13h. Largura de coluna arrastável

Cada tabela guarda as larguras em `larguras[idTabela][índice]`, fora do DOM — as tabelas são refeitas por `innerHTML` a cada ordenação e a largura precisa sobreviver a isso. No primeiro arraste, todas as colunas têm a largura atual congelada e a tabela passa a `table-layout: fixed`; sem isso o navegador redistribui as outras colunas a cada pixel arrastado. Duplo clique na alça restaura a tabela inteira.

### 13k. Rótulo de dados: dentro da barra, fora do ponto

O interruptor de rótulos vale para os quatro gráficos — oferta disponível e lançamentos, nos modos Total e Detalhado. O desenho muda conforme o elemento: em ponto de linha o número vai acima; em barra (única ou empilhada) vai **dentro**, em branco e centralizado no segmento. Fora dela, os rótulos das cinco séries se empilham no mesmo topo e viram borrão. Segmento com menos de 13 px de altura não recebe rótulo — não caberia — e valor zero nunca recebe.

### 13l. Guarda de queda: estreitar a janela de propósito também aborta

`checar_variacao` barra a publicação quando a janela devolve mais de 10 % a menos de empreendimentos que a execução anterior. Ela não distingue erro de intenção, e é assim de propósito: um `01/2026` digitado como `03/2026` some com dezenas de projetos sem erro nenhum. Mudar a data base de propósito cai na mesma trava — e como a data base move as duas pontas da janela ao mesmo tempo, a queda costuma ser maior do que se imagina. Na base de jul/2026: base `01/2026` → 79 empreendimentos, `03/2026` → 78, `06/2026` → 64.

Por isso a mensagem de aborto imprime os parâmetros das duas execuções, lado a lado — se a janela mudou, a queda é esperada. O escape é o campo **ignorar_queda** no formulário do workflow (`OF_IGNORAR_QUEDA=1` quando rodado à mão). O agendamento mensal nunca ignora: só a execução manual pode liberar.

### 13e. O `?v=` do index.html é carimbado pelo pipeline

Os arquivos de dados são servidos com `?v=<carimbo>`. Se o pipeline reescreve `data/dados_of.js` e o `?v=` continua o mesmo, o navegador serve a versão anterior do cache — o dashboard mostra a base da execução passada sem erro nenhum. Por isso `atualizar_cache_buster()` reescreve o token com a data e hora da execução no fim do pipeline, e o workflow commita o `index.html` junto com os dados. Em mudança só de código, o token é bumpado à mão no commit.

### 13d. O desfoque do "expandir" fica no overlay, não num ancestral

`filter: blur()` num ancestral desfoca também o card expandido — e, pior, transforma o ancestral em bloco de contenção do `position: fixed`, jogando o card para fora do viewport. Por isso o desfoque é `backdrop-filter` no `.expand-back`, que fica atrás do card. O `resize()` dos gráficos roda dentro de um `requestAnimationFrame`, depois que o layout novo já valeu — se rodar antes, o canvas é refeito no tamanho antigo e sai borrado.

### 14. Médias de venda do mercado

- **Média mensal:** entre os projetos históricos dos mesmos *clusters* dos empreendimentos filtrados, `unidades vendidas ÷ meses de comercialização`.
- **Média deflacionada:** mesma conta ignorando os 3 primeiros meses após o lançamento (tira o pico). Saiu do painel e do PDF a pedido; continua na aba Resumo do Excel exportado, porque lá é dado bruto, não leitura de tela.
- **Clusters:** `apart-map-1Q` a `apart-map-4Qmaior` (por nº de quartos), `apart-eco`, `outros`. É o cluster que liga um empreendimento novo à curva de venda do mercado.

### 14b. A curva de vendas — método (revisado em 07/2026)

A curva responde: *que fração do estoque um lançamento vende em cada etapa dos primeiros 18 meses de vida?* O cálculo, em `curvas_de_venda()`:

1. **Grão de produto** = `empreendimento + tipologia + privativa + incorporadora`. A incorporadora entra de propósito: em consórcio a síntese repete a linha para cada membro e o **estoque oficial soma todas** (13.107 un em 03/2026, conferido contra a planilha bruta). Com ela no grão, numerador e denominador contam do mesmo jeito — antes as vendas de consórcio somavam 2× contra estoque 1×.
2. **Coorte** = produtos lançados nos últimos **36 meses** até a data base. A vida conta a partir do lançamento e só até a data base.
3. **% vendido por etapa de vida** (3, 6, 9, 12, 15 e 18 meses), por cluster. Cada etapa usa **apenas os produtos que já a viveram por inteiro** (`vida_obs >= etapa`): um produto com 7 meses de vida entra em 3M e 6M e é desconsiderado das etapas seguintes. Antes ele entrava com venda zero em todas — 30% do denominador era venda-zero por construção e a curva saía achatada (51,7% em 18M contra os ~74% reais).
4. O incremento de cada etapa é `vendas da janela ÷ estoque de quem a observa`, com piso em zero (distrato líquido não desfaz venda passada); o acumulado é a soma dos incrementos — monotônico por construção e com teto em 100%. A taxa mensal usada na projeção é `incremento ÷ 3`.
5. **Fallback**: cluster sem histórico numa etapa herda o incremento do mercado; previsto que não se encaixa em cluster APART (`outros`: comercial, casas, lotes) segue a **curva global do mercado** inteira — o residual não vira curva própria.

O `FATOR_AJUSTE` multiplica a curva pronta, **uma vez só**.

**Validação** (data base 03/2026, régua definida pelo usuário):

| Métrica | Valor | Gate |
|---|---|---|
| Estoque na data base | 13.107 un | = soma da planilha ✓ |
| VSO clássica 12M (vendas ÷ estoque inicial + lançado) | 44,8% | 40–50% ✓ |
| Coorte global 12M de vida | 70,0% | acima da VSO clássica é esperado: lançamento vende mais rápido que o estoque antigo que a VSO carrega |
| Coorte global 18M de vida | 73,8% | — |

Curvas por cluster em 18M de vida: `1Q` 92% (produto de investidor, quase esgota), `2Q` 78%, `eco` 75%, `3Q` 61%, `4Q+` 58%. O pipeline imprime tudo isso no log e avisa se a VSO sair da régua (não aborta — pode ser ciclo de mercado real).

A base da síntese vem do export DownloadLayout do Brain, convertido por `scripts/converter_download_layout.py` (filtra **Goiânia + Aparecida de Goiânia**, mantém as linhas de consórcio) e subido ao Neon pelo workflow **Upload Síntese Consolidada**.

### 14c. Os dois PDFs não truncam nada

Os dois botões de exportação seguem a mesma regra: **nenhuma tabela é cortada**. O que não cabe numa página vira a próxima, e o título ganha o sufixo `(1/3)`, `(2/3)`, `(3/3)`. Antes o deck imprimia 11 linhas por corte e fechava com "+ 24 empreendimentos — lista completa no dashboard": um slide que parecia completo e não era. `paginar()` e `sufixoPag()` servem os dois exportadores.

**Relatório** (botão *Exportar PDF*) — 40 páginas na base de ago/2026, sem filtro:

| | Seção | Paginação |
|---|---|---|
| capa | título, emitido em, empreendimentos, janela | — |
| 01 | síntese: KPIs, os dois gráficos e os filtros aplicados | 1 |
| 02 | mapa georreferenciado | 1 |
| 03 | radar de empreendimentos | 16 linhas/página |
| 04 | unidades por tipologia (árvore inteira, indentada) | 18 linhas/página |
| 05 | desempenho por incorporadora | 18 linhas/página |
| 06 | concentração por bairro/macrozona/incorporadora | 18 linhas/página |
| 07 | radar sem previsão de lançamento | 16 linhas/página |

As seções 04–06 reaproveitam a **mesma árvore que está na tela**: `renderPivot`, `renderIncorporadoras` e `renderConcentracao` foram partidos em `dadosX()` + `renderX()`, e o PDF chama o `dadosX()`. Nível de drill, ordenação e filtros ativos saem iguais aos do painel — não é uma segunda implementação que pode divergir. `achatarArvore()` expande todos os níveis (o PDF não tem clique para abrir grupo) e o recuo marca a hierarquia.

**Capa:** só logotipo, título e os metadados objetivos. Saíram o *eyebrow* ("EBM INTELIGÊNCIA — RELATÓRIO EXECUTIVO"), a linha "Documento / Relatório de Oferta Futura" e os chips de filtro — que agora vivem no rodapé da página 01, onde a informação continua útil sem competir com o título. O grafismo de rede é desenhado com um azul **mais claro que o fundo** (`#4C6CB4`): com `NAVY7` sobre o navy da capa, a trama existia no SVG e sumia na rasterização.

### 14d. O mapa dos slides usa zoom fracionário

Os tiles só existem em zoom inteiro, e escolher o maior inteiro que coubesse deixava até 2× de folga — o recorte saía pequeno no meio do slide. Agora o zoom ideal é calculado como float (`zf`), os tiles vêm do inteiro **acima** e são reduzidos por `s = 2^(zf−z) ≤ 1`. Reduzir mantém nitidez; ampliar borraria. Raios e espessuras são divididos por `s` para ficarem constantes na imagem final.

A margem caiu de 16% para 4% do bbox, e a captura passou a ter exatamente a proporção da caixa do slide (2030×1120 para 1015×560), então o `object-fit: cover` não corta ponto nenhum. Na base sem filtro: zoom 12,59 (era 12 inteiro), todos os 76 pontos dentro da imagem, ocupando 93% da altura.

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
| **Exportar** | PDF (relatório com mapa e as seis tabelas do painel), PDF Apresentação (deck por macrozona, faixa de m², segmento e **terrenos sem previsão**), Excel (5 abas) e KMZ — todos respeitando os filtros. Nenhum dos dois PDFs trunca tabela: o excedente vira as páginas `(1/3)`, `(2/3)`… (ver §14c). |
| **Importar** | KMZ/KML do Google Earth. O mapa importado é **gravado no banco**: quem abrir o site depois vê a mesma geometria (ver §17). |
| **Chat de IA** | Consulta o Neon: o modelo escreve o SQL, o dashboard executa via `/api/sql` e devolve as linhas (até 3 consultas encadeadas). **Mantém o contexto da conversa** — pergunta curta herda o recorte da anterior. Provedor e modelo são compartilhados (§17); a chave de API é de cada usuário. Padrão de fábrica: modelo gratuito da OpenRouter. |
| **Edição ✎** | Títulos e subtítulos editáveis, **gravados no banco** e válidos para todos os usuários (senha do servidor — ver §17). O dock de configurações liga/desliga os lápis e os rótulos dos gráficos. |

### Segurança

- **Nunca commitar chave de API em `js/app.js`** — o arquivo é servido ao navegador. A chave do chat é do usuário e fica só no `localStorage` dele.
- `/api/sql` aceita apenas `SELECT`/`WITH`, uma instrução por chamada, no máximo 200 linhas, e só responde às origens do próprio site.
- A senha `123` protege só o painel da chave de API do chat, que fica no navegador de quem clica; não é controle de acesso.
- `/api/upload-sintese`, `/api/config` e `/api/atualizar-portal` exigem sessão SG e
  `SINTESE_UPLOAD_SENHA` nas ações de escrita. Sem a senha configurada no servidor,
  a escrita permanece desativada.
- `/api/config` responde `GET` somente com sessão SG. A escrita aceita apenas
  `textos`, `mapa_kmz` e `ia`; chaves de API pessoais não são gravadas nessa tabela.

## 16. Upload da síntese pelo dashboard

O botão **Atualizar base da síntese** (dock ⚙️) substitui a tabela `sintese_consolidada` no Neon sem sair do navegador. Equivale ao `scripts/upload_sintese.py`, mesmas 23 colunas e tipos.

Por que não é um `INSERT` direto: o navegador não fala com o Postgres, e a Vercel Hobby limita requisição a ~4,5 MB e função a 10 s. Então o cliente (`js/app.js`) lê a planilha com o SheetJS, converte as datas (`dd/mm/aaaa`, `mm/aaaa`, ISO), os números (vírgula decimal) e manda em lotes de 1.000 linhas para `/api/upload-sintese`:

| Ação | O que faz |
|------|-----------|
| `init` | recria a tabela de staging `sintese_stage` |
| `chunk` | insere um lote de linhas na staging (parametrizado) |
| `commit` | troca atômica (bloco `DO`): `DROP` da viva + `RENAME` da staging; grava `of_meta` |

A troca só acontece no `commit`, num único statement atômico — se o upload falhar no meio, a `sintese_consolidada` viva continua intacta. **A base bruta muda, mas o dashboard não**: rode o pipeline depois para recalcular `projecao_of` e os `data/*.js`.

## 17. Textos e mapa ficam no banco, não no navegador

Os títulos editados pelo lápis e o KMZ importado moravam no `localStorage`. Funcionava
— para uma pessoa, num navegador só. Quem abrisse o site de outra máquina via os
textos originais e o mapa do pipeline, e limpar o cache apagava tudo. Não é o que
"editar o dashboard" deveria significar num painel compartilhado.

Agora a fonte da verdade é a tabela `site_config` no Neon, servida por `/api/config`:

| Chave | Conteúdo |
|---|---|
| `textos` | objeto `{ id-do-elemento: texto }` — só o que foi editado |
| `mapa_kmz` | `{ arquivo, geojson }` do KMZ importado |

O boot **não espera** a rede: a página renderiza com os padrões do repositório e é
corrigida quando o banco responde. Se o endpoint estiver fora, o dashboard abre
normalmente com os textos do HTML e o mapa do pipeline — degradar para o padrão é
melhor que uma tela em branco.

### O id do texto vem do HTML, não do texto

Cada elemento editável carrega o próprio id: `data-editable="mapa-titulo"`. Antes o id
era derivado do conteúdo (`textKey(el.textContent)` + índice), e isso amarrava a edição
salva à redação original — bastava alguém mexer no `index.html`, ou o próprio pipeline
reescrever a página, para a edição virar órfã e a tela voltar ao padrão sem erro nenhum.
**Ao adicionar um elemento editável novo, dê um slug a ele**; sem o atributo o código cai
no índice posicional, que volta a ser frágil.

### Escrita usa a senha do servidor

Editar um título passou a mudar o site para todo mundo, então o gate é a mesma
`SINTESE_UPLOAD_SENHA` do upload da síntese — conferida no servidor, nunca no JS. A senha
é pedida uma vez por aba e fica só na memória (`senhaSessao`): gravá-la no `localStorage`
deixaria uma senha de servidor no disco do usuário.

Edições simultâneas não se atropelam: o cliente manda `patch` e o **servidor** mescla com
`jsonb ||`. Dois usuários editando títulos diferentes ao mesmo tempo mantêm as duas
mudanças — mandar o objeto inteiro faria o último a salvar apagar a edição do outro.

### O mapa importado tem prioridade sobre o do pipeline

Havendo `mapa_kmz` no banco, ele substitui `data/mapa_of.js`. Isso é intencional (foi
uma importação manual, deliberada), mas significa que **o pipeline atualiza o mapa e
ninguém vê**. Por isso a barra de ações mostra `MAPA IMPORTADO · arquivo · data` e o dock
de configurações ganha **Mapa importado → Restaurar**, que apaga a chave e devolve o mapa
do pipeline para todos.

A importação grava **antes** de trocar o mapa na tela: se a senha estiver errada ou o
servidor recusar, o usuário continua vendo o mapa que já estava lá, em vez de uma
importação que parece ter dado certo e some no F5 — que era exatamente o sintoma antigo.

Limite de 3,5 MB por chave (a Vercel Hobby corta perto de 4,5 MB). O KMZ atual do
projeto ocupa 200 KB como GeoJSON, com folga larga.

### 17b. Modelo de IA é compartilhado; a chave, não

`site_config.ia` guarda `{provider, model}` e vale para todos. A **chave de API fica
só no `localStorage`** de quem a cadastrou, e isso é deliberado: o `GET /api/config`
é público, então gravar a chave ali a entregaria a qualquer visitante. O servidor
reforça a regra — na chave `ia` ele reconstrói o objeto com apenas `provider` e
`model`, descartando qualquer outro campo que o cliente mande.

Salvar a chave de API **não** pede a senha do servidor: ela é local. A senha só entra
quando provedor ou modelo mudaram de fato, porque aí a mudança atinge todo mundo.

Padrão de fábrica: OpenRouter com `nvidia/nemotron-3-ultra-550b-a55b:free`. A lista
traz cinco modelos gratuitos primeiro, marcados **GRÁTIS**. Modelo free na OpenRouter
sempre termina em `:free`, e os ids foram conferidos em `openrouter.ai/api/v1/models`
— id inventado não falha ao salvar, falha na primeira pergunta, com um 404 que parece
problema de chave.

### 17c. O chat lembra da conversa

`historicoChat` guarda pergunta e resposta final de cada rodada e vai junto na
requisição seguinte. É o que faz "liste os empreendimentos" logo depois de "quantos
empreendimentos da OPUS em 2026?" herdar OPUS e 2026 em vez de listar a base inteira.

As idas e voltas de SQL de dentro de uma rodada **não** entram no histórico: são
rascunho, e repetir 24 KB de JSON de resultado a cada nova pergunta estouraria o
contexto em poucas trocas. A janela guarda 8 pares e desliza — a 9ª pergunta descarta
a 1ª. O `system prompt` explica a regra ao modelo, senão ele pede esclarecimento em
vez de usar o histórico que já recebeu.

A memória vive na aba: recarregar a página começa conversa nova.
