-- Boletim de Acompanhamento Diário, parte 1: base de dados e cadastros do site de administração.
-- Contrato: docs/contrato-boletim.md; plano: tasks/plano-boletim.md.
--
-- - `etapa` ganha identificação (sigla do número `BA<sigla>/…`), localização (coordenadas, fuso,
--   estações do INMET, horário da emissão) e dados do contrato. Tudo opcional no banco (a 2ª etapa
--   já existe); a criação pelo site exige sigla, coordenadas e fuso (`admin_salvar_etapa`).
-- - Tabelas novas: aditivos e responsáveis da etapa, estações do INMET e clima do dia (preenchidas
--   pela coleta, parte 2), observações do dia (Mini App) e boletins emitidos (próximas partes).
-- - `usuario.nome_exibicao` (definido pelo admin; o auth-telegram só atualiza nome e username) e
--   `organizacao.cabecalho` (linhas de subordinação acima do nome da OM).
-- - Bucket privado `boletins` (PDFs): leitura para participantes da etapa e admins; escrita só
--   service_role.

-- Funções auxiliares de formato --------------------------------------------------------------------

-- Fusos do Brasil aceitos em `etapa.fuso`.
create function privado.fuso_valido(p_fuso text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_fuso = any (array[
    'America/Noronha', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Araguaina',
    'America/Maceio', 'America/Bahia', 'America/Sao_Paulo', 'America/Campo_Grande', 'America/Cuiaba',
    'America/Santarem', 'America/Porto_Velho', 'America/Boa_Vista', 'America/Manaus', 'America/Eirunepe',
    'America/Rio_Branco'
  ]);
$$;
revoke execute on function privado.fuso_valido(text) from public, anon, authenticated;

-- Maiúsculas também para as letras acentuadas do português, qualquer que seja o locale do banco
-- (com o locale "C", `upper()` só converte ASCII).
create function privado.maiusculas(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(upper(p), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ');
$$;
revoke execute on function privado.maiusculas(text) from public, anon, authenticated;

-- Linhas do cabeçalho do boletim: até 4, cada uma com 1 a 100 caracteres, sem espaços nas pontas.
create function privado.cabecalho_valido(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and cardinality(p) <= 4
     and coalesce(array_ndims(p), 1) = 1
     and not exists (
       select 1 from unnest(p) l
        where l is null or char_length(l) not between 1 and 100 or l <> btrim(l, E' \t\r\n')
     );
$$;
revoke execute on function privado.cabecalho_valido(text[]) from public, anon, authenticated;

-- Código da OM no número do boletim: maiúsculas, sem acentos, só [A-Z0-9]. 'CO-FZ' → 'COFZ'.
create function privado.codigo_om(p_nome text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    upper(translate(coalesce(p_nome, ''),
                    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
                    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^A-Z0-9]', '', 'g');
$$;
revoke execute on function privado.codigo_om(text) from public, anon, authenticated;

-- Texto de um campo jsonb: null se ausente ou null; 22023 se não for texto ou passar de p_max
-- caracteres (p_max null = sem limite). Tira espaços e quebras de linha das pontas; vazio vira null.
create function privado.texto_jsonb(p_valor jsonb, p_rotulo text, p_max int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_valor is null or jsonb_typeof(p_valor) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_valor) <> 'string' then
    raise exception '% precisa ser texto', p_rotulo using errcode = '22023';
  end if;
  v := nullif(btrim(p_valor #>> '{}', E' \t\r\n'), '');
  if v is not null and p_max is not null and char_length(v) > p_max then
    raise exception '% pode ter até % caracteres', p_rotulo, p_max using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke execute on function privado.texto_jsonb(jsonb, text, int) from public, anon, authenticated;

-- Data "AAAA-MM-DD" de um campo jsonb (null se ausente, null ou vazio); 22023 se inválida.
create function privado.data_jsonb(p_valor jsonb, p_rotulo text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
  v_data date;
begin
  v := privado.texto_jsonb(p_valor, p_rotulo, null);
  if v is null then
    return null;
  end if;
  if v !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception '% inválida: use AAAA-MM-DD', p_rotulo using errcode = '22023';
  end if;
  begin
    v_data := v::date;
  exception when others then
    raise exception '% inválida: use AAAA-MM-DD', p_rotulo using errcode = '22023';
  end;
  return v_data;
end;
$$;
revoke execute on function privado.data_jsonb(jsonb, text) from public, anon, authenticated;

-- `etapa`: identificação, localização e contrato ---------------------------------------------------

alter table public.etapa
  add column sigla text,
  add column endereco text,
  add column latitude double precision,
  add column longitude double precision,
  add column fuso text not null default 'America/Sao_Paulo',
  add column inmet_estacao text,
  add column inmet_estacao_reserva text,
  add column boletim_horario time not null default '23:30',
  add column objeto text,
  add column local text,
  add column contratante text,
  add column contrato text,
  add column contratada text,
  add column contratada_cnpj text,
  add column os_numero text,
  add column os_data date,
  add column vigencia_meses int,
  add column valor_original numeric(15, 2),
  add column area_construida_m2 numeric(12, 2),
  add constraint etapa_sigla_unica unique (sigla),
  add constraint etapa_sigla_formato check (sigla ~ '^[A-Z0-9]{1,10}$'),
  add constraint etapa_endereco_tamanho check (char_length(endereco) between 1 and 300),
  add constraint etapa_latitude_brasil check (latitude between -34 and 6),
  add constraint etapa_longitude_brasil check (longitude between -74 and -28),
  add constraint etapa_coordenadas_juntas check ((latitude is null) = (longitude is null)),
  add constraint etapa_fuso_valido check (privado.fuso_valido(fuso)),
  add constraint etapa_inmet_formato check (inmet_estacao ~ '^[A-Z][0-9]{3}$'),
  add constraint etapa_inmet_reserva_formato check (inmet_estacao_reserva ~ '^[A-Z][0-9]{3}$'),
  add constraint etapa_inmet_diferentes check (inmet_estacao <> inmet_estacao_reserva),
  add constraint etapa_objeto_tamanho check (char_length(objeto) between 1 and 600),
  add constraint etapa_local_tamanho check (char_length(local) between 1 and 300),
  add constraint etapa_contratante_tamanho check (char_length(contratante) between 1 and 200),
  add constraint etapa_contrato_tamanho check (char_length(contrato) between 1 and 60),
  add constraint etapa_contratada_tamanho check (char_length(contratada) between 1 and 200),
  add constraint etapa_contratada_cnpj_formato check (contratada_cnpj ~ '^\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}$'),
  add constraint etapa_os_numero_tamanho check (char_length(os_numero) between 1 and 40),
  add constraint etapa_vigencia_meses_faixa check (vigencia_meses between 1 and 240),
  add constraint etapa_valor_original_positivo check (valor_original >= 0),
  add constraint etapa_area_positiva check (area_construida_m2 > 0);

comment on column public.etapa.sigla is 'Forma o número do boletim: BA<sigla>/AAMMDD/<OM>. Única; não é apagada depois de definida.';
comment on column public.etapa.fuso is 'Fuso da etapa: define o dia local das observações e do boletim.';
comment on column public.etapa.inmet_estacao is 'Estação automática do INMET (ex.: A305); a reserva vale quando faltam dados.';
comment on column public.etapa.boletim_horario is 'Hora local da emissão automática do boletim.';

-- Migração dos dados: a 2ª etapa (Fortaleza).
update public.etapa set sigla = '2', fuso = 'America/Fortaleza' where slug = '2a-etapa';

-- `usuario.nome_exibicao` e `organizacao.cabecalho` --------------------------------------------------

alter table public.usuario
  add column nome_exibicao text,
  add constraint usuario_nome_exibicao_formato check (
    char_length(nome_exibicao) between 1 and 60
    and nome_exibicao = upper(nome_exibicao)
    and nome_exibicao = btrim(regexp_replace(nome_exibicao, '\s+', ' ', 'g'))
  );
comment on column public.usuario.nome_exibicao is
  'Nome no boletim e no Mini App (ex.: CP PATRICIO), definido pelo admin; null = usa o nome do Telegram.';

alter table public.organizacao
  add column cabecalho text[] not null default '{}',
  add constraint organizacao_cabecalho_valido check (privado.cabecalho_valido(cabecalho));
comment on column public.organizacao.cabecalho is
  'Linhas de subordinação acima do nome da OM no cabeçalho do boletim (até 4).';

update public.organizacao
   set cabecalho = array['COMANDO DA AERONÁUTICA', 'DIRETORIA DE INFRAESTRUTURA DA AERONÁUTICA',
                         'COMISSÃO DE OBRAS DE FORTALEZA (CO-FZ)'];

-- Tabelas novas ----------------------------------------------------------------------------------

create table public.etapa_aditivo (
  id uuid primary key default gen_random_uuid(),
  etapa_id uuid not null references public.etapa (id) on delete cascade,
  numero text not null,
  data date not null,
  prazo_dias int not null default 0,
  valor numeric(15, 2) not null default 0,
  descricao text,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.usuario (id) on delete set null,
  constraint etapa_aditivo_numero_unico unique (etapa_id, numero),
  constraint etapa_aditivo_numero_tamanho check (char_length(numero) between 1 and 40),
  constraint etapa_aditivo_descricao_tamanho check (char_length(descricao) between 1 and 300)
);
comment on table public.etapa_aditivo is
  'Aditivos do contrato da etapa: acréscimo (ou supressão, se negativo) de prazo e de valor.';

create table public.etapa_responsavel (
  etapa_id uuid not null references public.etapa (id) on delete cascade,
  usuario_id uuid not null references public.usuario (id) on delete cascade,
  funcao text not null default 'Fiscal',
  ordem int not null default 0,
  primary key (etapa_id, usuario_id),
  constraint etapa_responsavel_funcao_tamanho check (char_length(funcao) between 1 and 60)
);
create index etapa_responsavel_usuario_idx on public.etapa_responsavel (usuario_id);
comment on table public.etapa_responsavel is 'Responsáveis da etapa que assinam o boletim, na ordem.';

create table public.inmet_estacao (
  codigo text primary key,
  nome text not null,
  uf text not null,
  latitude double precision not null,
  longitude double precision not null,
  altitude double precision,
  operante boolean not null default true,
  atualizado_em timestamptz not null default now(),
  constraint inmet_estacao_codigo_formato check (codigo ~ '^[A-Z][0-9]{3}$'),
  constraint inmet_estacao_uf_formato check (uf ~ '^[A-Z]{2}$')
);
comment on table public.inmet_estacao is
  'Estações automáticas do INMET (lista preenchida pela coleta do clima).';

create table public.observacao (
  id uuid primary key,
  obra_id uuid not null references public.obra (id) on delete cascade,
  autor_id uuid not null references public.usuario (id) on delete cascade,
  data date not null,
  texto text not null,
  escrito_em timestamptz not null,
  recebido_em timestamptz not null default now(),
  editado_em timestamptz,
  constraint observacao_texto_tamanho check (
    char_length(texto) between 1 and 1000 and texto = btrim(texto, E' \t\r\n')
  )
);
create index observacao_obra_data_idx on public.observacao (obra_id, data);
create index observacao_autor_idx on public.observacao (autor_id);
comment on table public.observacao is
  'Observações do dia (Mini App). id gerado no cliente; data = dia local (fuso da etapa) de escrito_em.';

create table public.clima_dia (
  etapa_id uuid not null references public.etapa (id) on delete cascade,
  data date not null,
  estacao text not null,
  horario jsonb not null,
  resumo jsonb not null,
  obtido_em timestamptz not null default now(),
  primary key (etapa_id, data, estacao)
);
comment on table public.clima_dia is 'Leituras do INMET por etapa, dia e estação (preenchida pela coleta).';

create table public.boletim (
  id uuid primary key default gen_random_uuid(),
  etapa_id uuid not null references public.etapa (id) on delete restrict,
  data date not null,
  revisao int not null default 0,
  numero text not null,
  snapshot jsonb not null,
  pdf_path text,
  emitido_em timestamptz not null default now(),
  emitido_por uuid references public.usuario (id) on delete set null,
  constraint boletim_numero_unico unique (numero),
  constraint boletim_etapa_data_revisao_unica unique (etapa_id, data, revisao),
  constraint boletim_revisao_positiva check (revisao >= 0)
);
comment on table public.boletim is
  'Boletins emitidos (revisão 0 = original; 1 = -R1 …). pdf_path no bucket boletins: <etapa_id>/<numero sem barras>.pdf. emitido_por null = automático.';

-- RLS e grants ------------------------------------------------------------------------------------

alter table public.etapa_aditivo enable row level security;
alter table public.etapa_responsavel enable row level security;
alter table public.inmet_estacao enable row level security;
alter table public.observacao enable row level security;
alter table public.clima_dia enable row level security;
alter table public.boletim enable row level security;

revoke all on public.etapa_aditivo, public.etapa_responsavel, public.inmet_estacao, public.observacao,
  public.clima_dia, public.boletim from public, anon, authenticated;
grant select on public.etapa_aditivo, public.etapa_responsavel, public.inmet_estacao, public.observacao,
  public.clima_dia, public.boletim to authenticated;

-- Coleta do clima e emissão do boletim (Edge Functions com a chave secreta).
grant select, insert, update, delete
  on public.etapa_aditivo, public.etapa_responsavel, public.inmet_estacao, public.clima_dia, public.boletim
  to service_role;

create policy etapa_aditivo_select on public.etapa_aditivo
  for select to authenticated using (privado.eh_admin() or privado.participa_da_etapa(etapa_id));

create policy etapa_responsavel_select on public.etapa_responsavel
  for select to authenticated using (privado.eh_admin() or privado.participa_da_etapa(etapa_id));

create policy clima_dia_select on public.clima_dia
  for select to authenticated using (privado.eh_admin() or privado.participa_da_etapa(etapa_id));

create policy boletim_select on public.boletim
  for select to authenticated using (privado.eh_admin() or privado.participa_da_etapa(etapa_id));

create policy inmet_estacao_select on public.inmet_estacao
  for select to authenticated using (privado.eh_admin());

create policy observacao_select on public.observacao
  for select to authenticated using (privado.eh_participante(obra_id) or privado.eh_admin());

-- Bucket privado `boletins`: <etapa_id>/<numero sem barras>.pdf -------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('boletins', 'boletins', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- Sem políticas de escrita: só o service_role grava e apaga.
create policy boletins_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'boletins'
    and (privado.eh_admin()
         or privado.participa_da_etapa(privado.uuid_ou_nulo((storage.foldername(name))[1])))
  );

-- Funções auxiliares do boletim ---------------------------------------------------------------------

-- BA<sigla>/AAMMDD/<OM>[-R<n>]. P0002 se a etapa não existe; 22023 se não tem sigla.
create function privado.numero_boletim(p_etapa uuid, p_data date, p_revisao int)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sigla text;
begin
  select e.sigla into v_sigla from public.etapa e where e.id = p_etapa;
  if not found then
    raise exception 'Etapa não encontrada' using errcode = 'P0002';
  end if;
  if v_sigla is null then
    raise exception 'A etapa não tem sigla' using errcode = '22023';
  end if;
  return 'BA' || v_sigla || '/' || to_char(p_data, 'YYMMDD') || '/'
         || privado.codigo_om(coalesce((select o.nome from public.organizacao o where o.id), 'CO-FZ'))
         || case when p_revisao > 0 then '-R' || p_revisao else '' end;
end;
$$;
revoke execute on function privado.numero_boletim(uuid, date, int) from public, anon, authenticated;

-- Dia local (fuso da etapa da obra) de um instante; null se a obra não existe.
create function privado.data_local(p_obra uuid, p_instante timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (p_instante at time zone e.fuso)::date
    from public.obra o join public.etapa e on e.id = o.etapa_id
   where o.id = p_obra;
$$;
revoke execute on function privado.data_local(uuid, timestamptz) from public, anon, authenticated;

-- Nome mostrado da pessoa: o de exibição ou, sem ele, o do Telegram.
create function privado.nome_pessoa(p_usuario uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(u.nome_exibicao, u.nome) from public.usuario u where u.id = p_usuario;
$$;
revoke execute on function privado.nome_pessoa(uuid) from public, anon, authenticated;

-- Já há boletim (qualquer revisão) da etapa no dia?
create function privado.boletim_emitido(p_etapa uuid, p_data date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.boletim b where b.etapa_id = p_etapa and b.data = p_data);
$$;
revoke execute on function privado.boletim_emitido(uuid, date) from public, anon, authenticated;

-- Responsáveis da etapa, na ordem: [{usuario_id, nome, nome_exibicao, funcao, ordem}].
create function privado.etapa_responsaveis(p_etapa uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'usuario_id', r.usuario_id, 'nome', u.nome, 'nome_exibicao', u.nome_exibicao,
           'funcao', r.funcao, 'ordem', r.ordem
         ) order by r.ordem, u.nome, r.usuario_id), '[]'::jsonb)
    from public.etapa_responsavel r join public.usuario u on u.id = r.usuario_id
   where r.etapa_id = p_etapa;
$$;
revoke execute on function privado.etapa_responsaveis(uuid) from public, anon, authenticated;

-- Campos do cadastro que o boletim usa e estão vazios, na ordem do contrato.
create function privado.etapa_faltando(p_etapa public.etapa)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when p_etapa.sigla is null then 'sigla' end,
    case when p_etapa.latitude is null or p_etapa.longitude is null then 'localizacao' end,
    case when p_etapa.inmet_estacao is null then 'inmet_estacao' end,
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
revoke execute on function privado.etapa_faltando(public.etapa) from public, anon, authenticated;

-- Aditivo no formato das RPCs do site.
create function privado.aditivo_json(p public.etapa_aditivo)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'etapa_id', p.etapa_id, 'numero', p.numero, 'data', p.data, 'prazo_dias', p.prazo_dias,
    'valor', p.valor, 'descricao', p.descricao, 'criado_em', p.criado_em
  );
$$;
revoke execute on function privado.aditivo_json(public.etapa_aditivo) from public, anon, authenticated;

-- A etapa inteira (formato de admin_obter_etapa).
create function privado.etapa_json(p_etapa uuid)
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
    'fuso', e.fuso, 'inmet_estacao', e.inmet_estacao, 'inmet_estacao_reserva', e.inmet_estacao_reserva,
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
revoke execute on function privado.etapa_json(uuid) from public, anon, authenticated;

-- Observação no formato das RPCs do Mini App.
create function privado.observacao_json(p public.observacao)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'obra_id', p.obra_id, 'data', p.data, 'texto', p.texto, 'escrito_em', p.escrito_em,
    'editado_em', p.editado_em, 'autor', jsonb_build_object('id', p.autor_id, 'nome', privado.nome_pessoa(p.autor_id))
  );
$$;
revoke execute on function privado.observacao_json(public.observacao) from public, anon, authenticated;

-- 22023 se o boletim do dia da etapa da obra já foi emitido.
create function privado.exigir_dia_aberto(p_obra uuid, p_data date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if privado.boletim_emitido((select o.etapa_id from public.obra o where o.id = p_obra), p_data) then
    raise exception 'O boletim de % já foi emitido; a correção é feita por retificação',
      to_char(p_data, 'DD/MM/YYYY') using errcode = '22023';
  end if;
end;
$$;
revoke execute on function privado.exigir_dia_aberto(uuid, date) from public, anon, authenticated;

-- RPCs do Mini App: observações do dia --------------------------------------------------------------

-- {id, obra_id, texto, escrito_em}. Id novo insere; id existente edita o texto (só o autor).
create function public.salvar_observacao(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_id uuid;
  v_obra uuid;
  v_texto text;
  v_escrito timestamptz;
  v_obs public.observacao;
begin
  if v_usuario is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da observação inválidos' using errcode = '22023';
  end if;
  v_id := privado.uuid_ou_nulo(p ->> 'id');
  if jsonb_typeof(p -> 'id') is distinct from 'string' or v_id is null then
    raise exception 'Identificador da observação inválido' using errcode = '22023';
  end if;
  if jsonb_typeof(p -> 'texto') is distinct from 'string' then
    raise exception 'O texto da observação precisa ser texto' using errcode = '22023';
  end if;
  v_texto := btrim(p ->> 'texto', E' \t\r\n');
  if char_length(v_texto) not between 1 and 1000 then
    raise exception 'A observação deve ter de 1 a 1000 caracteres' using errcode = '22023';
  end if;

  select * into v_obs from public.observacao o where o.id = v_id for update;
  if not found then
    v_obra := privado.uuid_ou_nulo(p ->> 'obra_id');
    if jsonb_typeof(p -> 'obra_id') is distinct from 'string' or v_obra is null then
      raise exception 'Identificador da obra inválido' using errcode = '22023';
    end if;
    if jsonb_typeof(p -> 'escrito_em') is distinct from 'string' then
      raise exception 'Data e hora da observação inválidas' using errcode = '22023';
    end if;
    begin
      v_escrito := (p ->> 'escrito_em')::timestamptz;
    exception when others then
      raise exception 'Data e hora da observação inválidas' using errcode = '22023';
    end;
    if not privado.eh_participante(v_obra) then
      raise exception 'Sem permissão nesta obra' using errcode = '42501';
    end if;
    if v_escrito > now() + interval '5 minutes' then
      raise exception 'A hora da observação está no futuro; confira o relógio do aparelho' using errcode = '22023';
    end if;
    perform privado.exigir_dia_aberto(v_obra, privado.data_local(v_obra, v_escrito));

    insert into public.observacao (id, obra_id, autor_id, data, texto, escrito_em)
    values (v_id, v_obra, v_usuario, privado.data_local(v_obra, v_escrito), v_texto, v_escrito)
    on conflict (id) do nothing
    returning * into v_obs;
    if found then
      return privado.observacao_json(v_obs);
    end if;
    -- Mesmo id gravado ao mesmo tempo (reenvio da fila): segue como edição.
    select * into v_obs from public.observacao o where o.id = v_id for update;
  end if;

  -- Edição: obra_id e escrito_em não mudam.
  if v_obs.autor_id <> v_usuario then
    raise exception 'Só o autor pode alterar a observação' using errcode = '42501';
  end if;
  if not privado.eh_participante(v_obs.obra_id) then
    raise exception 'Sem permissão nesta obra' using errcode = '42501';
  end if;
  if v_obs.texto = v_texto then
    return privado.observacao_json(v_obs);  -- reenvio idempotente
  end if;
  perform privado.exigir_dia_aberto(v_obs.obra_id, v_obs.data);
  update public.observacao o set texto = v_texto, editado_em = now()
   where o.id = v_id
  returning * into v_obs;
  return privado.observacao_json(v_obs);
end;
$$;

-- Só o autor, só antes da emissão. Id inexistente: nada a fazer.
create function public.excluir_observacao(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_obs public.observacao;
begin
  if v_usuario is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  select * into v_obs from public.observacao o where o.id = p_id for update;
  if not found then
    return;
  end if;
  if v_obs.autor_id <> v_usuario then
    raise exception 'Só o autor pode alterar a observação' using errcode = '42501';
  end if;
  if not privado.eh_participante(v_obs.obra_id) then
    raise exception 'Sem permissão nesta obra' using errcode = '42501';
  end if;
  perform privado.exigir_dia_aberto(v_obs.obra_id, v_obs.data);
  delete from public.observacao o where o.id = p_id;
end;
$$;

-- Observações da obra no dia (null = hoje no fuso da etapa), por escrito_em.
create function public.observacoes_do_dia(p_obra uuid, p_data date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_data date;
  v_travada boolean;
begin
  if v_usuario is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if not privado.eh_participante(p_obra) then
    raise exception 'Sem permissão nesta obra' using errcode = '42501';
  end if;
  v_data := coalesce(p_data, privado.data_local(p_obra, now()));
  v_travada := privado.boletim_emitido((select o.etapa_id from public.obra o where o.id = p_obra), v_data);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'data', o.data, 'texto', o.texto, 'escrito_em', o.escrito_em,
             'editado_em', o.editado_em,
             'autor', jsonb_build_object('id', o.autor_id, 'nome', privado.nome_pessoa(o.autor_id)),
             'minha', o.autor_id = v_usuario, 'travada', v_travada
           ) order by o.escrito_em, o.id)
      from public.observacao o
     where o.obra_id = p_obra and o.data = v_data
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.salvar_observacao(jsonb) from public, anon;
revoke execute on function public.excluir_observacao(uuid) from public, anon;
revoke execute on function public.observacoes_do_dia(uuid, date) from public, anon;
grant execute on function public.salvar_observacao(jsonb) to authenticated;
grant execute on function public.excluir_observacao(uuid) to authenticated;
grant execute on function public.observacoes_do_dia(uuid, date) to authenticated;

-- organizacao(): passa a devolver o cabeçalho (create or replace mantém os grants) ---------------------

create or replace function public.organizacao()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('nome', o.nome, 'logo_path', o.logo_path, 'cabecalho', to_jsonb(o.cabecalho))
       from public.organizacao o where o.id),
    jsonb_build_object('nome', 'CO-FZ', 'logo_path', null, 'cabecalho', '[]'::jsonb)
  );
$$;

-- Site de administração: pessoas ---------------------------------------------------------------------

-- Todas as pessoas que já entraram no Mini App, com as participações, por nome mostrado.
create function public.admin_listar_pessoas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', u.id, 'nome', u.nome, 'nome_exibicao', u.nome_exibicao, 'username', u.username,
             'telegram_id', u.telegram_id,
             'eh_admin', exists (select 1 from public.admin_app a where a.usuario_id = u.id),
             'participacoes', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'obra_slug', o.slug, 'obra_nome', o.nome, 'etapa_nome', e.nome, 'papel', p.papel
                      ) order by e.ordem, e.nome, o.ordem, o.nome)
                 from public.participacao p
                 join public.obra o on o.id = p.obra_id
                 join public.etapa e on e.id = o.etapa_id
                where p.usuario_id = u.id
             ), '[]'::jsonb)
           ) order by coalesce(u.nome_exibicao, u.nome), u.id)
      from public.usuario u
  ), '[]'::jsonb);
