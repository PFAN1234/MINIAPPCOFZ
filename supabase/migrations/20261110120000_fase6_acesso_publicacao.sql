-- Fase 6: acesso por grupo do Telegram (com aprovação) e publicação no tópico.
-- Contrato: docs/contrato-fase6.md, seção A.
-- Os segredos do Vault (segredo_interno e url_projeto) NÃO entram aqui: são criados uma vez no projeto.

-- Extensões (só se o servidor as oferece; no Supabase real sim, no PostgreSQL puro dos testes não) -----

do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

-- A.1 Tabelas e colunas ---------------------------------------------------------------------

create table privado.membro_grupo (
  obra_id uuid not null references public.obra (id) on delete cascade,
  usuario_id uuid not null references public.usuario (id) on delete cascade,
  conferido_em timestamptz not null default now(),
  primary key (obra_id, usuario_id)
);
alter table privado.membro_grupo enable row level security;
revoke all on privado.membro_grupo from public, anon, authenticated;

alter table public.solicitacao_acesso add column notificada_em timestamptz;

-- Pedidos passam a entrar só pela RPC solicitar_acesso.
drop policy solicitacao_acesso_insert on public.solicitacao_acesso;
revoke insert (obra_id, usuario_id) on public.solicitacao_acesso from authenticated;
revoke insert on public.solicitacao_acesso from authenticated;

-- A.2 RPCs para authenticated ---------------------------------------------------------------

create function public.obras_disponiveis()
returns table (id uuid, slug text, nome text, solicitacao text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
begin
  if v_usuario is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;

  return query
  select o.id, o.slug, o.nome,
         (select case when s.estado in ('pendente', 'recusada') then s.estado end
            from public.solicitacao_acesso s
           where s.obra_id = o.id and s.usuario_id = v_usuario
           order by s.criado_em desc, s.id desc
           limit 1) as solicitacao
    from public.obra o
    join privado.membro_grupo m on m.obra_id = o.id and m.usuario_id = v_usuario
   where m.conferido_em > now() - interval '7 days'
     and not exists (
       select 1 from public.participacao p
        where p.obra_id = o.id and p.usuario_id = v_usuario
     )
   order by o.ordem, o.nome;
end;
$$;

create function public.solicitar_acesso(p_obra uuid)
returns public.solicitacao_acesso
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := auth.uid();
  v_sol public.solicitacao_acesso;
begin
  if v_usuario is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;

  if not exists (
    select 1 from privado.membro_grupo m
     where m.obra_id = p_obra and m.usuario_id = v_usuario
       and m.conferido_em > now() - interval '7 days'
  ) then
    raise exception 'Entre no grupo da obra no Telegram para pedir acesso.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.participacao p where p.obra_id = p_obra and p.usuario_id = v_usuario
  ) then
    raise exception 'Você já tem acesso a esta obra.' using errcode = '23505';
  end if;

  select * into v_sol from public.solicitacao_acesso s
   where s.obra_id = p_obra and s.usuario_id = v_usuario and s.estado = 'pendente';
  if found then
    return v_sol;
  end if;

  if exists (
    select 1 from public.solicitacao_acesso s
     where s.obra_id = p_obra and s.usuario_id = v_usuario and s.estado = 'recusada'
       and s.decidido_em > now() - interval '24 hours'
  ) then
    raise exception 'Pedido recusado recentemente. Fale com o gestor da obra.' using errcode = '22023';
  end if;

  insert into public.solicitacao_acesso (obra_id, usuario_id, estado)
  values (p_obra, v_usuario, 'pendente')
  on conflict (obra_id, usuario_id) where estado = 'pendente' do nothing
  returning * into v_sol;
  if not found then
    -- Pedido simultâneo do mesmo usuário: devolve o que já existe.
    select * into v_sol from public.solicitacao_acesso s
     where s.obra_id = p_obra and s.usuario_id = v_usuario and s.estado = 'pendente';
  end if;
  return v_sol;
end;
$$;

