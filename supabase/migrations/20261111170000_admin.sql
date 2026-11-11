-- Site de administração, fase 1: perfil admin do Mini App, configuração das obras e
-- links de entrada de uso único. Plano: tasks/plano-admin.md; documentação: docs/admin.md.
--
-- O cliente não lê nem grava estas tabelas direto: tudo passa por RPCs `security definer`
-- que conferem `privado.eh_admin()` (erro 42501 para quem não é admin). As funções que a
-- Edge Function `admin-sessao` usa (`admin_entrada_*`, `admin_por_telegram`) são só do
-- service_role, que, como na fase 9, não tem grants nas tabelas: só executa as funções.

-- Tabelas ------------------------------------------------------------------------------------

create table public.admin_app (
  usuario_id uuid primary key references public.usuario (id) on delete cascade,
  criado_em timestamptz not null default now(),
  criado_por uuid references public.usuario (id) on delete set null
);
alter table public.admin_app enable row level security;
revoke all on public.admin_app from public, anon, authenticated;

comment on table public.admin_app is
  'Admins do Mini App (site /admin/): criam e editam todas as obras e gerenciam os admins.';

-- Equivalente do data/<slug>/obra.json, sem slug e nome (que ficam em `obra`) e com os
-- pavimentos reduzidos a codigo, pdf e pagina (nome e ordem ficam em `pavimento`).
create table public.obra_config (
  obra_id uuid primary key references public.obra (id) on delete cascade,
  config jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.usuario (id) on delete set null,
  constraint obra_config_objeto check (jsonb_typeof(config) = 'object')
);
alter table public.obra_config enable row level security;
revoke all on public.obra_config from public, anon, authenticated;

-- Links de entrada do site (uso único, 2 min). Só o SHA-256 (hex) do token fica no banco.
create table privado.admin_entrada (
  token_hash text primary key,
  usuario_id uuid not null references public.usuario (id) on delete cascade,
  expira_em timestamptz not null,
  constraint admin_entrada_hash_formato check (token_hash ~ '^[0-9a-f]{64}$')
);
alter table privado.admin_entrada enable row level security;
revoke all on privado.admin_entrada from public, anon, authenticated;

-- Funções auxiliares -------------------------------------------------------------------------

create function privado.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_app a where a.usuario_id = auth.uid());
$$;
revoke execute on function privado.eh_admin() from public, anon;
grant execute on function privado.eh_admin() to authenticated;

-- Lança 28000 sem sessão e 42501 para quem não é admin. Chamada pelas RPCs abaixo.
create function privado.exigir_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if not privado.eh_admin() then
    raise exception 'Apenas admins do Mini App podem fazer isto' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function privado.exigir_admin() from public, anon, authenticated;

-- Obra pelo slug (P0002 se não existir).
create function privado.obra_do_slug(p_slug text)
returns public.obra
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
begin
  select * into v_obra from public.obra o where o.slug = p_slug;
  if not found then
    raise exception 'Obra não encontrada' using errcode = 'P0002';
  end if;
  return v_obra;
end;
$$;
revoke execute on function privado.obra_do_slug(text) from public, anon, authenticated;

