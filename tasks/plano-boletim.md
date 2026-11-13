# Plano — Boletim de Acompanhamento Diário (BA)

## Contexto

Ao fim de cada dia a etapa emite um boletim que compila tudo o que foi lançado na data: serviços em execução, pendências abertas e encerradas (com fotos e observações), condições meteorológicas, indicadores e dados administrativos da etapa. Modelo do cabeçalho: boletim `BA2/111126/COFZ` da 2ª etapa (CO-FZ, campus do ITA em Fortaleza).

## Decisões (2026-11-13)

- **Abrangência:** um boletim por **etapa** por dia, com as seções separadas por obra (ex.: Bloco de Alojamento e Bloco Didático).
- **Emissão:** **automática** em horário fixo (hora local da obra), sem revisão prévia; o fiscal pode emitir **retificação** (`-R1`, `-R2`…), que substitui a anterior e fica registrada.
- **Clima:** **Observatório de Riscos Climáticos de Fortaleza** (Prefeitura de Fortaleza; decisão de 2026-11-13, substitui o INMET, que estava fora do ar): estação principal **Montese** (`8836`), reserva **Benfica** (`9281`). Coleta **de hora em hora**; gráficos **próprios** no estilo do site, com fonte e horário da leitura. Só Fortaleza por enquanto (sem outra fonte para obras fora da cidade). A condição do céu é estimada pelo **índice UV** (a Montese não mede radiação).
- **Nome de exibição:** cada pessoa tem um nome de exibição em texto livre, maiúsculas (ex.: Patricio Ferreira → `CP PATRICIO`), definido **só por admins** no site; vale no Mini App, nas publicações do Telegram e nos boletins.
- **Observações:** várias notas por obra e por dia, escritas por **qualquer participante** na página inicial da obra no Mini App; o boletim compila as de todas as obras da etapa na seção Observações.
- **Numeração:** `BA<sigla da etapa>/<YYMMDD>/<OM>`, ex.: `BA2/261111/COFZ`. Sigla = novo campo curto da etapa (`2`); OM = `organizacao.nome` em maiúsculas, sem acentos e só com letras e números (`CO-FZ` → `COFZ`). Retificação: `BA2/261111/COFZ-R1`.

## Clima (Observatório de Fortaleza)

**Fonte:** página pública `https://observatorio.fortaleza.ce.gov.br/riscos-climaticos/estacoes-meteorologicas` (robots.txt libera; atualizada a cada 10 min; 11 estações). Não há API: a página é gerada no servidor e cada estação tem uma ficha `article#estacao-<id>` com:
- valores atuais: temperatura, mín./máx. e sensação térmica; umidade (faixa de 24 h); vento (km/h e rumo, ex.: SE) e rajada máxima; chuva de hoje e do mês; índice UV e classificação; pressão (faixa de 24 h); ponto de orvalho; radiação solar (a Montese mostra "—");
- séries das últimas 24 h, hora a hora, como SVG: temperatura, umidade, vento, UV e pressão em `path.mg-linha` (24 pontos; o `aria-label` traz o mínimo e o máximo, e o valor de cada ponto sai da posição vertical, com precisão de 0,1) e chuva em `rect.mg-barra` (alturas proporcionais; o `aria-label` traz o total, que distribui os milímetros);
- "Leitura às HH:MM" na lista de estações; dados do equipamento (bateria, sinal).
- Testado em 2026-11-13: Montese 27,2–30,9 °C e 62–82% em 24 h; Centro com 1,5 mm = 1,4 + 0,1 mm.

**Riscos:** mudança de layout quebra a leitura → a coleta valida o que leu (24 pontos, faixas coerentes, horário da leitura) e registra falha; o boletim usa a reserva (Benfica) e, sem nenhuma, sai com "Dados meteorológicos indisponíveis (Observatório de Fortaleza)". Uso de dado público da Prefeitura com citação da fonte; vale avisar o IPPLAN/Observatório e, se oferecerem, trocar por um feed oficial.

**Coleta:** pg_cron + pg_net de hora em hora (minuto 5) chamam a Edge Function `coletar-clima`, que baixa a página uma vez, lê as fichas da estação principal e da reserva de cada etapa e grava `clima_leitura` (etapa, estação, hora da leitura, valores atuais, séries de 24 h, `obtido_em`). Repetível sem duplicar (`unique (estacao, leitura_em)`). Na emissão, o dia (0h–24h no fuso da etapa) é montado com as leituras horárias guardadas; `clima_dia` guarda o resumo usado no boletim.

**Cadastro:** os campos `inmet_estacao`/`inmet_estacao_reserva` da etapa passam a ser `estacao`/`estacao_reserva` com o código numérico do Observatório (padrão Montese `8836` e Benfica `9281`); o site mostra a lista das 11 estações pelo nome (a tabela de estações é preenchida pela própria coleta). A sugestão por distância sai (a página não traz coordenadas).

