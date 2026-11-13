# Plano — Boletim de Acompanhamento Diário (BA)

## Contexto

Ao fim de cada dia a etapa emite um boletim que compila tudo o que foi lançado na data: serviços em execução, pendências abertas e encerradas (com fotos e observações), condições meteorológicas, indicadores e dados administrativos da etapa. Modelo do cabeçalho: boletim `BA2/111126/COFZ` da 2ª etapa (CO-FZ, campus do ITA em Fortaleza).

## Decisões (2026-11-13)

- **Abrangência:** um boletim por **etapa** por dia, com as seções separadas por obra (ex.: Bloco de Alojamento e Bloco Didático).
- **Emissão:** **automática** em horário fixo (hora local da obra), sem revisão prévia; o fiscal pode emitir **retificação** (`-R1`, `-R2`…), que substitui a anterior e fica registrada.
- **Clima:** **Open-Meteo** (ponto exato da etapa, modelo hora a hora, sem chave) **+ INMET** (estação automática mais próxima, dado medido). Exige pedir token ao INMET.
- **Numeração:** `BA<sigla da etapa>/<YYMMDD>/<OM>`, ex.: `BA2/261111/COFZ`. Sigla = novo campo curto da etapa (`2`); OM = `organizacao.nome` em maiúsculas, sem acentos e só com letras e números (`CO-FZ` → `COFZ`). Retificação: `BA2/261111/COFZ-R1`.

## Clima

**Localização:** `etapa` ganha `latitude`, `longitude`, `endereco`, `fuso` (IANA, ex.: `America/Fortaleza`, preenchido pela resposta do Open-Meteo com `timezone=auto`) e `inmet_estacao` (código, ex.: `A305`). No site de admin: endereço/CEP → geocodificação → pino no mapa para confirmar; a estação INMET é sugerida pela menor distância (lista de estações automáticas) e pode ser trocada.