end;
$$;

-- Nome de exibição: espaços colapsados, maiúsculas; null ou só espaços tira o nome.
create function public.admin_definir_nome_exibicao(p_usuario uuid, p_nome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_usuario public.usuario;
begin
  perform privado.exigir_admin();
  v_nome := privado.maiusculas(nullif(btrim(regexp_replace(p_nome, '\s+', ' ', 'g')), ''));
  if char_length(v_nome) > 60 then
    raise exception 'O nome de exibição pode ter até 60 caracteres' using errcode = '22023';
  end if;
  update public.usuario u set nome_exibicao = v_nome where u.id = p_usuario
  returning * into v_usuario;
  if not found then
    raise exception 'Usuário não encontrado' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', v_usuario.id, 'nome', v_usuario.nome, 'nome_exibicao', v_usuario.nome_exibicao);
end;
$$;

revoke execute on function public.admin_listar_pessoas() from public, anon;
revoke execute on function public.admin_definir_nome_exibicao(uuid, text) from public, anon;
grant execute on function public.admin_listar_pessoas() to authenticated;
grant execute on function public.admin_definir_nome_exibicao(uuid, text) to authenticated;

-- Site de administração: etapas ---------------------------------------------------------------------

-- Cada item ganha `sigla` e `faltando` (quantos campos do cadastro do boletim estão vazios).
create or replace function public.admin_listar_etapas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'slug', e.slug, 'nome', e.nome, 'ordem', e.ordem,
             'arquivada_em', e.arquivada_em,
             'telegram_vinculado', e.telegram_chat_id is not null,
             'telegram_chat_titulo', e.telegram_chat_titulo,
             'obras', (select count(*) from public.obra o where o.etapa_id = e.id),
             'obras_arquivadas', (
               select count(*) from public.obra o where o.etapa_id = e.id and o.arquivada_em is not null
             ),
             'sigla', e.sigla,
             'faltando', cardinality(privado.etapa_faltando(e))
           ) order by e.ordem, e.nome, e.id)
      from public.etapa e
  ), '[]'::jsonb);
