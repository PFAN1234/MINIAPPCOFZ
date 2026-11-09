-- Fase 2: schema privado (funções auxiliares), RLS e grants.

create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated;

-- Nada nasce aberto: tabelas, sequências e funções futuras não são concedidas
-- a anon/authenticated automaticamente (vale para o papel que roda a migration).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema privado revoke execute on functions from public, anon;

-- Funções auxiliares de permissão -------------------------------------------

create function privado.eh_participante(p_obra uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.participacao p
    where p.obra_id = p_obra and p.usuario_id = auth.uid()
  );
$$;

create function privado.eh_gestor(p_obra uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.participacao p
    where p.obra_id = p_obra and p.usuario_id = auth.uid() and p.papel = 'gestor'
  );
$$;

-- Converte texto em uuid sem lançar erro (devolve null se for inválido).
-- O CASE garante que o cast só roda depois do teste do formato.
create function privado.uuid_ou_nulo(p text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid
    else null
  end;
$$;

-- Há alguma obra em comum entre o usuário autenticado e p_usuario?
create function privado.divide_obra_com(p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.participacao a
    join public.participacao b on b.obra_id = a.obra_id
    where a.usuario_id = auth.uid() and b.usuario_id = p_usuario
  );
$$;

revoke execute on function privado.eh_participante(uuid) from public, anon;
revoke execute on function privado.eh_gestor(uuid) from public, anon;
revoke execute on function privado.uuid_ou_nulo(text) from public, anon;
revoke execute on function privado.divide_obra_com(uuid) from public, anon;
grant execute on function privado.eh_participante(uuid) to authenticated;
grant execute on function privado.eh_gestor(uuid) to authenticated;
grant execute on function privado.uuid_ou_nulo(text) to authenticated;
grant execute on function privado.divide_obra_com(uuid) to authenticated;

-- RLS -------------------------------------------------------------------------

alter table public.obra enable row level security;
alter table public.usuario enable row level security;
alter table public.participacao enable row level security;
alter table public.solicitacao_acesso enable row level security;
alter table public.pavimento enable row level security;
alter table public.ambiente enable row level security;
alter table public.registro enable row level security;
alter table public.encerramento enable row level security;
alter table public.foto enable row level security;
alter table public.publicacao_telegram enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on
  public.obra, public.usuario, public.participacao, public.solicitacao_acesso,
  public.pavimento, public.ambiente, public.registro, public.encerramento,
  public.foto, public.publicacao_telegram
to authenticated;
grant insert (obra_id, usuario_id) on public.solicitacao_acesso to authenticated;

create policy obra_select on public.obra
  for select to authenticated using (privado.eh_participante(id));

create policy pavimento_select on public.pavimento
  for select to authenticated using (privado.eh_participante(obra_id));

create policy ambiente_select on public.ambiente
  for select to authenticated using (privado.eh_participante(obra_id));

create policy registro_select on public.registro
  for select to authenticated using (privado.eh_participante(obra_id));

create policy encerramento_select on public.encerramento
  for select to authenticated using (privado.eh_participante(obra_id));

create policy foto_select on public.foto
  for select to authenticated using (privado.eh_participante(obra_id));

create policy publicacao_telegram_select on public.publicacao_telegram
  for select to authenticated using (privado.eh_participante(obra_id));

create policy usuario_select on public.usuario
  for select to authenticated
  using (id = (select auth.uid()) or privado.divide_obra_com(id));

create policy participacao_select on public.participacao
  for select to authenticated
  using (usuario_id = (select auth.uid()) or privado.eh_gestor(obra_id));

create policy solicitacao_acesso_select on public.solicitacao_acesso
  for select to authenticated
  using (usuario_id = (select auth.uid()) or privado.eh_gestor(obra_id));

create policy solicitacao_acesso_insert on public.solicitacao_acesso
  for insert to authenticated
  with check (
    usuario_id = (select auth.uid())
    and estado = 'pendente'
    and decidido_por is null
    and decidido_em is null
  );