**Céu estimado pelo UV:** razão entre o UV medido e o de céu limpo estimado para a hora e a latitude (`UV_limpo ≈ 12,5 · cos(z)^2,42`, z = ângulo zenital): ≥ 75% ensolarado; 45–75% parcialmente nublado; < 45% nublado. Limiares a calibrar com uma semana de dados; o boletim diz que é estimativa.

**No boletim** (substitui "SOL / CHUVA"):
- Manhã (6h–12h) e Tarde (12h–18h): condição ("Sem chuva · ensolarado", "Chuva · nublado"), faixa de temperatura, umidade, chuva (mm e horário), vento médio / rajada, UV máximo.
- Dia: mínima/máxima e sensação térmica, umidade, chuva total e horas com chuva, vento com rumo, rajada máxima, pressão, ponto de orvalho.
- Gráficos próprios no estilo do site (uma linha por variável: temperatura, umidade, chuva em barras, vento, UV), com a linha de fonte: "Fonte: Observatório de Riscos Climáticos de Fortaleza (Prefeitura de Fortaleza), estação Montese — leitura das 23:20, coletada em 13/11/2026 às 23:25".
- Dia com chuva = chuva ≥ 0,2 mm no dia (conta nos indicadores de clima).

## Dados administrativos da etapa

Preenchidos **no cadastro da etapa** (decisão de 2026-11-13): o formulário de criação/edição do site de admin (`/admin/etapas/<slug>`, RPC `admin_salvar_etapa`), que hoje tem nome e ordem, ganha as seções "Identificação" (sigla), "Localização" e "Dados do contrato". Tudo pode ser corrigido depois na mesma página. Sigla e localização são obrigatórias para criar a etapa (sem elas não há número nem clima); os demais campos podem ficar em branco e saem como "—" no boletim, com aviso na página da etapa enquanto faltarem. A 2ª etapa, que já existe, é completada pela edição.

Novos campos em `etapa`: objeto (texto da obra/serviço), local, contratante, contrato, contratada, CNPJ, OS nº, data de assinatura da OS, vigência original (meses), valor original, área total construída. Responsáveis: `etapa_responsavel` (etapa, usuário, função, ordem), escolhidos entre as pessoas cadastradas e mostrados pelo nome de exibição. Tabela `etapa_aditivo` (número, data, acréscimo de prazo em dias, acréscimo de valor), lançada na página da etapa à medida que os aditivos saem → vigência e valor atualizados.

Calculados: data de término prevista, dias decorridos desde a OS, % do prazo decorrido, dias restantes.

## Nome de exibição

- `usuario.nome_exibicao` (texto, maiúsculas, até 60 caracteres, opcional). O `nome` continua vindo do Telegram e sendo atualizado no login; `nome_exibicao` nunca é sobrescrito pelo `auth-telegram`.
- Site de admin: página **Pessoas** com todos os usuários (participantes, gestores e admins), nome do Telegram, @username, obras/papéis e o nome de exibição editável; RPC `admin_definir_nome_exibicao` (só admin; grava em maiúsculas, sem espaços duplicados).
- Exibição em todo lugar por `coalesce(nome_exibicao, nome)`: autores no Mini App (histórico, pendências, encerramentos, observações), mensagens publicadas no Telegram, pedidos de acesso e boletins. O snapshot do boletim guarda o nome da hora da emissão (trocar o nome depois não altera boletins emitidos).

## Observações da obra

- Tabela `observacao` (id gerado no cliente, obra, autor, data local, texto até 1000 caracteres, criado_em, editado_em). RLS: lê e escreve quem participa da obra.
- Mini App: cartão **Observações do dia** na página inicial da obra, com a lista do dia (hora, autor, texto) e "Adicionar observação"; entra na mesma fila do modo sem sinal que os registros.
- Quem escreveu pode editar ou apagar até a emissão do boletim daquele dia; depois a nota fica travada (RPC confere se já existe boletim da etapa na data) e correções vão por retificação.
- No boletim: seção Observações agrupada por obra (hora · autor · texto); obra sem nota no dia não aparece; nenhuma nota na etapa → "Sem observações".

## Conteúdo do boletim

1. Cabeçalho (logo da OM, linhas da OM, número, data de expedição, assunto, obra/serviço, local, responsáveis). O logo é o da OM cadastrado em `/admin/organizacao` (`organizacao.logo_path`, já existe); `organizacao` ganha `cabecalho` (linhas de subordinação, ex.: COMANDO DA AERONÁUTICA / DIRETORIA DE INFRAESTRUTURA DA AERONÁUTICA / COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)), editado na mesma tela.
2. Dados da obra/serviço (administrativos + prazo).
3. Condições meteorológicas.
4. Indicadores (etapa e por obra):
   - Pendências: abertas no início do dia, abertas no dia, encerradas no dia, abertas no fim do dia; acumulado aberto/encerrado; taxa de resolução.
   - Envelhecimento: abertas há mais de 7, 15 e 30 dias; tempo médio de resolução.
   - Atividade: registros de serviço, fotos e ambientes com lançamento no dia; quantas pessoas lançaram.
   - Clima acumulado: dias com chuva e chuva total no mês e desde a OS.