create function public.listar_solicitacoes(p_obra uuid)
returns table (id uuid, usuario_id uuid, nome text, username text, criado_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if not privado.eh_gestor(p_obra) then
    raise exception 'Apenas gestores da obra podem ver os pedidos de acesso' using errcode = '42501';
  end if;

  return query
  select s.id, s.usuario_id, u.nome, u.username, s.criado_em
    from public.solicitacao_acesso s
    join public.usuario u on u.id = s.usuario_id
   where s.obra_id = p_obra and s.estado = 'pendente'
   order by s.criado_em, s.id;
end;
$$;

create function public.decidir_solicitacao(p_id uuid, p_aprovar boolean)
returns public.solicitacao_acesso
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sol public.solicitacao_acesso;
  v_novo text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if p_aprovar is null then
    raise exception 'Informe se o pedido é aprovado ou recusado' using errcode = '22023';
  end if;

  select * into v_sol from public.solicitacao_acesso s where s.id = p_id for update;
  if not found then
    raise exception 'Pedido não encontrado' using errcode = 'P0002';
  end if;
  if not privado.eh_gestor(v_sol.obra_id) then
    raise exception 'Apenas gestores da obra podem decidir pedidos de acesso' using errcode = '42501';
  end if;

  v_novo := case when p_aprovar then 'aprovada' else 'recusada' end;
  if v_sol.estado <> 'pendente' then
    if v_sol.estado = v_novo then
      return v_sol;
    end if;
    raise exception 'Pedido já decidido.' using errcode = '23505';
  end if;

  update public.solicitacao_acesso s
     set estado = v_novo, decidido_por = auth.uid(), decidido_em = now()
   where s.id = p_id
  returning * into v_sol;

  if p_aprovar then
    insert into public.participacao (obra_id, usuario_id, papel)
    values (v_sol.obra_id, v_sol.usuario_id, 'equipe')
    on conflict do nothing;
  end if;
  return v_sol;
end;
$$;

revoke execute on function public.obras_disponiveis() from public, anon;
revoke execute on function public.solicitar_acesso(uuid) from public, anon;
revoke execute on function public.listar_solicitacoes(uuid) from public, anon;
revoke execute on function public.decidir_solicitacao(uuid, boolean) from public, anon;
grant execute on function public.obras_disponiveis() to authenticated;
grant execute on function public.solicitar_acesso(uuid) to authenticated;
grant execute on function public.listar_solicitacoes(uuid) to authenticated;
grant execute on function public.decidir_solicitacao(uuid, boolean) to authenticated;

-- A.3 RPCs só para service_role -------------------------------------------------------------

create function public.segredo_interno()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select (select d.decrypted_secret from vault.decrypted_secrets d where d.name = 'segredo_interno' limit 1);
$$;

create function public.sincronizar_acesso(p_usuario uuid, p_itens jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_obra uuid;
  v_situacao text;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'A lista de obras é inválida' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'obra_id') <> 'string'
       or (v_item ->> 'obra_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (v_item ->> 'situacao') is null
       or (v_item ->> 'situacao') not in ('admin', 'membro', 'fora') then
      raise exception 'Item de acesso inválido' using errcode = '22023';
    end if;
    v_obra := (v_item ->> 'obra_id')::uuid;
    v_situacao := v_item ->> 'situacao';

    -- Obra inexistente não derruba a sincronização das demais.
    if not exists (select 1 from public.obra o where o.id = v_obra) then
      continue;
    end if;

    if v_situacao in ('admin', 'membro') then
      insert into privado.membro_grupo (obra_id, usuario_id, conferido_em)
      values (v_obra, p_usuario, now())
      on conflict (obra_id, usuario_id) do update set conferido_em = excluded.conferido_em;
    end if;

    if v_situacao = 'admin' then
      insert into public.participacao (obra_id, usuario_id, papel)
      values (v_obra, p_usuario, 'gestor')
      on conflict (obra_id, usuario_id) do update set papel = 'gestor';
    elsif v_situacao = 'fora' then
      delete from public.participacao p where p.obra_id = v_obra and p.usuario_id = p_usuario;
      delete from privado.membro_grupo m where m.obra_id = v_obra and m.usuario_id = p_usuario;
      update public.solicitacao_acesso s
         set estado = 'recusada', decidido_por = null, decidido_em = now()
       where s.obra_id = v_obra and s.usuario_id = p_usuario and s.estado = 'pendente';
    end if;
  end loop;
end;
$$;

create function public.vincular_obra(p_slug text, p_chat bigint, p_thread bigint)
returns public.obra
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
begin
  update public.obra o
     set telegram_chat_id = p_chat, telegram_thread_id = p_thread
   where o.slug = p_slug
  returning * into v_obra;
  if not found then
    return null;
  end if;

  update public.publicacao_telegram p
     set proxima_tentativa_em = now(), atualizado_em = now()
   where p.obra_id = v_obra.id and p.estado = 'pendente';
  return v_obra;
end;
$$;

create function public.reivindicar_publicacoes(p_limite int default 10)
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
      order by q.id
      limit greatest(coalesce(p_limite, 10), 0)
      for update skip locked
   )
  returning p.*;
end;
$$;

create function public.finalizar_publicacao(
  p_id bigint, p_estado text, p_message_ids bigint[], p_erro text, p_proxima timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_estado is null or p_estado not in ('publicado', 'pendente', 'incerto', 'falhou') then
    raise exception 'Estado de publicação inválido' using errcode = '22023';
  end if;

  update public.publicacao_telegram p
     set estado = p_estado,
         message_ids = p_message_ids,
         erro = left(p_erro, 500),
         proxima_tentativa_em = coalesce(p_proxima, now()),
         atualizado_em = now()
   where p.id = p_id and p.estado = 'enviando';
end;
$$;

revoke execute on function public.segredo_interno() from public, anon, authenticated;
revoke execute on function public.sincronizar_acesso(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.vincular_obra(text, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.reivindicar_publicacoes(int) from public, anon, authenticated;
revoke execute on function public.finalizar_publicacao(bigint, text, bigint[], text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.segredo_interno() to service_role;
grant execute on function public.sincronizar_acesso(uuid, jsonb) to service_role;
grant execute on function public.vincular_obra(text, bigint, bigint) to service_role;
grant execute on function public.reivindicar_publicacoes(int) to service_role;
grant execute on function public.finalizar_publicacao(bigint, text, bigint[], text, timestamptz) to service_role;

-- A.4 Disparo (pg_cron + pg_net) ------------------------------------------------------------

-- Chama a Edge Function publish-outbox. Roda dentro de transações de usuários (via gatilho),
-- então nunca pode falhar: sem segredos no Vault não faz nada; erro no envio vira aviso.
create function privado.disparar_publicacao()
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
    select d.decrypted_secret into v_url from vault.decrypted_secrets d where d.name = 'url_projeto' limit 1;
    select d.decrypted_secret into v_segredo from vault.decrypted_secrets d where d.name = 'segredo_interno' limit 1;
    if v_url is null or v_segredo is null then
      return;
    end if;

    perform net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/publish-outbox',
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-segredo-interno', v_segredo),
      timeout_milliseconds := 55000
    );
  exception when others then
    raise warning 'Não foi possível acionar a publicação no Telegram: %', sqlerrm;
  end;
end;
$$;
revoke execute on function privado.disparar_publicacao() from public, anon, authenticated;

-- Função de gatilho (um gatilho precisa devolver "trigger"; repassa a disparar_publicacao).
create function privado.gatilho_disparar_publicacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.disparar_publicacao();
  return null;
end;
$$;
revoke execute on function privado.gatilho_disparar_publicacao() from public, anon, authenticated;

create trigger publicacao_telegram_disparar
  after insert on public.publicacao_telegram
  for each statement execute function privado.gatilho_disparar_publicacao();

create trigger solicitacao_acesso_disparar
  after insert on public.solicitacao_acesso
  for each statement execute function privado.gatilho_disparar_publicacao();

-- Cron a cada minuto, de forma idempotente (desagenda antes, se existir).
do $$
begin
  if exists (select 1 from cron.job j where j.jobname = 'publicar-telegram') then
    perform cron.unschedule(job_name := 'publicar-telegram');
  end if;
  perform cron.schedule(
    job_name := 'publicar-telegram',
    schedule := '* * * * *',
    command := 'select privado.disparar_publicacao()'
  );
end $$;
