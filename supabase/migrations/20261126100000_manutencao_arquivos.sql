-- Parte 2 do R2: manutenção diária dos arquivos.
-- Contrato: docs/contrato-r2.md. O job chama a Edge Function `armazenamento` (ação `manutencao`,
-- só no modo interno) com pg_net e o segredo interno do Vault, no mesmo padrão do
-- publish-outbox. Sem `url_projeto` ou `segredo_interno` no Vault, não faz nada.

create function privado.disparar_manutencao_arquivos()
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
      url := rtrim(v_url, '/') || '/functions/v1/armazenamento',
      body := '{"acao":"manutencao"}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-segredo-interno', v_segredo),
      timeout_milliseconds := 300000
    );
  exception when others then
    raise warning 'Não foi possível acionar a manutenção dos arquivos: %', sqlerrm;
  end;
end;
$$;
revoke execute on function privado.disparar_manutencao_arquivos() from public, anon, authenticated;

-- Diário às 04:41 UTC (idempotente; fora das horas cheias e do job de órfãos das 03:17).
do $$
begin
  if exists (select 1 from cron.job j where j.jobname = 'manutencao-arquivos') then
    perform cron.unschedule(job_name := 'manutencao-arquivos');
  end if;
  perform cron.schedule(
    job_name := 'manutencao-arquivos',
    schedule := '41 4 * * *',
    command := 'select privado.disparar_manutencao_arquivos()'
  );
end $$;