end;
$$;

create function public.admin_obter_etapa(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return privado.etapa_json((privado.etapa_do_slug(p_slug)).id);
end;
$$;

-- Cria (sem `id`; slug, nome, sigla, latitude, longitude e fuso obrigatórios) ou edita (com `id`)
-- uma etapa. Na edição, chave ausente mantém o valor e chave com null apaga (menos fuso e
-- boletim_horario, que não aceitam null, e a sigla, que não é apagada depois de definida).
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
  if p ? 'inmet_estacao' then
    v_novo.inmet_estacao := privado.texto_jsonb(p -> 'inmet_estacao', 'A estação do INMET', null);
  end if;
  if p ? 'inmet_estacao_reserva' then
    v_novo.inmet_estacao_reserva := privado.texto_jsonb(p -> 'inmet_estacao_reserva', 'A estação de reserva', null);
  end if;
  if v_novo.inmet_estacao !~ '^[A-Z][0-9]{3}$' or v_novo.inmet_estacao_reserva !~ '^[A-Z][0-9]{3}$' then
    raise exception 'Código de estação do INMET inválido: use uma letra e três dígitos, como A305'
      using errcode = '22023';
  end if;
  if v_novo.inmet_estacao = v_novo.inmet_estacao_reserva then
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
      slug, nome, ordem, sigla, endereco, latitude, longitude, fuso, inmet_estacao, inmet_estacao_reserva,
      boletim_horario, objeto, local, contratante, contrato, contratada, contratada_cnpj, os_numero, os_data,
      vigencia_meses, valor_original, area_construida_m2
    ) values (
      v_slug, v_nome, coalesce(v_ordem, 0), v_novo.sigla, v_novo.endereco, v_novo.latitude, v_novo.longitude,
      v_novo.fuso, v_novo.inmet_estacao, v_novo.inmet_estacao_reserva, v_novo.boletim_horario, v_novo.objeto,
      v_novo.local, v_novo.contratante, v_novo.contrato, v_novo.contratada, v_novo.contratada_cnpj,
      v_novo.os_numero, v_novo.os_data, v_novo.vigencia_meses, v_novo.valor_original, v_novo.area_construida_m2
    )
    returning * into v_etapa;
  else
    update public.etapa e
       set nome = coalesce(v_nome, e.nome), ordem = coalesce(v_ordem, e.ordem),
           sigla = v_novo.sigla, endereco = v_novo.endereco, latitude = v_novo.latitude,
           longitude = v_novo.longitude, fuso = v_novo.fuso, inmet_estacao = v_novo.inmet_estacao,
           inmet_estacao_reserva = v_novo.inmet_estacao_reserva, boletim_horario = v_novo.boletim_horario,
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