-- Inteiro de um campo jsonb (null se ausente); 22023 se não for número inteiro.
create function privado.inteiro_jsonb(p_valor jsonb, p_campo text)
returns int
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_valor is null or jsonb_typeof(p_valor) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}') !~ '^-?\d{1,9}$' then
    raise exception 'O campo % precisa ser um número inteiro', p_campo using errcode = '22023';
  end if;
  return (p_valor #>> '{}')::int;
end;
$$;
revoke execute on function privado.inteiro_jsonb(jsonb, text) from public, anon, authenticated;

-- RPCs para authenticated ----------------------------------------------------------------------

create function public.sou_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.eh_admin();
$$;

create function public.admin_listar_obras()
returns table (
  id uuid,
  slug text,
  nome text,
  ordem int,
  pavimentos jsonb,
  ambientes_ativos int,
  status text,
  config_atualizada_em timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return query
  select o.id, o.slug, o.nome, o.ordem,
         coalesce((
           select jsonb_agg(jsonb_build_object('codigo', p.codigo, 'nome', p.nome, 'ordem', p.ordem)
                            order by p.ordem, p.codigo)
             from public.pavimento p where p.obra_id = o.id
         ), '[]'::jsonb),
         (select count(*)::int from public.ambiente a where a.obra_id = o.id and a.ativo),
         c.config ->> 'status',
         c.atualizado_em
    from public.obra o
    left join public.obra_config c on c.obra_id = o.id
   order by o.ordem, o.nome;
end;
$$;

create function public.admin_obter_obra(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  return jsonb_build_object(
    'obra', jsonb_build_object(
      'id', v_obra.id, 'slug', v_obra.slug, 'nome', v_obra.nome, 'ordem', v_obra.ordem,
      'telegram_vinculado', v_obra.telegram_chat_id is not null
    ),
    'pavimentos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'codigo', p.codigo, 'nome', p.nome, 'ordem', p.ordem,
               'ambientes', (select count(*) from public.ambiente a where a.pavimento_id = p.id),
               'ambientes_ativos', (select count(*) from public.ambiente a where a.pavimento_id = p.id and a.ativo),
               'plantas', (select count(*) from public.planta pl where pl.pavimento_id = p.id)
             ) order by p.ordem, p.codigo)
        from public.pavimento p where p.obra_id = v_obra.id
    ), '[]'::jsonb),
    'config', (select c.config from public.obra_config c where c.obra_id = v_obra.id),
    'config_atualizada_em', (select c.atualizado_em from public.obra_config c where c.obra_id = v_obra.id),
    'config_atualizada_por', (
      select u.nome from public.obra_config c join public.usuario u on u.id = c.atualizado_por
       where c.obra_id = v_obra.id
    )
  );
end;
$$;

-- Cria (sem `id`) ou edita (com `id`) uma obra. O slug é definido na criação e não muda.
create function public.admin_salvar_obra(p jsonb)
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
  v_obra public.obra;
begin
  perform privado.exigir_admin();
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da obra inválidos' using errcode = '22023';
  end if;
  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    v_id := privado.uuid_ou_nulo(p ->> 'id');
    if v_id is null then
      raise exception 'Identificador da obra inválido' using errcode = '22023';
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
    raise exception 'Informe o nome da obra (até 120 caracteres)' using errcode = '22023';
  end if;

  if v_id is null then
    if v_slug is null or v_slug !~ '^[a-z0-9-]+$' or char_length(v_slug) > 40 then
      raise exception 'Slug inválido: use letras minúsculas, dígitos e hífen (até 40 caracteres)'
        using errcode = '22023';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome da obra (até 120 caracteres)' using errcode = '22023';
    end if;
    if exists (select 1 from public.obra o where o.slug = v_slug) then
      raise exception 'Já existe uma obra com o slug %', v_slug using errcode = '23505';
    end if;
    insert into public.obra (slug, nome, ordem)
    values (v_slug, v_nome, coalesce(v_ordem, 0))
    returning * into v_obra;
  else
    select * into v_obra from public.obra o where o.id = v_id for update;
    if not found then
      raise exception 'Obra não encontrada' using errcode = 'P0002';
    end if;
    if v_slug is not null and v_slug <> v_obra.slug then
      raise exception 'O slug não pode ser alterado depois de criado' using errcode = '22023';
    end if;
    update public.obra o
       set nome = coalesce(v_nome, o.nome), ordem = coalesce(v_ordem, o.ordem)
     where o.id = v_id
    returning * into v_obra;
  end if;

  return jsonb_build_object('id', v_obra.id, 'slug', v_obra.slug, 'nome', v_obra.nome, 'ordem', v_obra.ordem);
end;
$$;

