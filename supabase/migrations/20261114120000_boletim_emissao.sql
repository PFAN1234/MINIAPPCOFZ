-- Boletim de Acompanhamento Diário, parte 3: geração, emissão e envio.
-- Contrato: docs/contrato-boletim.md ("Parte 3"); plano: tasks/plano-boletim.md.
--
-- - Clima pelo Observatório de Riscos Climáticos de Fortaleza: `etapa.inmet_estacao`/
--   `inmet_estacao_reserva` passam a `estacao`/`estacao_reserva` (código numérico, padrão Montese
--   8836 e Benfica 9281). Saem `inmet_estacao`, `clima_dia` e `admin_sugerir_estacoes`.
-- - Fila `boletim_emissao`: o pg_cron (`privado.agendar_boletins`, a cada 5 min) cria o pedido do
--   dia depois do horário da etapa e aciona o gerador (Vercel, `app/api/gerar-boletim.ts`), que
--   reivindica os pedidos, lê o snapshot, gera o PDF e conclui (ou falha, com nova tentativa).
-- - `publicacao_telegram.boletim_id`: o boletim emitido vai ao grupo da etapa pela publish-outbox.
-- - RPCs do site: lista de boletins e pedidos, pedido manual (emissão ou retificação) e o
--   snapshot para a prévia.

-- Estações do Observatório no lugar do INMET -----------------------------------------------------

alter table public.etapa
  drop constraint etapa_inmet_formato,
  drop constraint etapa_inmet_reserva_formato,
  drop constraint etapa_inmet_diferentes;
alter table public.etapa rename column inmet_estacao to estacao;
alter table public.etapa rename column inmet_estacao_reserva to estacao_reserva;

-- Códigos do INMET (A305...) não valem no Observatório.
update public.etapa e
   set estacao = case when e.estacao ~ '^[0-9]{3,6}$' then e.estacao end,
       estacao_reserva = case when e.estacao_reserva ~ '^[0-9]{3,6}$' then e.estacao_reserva end
 where e.estacao is not null or e.estacao_reserva is not null;
update public.etapa set estacao = '8836', estacao_reserva = '9281' where slug = '2a-etapa';

alter table public.etapa
  add constraint etapa_estacao_formato check (estacao ~ '^[0-9]{3,6}$'),
  add constraint etapa_estacao_reserva_formato check (estacao_reserva ~ '^[0-9]{3,6}$'),
  add constraint etapa_estacoes_diferentes check (estacao <> estacao_reserva);

comment on column public.etapa.estacao is
  'Estação do Observatório de Riscos Climáticos de Fortaleza (ex.: 8836 Montese); a reserva vale quando a principal está sem leitura recente.';
comment on column public.etapa.estacao_reserva is
  'Estação de reserva do Observatório (ex.: 9281 Benfica).';

drop function public.admin_sugerir_estacoes(double precision, double precision, int);
drop table public.inmet_estacao;
drop table public.clima_dia;

-- Campos do cadastro que o boletim usa e estão vazios, na ordem do contrato.
create or replace function privado.etapa_faltando(p_etapa public.etapa)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when p_etapa.sigla is null then 'sigla' end,
    case when p_etapa.latitude is null or p_etapa.longitude is null then 'localizacao' end,
    case when p_etapa.estacao is null then 'estacao' end,
    case when p_etapa.objeto is null then 'objeto' end,
    case when p_etapa.local is null then 'local' end,
    case when p_etapa.contratante is null then 'contratante' end,
    case when p_etapa.contrato is null then 'contrato' end,
    case when p_etapa.contratada is null then 'contratada' end,
    case when p_etapa.contratada_cnpj is null then 'contratada_cnpj' end,
    case when p_etapa.os_numero is null then 'os_numero' end,
    case when p_etapa.os_data is null then 'os_data' end,
    case when p_etapa.vigencia_meses is null then 'vigencia_meses' end,
    case when p_etapa.valor_original is null then 'valor_original' end,
    case when p_etapa.area_construida_m2 is null then 'area_construida_m2' end,
    case when not exists (select 1 from public.etapa_responsavel r where r.etapa_id = p_etapa.id)
         then 'responsaveis' end
  ], null);
$$;

-- A etapa inteira (formato de admin_obter_etapa), com `estacao`/`estacao_reserva`.
create or replace function privado.etapa_json(p_etapa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.etapa;
  v_termino date;
  v_dias int;
  v_valor numeric;
begin
  select * into e from public.etapa x where x.id = p_etapa;
  if not found then
    raise exception 'Etapa não encontrada' using errcode = 'P0002';
  end if;
  select coalesce(sum(a.prazo_dias), 0)::int, coalesce(sum(a.valor), 0)
    into v_dias, v_valor
    from public.etapa_aditivo a where a.etapa_id = e.id;
  if e.os_data is not null and e.vigencia_meses is not null then
    v_termino := (e.os_data + make_interval(months => e.vigencia_meses))::date;
  end if;

  return jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'nome', e.nome, 'ordem', e.ordem, 'arquivada_em', e.arquivada_em,
    'telegram_vinculado', e.telegram_chat_id is not null, 'telegram_chat_titulo', e.telegram_chat_titulo,
    'sigla', e.sigla, 'endereco', e.endereco, 'latitude', e.latitude, 'longitude', e.longitude,
    'fuso', e.fuso, 'estacao', e.estacao, 'estacao_reserva', e.estacao_reserva,
    'boletim_horario', to_char(e.boletim_horario, 'HH24:MI'),
    'objeto', e.objeto, 'local', e.local, 'contratante', e.contratante, 'contrato', e.contrato,
    'contratada', e.contratada, 'contratada_cnpj', e.contratada_cnpj, 'os_numero', e.os_numero,
    'os_data', e.os_data, 'vigencia_meses', e.vigencia_meses, 'valor_original', e.valor_original,
    'area_construida_m2', e.area_construida_m2,
    'aditivos', coalesce((
      select jsonb_agg(privado.aditivo_json(a) order by a.data, a.numero, a.id)
        from public.etapa_aditivo a where a.etapa_id = e.id
    ), '[]'::jsonb),
    'responsaveis', privado.etapa_responsaveis(e.id),
    'prazo', case when v_termino is null then null else jsonb_build_object(
      'termino_original', v_termino,
      'prazo_aditivos_dias', v_dias,
      'termino_atual', v_termino + v_dias,
      'valor_atual', e.valor_original + v_valor
    ) end,
    'faltando', to_jsonb(privado.etapa_faltando(e))
  );
end;
$$;

