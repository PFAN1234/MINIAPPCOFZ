# Contrato: equipe de serviço (check-in e check-out) e abas de etapa no início

Decisões do usuário (13/11):

- A tela de início mostra **abas com todas as etapas ativas**, lado a lado, sempre visíveis.
- Sai a seção "Últimos registros"; entra a seção **Equipe de serviço** da etapa escolhida.
- **Quem participa da etapa** (tem participação em alguma obra ativa dela) pode fazer check-in. Não há escala cadastrada.
- O check-in **exige estar a até 1 km** da coordenada da etapa (`etapa.latitude/longitude`), com a posição do GPS do celular. O check-out não pede localização.
- Esqueceu o check-out: o serviço **fecha sozinho 24 h depois da entrada** e aparece como "saída não registrada".
- Check-in e check-out **avisam no grupo** da etapa (tópico Geral). O fechamento automático não avisa.
- O boletim ganha a **lista da equipe de serviço do dia** (entrada e saída), e os militares de serviço passam a ser os **RESPONSÁVEIS** do boletim. Se ninguém fez check-in no dia, valem os responsáveis cadastrados na etapa (como hoje).

## Parte A: banco (`supabase/migrations/20261116090000_equipe_servico.sql`)

### Tabela `public.servico`

| coluna | tipo | regra |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| etapa_id | uuid not null → etapa(id) on delete cascade | |
| usuario_id | uuid not null → usuario(id) on delete cascade | |
| entrada_em | timestamptz not null default now() | |
| saida_em | timestamptz null | check `saida_em is null or saida_em >= entrada_em` |
| saida_automatica | boolean not null default false | check `not saida_automatica or saida_em is not null` |
| latitude, longitude | double precision not null | posição do check-in |
| precisao_m | double precision null | precisão informada pelo celular |
| distancia_m | double precision not null | distância calculada até a etapa |
| criado_em | timestamptz not null default now() | |

- Índice único parcial: um serviço aberto por usuário (`unique (usuario_id) where saida_em is null`).
- Índice `(etapa_id, entrada_em)`.
- RLS ligada, sem políticas (tudo por RPC `security definer`). Sem grants diretos a `anon`/`authenticated`.

### Funções internas (`privado`, sem execute para `public, anon, authenticated`)

- `privado.fechar_servicos_vencidos()`: `update servico set saida_em = entrada_em + interval '24 hours', saida_automatica = true where saida_em is null and entrada_em + interval '24 hours' <= now()`.
- `privado.distancia_m(lat1, lon1, lat2, lon2) returns double precision`: haversine, raio 6 371 000 m, `immutable`.
- `privado.participa_da_etapa(p_etapa uuid) returns boolean`: existe participação de `auth.uid()` em obra **ativa** da etapa, com a etapa ativa.
- `privado.servico_saida_efetiva(s public.servico) returns timestamptz`: `coalesce(s.saida_em, case when s.entrada_em + 24h <= now() then s.entrada_em + 24h end)` (null = em serviço).
- `privado.equipe_do_dia(p_etapa uuid, p_data date) returns jsonb`: serviços da etapa cujo período toca o dia `p_data` no fuso da etapa (`entrada_em < fim_do_dia and coalesce(saida_efetiva, now()) >= inicio_do_dia`), ordenados por `entrada_em`; cada item `{nome, entrada_em, saida_em, saida_automatica}`, com `saida_em` = saída efetiva (null se em serviço) e `saida_automatica` true quando a saída efetiva veio das 24 h. `nome` = `privado.nome_pessoa(usuario_id)`. `[]` se ninguém.
- `privado.responsaveis_do_dia(p_etapa uuid, p_data date) returns jsonb`: se `equipe_do_dia` não for vazia, uma entrada por **usuário distinto** da equipe (ordem da primeira entrada) `{nome, funcao}`, com `funcao` = a função dele em `etapa_responsavel` da etapa, se houver, senão `'Militar de serviço'`; se for vazia, os cadastrados em `etapa_responsavel` no formato atual (`{nome, funcao}` por `ordem, usuario_id`).

### Snapshot do boletim

Renomear `privado.boletim_snapshot(uuid, date)` para `privado.boletim_snapshot_base` (mesmos grants) e criar um novo `privado.boletim_snapshot(p_etapa uuid, p_data date)` que devolve `base || jsonb_build_object('responsaveis', privado.responsaveis_do_dia(p_etapa, p_data), 'equipe_servico', privado.equipe_do_dia(p_etapa, p_data))`. Os chamadores (`public.boletim_snapshot`, `admin_boletim_snapshot`, emissão) continuam chamando pelo nome. `versao` continua 1; `equipe_servico` é campo novo e opcional (snapshots antigos não têm).

A conferência de dados faltando (`'responsaveis'` quando a etapa não tem cadastrados) **não muda**: os cadastrados são o reserva.

### Publicação no grupo