-- Lista completa de pavimentos da obra: [{codigo, nome, ordem}]. Inclui os novos, atualiza
-- nome e ordem dos existentes (pelo código) e apaga os que ficaram fora, desde que não
-- tenham ambientes nem plantas. Devolve a lista resultante.
create function public.admin_salvar_pavimentos(p_slug text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
  v_item jsonb;
  v_codigo text;
  v_nome text;
  v_codigos text[] := '{}';
  v_bloqueado text;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'A lista de pavimentos é inválida' using errcode = '22023';
  end if;

  -- Serializa edições simultâneas da mesma obra.
  perform 1 from public.obra o where o.id = v_obra.id for update;

  for v_item in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'codigo') is distinct from 'string'
       or jsonb_typeof(v_item -> 'nome') is distinct from 'string' then
      raise exception 'Cada pavimento precisa de código e nome' using errcode = '22023';
    end if;
    v_codigo := v_item ->> 'codigo';
    v_nome := btrim(v_item ->> 'nome');
    if v_codigo !~ '^[a-z0-9][a-z0-9-]*$' or char_length(v_codigo) > 30 then
      raise exception 'Código de pavimento inválido: %. Use letras minúsculas, dígitos e hífen (até 30)', v_codigo
        using errcode = '22023';
    end if;
    if v_nome = '' or char_length(v_nome) > 80 then
      raise exception 'Informe o nome do pavimento % (até 80 caracteres)', v_codigo using errcode = '22023';
    end if;
    if v_codigo = any (v_codigos) then
      raise exception 'Código de pavimento repetido: %', v_codigo using errcode = '22023';
    end if;
    v_codigos := v_codigos || v_codigo;

    insert into public.pavimento (obra_id, codigo, nome, ordem)
    values (v_obra.id, v_codigo, v_nome,
            coalesce(privado.inteiro_jsonb(v_item -> 'ordem', 'ordem'), cardinality(v_codigos)))
    on conflict (obra_id, codigo) do update
      set nome = excluded.nome, ordem = excluded.ordem;
  end loop;

  select string_agg(pv.codigo, ', ' order by pv.codigo) into v_bloqueado
    from public.pavimento pv
   where pv.obra_id = v_obra.id and not (pv.codigo = any (v_codigos))
     and (exists (select 1 from public.ambiente a where a.pavimento_id = pv.id)
          or exists (select 1 from public.planta pl where pl.pavimento_id = pv.id));
  if v_bloqueado is not null then
    raise exception 'Não é possível apagar pavimento com ambientes ou plantas: %', v_bloqueado
      using errcode = '23503';
  end if;

  delete from public.pavimento pv where pv.obra_id = v_obra.id and not (pv.codigo = any (v_codigos));

  return coalesce((
    select jsonb_agg(jsonb_build_object('codigo', pv.codigo, 'nome', pv.nome, 'ordem', pv.ordem)
                     order by pv.ordem, pv.codigo)
      from public.pavimento pv where pv.obra_id = v_obra.id
  ), '[]'::jsonb);
end;
$$;