-- Cria (sem `id`) ou edita (com `id`; chave ausente mantém) um aditivo. Retorno: o aditivo.
create function public.admin_salvar_aditivo(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_etapa uuid;
  v_novo public.etapa_aditivo;
  v_linha public.etapa_aditivo;
  v_num numeric;
begin
  perform privado.exigir_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados do aditivo inválidos' using errcode = '22023';
  end if;
  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    v_id := privado.uuid_ou_nulo(p ->> 'id');
    if jsonb_typeof(p -> 'id') <> 'string' or v_id is null then
      raise exception 'Identificador do aditivo inválido' using errcode = '22023';
    end if;
  end if;
  if p ? 'etapa_id' and jsonb_typeof(p -> 'etapa_id') <> 'null' then
    v_etapa := privado.uuid_ou_nulo(p ->> 'etapa_id');
    if jsonb_typeof(p -> 'etapa_id') <> 'string' or v_etapa is null then
      raise exception 'Identificador da etapa inválido' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    if v_etapa is null then
      raise exception 'Informe a etapa do aditivo' using errcode = '22023';
    end if;
    perform 1 from public.etapa e where e.id = v_etapa for share;
    if not found then
      raise exception 'Etapa não encontrada' using errcode = 'P0002';
    end if;
    v_novo.etapa_id := v_etapa;
    v_novo.prazo_dias := 0;
    v_novo.valor := 0;
  else
    select * into v_novo from public.etapa_aditivo a where a.id = v_id for update;
    if not found then
      raise exception 'Aditivo não encontrado' using errcode = 'P0002';
    end if;
    if v_etapa is not null and v_etapa <> v_novo.etapa_id then
      raise exception 'O aditivo não pode mudar de etapa' using errcode = '22023';
    end if;
  end if;

  if v_id is null or p ? 'numero' then
    v_novo.numero := privado.texto_jsonb(p -> 'numero', 'O número do aditivo', 40);
    if v_novo.numero is null then
      raise exception 'Informe o número do aditivo (até 40 caracteres)' using errcode = '22023';
    end if;
  end if;
  if v_id is null or p ? 'data' then
    v_novo.data := privado.data_jsonb(p -> 'data', 'Data do aditivo');
    if v_novo.data is null then
      raise exception 'Informe a data do aditivo' using errcode = '22023';
    end if;
  end if;
  if p ? 'prazo_dias' then
    v_novo.prazo_dias := coalesce(privado.inteiro_jsonb(p -> 'prazo_dias', 'prazo_dias'), 0);
  end if;
  if p ? 'valor' then
    v_num := coalesce(round(privado.numero_jsonb(p -> 'valor', 'valor', true), 2), 0);
    if abs(v_num) >= 1e13 then
      raise exception 'O valor do aditivo é grande demais' using errcode = '22023';
    end if;
    v_novo.valor := v_num;
  end if;
  if p ? 'descricao' then
    v_novo.descricao := privado.texto_jsonb(p -> 'descricao', 'A descrição', 300);
  end if;

  if exists (select 1 from public.etapa_aditivo a
              where a.etapa_id = v_novo.etapa_id and a.numero = v_novo.numero and a.id is distinct from v_id) then
    raise exception 'Já existe o aditivo % nesta etapa', v_novo.numero using errcode = '23505';
  end if;

  if v_id is null then
    insert into public.etapa_aditivo (etapa_id, numero, data, prazo_dias, valor, descricao, criado_por)
    values (v_novo.etapa_id, v_novo.numero, v_novo.data, v_novo.prazo_dias, v_novo.valor, v_novo.descricao,
            auth.uid())
    returning * into v_linha;
  else
    update public.etapa_aditivo a
       set numero = v_novo.numero, data = v_novo.data, prazo_dias = v_novo.prazo_dias, valor = v_novo.valor,
           descricao = v_novo.descricao
     where a.id = v_id
    returning * into v_linha;
  end if;
  return privado.aditivo_json(v_linha);
end;
$$;

create function public.admin_remover_aditivo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  delete from public.etapa_aditivo a where a.id = p_id;
  if not found then
    raise exception 'Aditivo não encontrado' using errcode = 'P0002';
  end if;
end;
$$;

-- Substitui os responsáveis da etapa: [{usuario_id, funcao}] na ordem desejada (vazia = nenhum).
create function public.admin_definir_responsaveis(p_etapa uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_pos int := 0;
  v_usuario uuid;
  v_usuarios uuid[] := '{}';
  v_funcao text;
  v_funcoes text[] := '{}';
begin
  perform privado.exigir_admin();
  perform 1 from public.etapa e where e.id = p_etapa for update;
  if not found then
    raise exception 'Etapa não encontrada' using errcode = 'P0002';
  end if;
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'A lista de responsáveis é inválida' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p) loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item -> 'usuario_id') is distinct from 'string'
       or privado.uuid_ou_nulo(v_item ->> 'usuario_id') is null then
      raise exception 'Responsável % com identificador inválido', v_pos using errcode = '22023';
    end if;
    v_usuario := (v_item ->> 'usuario_id')::uuid;
    if v_usuario = any (v_usuarios) then
      raise exception 'Pessoa repetida na lista de responsáveis' using errcode = '22023';
    end if;
    if not exists (select 1 from public.usuario u where u.id = v_usuario) then
      raise exception 'Usuário não encontrado' using errcode = 'P0002';
    end if;
    v_funcao := coalesce(privado.texto_jsonb(v_item -> 'funcao', 'A função', 60), 'Fiscal');
    v_usuarios := v_usuarios || v_usuario;
    v_funcoes := v_funcoes || v_funcao;
  end loop;

  delete from public.etapa_responsavel r where r.etapa_id = p_etapa;
  insert into public.etapa_responsavel (etapa_id, usuario_id, funcao, ordem)
  select p_etapa, x.usuario_id, x.funcao, x.ordem::int
    from unnest(v_usuarios, v_funcoes) with ordinality as x(usuario_id, funcao, ordem);

  return privado.etapa_responsaveis(p_etapa);
