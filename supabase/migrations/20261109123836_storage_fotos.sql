-- Fase 2: bucket privado `fotos` e políticas de acesso.
-- Caminho: <obra_id>/<registro_id>/<foto_id>.jpg

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;

-- Foto já vinculada a um registro ou encerramento: o arquivo vira evidência e não
-- pode mais ser sobrescrito pelo cliente.
create function privado.foto_registrada(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.foto f where f.storage_path = p_name);
$$;

revoke execute on function privado.foto_registrada(text) from public, anon;
grant execute on function privado.foto_registrada(text) to authenticated;

create policy fotos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fotos'
    and privado.eh_participante(privado.uuid_ou_nulo((storage.foldername(name))[1]))
  );

create policy fotos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fotos'
    and privado.eh_participante(privado.uuid_ou_nulo((storage.foldername(name))[1]))
  );

-- Reenvio (upsert) do mesmo arquivo: só o dono do objeto, ainda dentro da obra,
-- e só enquanto a foto não foi vinculada por concluir_registro/encerrar_pendencia.
create policy fotos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fotos'
    and owner_id = (select auth.uid())::text
    and privado.eh_participante(privado.uuid_ou_nulo((storage.foldername(name))[1]))
    and not privado.foto_registrada(name)
  )
  with check (
    bucket_id = 'fotos'
    and owner_id = (select auth.uid())::text
    and privado.eh_participante(privado.uuid_ou_nulo((storage.foldername(name))[1]))
  );

-- Sem política de delete: fotos não são apagadas pelo cliente.
