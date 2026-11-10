-- Stub mínimo do Supabase para testar migrations em um PostgreSQL puro.
-- Reproduz só o que as migrations usam: papéis, auth.users/auth.uid(), storage.buckets/objects.
-- NÃO é o Supabase real: ver observações no relatório da fase 2.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  email text
);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema if not exists storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner_id text,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

-- Igual ao do Supabase.
create function storage.foldername(name text) returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- Fase 6: Vault, pg_cron e pg_net (stubs mínimos que gravam em tabelas para inspeção).
-- No Supabase real as extensões pg_cron/pg_net e o Vault existem; aqui só as assinaturas usadas.
create schema if not exists vault;
create table vault.decrypted_secrets (
  name text,
  decrypted_secret text
);

create schema if not exists cron;
create table cron.job (
  jobid bigint generated always as identity primary key,
  schedule text not null,
  command text not null,
  jobname text unique
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql
as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid;
$$;
create function cron.unschedule(job_name text) returns boolean
language plpgsql
as $$
begin
  delete from cron.job where jobname = job_name;
  if not found then
    raise exception 'could not find valid entry for job ''%''', job_name;
  end if;
  return true;
end
$$;

create schema if not exists net;
create table net.pedido_stub (
  id bigint generated always as identity primary key,
  url text,
  body jsonb,
  params jsonb,
  headers jsonb,
  timeout_milliseconds int,
  criado_em timestamptz not null default now()
);
create function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds int default 5000
) returns bigint
language sql
as $$
  insert into net.pedido_stub (url, body, params, headers, timeout_milliseconds)
  values (url, body, params, headers, timeout_milliseconds)
  returning id;
$$;