end;
$$;

-- Estações operantes mais próximas (haversine, km com 1 casa): [{codigo, nome, uf, latitude,
-- longitude, distancia_km}].
create function public.admin_sugerir_estacoes(p_lat double precision, p_lon double precision,
                                              p_limite int default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'Coordenadas inválidas' using errcode = '22023';
  end if;
  if p_limite is not null and p_limite not between 1 and 50 then
    raise exception 'O limite precisa estar entre 1 e 50' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'codigo', x.codigo, 'nome', x.nome, 'uf', x.uf, 'latitude', x.latitude, 'longitude', x.longitude,
             'distancia_km', round(x.distancia::numeric, 1)
           ) order by x.distancia, x.codigo)
      from (
        select s.*,
               2 * 6371 * asin(least(1, sqrt(
                 power(sin(radians(s.latitude - p_lat) / 2), 2)
                 + cos(radians(p_lat)) * cos(radians(s.latitude)) * power(sin(radians(s.longitude - p_lon) / 2), 2)
               ))) as distancia
          from public.inmet_estacao s
         where s.operante
         order by distancia, s.codigo
         limit coalesce(p_limite, 5)
      ) x
  ), '[]'::jsonb);
end;
$$;

-- Exclusão da etapa: apaga os boletins dela antes (boletim → etapa é `on delete restrict`). Os PDFs
-- no bucket `boletins` saem pela Edge Function de exclusão (parte futura).
create or replace function public.admin_excluir_etapa(p_slug text, p_confirmacao text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
  v_resumo jsonb;
  v_obra uuid;
  v_exclusoes uuid[] := '{}';
begin
  perform privado.exigir_admin();
  v_etapa := privado.etapa_do_slug(p_slug);
  select * into v_etapa from public.etapa e where e.id = v_etapa.id for update;
  if not found then
    raise exception 'Etapa não encontrada' using errcode = 'P0002';
  end if;

  if p_confirmacao is null or btrim(p_confirmacao) <> btrim(v_etapa.nome) then
    raise exception 'Para excluir, digite exatamente o nome da etapa: %', v_etapa.nome using errcode = '22023';
  end if;

  -- Trava as obras (como admin_excluir_obra) antes de contar.
  perform 1 from public.obra o where o.etapa_id = v_etapa.id order by o.id for update;
  v_resumo := public.admin_resumo_etapa(v_etapa.slug);

  for v_obra in select o.id from public.obra o where o.etapa_id = v_etapa.id order by o.ordem, o.nome, o.id loop
    v_exclusoes := v_exclusoes || privado.excluir_obra(v_obra, v_etapa.nome);
  end loop;
  delete from public.boletim b where b.etapa_id = v_etapa.id;
  delete from public.etapa e where e.id = v_etapa.id;

  return jsonb_build_object('etapa_id', v_etapa.id, 'exclusoes', to_jsonb(v_exclusoes), 'resumo', v_resumo);
end;
$$;

revoke execute on function public.admin_obter_etapa(text) from public, anon;
revoke execute on function public.admin_salvar_aditivo(jsonb) from public, anon;
revoke execute on function public.admin_remover_aditivo(uuid) from public, anon;
revoke execute on function public.admin_definir_responsaveis(uuid, jsonb) from public, anon;
revoke execute on function public.admin_sugerir_estacoes(double precision, double precision, int) from public, anon;
grant execute on function public.admin_obter_etapa(text) to authenticated;
grant execute on function public.admin_salvar_aditivo(jsonb) to authenticated;
grant execute on function public.admin_remover_aditivo(uuid) to authenticated;
grant execute on function public.admin_definir_responsaveis(uuid, jsonb) to authenticated;
grant execute on function public.admin_sugerir_estacoes(double precision, double precision, int) to authenticated;

-- Site de administração: organização ganha o cabeçalho -------------------------------------------------

-- {nome, logo_path, cabecalho}: campo ausente mantém o valor; logo_path null tira o logo; cabecalho
-- é a lista de linhas (até 4, de 1 a 100 caracteres; [] limpa).
create or replace function public.admin_salvar_organizacao(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text;
  v_logo text;
  v_cabecalho text[];
  v_org public.organizacao;
begin
  perform privado.exigir_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da organização inválidos' using errcode = '22023';
  end if;
  if p ? 'nome' and jsonb_typeof(p -> 'nome') <> 'string' then
    raise exception 'O nome precisa ser texto' using errcode = '22023';
  end if;
  if p ? 'logo_path' and jsonb_typeof(p -> 'logo_path') not in ('string', 'null') then
    raise exception 'O caminho do logo precisa ser texto' using errcode = '22023';
  end if;
  v_nome := btrim(p ->> 'nome');
  if p ? 'nome' and (v_nome = '' or char_length(v_nome) > 80) then
    raise exception 'Informe o nome da organização (até 80 caracteres)' using errcode = '22023';
  end if;
  v_logo := p ->> 'logo_path';
  if v_logo is not null then
    if v_logo !~ '^logo-[0-9a-f]{16}\.(png|jpg|webp)$' then
      raise exception 'Caminho do logo inválido: use logo-<16 hex>.<png|jpg|webp>' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects so where so.bucket_id = 'organizacao' and so.name = v_logo) then
      raise exception 'O logo % não foi enviado ao bucket organizacao', v_logo using errcode = '22023';
    end if;
  end if;
  if p ? 'cabecalho' then
    if jsonb_typeof(p -> 'cabecalho') <> 'array'
       or exists (select 1 from jsonb_array_elements(p -> 'cabecalho') l where jsonb_typeof(l) <> 'string') then
      raise exception 'O cabeçalho precisa ser uma lista de linhas de texto' using errcode = '22023';
    end if;
    v_cabecalho := array(
      select btrim(l.linha, E' \t\r\n')
        from jsonb_array_elements_text(p -> 'cabecalho') with ordinality as l(linha, pos)
       order by l.pos
    );
    if cardinality(v_cabecalho) > 4 then
      raise exception 'O cabeçalho pode ter até 4 linhas' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_cabecalho) l where char_length(l) not between 1 and 100) then
      raise exception 'Cada linha do cabeçalho precisa ter de 1 a 100 caracteres' using errcode = '22023';
    end if;
  end if;

  insert into public.organizacao (id) values (true) on conflict (id) do nothing;
  update public.organizacao o
     set nome = coalesce(v_nome, o.nome),
         logo_path = case when p ? 'logo_path' then v_logo else o.logo_path end,
         cabecalho = case when p ? 'cabecalho' then v_cabecalho else o.cabecalho end,
         atualizado_em = now(), atualizado_por = auth.uid()
   where o.id
  returning * into v_org;

  return jsonb_build_object('nome', v_org.nome, 'logo_path', v_org.logo_path, 'cabecalho', to_jsonb(v_org.cabecalho));
end;
$$;