-- Cria (sem `id`; slug, nome, sigla, latitude, longitude e fuso obrigatórios; estações 8836/9281 se
-- não vierem) ou edita (com `id`) uma etapa. Na edição, chave ausente mantém o valor e chave com
-- null apaga (menos fuso e boletim_horario, que não aceitam null, e a sigla, que não é apagada
-- depois de definida).
-- Retorno: o mesmo de admin_obter_etapa.
create or replace function public.admin_salvar_etapa(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_slug text;
  v_nome text;
  v_ordem int;
  v_etapa public.etapa;
  v_novo public.etapa;
  v_campo text;
  v_texto text;
  v_num numeric;
begin
  perform privado.exigir_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da etapa inválidos' using errcode = '22023';
  end if;
  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    v_id := privado.uuid_ou_nulo(p ->> 'id');
    if v_id is null then
      raise exception 'Identificador da etapa inválido' using errcode = '22023';
    end if;
  end if;
  if p ? 'slug' and jsonb_typeof(p -> 'slug') not in ('string', 'null') then
    raise exception 'O slug precisa ser texto' using errcode = '22023';
  end if;
  if p ? 'nome' and jsonb_typeof(p -> 'nome') not in ('string', 'null') then
    raise exception 'O nome precisa ser texto' using errcode = '22023';
  end if;
  v_slug := p ->> 'slug';
  v_nome := btrim(p ->> 'nome');
  v_ordem := privado.inteiro_jsonb(p -> 'ordem', 'ordem');

  if v_nome is not null and (v_nome = '' or char_length(v_nome) > 120) then
    raise exception 'Informe o nome da etapa (até 120 caracteres)' using errcode = '22023';
  end if;

  if v_id is null then
    if v_slug is null or v_slug !~ '^[a-z0-9-]+$' or char_length(v_slug) > 40 then
      raise exception 'Slug inválido: use letras minúsculas, dígitos e hífen (até 40 caracteres)'
        using errcode = '22023';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome da etapa (até 120 caracteres)' using errcode = '22023';
    end if;
    foreach v_campo in array array['sigla', 'latitude', 'longitude', 'fuso'] loop
      if not p ? v_campo or jsonb_typeof(p -> v_campo) = 'null'
         or (jsonb_typeof(p -> v_campo) = 'string' and btrim(p ->> v_campo) = '') then
        raise exception 'O campo % é obrigatório na criação da etapa', v_campo using errcode = '22023';
      end if;
    end loop;
    v_novo.fuso := 'America/Sao_Paulo';
    v_novo.boletim_horario := '23:30';
  else
    select * into v_etapa from public.etapa e where e.id = v_id for update;
    if not found then
      raise exception 'Etapa não encontrada' using errcode = 'P0002';
    end if;
    if v_slug is not null and v_slug <> v_etapa.slug then
      raise exception 'O slug não pode ser alterado depois de criado' using errcode = '22023';
    end if;
    v_novo := v_etapa;
  end if;

  -- Identificação
  if p ? 'sigla' then
    v_texto := privado.texto_jsonb(p -> 'sigla', 'A sigla', null);
    if v_texto is null then
      if v_novo.sigla is not null then
        raise exception 'A sigla não pode ser apagada' using errcode = '22023';
      end if;
    else
      if v_texto !~ '^[A-Z0-9]{1,10}$' then
        raise exception 'Sigla inválida: use de 1 a 10 letras maiúsculas ou dígitos' using errcode = '22023';
      end if;
      if exists (select 1 from public.etapa e where e.sigla = v_texto and e.id is distinct from v_id) then
        raise exception 'Já existe uma etapa com a sigla %', v_texto using errcode = '23505';
      end if;
      v_novo.sigla := v_texto;
    end if;
  end if;

  -- Localização
  if p ? 'endereco' then
    v_novo.endereco := privado.texto_jsonb(p -> 'endereco', 'O endereço', 300);
  end if;
  if p ? 'latitude' then
    v_novo.latitude := privado.numero_jsonb(p -> 'latitude', 'latitude', true);
  end if;
  if p ? 'longitude' then
    v_novo.longitude := privado.numero_jsonb(p -> 'longitude', 'longitude', true);
  end if;
  if (v_novo.latitude is null) <> (v_novo.longitude is null) then
    raise exception 'Informe latitude e longitude juntas (ou nenhuma)' using errcode = '22023';
  end if;
  if v_novo.latitude not between -34 and 6 then
    raise exception 'Latitude fora do Brasil: use um valor entre -34 e 6' using errcode = '22023';
  end if;
  if v_novo.longitude not between -74 and -28 then
    raise exception 'Longitude fora do Brasil: use um valor entre -74 e -28' using errcode = '22023';
  end if;
  if p ? 'fuso' then
    if jsonb_typeof(p -> 'fuso') = 'null' then
      raise exception 'O fuso não pode ser apagado' using errcode = '22023';
    end if;
    v_texto := privado.texto_jsonb(p -> 'fuso', 'O fuso', null);
    if v_texto is null or not privado.fuso_valido(v_texto) then
      raise exception 'Fuso inválido: %', coalesce(v_texto, '(vazio)') using errcode = '22023';
    end if;
    v_novo.fuso := v_texto;
  end if;
  -- Estações do Observatório de Fortaleza. Na criação, as que não vierem assumem Montese (8836) e
  -- Benfica (9281), sem repetir a que veio.
  if p ? 'estacao' then
    v_novo.estacao := privado.texto_jsonb(p -> 'estacao', 'A estação', null);
  end if;
  if p ? 'estacao_reserva' then
    v_novo.estacao_reserva := privado.texto_jsonb(p -> 'estacao_reserva', 'A estação de reserva', null);
  end if;
  if v_id is null then
    v_novo.estacao := coalesce(v_novo.estacao,
                               case when v_novo.estacao_reserva = '8836' then '9281' else '8836' end);
    v_novo.estacao_reserva := coalesce(v_novo.estacao_reserva,
                                       case when v_novo.estacao = '9281' then '8836' else '9281' end);
  end if;
  if v_novo.estacao !~ '^[0-9]{3,6}$' or v_novo.estacao_reserva !~ '^[0-9]{3,6}$' then
    raise exception 'Código de estação inválido: use de 3 a 6 dígitos, como 8836' using errcode = '22023';
  end if;
  if v_novo.estacao = v_novo.estacao_reserva then
    raise exception 'A estação de reserva precisa ser diferente da principal' using errcode = '22023';
  end if;
  if p ? 'boletim_horario' then
    if jsonb_typeof(p -> 'boletim_horario') = 'null' then
      raise exception 'O horário do boletim não pode ser apagado' using errcode = '22023';
    end if;
    v_texto := privado.texto_jsonb(p -> 'boletim_horario', 'O horário do boletim', null);
    if v_texto is null or v_texto !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Horário do boletim inválido: use HH:MM' using errcode = '22023';
    end if;
    v_novo.boletim_horario := v_texto::time;
  end if;

  -- Dados do contrato
  if p ? 'objeto' then
    v_novo.objeto := privado.texto_jsonb(p -> 'objeto', 'A obra/serviço', 600);
  end if;
  if p ? 'local' then
    v_novo.local := privado.texto_jsonb(p -> 'local', 'O local', 300);
  end if;
  if p ? 'contratante' then
    v_novo.contratante := privado.texto_jsonb(p -> 'contratante', 'O contratante', 200);
  end if;
  if p ? 'contrato' then
    v_novo.contrato := privado.texto_jsonb(p -> 'contrato', 'O contrato', 60);
  end if;
  if p ? 'contratada' then
    v_novo.contratada := privado.texto_jsonb(p -> 'contratada', 'A contratada', 200);
  end if;
  if p ? 'contratada_cnpj' then
    v_texto := privado.texto_jsonb(p -> 'contratada_cnpj', 'O CNPJ', null);
    if v_texto !~ '^\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$' then
      raise exception 'CNPJ inválido: use o formato 00.000.000/0000-00' using errcode = '22023';
    end if;
    v_novo.contratada_cnpj := v_texto;
  end if;
  if p ? 'os_numero' then
    v_novo.os_numero := privado.texto_jsonb(p -> 'os_numero', 'O número da OS', 40);
  end if;
  if p ? 'os_data' then
    v_novo.os_data := privado.data_jsonb(p -> 'os_data', 'Data da OS');
  end if;
  if p ? 'vigencia_meses' then
    v_novo.vigencia_meses := privado.inteiro_jsonb(p -> 'vigencia_meses', 'vigencia_meses');
    if v_novo.vigencia_meses not between 1 and 240 then
      raise exception 'A vigência precisa estar entre 1 e 240 meses' using errcode = '22023';
    end if;
  end if;
  if p ? 'valor_original' then
    v_num := round(privado.numero_jsonb(p -> 'valor_original', 'valor_original', true), 2);
    if v_num < 0 then
      raise exception 'O valor original não pode ser negativo' using errcode = '22023';
    end if;
    if v_num >= 1e13 then
      raise exception 'O valor original é grande demais' using errcode = '22023';
    end if;
    v_novo.valor_original := v_num;
  end if;
  if p ? 'area_construida_m2' then
    v_num := round(privado.numero_jsonb(p -> 'area_construida_m2', 'area_construida_m2', true), 2);
    if v_num <= 0 then
      raise exception 'A área construída precisa ser maior que zero' using errcode = '22023';
    end if;
    if v_num >= 1e10 then
      raise exception 'A área construída é grande demais' using errcode = '22023';
    end if;
    v_novo.area_construida_m2 := v_num;
  end if;

  if v_id is null then
    if exists (select 1 from public.etapa e where e.slug = v_slug) then
      raise exception 'Já existe uma etapa com o slug %', v_slug using errcode = '23505';
    end if;
    insert into public.etapa (
      slug, nome, ordem, sigla, endereco, latitude, longitude, fuso, estacao, estacao_reserva,
      boletim_horario, objeto, local, contratante, contrato, contratada, contratada_cnpj, os_numero, os_data,
      vigencia_meses, valor_original, area_construida_m2
    ) values (
      v_slug, v_nome, coalesce(v_ordem, 0), v_novo.sigla, v_novo.endereco, v_novo.latitude, v_novo.longitude,
      v_novo.fuso, v_novo.estacao, v_novo.estacao_reserva, v_novo.boletim_horario, v_novo.objeto,
      v_novo.local, v_novo.contratante, v_novo.contrato, v_novo.contratada, v_novo.contratada_cnpj,
      v_novo.os_numero, v_novo.os_data, v_novo.vigencia_meses, v_novo.valor_original, v_novo.area_construida_m2
    )
    returning * into v_etapa;
  else
    update public.etapa e
       set nome = coalesce(v_nome, e.nome), ordem = coalesce(v_ordem, e.ordem),
           sigla = v_novo.sigla, endereco = v_novo.endereco, latitude = v_novo.latitude,
           longitude = v_novo.longitude, fuso = v_novo.fuso, estacao = v_novo.estacao,
           estacao_reserva = v_novo.estacao_reserva, boletim_horario = v_novo.boletim_horario,
           objeto = v_novo.objeto, local = v_novo.local, contratante = v_novo.contratante,
           contrato = v_novo.contrato, contratada = v_novo.contratada,
           contratada_cnpj = v_novo.contratada_cnpj, os_numero = v_novo.os_numero, os_data = v_novo.os_data,
           vigencia_meses = v_novo.vigencia_meses, valor_original = v_novo.valor_original,
           area_construida_m2 = v_novo.area_construida_m2
     where e.id = v_id
    returning * into v_etapa;
  end if;

  return privado.etapa_json(v_etapa.id);
end;
$$;

-- Fila de emissão -------------------------------------------------------------------------------

create table public.boletim_emissao (
  id bigint generated always as identity primary key,
  etapa_id uuid not null references public.etapa (id) on delete cascade,
  data date not null,
  revisao int not null default 0,
  estado text not null default 'pendente',
  tentativas int not null default 0,
  proxima_tentativa timestamptz not null default now(),
  erro text,
  pedido_por uuid references public.usuario (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  boletim_id uuid references public.boletim (id) on delete cascade,
  constraint boletim_emissao_unica unique (etapa_id, data, revisao),
  constraint boletim_emissao_estado_valido check (estado in ('pendente', 'gerando', 'emitido', 'falhou')),
  constraint boletim_emissao_revisao_positiva check (revisao >= 0),
  constraint boletim_emissao_tentativas_positivas check (tentativas >= 0),
  constraint boletim_emissao_boletim_coerente check ((estado = 'emitido') = (boletim_id is not null))
);
create index boletim_emissao_fila_idx on public.boletim_emissao (estado, proxima_tentativa);
create index boletim_emissao_boletim_idx on public.boletim_emissao (boletim_id);
comment on table public.boletim_emissao is
  'Pedidos de emissão do boletim (automáticos, pedido_por null, ou do site). Sem acesso direto: o gerador usa reivindicar_emissoes/concluir_emissao/falhar_emissao; o site, admin_listar_boletins/admin_pedir_emissao.';

alter table public.boletim_emissao enable row level security;
revoke all on public.boletim_emissao from public, anon, authenticated;

-- Publicação do boletim no Telegram ------------------------------------------------------------------

-- Boletim: obra_id null (o destino é o grupo da etapa, tópico Geral).
alter table public.publicacao_telegram
  add column boletim_id uuid references public.boletim (id) on delete cascade,
  alter column obra_id drop not null,
  drop constraint publicacao_um_dono,
  add constraint publicacao_um_dono check (num_nonnulls(registro_id, encerramento_id, boletim_id) = 1),
  add constraint publicacao_obra_coerente check ((obra_id is null) = (boletim_id is not null));
create unique index publicacao_boletim_unica on public.publicacao_telegram (boletim_id) where boletim_id is not null;
comment on column public.publicacao_telegram.boletim_id is
  'Boletim emitido (PDF enviado com sendDocument ao grupo da etapa, tópico Geral); obra_id fica null.';

-- A política de leitura (`eh_participante(obra_id)`) continua: com obra_id null, a publicação do
-- boletim não aparece para ninguém no Mini App; o site lê o estado por admin_listar_boletins.

-- Itens de obra arquivada (ela ou a etapa) e boletins de etapa arquivada ficam "pendente" e não
-- são reivindicados. Devolve `boletim_id` (coluna nova da tabela).
create or replace function public.reivindicar_publicacoes(p_limite int default 10)
returns setof public.publicacao_telegram
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Envio interrompido há mais de 10 minutos: não dá para saber se saiu; vira "incerto".
  update public.publicacao_telegram p
     set estado = 'incerto', erro = 'Envio interrompido; conferir no tópico.', atualizado_em = now()
   where p.estado = 'enviando' and p.atualizado_em < now() - interval '10 minutes';

  return query
  update public.publicacao_telegram p
     set estado = 'enviando', tentativas = p.tentativas + 1, atualizado_em = now()
   where p.id in (
     select q.id from public.publicacao_telegram q
      where q.estado = 'pendente' and q.proxima_tentativa_em <= now()
        and not exists (
          select 1 from public.obra o join public.etapa e on e.id = o.etapa_id
           where o.id = q.obra_id and (o.arquivada_em is not null or e.arquivada_em is not null)
        )
        and not exists (
          select 1 from public.boletim b join public.etapa e on e.id = b.etapa_id
           where b.id = q.boletim_id and e.arquivada_em is not null
        )
      order by q.id
      limit greatest(coalesce(p_limite, 10), 0)
      for update of q skip locked
   )
  returning p.*;
end;
$$;

-- Ao vincular o grupo, os boletins da etapa que esperavam o grupo voltam à fila já.
create or replace function public.vincular_etapa(p_slug text, p_chat bigint, p_titulo text)
returns public.etapa
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
  v_outra public.etapa;
begin
  if p_chat is null then
    raise exception 'Grupo do Telegram inválido' using errcode = '22023';
  end if;
  select * into v_etapa from public.etapa e where e.slug = p_slug for update;
  if not found then
    return null;
  end if;
  if v_etapa.arquivada_em is not null then
    raise exception 'A etapa “%” está arquivada. Peça a um admin do Mini App para desarquivá-la antes de vincular o grupo.',
      v_etapa.nome using errcode = '22023';
  end if;
  select * into v_outra from public.etapa e where e.telegram_chat_id = p_chat and e.id <> v_etapa.id;
  if found then
    raise exception 'Este grupo já é da etapa “%”. Cada etapa usa um grupo próprio.', v_outra.nome
      using errcode = '22023';
  end if;
  if v_etapa.telegram_chat_id is not null and v_etapa.telegram_chat_id <> p_chat then
    raise exception 'A etapa “%” já está vinculada a outro grupo. Desvincule o grupo no site de administração antes de vincular este.',
      v_etapa.nome using errcode = '22023';
  end if;

  begin
    update public.etapa e
       set telegram_chat_id = p_chat, telegram_chat_titulo = nullif(btrim(left(p_titulo, 255)), '')
     where e.id = v_etapa.id
    returning * into v_etapa;
  exception when unique_violation then
    -- Outra etapa ficou com este grupo ao mesmo tempo.
    raise exception 'Este grupo já é de outra etapa. Cada etapa usa um grupo próprio.' using errcode = '22023';
  end;

  update public.publicacao_telegram p
     set proxima_tentativa_em = now(), atualizado_em = now()
   where p.estado = 'pendente'
     and p.boletim_id in (select b.id from public.boletim b where b.etapa_id = v_etapa.id);
  return v_etapa;
end;
$$;

-- Desarquivar a etapa devolve à fila também as publicações dos boletins dela.
create or replace function public.admin_arquivar_etapa(p_slug text, p_arquivada boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
begin
  perform privado.exigir_admin();
  if p_arquivada is null then
    raise exception 'Informe se a etapa deve ser arquivada ou desarquivada' using errcode = '22023';
  end if;
  v_etapa := privado.etapa_do_slug(p_slug);
  select * into v_etapa from public.etapa e where e.id = v_etapa.id for update;

  if p_arquivada and v_etapa.arquivada_em is null then
    update public.etapa e set arquivada_em = now(), arquivada_por = auth.uid()
     where e.id = v_etapa.id
    returning * into v_etapa;
  elsif not p_arquivada and v_etapa.arquivada_em is not null then
    update public.etapa e set arquivada_em = null, arquivada_por = null
     where e.id = v_etapa.id
    returning * into v_etapa;
    -- As publicações que ficaram paradas voltam à fila já (as de obra arquivada continuam
    -- paradas em reivindicar_publicacoes).
    update public.publicacao_telegram p
       set proxima_tentativa_em = now(), atualizado_em = now()
     where p.estado = 'pendente'
       and (p.obra_id in (select o.id from public.obra o where o.etapa_id = v_etapa.id)
            or p.boletim_id in (select b.id from public.boletim b where b.etapa_id = v_etapa.id));
  end if;

  return jsonb_build_object('slug', v_etapa.slug, 'arquivada_em', v_etapa.arquivada_em);
end;
$$;

-- Snapshot do dia --------------------------------------------------------------------------------

-- Fotos de um registro (p_registro) ou de um encerramento (p_encerramento), na ordem:
-- [{path, largura, altura}] (path no bucket `fotos`).
create function privado.boletim_fotos(p_registro uuid, p_encerramento uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('path', f.storage_path, 'largura', f.largura, 'altura', f.altura)
                            order by f.ordem, f.id), '[]'::jsonb)
    from public.foto f
   where (p_registro is not null and f.registro_id = p_registro)
      or (p_encerramento is not null and f.encerramento_id = p_encerramento);
$$;
revoke execute on function privado.boletim_fotos(uuid, uuid) from public, anon, authenticated;

-- Registros (serviços ou pendências) da obra capturados em [p_ini, p_fim), na ordem pavimento,
-- ambiente, hora: [{id, pavimento, ambiente, hora, autor, legenda, fotos}].
create function privado.boletim_registros(p_obra uuid, p_tipo text, p_ini timestamptz, p_fim timestamptz,
                                          p_fuso text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'pavimento', pv.nome, 'ambiente', a.nome_operacional,
           'hora', to_char(r.capturado_em at time zone p_fuso, 'HH24:MI'),
           'autor', privado.nome_pessoa(r.autor_id), 'legenda', r.legenda,
           'fotos', privado.boletim_fotos(r.id, null)
         ) order by pv.ordem, pv.nome, a.ordem, a.nome_operacional, r.capturado_em, r.id), '[]'::jsonb)
    from public.registro r
    join public.ambiente a on a.id = r.ambiente_id
    join public.pavimento pv on pv.id = a.pavimento_id
   where r.obra_id = p_obra and r.tipo = p_tipo
     and r.capturado_em >= p_ini and r.capturado_em < p_fim;
