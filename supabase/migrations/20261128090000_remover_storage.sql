-- Remove as políticas antigas de storage.objects (Parte 5 da troca do Storage pelo Cloudflare R2).
--
-- ATENÇÃO: esta migration só pode ser aplicada DEPOIS da conferência da virada (ver
-- docs/contrato-r2.md, Parte 5): app e functions já usando só o R2, arquivos copiados e
-- conferidos, backup semanal funcionando. Antes disso, o código antigo ainda depende das políticas.
--
-- Não apaga buckets nem objetos por SQL: o Supabase proíbe `delete` direto nas tabelas do Storage.
-- Os buckets e objetos restantes são removidos pela API do Storage, em passo separado.

drop policy if exists fotos_select on storage.objects;
drop policy if exists fotos_insert on storage.objects;
drop policy if exists fotos_update on storage.objects;
drop policy if exists fotos_admin_select on storage.objects;
drop policy if exists plantas_select on storage.objects;
drop policy if exists plantas_admin_select on storage.objects;
drop policy if exists plantas_admin_insert on storage.objects;
drop policy if exists plantas_admin_update on storage.objects;
drop policy if exists originais_admin_select on storage.objects;
drop policy if exists originais_admin_insert on storage.objects;
drop policy if exists originais_admin_update on storage.objects;
drop policy if exists modelos_select on storage.objects;
drop policy if exists modelos_admin_select on storage.objects;
drop policy if exists modelos_admin_insert on storage.objects;
drop policy if exists modelos_admin_update on storage.objects;
drop policy if exists organizacao_admin_select on storage.objects;
drop policy if exists organizacao_admin_insert on storage.objects;
drop policy if exists organizacao_admin_update on storage.objects;
drop policy if exists organizacao_admin_delete on storage.objects;
drop policy if exists boletins_select on storage.objects;
