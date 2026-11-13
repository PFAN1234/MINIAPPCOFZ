# Plano — Boletim de Acompanhamento Diário (BA)

## Contexto

Ao fim de cada dia a etapa emite um boletim que compila tudo o que foi lançado na data: serviços em execução, pendências abertas e encerradas (com fotos e observações), condições meteorológicas, indicadores e dados administrativos da etapa. Modelo do cabeçalho: boletim `BA2/111126/COFZ` da 2ª etapa (CO-FZ, campus do ITA em Fortaleza).

## Decisões (2026-11-13)

- **Abrangência:** um boletim por **etapa** por dia, com as seções separadas por obra (ex.: Bloco de Alojamento e Bloco Didático).
- **Emissão:** **automática** em horário fixo (hora local da obra), sem revisão prévia; o fiscal pode emitir **retificação** (`-R1`, `-R2`…), que substitui a anterior e fica registrada.
- **Clima:** **só INMET** (estação automática mais próxima, dado medido; decisão de 2026-11-13, substitui Open-Meteo + INMET). Exige pedir token ao INMET. A condição do céu (ensolarado/parcialmente nublado/nublado) é **estimada pela radiação solar** medida.
- **Nome de exibição:** cada pessoa tem um nome de exibição em texto livre, maiúsculas (ex.: Patricio Ferreira → `CP PATRICIO`), definido **só por admins** no site; vale no Mini App, nas publicações do Telegram e nos boletins.
- **Observações:** várias notas por obra e por dia, escritas por **qualquer participante** na página inicial da obra no Mini App; o boletim compila as de todas as obras da etapa na seção Observações.
- **Numeração:** `BA<sigla da etapa>/<YYMMDD>/<OM>`, ex.: `BA2/261111/COFZ`. Sigla = novo campo curto da etapa (`2`); OM = `organizacao.nome` em maiúsculas, sem acentos e só com letras e números (`CO-FZ` → `COFZ`). Retificação: `BA2/261111/COFZ-R1`.

## Clima (INMET)

**Localização:** `etapa` ganha `latitude`, `longitude`, `endereco`, `fuso` e `inmet_estacao` (código, ex.: `A305`), mais `inmet_estacao_reserva` opcional. Preenchidos no formulário da etapa (ver abaixo): endereço/CEP → geocodificação → pino no mapa para confirmar; a estação é sugerida pela menor distância na lista de estações automáticas do INMET (a segunda mais próxima vira a reserva) e pode ser trocada. O `fuso` é escolhido numa lista dos fusos do Brasil (IANA, ex.: `America/Fortaleza`, `America/Manaus`, `America/Rio_Branco`, `America/Noronha`), pré-preenchido pela UF da estação.

**Dados usados** (`apitempo.inmet.gov.br`, estação automática, de hora em hora, em UTC): `CHUVA` (mm), `TEM_INS/MAX/MIN` (°C), `UMD_INS/MAX/MIN` (%), `PTO_INS` (ponto de orvalho), `PRE_INS` (hPa), `VEN_VEL`, `VEN_DIR`, `VEN_RAJ` (m/s → km/h) e `RAD_GLO` (kJ/m²). Dados brutos: horas faltando aparecem como "sem dado"; se faltar mais da metade das horas do expediente na estação principal, usa a reserva e o boletim indica qual estação valeu.

**Céu estimado pela radiação:** para cada período, razão entre a radiação medida e a de céu limpo calculada para a posição da estação e a hora (modelo de Haurwitz): ≥ 75% ensolarado; 45–75% parcialmente nublado; < 45% nublado. Limiares a calibrar com uma semana de dados reais da A305; o boletim diz que é estimativa.

**Acesso:** em 2026-11-13 todos os endereços do INMET devolveram resposta vazia a partir do ambiente de desenvolvimento (provável bloqueio de acessos de fora do Brasil). A coleta precisa sair do Brasil: testar a Edge Function com a região fixada em `sa-east-1` assim que houver token; se não der, outra saída no Brasil.

**Coleta:** pg_cron + pg_net (mesmo padrão do `publish-outbox`) chamam a Edge Function `coletar-clima` antes da emissão e de novo na madrugada seguinte; grava `clima_dia` (etapa, data local, estação, horário em `jsonb`, resumo, `obtido_em`), `unique (etapa_id, data, estacao)`. Sem dado na emissão, o boletim sai com "Dados meteorológicos indisponíveis (INMET)"; se o dado chegar depois, o app sugere retificação ao fiscal.

**No boletim** (substitui "SOL / CHUVA"):
- Manhã (6h–12h) e Tarde (12h–18h): condição ("Sem chuva · ensolarado", "Chuva · nublado"), faixa de temperatura, umidade, chuva (mm e horário), vento médio / rajada, radiação (% do céu limpo).
- Dia: mínima/máxima e ponto de orvalho, umidade média e mínima, chuva total e horas com chuva, vento máximo com direção, rajada, pressão.
- Gráfico hora a hora (temperatura em linha, chuva em barras, radiação medida × céu limpo) e a fonte: estação, distância da obra, horário de obtenção.
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

- pg_cron por etapa no horário local configurado (padrão 23:30) → Edge Function `emitir-boletim`: coleta o clima do INMET (se faltar), monta o **snapshot** (`jsonb`) do dia, grava `boletim` (etapa, data, numero, revisao, snapshot, pdf_path, emitido_em, emitido_por = null quando automático) e gera o PDF.
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
4. `coletar-clima` (INMET, estação reserva, céu pela radiação) e testes Deno com respostas gravadas; teste real de acesso a partir de `sa-east-1`.
5. RPC/consulta do snapshot do dia (indicadores, serviços, pendências, observações) + testes de banco.
6. Template HTML do boletim + geração do PDF + bucket + envio ao Telegram.
7. Agendamento por etapa, retificação e tela "Boletins" no Mini App (lista, abrir PDF, retificar).

## Verificação

- Testes de banco: snapshot de um dia com registros, pendências abertas/encerradas e lançamento tardio; contagens dos indicadores; número `BA2/261111/COFZ` e `-R1`; fuso diferente (ex.: `America/Rio_Branco`) muda o dia de um lançamento às 23h.
- Testes de banco: nome de exibição só por admin e não sobrescrito no login; observação travada depois da emissão; participante de outra obra não lê observações.
- Testes Deno: conversão UTC → fuso e m/s → km/h, resumo manhã/tarde, céu pela radiação, horas faltando e troca para a estação reserva, INMET indisponível.
- Playwright: template do boletim com fixture → PDF com cabeçalho, tabela de clima e fotos.
- Real: uma semana de boletins da 2ª etapa comparados com o boletim manual (inclusive a condição do céu estimada) para calibrar os limiares.

## Pendências externas

- Token da API do INMET.
- Confirmar que a coleta a partir do Supabase (`sa-east-1`) alcança o INMET.
- Nomes de exibição de todos os participantes.
- Coordenadas exatas do canteiro da 2ª etapa e preenchimento dos dados administrativos.