$$;
revoke execute on function privado.boletim_registros(uuid, text, timestamptz, timestamptz, text)
  from public, anon, authenticated;

-- Pendências da obra encerradas em [p_ini, p_fim): [{id, pavimento, ambiente, aberta_em, dias_aberta,
-- legenda, fotos_registro, encerramento: {hora, autor, observacao, fotos}}]. dias_aberta = dias de
-- calendário (no fuso) entre a captura e o encerramento.
create function privado.boletim_encerradas(p_obra uuid, p_ini timestamptz, p_fim timestamptz, p_fuso text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'pavimento', pv.nome, 'ambiente', a.nome_operacional,
           'aberta_em', r.capturado_em,
           'dias_aberta', (en.encerrado_em at time zone p_fuso)::date - (r.capturado_em at time zone p_fuso)::date,
           'legenda', r.legenda,
           'fotos_registro', privado.boletim_fotos(r.id, null),
           'encerramento', jsonb_build_object(
             'hora', to_char(en.encerrado_em at time zone p_fuso, 'HH24:MI'),
             'autor', privado.nome_pessoa(en.gestor_id),
             'observacao', en.observacao,
             'fotos', privado.boletim_fotos(null, en.id)
           )
         ) order by pv.ordem, pv.nome, a.ordem, a.nome_operacional, en.encerrado_em, en.id), '[]'::jsonb)
    from public.encerramento en
    join public.registro r on r.id = en.registro_id
    join public.ambiente a on a.id = r.ambiente_id
    join public.pavimento pv on pv.id = a.pavimento_id
   where en.obra_id = p_obra and en.encerrado_em >= p_ini and en.encerrado_em < p_fim;