5. Serviços em execução no dia: obra → pavimento → ambiente; fotos (4 por linha, comprimidas), legenda, autor, hora.
6. Pendências abertas no dia e pendências encerradas no dia (foto original + foto de comprovação, observação, quem encerrou).
7. Observações das obras (ver acima) e, numa retificação, as observações do fiscal.
8. Responsáveis.

**Data de um lançamento:** `registro.capturado_em` e `encerramento.encerrado_em` convertidos para o `fuso` da etapa.

## Emissão

- pg_cron por etapa no horário local configurado (padrão 23:30) → Edge Function `emitir-boletim`: monta o clima do dia com as leituras horárias do Observatório, monta o **snapshot** (`jsonb`) do dia, grava `boletim` (etapa, data, numero, revisao, snapshot, pdf_path, emitido_em, emitido_por = null quando automático) e gera o PDF.
- PDF: página HTML do boletim renderizada por Chromium em função da Vercel (fidelidade ao modelo da CO-FZ); arquivo no bucket privado `boletins` e envio ao grupo da etapa no Telegram (`sendDocument`, tópico Geral).
- Emitido = imutável. Retificação: o fiscal edita observações/correções no app, gera `-R1` com novo snapshot; o anterior fica no histórico como substituído.
- Lançamentos que chegam depois da emissão (registro offline com `capturado_em` do dia já emitido): aparecem no boletim seguinte em "Lançamentos recebidos após a emissão" e o app sugere retificação ao fiscal.
- Idempotente: `unique (etapa_id, data, revisao)`; nova tentativa não duplica número nem mensagem.

## Prévia visual

`docs/mockups/boletim-diario-v2.pdf` (e páginas em PNG): gerada por `docs/mockups/reproduce/boletim/`, com todos os dados ilustrativos (clima no formato do INMET). A v1, com Open-Meteo, está no histórico do Git.

## Etapas de implementação

1. Migration: campos da etapa (sigla, localização, fuso, estações INMET, dados administrativos), `etapa_aditivo`, `etapa_responsavel`, `usuario.nome_exibicao`, `observacao`, `organizacao.cabecalho`, `clima_dia`, `boletim`, bucket `boletins`, RLS (boletins: leitura para participantes da etapa; escrita só por service_role e RPC de retificação); função `numero_boletim(etapa, data, revisao)`.
2. Admin: página Pessoas (nome de exibição); formulário de cadastro/edição da etapa com sigla, localização (mapa, estações INMET sugeridas, fuso), dados do contrato e responsáveis; aditivos na página da etapa; linhas do cabeçalho em `/admin/organizacao`.
3. Mini App: nome de exibição em todas as telas e publicações; cartão Observações do dia na obra (com fila offline).
4. `coletar-clima` (Observatório de Fortaleza, de hora em hora, estação reserva, céu pelo UV) com testes Deno sobre uma cópia gravada da página; migration das estações e `clima_leitura`; ajuste do cadastro da etapa no site.
5. RPC/consulta do snapshot do dia (indicadores, serviços, pendências, observações) + testes de banco.
6. Template HTML do boletim + geração do PDF + bucket + envio ao Telegram.
7. Agendamento por etapa, retificação e tela "Boletins" no Mini App (lista, abrir PDF, retificar).

## Verificação

- Testes de banco: snapshot de um dia com registros, pendências abertas/encerradas e lançamento tardio; contagens dos indicadores; número `BA2/261111/COFZ` e `-R1`; fuso diferente (ex.: `America/Rio_Branco`) muda o dia de um lançamento às 23h.
- Testes de banco: nome de exibição só por admin e não sobrescrito no login; observação travada depois da emissão; participante de outra obra não lê observações.
- Testes Deno: leitura das fichas (valores atuais, séries de 24 h a partir do SVG, chuva por barras, horário da leitura), validação contra layout alterado, troca para a estação reserva, resumo manhã/tarde, céu pelo UV.
- Playwright: template do boletim com fixture → PDF com cabeçalho, tabela de clima e fotos.
- Real: uma semana de boletins da 2ª etapa comparados com o boletim manual (inclusive a condição do céu estimada) para calibrar os limiares.

## Pendências externas

- Confirmar que a coleta a partir do Supabase alcança a página do Observatório.
- Avisar o Observatório/IPPLAN do uso dos dados (e pedir um feed oficial, se houver).
- Nomes de exibição de todos os participantes.
- Coordenadas exatas do canteiro da 2ª etapa e preenchimento dos dados administrativos.