-- Grava a configuração da obra (objeto jsonb; os campos conhecidos são conferidos).
create function public.admin_salvar_config(p_slug text, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
  v_campo text;
  v_linha public.obra_config;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'A configuração precisa ser um objeto JSON' using errcode = '22023';
  end if;
  if p_config ? 'status' and (p_config ->> 'status') is distinct from 'aguardando_revisao_humana'
     and (p_config ->> 'status') is distinct from 'revisado' then
    raise exception 'Status inválido: use aguardando_revisao_humana ou revisado' using errcode = '22023';
  end if;
  foreach v_campo in array array['nomes_fixos', 'categorias'] loop
    if p_config ? v_campo and (
         jsonb_typeof(p_config -> v_campo) <> 'object'
         or exists (select 1 from jsonb_each(p_config -> v_campo) e where jsonb_typeof(e.value) <> 'string')
       ) then
      raise exception 'O campo % precisa ser um objeto de texto para texto', v_campo using errcode = '22023';
    end if;
  end loop;

  insert into public.obra_config (obra_id, config, atualizado_em, atualizado_por)
  values (v_obra.id, p_config, now(), auth.uid())
  on conflict (obra_id) do update
    set config = excluded.config, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por
  returning * into v_linha;

  return jsonb_build_object('config', v_linha.config, 'atualizado_em', v_linha.atualizado_em);
end;
$$;

-- Cópia de segurança da obra em JSON: obra, pavimentos, configuração, ambientes e plantas.
create function public.admin_exportar_obra(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  return jsonb_build_object(
    'formato', 'miniappcofz-obra',
    'versao', 1,
    'exportado_em', now(),
    'obra', jsonb_build_object('slug', v_obra.slug, 'nome', v_obra.nome, 'ordem', v_obra.ordem),
    'pavimentos', coalesce((
      select jsonb_agg(jsonb_build_object('codigo', p.codigo, 'nome', p.nome, 'ordem', p.ordem)
                       order by p.ordem, p.codigo)
        from public.pavimento p where p.obra_id = v_obra.id
    ), '[]'::jsonb),
    'config', (select c.config from public.obra_config c where c.obra_id = v_obra.id),
    'ambientes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'codigo', a.codigo, 'pavimento', p.codigo, 'nome_operacional', a.nome_operacional,
               'nome_planta', a.nome_planta, 'categoria', a.categoria, 'area_m2', a.area_m2,
               'revisao_planta', a.revisao_planta, 'marcadores', a.marcadores, 'ordem', a.ordem,
               'ativo', a.ativo
             ) order by p.ordem, a.ordem, a.codigo)
        from public.ambiente a join public.pavimento p on p.id = a.pavimento_id
       where a.obra_id = v_obra.id
    ), '[]'::jsonb),
    'plantas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'pavimento', p.codigo, 'revisao', pl.revisao, 'ativa', pl.ativa, 'pdf_sha256', pl.pdf_sha256,
               'pagina_pt', jsonb_build_array(pl.pagina_largura_pt, pl.pagina_altura_pt),
               'recorte_pt', to_jsonb(pl.recorte_pt),
               'imagem', jsonb_build_object('path', pl.imagem_path, 'largura', pl.imagem_largura,
                                            'altura', pl.imagem_altura),
               'imagem_hd', case when pl.imagem_hd_path is null then null else
                 jsonb_build_object('path', pl.imagem_hd_path, 'largura', pl.imagem_hd_largura,
                                    'altura', pl.imagem_hd_altura) end,
               'criado_em', pl.criado_em,
               'detalhes', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'ambiente', a.codigo, 'imagem_path', d.imagem_path,
                          'recorte_pt', to_jsonb(d.recorte_pt), 'largura', d.largura, 'altura', d.altura
                        ) order by a.codigo)
                   from public.planta_detalhe d join public.ambiente a on a.id = d.ambiente_id
                  where d.planta_id = pl.id
               ), '[]'::jsonb)
             ) order by p.ordem, p.codigo, pl.criado_em, pl.revisao)
        from public.planta pl join public.pavimento p on p.id = pl.pavimento_id
       where pl.obra_id = v_obra.id
    ), '[]'::jsonb)
  );
end;
$$;