`publicacao_telegram` ganha `servico_id uuid references servico(id) on delete cascade` e `servico_evento text check (servico_evento in ('entrada','saida'))`, com:

- `publicacao_um_dono`: `num_nonnulls(registro_id, encerramento_id, boletim_id, servico_id) = 1`;
- `publicacao_obra_coerente`: `(obra_id is null) = (boletim_id is not null or servico_id is not null)`;
- check `(servico_id is null) = (servico_evento is null)`;
- índice único `(servico_id, servico_evento) where servico_id is not null`.

`reivindicar_publicacoes` passa a deixar pendentes também os itens de serviço de etapa arquivada (mesmo padrão do boletim). O gatilho que acorda a publish-outbox ao inserir em `publicacao_telegram` já existe.

### RPCs do Mini App (`authenticated`; `security definer`, `search_path = ''`)

Todas chamam `privado.fechar_servicos_vencidos()` antes (menos `etapas_inicio`).

1. `public.etapas_inicio() returns table (id uuid, slug text, nome text, ordem int, participa boolean)`: etapas não arquivadas, `order by ordem, nome`; `participa` = `privado.participa_da_etapa(id)`.
2. `public.equipe_servico(p_etapa uuid) returns jsonb`:
   ```json
   {
     "etapa_id": "…", "participa": true, "tem_localizacao": true,
     "meu_servico": {"id": "…", "etapa_id": "…", "etapa_nome": "2ª ETAPA", "entrada_em": "…"} ,
     "equipe": [{"id": "…", "usuario_id": "…", "nome": "CP PATRICIO", "entrada_em": "…",
                 "saida_em": null, "saida_automatica": false, "eu": true}]
   }
   ```
   - `meu_servico`: o serviço aberto do usuário em **qualquer** etapa, ou null.
   - `equipe`: serviços da etapa abertos + os encerrados com saída nas últimas 24 h; abertos primeiro, depois por `entrada_em desc`. `nome` = `privado.nome_pessoa`.
   - Etapa inexistente ou arquivada: erro `P0002` "Etapa não encontrada". Qualquer usuário autenticado pode ler (participante ou não).
3. `public.fazer_checkin(p_etapa uuid, p_latitude double precision, p_longitude double precision, p_precisao double precision default null) returns jsonb` (mesmo formato de `equipe_servico`). Erros, nesta ordem:
   - etapa inexistente/arquivada: `P0002` "Etapa não encontrada";
   - não participa: `42501` "Você não participa desta etapa";
   - coordenadas nulas ou fora de [-90,90]/[-180,180]: `22023` "Localização inválida";
   - etapa sem latitude/longitude: `P0001` "A localização da etapa não está cadastrada. Peça ao administrador para preencher no site.";
   - já tem serviço aberto: `23505` "Você já está de serviço na <nome da etapa>";
   - distância > 1000 m: `P0001` "Você está a <d> da etapa. O check-in só vale até 1 km." (`<d>` = "850 m" abaixo de 1 km, "2,3 km" acima, vírgula decimal).
   Sucesso: insere o serviço e a publicação `(servico_id, servico_evento='entrada', estado 'pendente')`.
4. `public.fazer_checkout() returns jsonb` (formato de `equipe_servico`, da etapa do serviço fechado): fecha o serviço aberto do usuário (`saida_em = now()`) e enfileira `servico_evento='saida'`. Sem serviço aberto: `P0002` "Você não está de serviço".

Testes em `tests/db/test_equipe_servico.py`, no padrão de `tests/db/conftest.py`: cada erro acima, distância (perto/longe/sem coordenadas), um aberto por usuário, fechamento automático em 24 h (manipulando `entrada_em`), `equipe_servico` para não participante, publicação enfileirada nos dois eventos e nenhuma no fechamento automático, snapshot com `responsaveis` e `equipe_servico` (com check-in e sem check-in → cadastrados; função cadastrada vs "Militar de serviço"; serviço que atravessa a meia-noite aparece nos dois dias), grants (anon sem execute; funções `privado` sem execute para authenticated).

## Parte B: boletim e Telegram

### Gerador (`app/servidor/boletim/`)

- `tipos.ts`: `Snapshot.equipe_servico?: { nome: string; entrada_em: string; saida_em: string | null; saida_automatica: boolean }[]`.
- `template.ts`, seção 8 RESPONSÁVEIS: quando `equipe_servico` existir e não for vazia, antes das assinaturas, uma tabela "Equipe de serviço" com colunas Militar | Entrada | Saída (data e hora no fuso do snapshot, `dd/mm HH:MM`; saída null → "em serviço"; automática → "não registrada"). Quando existir e for vazia: linha "Nenhum check-in de serviço neste dia; assinam os responsáveis cadastrados na etapa." Quando não existir (snapshot antigo): nada muda. Testes no padrão dos testes de template existentes.

### Edge Function `publish-outbox`