$$;
revoke execute on function privado.boletim_encerradas(uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;

-- Observações da obra no dia, por hora: [{hora, autor, texto, editada}].
create function privado.boletim_observacoes(p_obra uuid, p_data date, p_fuso text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'hora', to_char(o.escrito_em at time zone p_fuso, 'HH24:MI'),
           'autor', privado.nome_pessoa(o.autor_id), 'texto', o.texto, 'editada', o.editado_em is not null
         ) order by o.escrito_em, o.id), '[]'::jsonb)
    from public.observacao o
   where o.obra_id = p_obra and o.data = p_data;
$$;
revoke execute on function privado.boletim_observacoes(uuid, date, text) from public, anon, authenticated;

-- Snapshot do boletim da etapa no dia (formato no contrato, parte 3). O dia é [data 00:00,
-- data+1 00:00) no fuso da etapa; os lançamentos contam por registro.capturado_em,
-- encerramento.encerrado_em e observacao.data. Entram as obras da etapa não arquivadas antes do
-- início do dia, na ordem (ordem, nome).
create function privado.boletim_snapshot(p_etapa uuid, p_data date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.etapa;
  v_ini timestamptz;
  v_fim timestamptz;
  v_obras uuid[];
  v_etapa jsonb;
  v_aditivos jsonb;
  v_dias int;
  v_valor numeric;
  v_termino date;
  v_total int;
  v_prazo jsonb;
  v_pend jsonb;
  v_por_obra jsonb;
  v_atividade jsonb;
  v_obras_json jsonb;
  v_tardios jsonb;
begin
  if p_data is null then
    raise exception 'Informe a data do boletim' using errcode = '22023';
  end if;
  select * into e from public.etapa x where x.id = p_etapa;
  if not found then
    raise exception 'Etapa não encontrada' using errcode = 'P0002';
  end if;
  v_ini := p_data::timestamp at time zone e.fuso;
  v_fim := (p_data + 1)::timestamp at time zone e.fuso;
  v_obras := array(
    select o.id from public.obra o
     where o.etapa_id = e.id and (o.arquivada_em is null or o.arquivada_em >= v_ini)
     order by o.ordem, o.nome, o.id
  );

  -- Etapa: campos de admin_obter_etapa, com os aditivos assinados até a data e o prazo na data.
  select coalesce(sum(a.prazo_dias), 0)::int, coalesce(sum(a.valor), 0),
         coalesce(jsonb_agg(privado.aditivo_json(a) order by a.data, a.numero, a.id), '[]'::jsonb)
    into v_dias, v_valor, v_aditivos
    from public.etapa_aditivo a
   where a.etapa_id = e.id and a.data <= p_data;
  if e.os_data is not null and e.vigencia_meses is not null then
    v_termino := (e.os_data + make_interval(months => e.vigencia_meses))::date;
    v_total := (v_termino + v_dias) - e.os_data;
    v_prazo := jsonb_build_object(
      'termino_original', v_termino,
      'prazo_aditivos_dias', v_dias,
      'termino_atual', v_termino + v_dias,
      'valor_atual', e.valor_original + v_valor,
      'dias_decorridos', p_data - e.os_data,
      'dias_totais', v_total,
      'percentual', case when v_total > 0 then round(100.0 * (p_data - e.os_data) / v_total, 1) end,
      'dias_restantes', (v_termino + v_dias) - p_data
    );
  end if;
  v_etapa := (privado.etapa_json(e.id) - 'aditivos' - 'faltando')
             || jsonb_build_object('aditivos', v_aditivos, 'prazo', v_prazo);

  -- Pendências por obra: abertas = capturadas antes do instante e não encerradas antes dele.
  with pend as (
    select r.obra_id, r.capturado_em, en.encerrado_em,
           p_data - (r.capturado_em at time zone e.fuso)::date as idade
      from public.registro r
      left join public.encerramento en on en.registro_id = r.id
     where r.obra_id = any (v_obras) and r.tipo = 'pendencia'
  ),
  por_obra as (
    select o.id, o.nome, o.ordem,
           (select count(*) from public.registro r
             where r.obra_id = o.id and r.tipo = 'servico'
               and r.capturado_em >= v_ini and r.capturado_em < v_fim) as servicos,
           count(p.*) filter (where p.capturado_em < v_ini
                                and (p.encerrado_em is null or p.encerrado_em >= v_ini)) as abertas_inicio,
           count(p.*) filter (where p.capturado_em >= v_ini and p.capturado_em < v_fim) as abertas_no_dia,
           count(p.*) filter (where p.encerrado_em >= v_ini and p.encerrado_em < v_fim) as encerradas_no_dia,
           count(p.*) filter (where p.capturado_em < v_fim
                                and (p.encerrado_em is null or p.encerrado_em >= v_fim)) as abertas_fim,
           count(p.*) filter (where p.capturado_em < v_fim) as total_abertas,
           count(p.*) filter (where p.encerrado_em < v_fim) as total_encerradas,
           count(p.*) filter (where p.capturado_em < v_fim and (p.encerrado_em is null or p.encerrado_em >= v_fim)
                                and p.idade > 7) as mais_7,
           count(p.*) filter (where p.capturado_em < v_fim and (p.encerrado_em is null or p.encerrado_em >= v_fim)
                                and p.idade > 15) as mais_15,
           count(p.*) filter (where p.capturado_em < v_fim and (p.encerrado_em is null or p.encerrado_em >= v_fim)
                                and p.idade > 30) as mais_30,
           coalesce(sum(extract(epoch from p.encerrado_em - p.capturado_em))
                      filter (where p.encerrado_em < v_fim), 0) as segundos_resolucao
      from public.obra o
      left join pend p on p.obra_id = o.id
     where o.id = any (v_obras)
     group by o.id, o.nome, o.ordem
  )
  select
    jsonb_build_object(
      'abertas_inicio', coalesce(sum(x.abertas_inicio), 0),
      'abertas_no_dia', coalesce(sum(x.abertas_no_dia), 0),
      'encerradas_no_dia', coalesce(sum(x.encerradas_no_dia), 0),
      'abertas_fim', coalesce(sum(x.abertas_fim), 0),
      'total_abertas', coalesce(sum(x.total_abertas), 0),
      'total_encerradas', coalesce(sum(x.total_encerradas), 0),
      'taxa_resolucao', case when sum(x.total_abertas) > 0
                             then round(100.0 * sum(x.total_encerradas) / sum(x.total_abertas), 1) end,
      'mais_7', coalesce(sum(x.mais_7), 0),
      'mais_15', coalesce(sum(x.mais_15), 0),
      'mais_30', coalesce(sum(x.mais_30), 0),
      'tempo_medio_resolucao_dias', case when sum(x.total_encerradas) > 0
                                         then round(sum(x.segundos_resolucao) / sum(x.total_encerradas) / 86400, 1) end
    ),
    coalesce(jsonb_agg(jsonb_build_object(
      'obra', x.nome, 'servicos', x.servicos, 'abertas_no_dia', x.abertas_no_dia,
      'encerradas_no_dia', x.encerradas_no_dia, 'abertas_fim', x.abertas_fim, 'mais_15', x.mais_15
    ) order by x.ordem, x.nome, x.id), '[]'::jsonb)
    into v_pend, v_por_obra
    from por_obra x;

  -- Atividade do dia: serviços, fotos (de registros e encerramentos do dia), ambientes com lançamento
  -- e pessoas que lançaram (registros, encerramentos e observações).
  with regs as (
    select r.id, r.tipo, r.ambiente_id, r.autor_id from public.registro r
     where r.obra_id = any (v_obras) and r.capturado_em >= v_ini and r.capturado_em < v_fim
  ),
  encs as (
    select en.id, en.gestor_id, r.ambiente_id from public.encerramento en
      join public.registro r on r.id = en.registro_id
     where en.obra_id = any (v_obras) and en.encerrado_em >= v_ini and en.encerrado_em < v_fim
  ),
  obs as (
    select o.autor_id from public.observacao o where o.obra_id = any (v_obras) and o.data = p_data
  )
  select jsonb_build_object(
    'registros_servico', (select count(*) from regs where regs.tipo = 'servico'),
    'fotos', (select count(*) from public.foto f where f.registro_id in (select regs.id from regs))
             + (select count(*) from public.foto f where f.encerramento_id in (select encs.id from encs)),
    'ambientes', (select count(*) from (select regs.ambiente_id from regs
                                        union select encs.ambiente_id from encs) x),
    'pessoas', (select count(*) from (select regs.autor_id from regs union select encs.gestor_id from encs
                                      union select obs.autor_id from obs) x)
  ) into v_atividade;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'nome', o.nome, 'slug', o.slug,
           'servicos', privado.boletim_registros(o.id, 'servico', v_ini, v_fim, e.fuso),
           'pendencias_abertas', privado.boletim_registros(o.id, 'pendencia', v_ini, v_fim, e.fuso),
           'pendencias_encerradas', privado.boletim_encerradas(o.id, v_ini, v_fim, e.fuso),
           'observacoes', privado.boletim_observacoes(o.id, p_data, e.fuso)
         ) order by o.ordem, o.nome, o.id), '[]'::jsonb)
    into v_obras_json
    from public.obra o where o.id = any (v_obras);

  -- Tardios: lançamentos de dias anteriores recebidos depois de uma emissão do boletim do dia
  -- deles, sem retificação desse dia emitida depois da chegada e ainda não listados como tardios
  -- em outro boletim (de outra data; revisões anteriores do mesmo dia não contam).
  with itens as (
    select r.tipo, r.id, (r.capturado_em at time zone e.fuso)::date as data, r.capturado_em as instante,
           r.recebido_em as recebido, r.obra_id, r.ambiente_id, r.autor_id, r.legenda as texto
      from public.registro r
     where r.obra_id = any (v_obras) and r.capturado_em < v_ini
    union all
    select 'encerramento', en.id, (en.encerrado_em at time zone e.fuso)::date, en.encerrado_em,
           en.encerrado_em, en.obra_id, r.ambiente_id, en.gestor_id, coalesce(en.observacao, r.legenda)
      from public.encerramento en join public.registro r on r.id = en.registro_id
     where en.obra_id = any (v_obras) and en.encerrado_em < v_ini
    union all
    select 'observacao', o.id, o.data, o.escrito_em, o.recebido_em, o.obra_id, null, o.autor_id, o.texto
      from public.observacao o
     where o.obra_id = any (v_obras) and o.data < p_data
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', i.tipo, 'data', i.data, 'obra', ob.nome, 'ambiente', a.nome_operacional,
           'autor', privado.nome_pessoa(i.autor_id), 'texto', i.texto,
           'id', i.id, 'hora', to_char(i.instante at time zone e.fuso, 'HH24:MI'), 'recebido_em', i.recebido
         ) order by i.data, i.instante, i.tipo, i.id), '[]'::jsonb)
    into v_tardios
    from itens i
    join public.obra ob on ob.id = i.obra_id
    left join public.ambiente a on a.id = i.ambiente_id
   where exists (select 1 from public.boletim b
                  where b.etapa_id = e.id and b.data = i.data and b.emitido_em < i.recebido)
     and not exists (select 1 from public.boletim b
                      where b.etapa_id = e.id and b.data = i.data and b.emitido_em >= i.recebido)
     and not exists (select 1 from public.boletim b
                      where b.etapa_id = e.id and b.data <> p_data
                        and b.snapshot -> 'tardios' @> jsonb_build_array(jsonb_build_object('tipo', i.tipo, 'id', i.id)));

  return jsonb_build_object(
    'versao', 1,
    'data', p_data,
    'fuso', e.fuso,
    'gerado_em', now(),
    'organizacao', public.organizacao(),
    'etapa', v_etapa,
    'responsaveis', coalesce((
      select jsonb_agg(jsonb_build_object('nome', privado.nome_pessoa(r.usuario_id), 'funcao', r.funcao)
                       order by r.ordem, r.usuario_id)
        from public.etapa_responsavel r where r.etapa_id = e.id
    ), '[]'::jsonb),
    'indicadores', jsonb_build_object('pendencias', v_pend, 'atividade', v_atividade, 'por_obra', v_por_obra),
    'obras', v_obras_json,
    'tardios', v_tardios,
    'clima', null
  );
