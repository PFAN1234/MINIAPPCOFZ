-- Fase 9 (B): modelos 3D do modelo federado (.frag da That Open Engine).
-- Plano: tasks/plano-modelo-federado.md, fase B.
-- Arquivo: <obra_id>/<SIGLA>.frag no bucket privado `modelos`. A tabela guarda o `hash`
-- (o app usa como chave do cache no aparelho: o mesmo hash dispensa novo download).
-- O cliente só lê; a gravação é do script `publicar_modelos` (service role).

create table public.modelo (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  sigla text not null,
  revisao text,
  caminho text not null,
  bytes bigint not null,
  hash text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint modelo_sigla_formato check (sigla ~ '^[A-Z]{2,4}$'),
  constraint modelo_bytes_positivo check (bytes > 0),
  constraint modelo_hash_nao_vazio check (hash <> ''),
  constraint modelo_unico_por_sigla unique (obra_id, sigla)
);

alter table public.modelo enable row level security;

revoke all on public.modelo from anon, authenticated;
grant select on public.modelo to authenticated;

-- O script `publicar_modelos` (chave secreta) lê a obra e grava os modelos. Só isso: o
-- service_role não tem grants nas demais tabelas.
grant select on public.obra to service_role;
grant select, insert, update, delete on public.modelo to service_role;

create policy modelo_select on public.modelo
  for select to authenticated using (privado.eh_participante(obra_id));

-- Bucket privado `modelos` (.frag, até 200 MB) -----------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('modelos', 'modelos', false, 209715200, array['application/octet-stream'])
on conflict (id) do nothing;

create policy modelos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'modelos'
    and privado.eh_participante(privado.uuid_ou_nulo((storage.foldername(name))[1]))
  );