**Open-Meteo** (`api.open-meteo.com/v1/forecast`, `past_days=1`, `timezone=auto`): horário de `temperature_2m`, `relative_humidity_2m`, `apparent_temperature`, `precipitation`, `weather_code`, `cloud_cover`, `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `uv_index`. Testado em 2026-11-13 para a Av. Borges de Melo: responde com fuso `America/Fortaleza`.
- É modelo, não medição: para 11/11/2026 o modelo deu 3,8 mm em chuvisco (0,1–0,5 mm/h de manhã) enquanto o boletim manual registrou sol. Regra: chuva < 0,2 mm/h não conta como "com chuva"; o INMET aparece ao lado como dado medido.
- Plano gratuito é para uso não comercial (~1 chamada por etapa por dia); confirmar o enquadramento do órgão.

**INMET** (`apitempo.inmet.gov.br`): dados horários da estação (UTC). Em 2026-11-13 a API não respondeu a partir do ambiente de desenvolvimento; a API atual exige token. Pendente: pedir o token ao INMET e guardar nos segredos das Edge Functions. Sem token ou sem resposta, o boletim sai só com o Open-Meteo e diz "INMET indisponível".

**Coleta:** pg_cron + pg_net (mesmo padrão do `publish-outbox`) chamam a Edge Function `coletar-clima` antes da emissão; grava `clima_dia` (etapa, data local, fonte `open-meteo|inmet`, horário em `jsonb`, resumo, `obtido_em`). Repetível sem duplicar (`unique (etapa_id, data, fonte)`).

**No boletim** (substitui "SOL / CHUVA"):
- Manhã (6h–12h) e Tarde (12h–18h): condição (código WMO → texto em português), faixa de temperatura, chuva (mm), rajada máxima.
- Dia: mínima/máxima, umidade média e mínima, chuva total e horas com chuva, vento médio e rajada máxima com direção, UV máximo.
- Gráfico hora a hora (temperatura em linha, chuva em barras) e linha de fonte: "Open-Meteo (modelo, ponto da obra) · INMET A305 Fortaleza (medido, a X km)".

## Dados administrativos da etapa

Novos campos em `etapa` (editados no admin): objeto (texto da obra/serviço), local, contratante, contrato, contratada, CNPJ, OS nº, data de assinatura da OS, vigência original (meses), valor original, área total construída, responsáveis (fiscais). Tabela `etapa_aditivo` (número, data, acréscimo de prazo em dias, acréscimo de valor) → vigência e valor atualizados.

Calculados: data de término prevista, dias decorridos desde a OS, % do prazo decorrido, dias restantes.

## Conteúdo do boletim

1. Cabeçalho (logo e nome da OM, número, data de expedição, assunto, obra/serviço, local, responsáveis).
2. Dados da obra/serviço (administrativos + prazo).
3. Condições meteorológicas.
4. Indicadores (etapa e por obra):
   - Pendências: abertas no início do dia, abertas no dia, encerradas no dia, abertas no fim do dia; acumulado aberto/encerrado; taxa de resolução.
   - Envelhecimento: abertas há mais de 7, 15 e 30 dias; tempo médio de resolução.
   - Atividade: registros de serviço, fotos e ambientes com lançamento no dia; quantas pessoas lançaram.
   - Clima acumulado: dias com chuva e chuva total no mês e desde a OS.
5. Serviços em execução no dia: obra → pavimento → ambiente; fotos (2 por linha, comprimidas), legenda, autor, hora.
6. Pendências abertas no dia e pendências encerradas no dia (foto original + foto de comprovação, observação, quem encerrou).
7. Observações (preenchidas na retificação, quando houver).
8. Responsáveis.

**Data de um lançamento:** `registro.capturado_em` e `encerramento.encerrado_em` convertidos para o `fuso` da etapa.

## Emissão

- pg_cron por etapa no horário local configurado (padrão 23:30) → Edge Function `emitir-boletim`: coleta o clima (se faltar), monta o **snapshot** (`jsonb`) do dia, grava `boletim` (etapa, data, numero, revisao, snapshot, pdf_path, emitido_em, emitido_por = null quando automático) e gera o PDF.
- PDF: página HTML do boletim renderizada por Chromium em função da Vercel (fidelidade ao modelo da CO-FZ); arquivo no bucket privado `boletins` e envio ao grupo da etapa no Telegram (`sendDocument`, tópico Geral).
- Emitido = imutável. Retificação: o fiscal edita observações/correções no app, gera `-R1` com novo snapshot; o anterior fica no histórico como substituído.
- Lançamentos que chegam depois da emissão (registro offline com `capturado_em` do dia já emitido): aparecem no boletim seguinte em "Lançamentos recebidos após a emissão" e o app sugere retificação ao fiscal.
- Idempotente: `unique (etapa_id, data, revisao)`; nova tentativa não duplica número nem mensagem.

## Etapas de implementação

1. Migration: campos da etapa (sigla, localização, fuso, estação INMET, dados administrativos), `etapa_aditivo`, `clima_dia`, `boletim`, bucket `boletins`, RLS (leitura para participantes da etapa; escrita só por service_role e RPC de retificação); função `numero_boletim(etapa, data, revisao)`.
2. Admin: formulário de dados administrativos, aditivos, localização com mapa e sugestão de estação INMET.
3. `coletar-clima` (Open-Meteo + INMET) e testes Deno com respostas gravadas.
4. RPC/consulta do snapshot do dia (indicadores, serviços, pendências) + testes de banco.
5. Template HTML do boletim + geração do PDF + bucket + envio ao Telegram.
6. Agendamento por etapa, retificação e tela "Boletins" no Mini App (lista, abrir PDF, retificar).

## Verificação

- Testes de banco: snapshot de um dia com registros, pendências abertas/encerradas e lançamento tardio; contagens dos indicadores; número `BA2/261111/COFZ` e `-R1`; fuso diferente (ex.: `America/Rio_Branco`) muda o dia de um lançamento às 23h.
- Testes Deno: conversão de códigos WMO, resumo manhã/tarde, limiar de chuva, INMET indisponível.
- Playwright: template do boletim com fixture → PDF com cabeçalho, tabela de clima e fotos.
- Real: uma semana de boletins da 2ª etapa comparados com o boletim manual e com o INMET.

## Pendências externas

- Token da API do INMET.
- Confirmar o uso do Open-Meteo gratuito pelo órgão.
- Coordenadas exatas do canteiro da 2ª etapa e preenchimento dos dados administrativos.