end;
$$;
revoke execute on function privado.boletim_snapshot(uuid, date) from public, anon, authenticated;

-- Acionamento do gerador ---------------------------------------------------------------------------

-- Chama o gerador do boletim (Vercel). Roda em transações do site e do cron, então nunca pode
-- falhar: sem os segredos no Vault (`url_gerador_boletim`, `segredo_interno`) não faz nada; erro
-- no envio vira aviso. Tempo longo: o gerador abre o Chromium e gera o PDF antes de responder.
create function privado.disparar_gerador()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_segredo text;
begin
  begin
    select d.decrypted_secret into v_url from vault.decrypted_secrets d where d.name = 'url_gerador_boletim' limit 1;
    select d.decrypted_secret into v_segredo from vault.decrypted_secrets d where d.name = 'segredo_interno' limit 1;
    if v_url is null or v_segredo is null then
      return;
    end if;

    perform net.http_post(
      url := v_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-segredo-interno', v_segredo),
      timeout_milliseconds := 300000
    );
  exception when others then
    raise warning 'Não foi possível acionar o gerador do boletim: %', sqlerrm;
  end;
end;
$$;
revoke execute on function privado.disparar_gerador() from public, anon, authenticated;

-- Agendamento: para cada etapa ativa com sigla, depois do horário local da emissão, cria o pedido
-- do dia local (se ainda não há boletim nem pedido para a data). Aciona o gerador se houver pedido
-- pendente vencido ou geração interrompida (mais de 15 min). p_agora só serve aos testes.
-- Retorno: quantos pedidos foram criados.
create function privado.agendar_boletins(p_agora timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_criados int;
begin
  with novos as (
    insert into public.boletim_emissao (etapa_id, data, revisao)
    select e.id, (p_agora at time zone e.fuso)::date, 0
      from public.etapa e
     where e.arquivada_em is null and e.sigla is not null
       and (p_agora at time zone e.fuso)::time >= e.boletim_horario
       and not exists (select 1 from public.boletim b
                        where b.etapa_id = e.id and b.data = (p_agora at time zone e.fuso)::date)
       and not exists (select 1 from public.boletim_emissao q
                        where q.etapa_id = e.id and q.data = (p_agora at time zone e.fuso)::date)
    on conflict (etapa_id, data, revisao) do nothing
    returning 1
  )
  select count(*) into v_criados from novos;

  if v_criados > 0 or exists (
    select 1 from public.boletim_emissao q
     where (q.estado = 'pendente' and q.proxima_tentativa <= p_agora)
        or (q.estado = 'gerando' and q.atualizado_em < p_agora - interval '15 minutes')
  ) then
    perform privado.disparar_gerador();
  end if;
  return v_criados;
end;
$$;
revoke execute on function privado.agendar_boletins(timestamptz) from public, anon, authenticated;

-- Cron a cada 5 minutos, de forma idempotente (desagenda antes, se existir).
do $$
begin
  if exists (select 1 from cron.job j where j.jobname = 'agendar-boletins') then
    perform cron.unschedule(job_name := 'agendar-boletins');
  end if;
  perform cron.schedule(
    job_name := 'agendar-boletins',
    schedule := '*/5 * * * *',
    command := 'select privado.agendar_boletins()'
  );
end $$;

-- RPCs do gerador (service_role) ---------------------------------------------------------------------

-- Até p_limite pedidos pendentes vencidos (ou em geração há mais de 15 min) passam a "gerando",
-- com +1 tentativa: [{id, etapa_id, data, revisao, numero}]. Geração interrompida que já esgotou
-- as 8 tentativas vira "falhou".
create function public.reivindicar_emissoes(p_limite int default 3)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lote jsonb;
begin
  update public.boletim_emissao q
     set estado = 'falhou', erro = 'Geração interrompida; tentativas esgotadas.', atualizado_em = now()
   where q.estado = 'gerando' and q.atualizado_em < now() - interval '15 minutes' and q.tentativas >= 8;

  with lote as (
    update public.boletim_emissao q
       set estado = 'gerando', tentativas = q.tentativas + 1, atualizado_em = now()
     where q.id in (
       select x.id from public.boletim_emissao x
        where (x.estado = 'pendente' and x.proxima_tentativa <= now())
           or (x.estado = 'gerando' and x.atualizado_em < now() - interval '15 minutes')
        order by x.proxima_tentativa, x.id
        limit greatest(coalesce(p_limite, 3), 0)
        for update skip locked
     )
    returning q.id, q.etapa_id, q.data, q.revisao
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'etapa_id', l.etapa_id, 'data', l.data, 'revisao', l.revisao,
           'numero', privado.numero_boletim(l.etapa_id, l.data, l.revisao)
         ) order by l.id), '[]'::jsonb)
    into v_lote
    from lote l;
  return v_lote;