- `Publicacao` ganha `servico_id?` e `servico_evento?`. Em `processar`, antes do ramo de obra: `if (pub.servico_id) return await processarServico(pub)`.
- `processarServico`: lê o serviço (`etapa_id, usuario_id, entrada_em, saida_em`), a etapa (`nome, telegram_chat_id, fuso`) e o usuário (`nome, nome_exibicao`, via `nomeMostrado`). Etapa sem grupo → `pendente` com `ESPERA_SEM_TOPICO_MIN` (como o boletim). `sendMessage` com `chat_id`, `parse_mode: HTML`, sem `message_thread_id` (tópico Geral), texto:
  - entrada: `🟢 <b>{nome}</b> entrou de serviço às {HH:MM} · {etapa}`
  - saída: `🔴 <b>{nome}</b> saiu do serviço às {HH:MM} · {etapa}`
  com a hora de `entrada_em`/`saida_em` no fuso da etapa e nome/etapa escapados para HTML. Serviço não encontrado → `falhou`. Resultado por `classificar`, como os demais.
- Testes em `handler_test.ts`: os dois textos, fuso, etapa sem grupo, serviço não encontrado.

## Parte C: Mini App

### Dados (`app/src/dados/`)

- Tipos: `EtapaInicio {id, slug, nome, ordem, participa}`, `MembroServico {id, usuario_id, nome, entrada_em, saida_em, saida_automatica, eu}`, `EquipeServico {etapa_id, participa, tem_localizacao, meu_servico: {id, etapa_id, etapa_nome, entrada_em} | null, equipe: MembroServico[]}`, `Posicao {latitude, longitude, precisao: number | null}`.
- `Repositorio`: `etapasInicio()`, `equipeServico(etapaId)`, `fazerCheckin(etapaId, posicao)`, `fazerCheckout()`. Implementar em `supabase.ts` (RPCs da Parte A) e no fixture (estado em memória; o fixture participa de todas as etapas dele, tem coordenadas e aceita qualquer posição; ter uma etapa extra em que não participa).
- Hooks: `useEtapasInicio()`, `useEquipeServico(etapaId)` (refetch a cada 60 s e ao focar), `useCheckin(etapaId)`, `useCheckout()`; as mutações gravam o retorno no cache de `useEquipeServico` da etapa e invalidam as outras equipes.

### Localização (`app/src/util/localizacao.ts`)

`obterPosicao(): Promise<Posicao>`: usa o `LocationManager` do Telegram (Bot API 8.0+: `init`, `isLocationAvailable`, `isAccessGranted`/`isAccessRequested`, `getLocation(cb)`, `openSettings()`) quando existir e estiver disponível; senão `navigator.geolocation.getCurrentPosition` (`enableHighAccuracy`, timeout 15 s). Erros com mensagens em pt-BR: sem permissão ("Permita o acesso à localização para fazer o check-in." e, no Telegram, oferecer abrir os ajustes), sem GPS, tempo esgotado. Tipos do LocationManager em `telegram.ts`.

### Tela de início (`app/src/telas/Obras.tsx`)

- Topo azul: título "Obras" e **abas de etapa** (componente novo `AbasEtapa`, `role="tablist"`, botões lado a lado com rolagem horizontal, aba ativa destacada), substituindo `SeletorEtapa` e o subtítulo. Lista = `etapasInicio` unida às etapas das obras em cache (`etapasDasObras`), para funcionar offline. A escolha continua guardada (`useEtapaEscolhida`). Aparece mesmo com uma etapa só.
- Etapa em que o usuário não participa e não tem obras para pedir acesso: no lugar da lista de obras, aviso "Você não participa desta etapa. Entre no grupo dela no Telegram e abra o app de novo para pedir acesso."
- **Remover** a seção "Últimos registros" (e o que só ela usava).
- Nova seção **Equipe de serviço** (componente `EquipeServico`), entre as obras e "Administração":
  - Lista: nome; "Em serviço desde HH:MM" (ou "desde dd/mm HH:MM" se não for hoje) ou "HH:MM – HH:MM" / "– saída não registrada". "(você)" no próprio. Vazia: "Ninguém de serviço agora."
  - Botão principal: **Fazer check-in** (participa e sem serviço aberto); **Fazer check-out** (serviço aberto nesta etapa); com serviço aberto em outra etapa: texto "Você está de serviço na X" e o botão de check-out dela. Não participa: sem botão.
  - Check-in: "Obtendo localização…" → chama `fazerCheckin`; erros do servidor e da localização aparecem em `role="alert"`. Check-out pede confirmação simples (`window.confirm` ou botão de confirmar). Offline: botões desabilitados com "Sem conexão".
  - `tem_localizacao` false: aviso "A localização da etapa não está cadastrada; o check-in fica indisponível." e botão desabilitado.
- Testes (Vitest + Testing Library) no padrão de `Obras.test.tsx`: abas, troca de etapa, sem "Últimos registros", estados da equipe e dos botões, erro de localização, offline.