create function public.admin_listar_admins()
returns table (
  usuario_id uuid,
  nome text,
  username text,
  telegram_id bigint,
  criado_em timestamptz,
  criado_por_nome text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return query
  select a.usuario_id, u.nome, u.username, u.telegram_id, a.criado_em, c.nome
    from public.admin_app a
    join public.usuario u on u.id = a.usuario_id
    left join public.usuario c on c.id = a.criado_por
   order by u.nome, a.usuario_id;
end;
$$;

create function public.admin_incluir_admin(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  if not exists (select 1 from public.usuario u where u.id = p_usuario) then
    raise exception 'Usuário não encontrado' using errcode = 'P0002';
  end if;
  insert into public.admin_app (usuario_id, criado_por)
  values (p_usuario, auth.uid())
  on conflict (usuario_id) do nothing;
end;
$$;

-- Nunca remove o último admin (as linhas são travadas para remoções simultâneas).
create function public.admin_remover_admin(p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  perform 1 from public.admin_app a for update;
  if not exists (select 1 from public.admin_app a where a.usuario_id = p_usuario) then
    raise exception 'Este usuário não é admin' using errcode = 'P0002';
  end if;
  if (select count(*) from public.admin_app) <= 1 then
    raise exception 'Não é possível remover o último admin' using errcode = '22023';
  end if;
  delete from public.admin_app a where a.usuario_id = p_usuario;
end;
$$;

-- Usuários que já entraram no Mini App, para escolher um novo admin.
create function public.admin_listar_usuarios()
returns table (id uuid, nome text, username text, telegram_id bigint, eh_admin boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return query
  select u.id, u.nome, u.username, u.telegram_id,
         exists (select 1 from public.admin_app a where a.usuario_id = u.id)
    from public.usuario u
   order by u.nome, u.id;
end;
$$;

revoke execute on function public.sou_admin() from public, anon;
revoke execute on function public.admin_listar_obras() from public, anon;
revoke execute on function public.admin_obter_obra(text) from public, anon;
revoke execute on function public.admin_salvar_obra(jsonb) from public, anon;
revoke execute on function public.admin_salvar_pavimentos(text, jsonb) from public, anon;
revoke execute on function public.admin_salvar_config(text, jsonb) from public, anon;
revoke execute on function public.admin_exportar_obra(text) from public, anon;
revoke execute on function public.admin_listar_admins() from public, anon;
revoke execute on function public.admin_incluir_admin(uuid) from public, anon;
revoke execute on function public.admin_remover_admin(uuid) from public, anon;
revoke execute on function public.admin_listar_usuarios() from public, anon;
grant execute on function public.sou_admin() to authenticated;
grant execute on function public.admin_listar_obras() to authenticated;
grant execute on function public.admin_obter_obra(text) to authenticated;
grant execute on function public.admin_salvar_obra(jsonb) to authenticated;
grant execute on function public.admin_salvar_pavimentos(text, jsonb) to authenticated;
grant execute on function public.admin_salvar_config(text, jsonb) to authenticated;
grant execute on function public.admin_exportar_obra(text) to authenticated;
grant execute on function public.admin_listar_admins() to authenticated;
grant execute on function public.admin_incluir_admin(uuid) to authenticated;
grant execute on function public.admin_remover_admin(uuid) to authenticated;
grant execute on function public.admin_listar_usuarios() to authenticated;

-- RPCs só para service_role (Edge Function admin-sessao) ----------------------------------------

-- Guarda o hash de um link de entrada (vale 2 min) para um admin e apaga os expirados.
create function public.admin_entrada_criar(p_usuario uuid, p_token_hash text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expira timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash do token inválido' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admin_app a where a.usuario_id = p_usuario) then
    raise exception 'Apenas admins do Mini App podem abrir o site de administração' using errcode = '42501';
  end if;
  delete from privado.admin_entrada e where e.expira_em <= now();
  insert into privado.admin_entrada (token_hash, usuario_id, expira_em)
  values (p_token_hash, p_usuario, now() + interval '2 minutes')
  returning expira_em into v_expira;
  return v_expira;
end;
$$;

-- Consome o link (uso único: a linha é apagada) e devolve o admin dono dele, ou nada se o
-- hash não existir, tiver expirado ou o usuário não for mais admin.
create function public.admin_entrada_consumir(p_token_hash text)
returns table (usuario_id uuid, email text, nome text, username text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid;
  v_expira timestamptz;
begin
  delete from privado.admin_entrada e where e.token_hash = p_token_hash
  returning e.usuario_id, e.expira_em into v_usuario, v_expira;
  delete from privado.admin_entrada e where e.expira_em <= now();
  if v_usuario is null or v_expira <= now() then
    return;
  end if;
  return query
  select u.id, au.email::text, u.nome, u.username
    from public.usuario u
    join public.admin_app a on a.usuario_id = u.id
    join auth.users au on au.id = u.id
   where u.id = v_usuario;
end;
$$;

-- Admin pelo id do Telegram (Login Widget); nada se não existir ou não for admin.
create function public.admin_por_telegram(p_telegram_id bigint)
returns table (usuario_id uuid, email text, nome text, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, au.email::text, u.nome, u.username
    from public.usuario u
    join public.admin_app a on a.usuario_id = u.id
    join auth.users au on au.id = u.id
   where u.telegram_id = p_telegram_id;
$$;

revoke execute on function public.admin_entrada_criar(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_entrada_consumir(text) from public, anon, authenticated;
revoke execute on function public.admin_por_telegram(bigint) from public, anon, authenticated;
grant execute on function public.admin_entrada_criar(uuid, text) to service_role;
grant execute on function public.admin_entrada_consumir(text) to service_role;
grant execute on function public.admin_por_telegram(bigint) to service_role;