end;
$$;

create function public.boletim_snapshot(p_etapa uuid, p_data date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select privado.boletim_snapshot(p_etapa, p_data);
$$;

-- Grava o boletim do pedido (número, revisão, snapshot com o clima, pdf_path, emitido_por =
-- pedido_por), marca o pedido "emitido" e enfileira a publicação no Telegram (o gatilho da fila
-- aciona a publish-outbox). Pedido já emitido: devolve o boletim existente. O PDF precisa estar
-- no bucket `boletins` em <etapa_id>/<número sem barras>.pdf. Retorno: {boletim_id, numero}.
create function public.concluir_emissao(p_id bigint, p_snapshot jsonb, p_pdf_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.boletim_emissao;
  v_boletim public.boletim;
  v_numero text;
  v_caminho text;
begin
  select * into v_pedido from public.boletim_emissao q where q.id = p_id for update;
  if not found then
    raise exception 'Pedido de emissão não encontrado' using errcode = 'P0002';
  end if;
  if v_pedido.estado = 'emitido' then
    select * into v_boletim from public.boletim b where b.id = v_pedido.boletim_id;
    return jsonb_build_object('boletim_id', v_boletim.id, 'numero', v_boletim.numero);
  end if;

  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Snapshot do boletim inválido' using errcode = '22023';
  end if;
  if p_snapshot ->> 'data' is distinct from v_pedido.data::text then
    raise exception 'O snapshot não é do dia do pedido (%)', v_pedido.data using errcode = '22023';
  end if;
  v_numero := privado.numero_boletim(v_pedido.etapa_id, v_pedido.data, v_pedido.revisao);
  v_caminho := v_pedido.etapa_id || '/' || replace(v_numero, '/', '') || '.pdf';
  if p_pdf_path is distinct from v_caminho then
    raise exception 'Caminho do PDF inválido: use %', v_caminho using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects so where so.bucket_id = 'boletins' and so.name = v_caminho) then
    raise exception 'O PDF % não foi enviado ao bucket boletins', v_caminho using errcode = '22023';
  end if;

  insert into public.boletim (etapa_id, data, revisao, numero, snapshot, pdf_path, emitido_por)
  values (v_pedido.etapa_id, v_pedido.data, v_pedido.revisao, v_numero, p_snapshot, v_caminho, v_pedido.pedido_por)
  returning * into v_boletim;

  update public.boletim_emissao q
     set estado = 'emitido', boletim_id = v_boletim.id, erro = null, atualizado_em = now()
   where q.id = p_id;

  insert into public.publicacao_telegram (boletim_id, estado) values (v_boletim.id, 'pendente');

  return jsonb_build_object('boletim_id', v_boletim.id, 'numero', v_boletim.numero);
end;
$$;

-- Falha na geração: nova tentativa em 5, 10, 20, 40... min; na 8ª tentativa o pedido vira "falhou".
-- Pedido já emitido ou com falha definitiva não muda. Retorno: {id, estado, tentativas,
-- proxima_tentativa, erro}.
create function public.falhar_emissao(p_id bigint, p_erro text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public.boletim_emissao;
  v_erro text := left(coalesce(nullif(btrim(p_erro), ''), 'Erro desconhecido na geração.'), 1000);
begin
  select * into v_pedido from public.boletim_emissao q where q.id = p_id for update;
  if not found then
    raise exception 'Pedido de emissão não encontrado' using errcode = 'P0002';
  end if;

  if v_pedido.estado in ('pendente', 'gerando') then
    if v_pedido.tentativas >= 8 then
      update public.boletim_emissao q
         set estado = 'falhou', erro = v_erro, atualizado_em = now()
       where q.id = p_id
      returning * into v_pedido;
    else
      update public.boletim_emissao q
         set estado = 'pendente', erro = v_erro, atualizado_em = now(),
             proxima_tentativa = now() + make_interval(mins => 5 * power(2, greatest(q.tentativas - 1, 0))::int)
       where q.id = p_id
      returning * into v_pedido;
    end if;
  end if;

  return jsonb_build_object('id', v_pedido.id, 'estado', v_pedido.estado, 'tentativas', v_pedido.tentativas,
                            'proxima_tentativa', v_pedido.proxima_tentativa, 'erro', v_pedido.erro);
end;
$$;

revoke execute on function public.reivindicar_emissoes(int) from public, anon, authenticated;
revoke execute on function public.boletim_snapshot(uuid, date) from public, anon, authenticated;
revoke execute on function public.concluir_emissao(bigint, jsonb, text) from public, anon, authenticated;
revoke execute on function public.falhar_emissao(bigint, text) from public, anon, authenticated;
grant execute on function public.reivindicar_emissoes(int) to service_role;
grant execute on function public.boletim_snapshot(uuid, date) to service_role;
grant execute on function public.concluir_emissao(bigint, jsonb, text) to service_role;
grant execute on function public.falhar_emissao(bigint, text) to service_role;

-- RPCs do site (admin) -----------------------------------------------------------------------------

-- Pedido no formato do site.
create function privado.pedido_emissao_json(p public.boletim_emissao)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'data', p.data, 'revisao', p.revisao, 'estado', p.estado, 'tentativas', p.tentativas,
    'erro', p.erro, 'atualizado_em', p.atualizado_em
  );
$$;
revoke execute on function privado.pedido_emissao_json(public.boletim_emissao) from public, anon, authenticated;

-- {boletins: [{id, data, revisao, numero, emitido_em, emitido_por_nome, pdf_path, publicado,
-- publicacao_estado}], pedidos: [{id, data, revisao, estado, tentativas, erro, atualizado_em}]}:
-- os emitidos e os pedidos ainda não emitidos, mais recentes primeiro (data, revisão).
-- emitido_por_nome null = emissão automática.
create function public.admin_listar_boletins(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
begin
  perform privado.exigir_admin();
  v_etapa := privado.etapa_do_slug(p_slug);
  return jsonb_build_object(
    'boletins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'data', b.data, 'revisao', b.revisao, 'numero', b.numero, 'emitido_em', b.emitido_em,
               'emitido_por_nome', privado.nome_pessoa(b.emitido_por), 'pdf_path', b.pdf_path,
               'publicado', coalesce(pt.estado = 'publicado', false),
               'publicacao_estado', pt.estado
             ) order by b.data desc, b.revisao desc)
        from public.boletim b
        left join public.publicacao_telegram pt on pt.boletim_id = b.id
       where b.etapa_id = v_etapa.id
    ), '[]'::jsonb),
    'pedidos', coalesce((
      select jsonb_agg(privado.pedido_emissao_json(q) order by q.data desc, q.revisao desc, q.id desc)
        from public.boletim_emissao q
       where q.etapa_id = v_etapa.id and q.estado <> 'emitido'
    ), '[]'::jsonb)
  );
end;
$$;

-- Pedido manual (pedido_por = quem pediu): sem boletim na data → revisão 0; com boletim →
-- retificação (maior revisão + 1). Data no futuro (no fuso da etapa) → 22023; pedido pendente ou
-- gerando para a data → 23505. Um pedido que falhou para a mesma revisão volta à fila. Aciona o
-- gerador. Retorno: o pedido ({id, data, revisao, estado, tentativas, erro, atualizado_em}) e o
-- `numero` que o boletim terá.
create function public.admin_pedir_emissao(p_slug text, p_data date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
  v_revisao int;
  v_numero text;
  v_pedido public.boletim_emissao;
begin
  perform privado.exigir_admin();
  v_etapa := privado.etapa_do_slug(p_slug);
  -- Serializa os pedidos da etapa.
  select * into v_etapa from public.etapa e where e.id = v_etapa.id for update;
  if p_data is null then
    raise exception 'Informe a data do boletim' using errcode = '22023';
  end if;
  if p_data > (now() at time zone v_etapa.fuso)::date then
    raise exception 'O boletim de % ainda não pode ser emitido: a data está no futuro',
      to_char(p_data, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if exists (select 1 from public.boletim_emissao q
              where q.etapa_id = v_etapa.id and q.data = p_data and q.estado in ('pendente', 'gerando')) then
    raise exception 'Já há um pedido de emissão em andamento para %', to_char(p_data, 'DD/MM/YYYY')
      using errcode = '23505';
  end if;

  select coalesce(max(b.revisao) + 1, 0) into v_revisao
    from public.boletim b where b.etapa_id = v_etapa.id and b.data = p_data;
  v_numero := privado.numero_boletim(v_etapa.id, p_data, v_revisao);  -- 22023 sem sigla

  insert into public.boletim_emissao (etapa_id, data, revisao, pedido_por)
  values (v_etapa.id, p_data, v_revisao, auth.uid())
  on conflict (etapa_id, data, revisao) do update
     set estado = 'pendente', tentativas = 0, proxima_tentativa = now(), erro = null,
         pedido_por = excluded.pedido_por, atualizado_em = now()
   where public.boletim_emissao.estado = 'falhou'
  returning * into v_pedido;
  if not found then
    -- Só acontece se o pedido dessa revisão já foi emitido ao mesmo tempo.
    raise exception 'Já há um pedido de emissão em andamento para %', to_char(p_data, 'DD/MM/YYYY')
      using errcode = '23505';
  end if;

  perform privado.disparar_gerador();
  return privado.pedido_emissao_json(v_pedido) || jsonb_build_object('numero', v_numero);
end;
$$;

-- Snapshot para a prévia do site (nada é gravado).
create function public.admin_boletim_snapshot(p_slug text, p_data date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return privado.boletim_snapshot((privado.etapa_do_slug(p_slug)).id, p_data);
end;
$$;

revoke execute on function public.admin_listar_boletins(text) from public, anon;
revoke execute on function public.admin_pedir_emissao(text, date) from public, anon;
revoke execute on function public.admin_boletim_snapshot(text, date) from public, anon;
grant execute on function public.admin_listar_boletins(text) to authenticated;
grant execute on function public.admin_pedir_emissao(text, date) to authenticated;
grant execute on function public.admin_boletim_snapshot(text, date) to authenticated;
