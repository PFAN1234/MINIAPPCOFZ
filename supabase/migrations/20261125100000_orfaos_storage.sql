-- Varredura de órfãos nos buckets do Storage (simulação). Contrato: docs/contrato-erros-orfaos.md (B).
-- Só registra na tabela `orfao_storage` o que parece órfão; NUNCA apaga de `storage.objects`.
-- A remoção real (fase futura) deve usar a API do Storage por Edge Function.

create table public.orfao_storage (
  bucket text not null,
  caminho text not null,
  tamanho bigint,
  criado_em timestamptz,
  detectado_em timestamptz not null default now(),
  removido_em timestamptz,
  primary key (bucket, caminho)
);
comment on table public.orfao_storage is
  'Arquivos dos buckets sem referência no banco há mais de 7 dias (simulação: nada é removido do Storage).';

alter table public.orfao_storage enable row level security;
revoke all on public.orfao_storage from public, anon, authenticated;
grant select on public.orfao_storage to authenticated;
create policy orfao_storage_admin_le on public.orfao_storage
  for select to authenticated
  using (privado.eh_admin());

-- Mapeamento bucket -> onde o banco guarda o caminho (levantado nas migrations):
--   fotos      : foto.storage_path
--   plantas    : planta.imagem_path, planta.imagem_hd_path, planta_detalhe.imagem_path
--   originais  : publicacao_planta.pdf_path (PDF de cada revisão publicada)
--   modelos    : modelo.caminho e publicacao_modelo.caminho (histórico de publicações)
--   boletins   : boletim.pdf_path e, por convenção sem coluna, a imagem do clima
--                <etapa_id>/<numero sem barras>-clima.png (derivada de boletim.etapa_id e boletim.numero)
--   organizacao: organizacao.logo_path (logo da organização/etapas)
--   relatorios : sem coluna (PDFs gerados com a chave secreta, caminho montado por convenção).
--                Na dúvida, tudo é referenciado; só vira órfão o objeto cuja primeira pasta é um uuid
--                que não é de nenhuma obra nem etapa existente (obra/etapa excluída).
-- Arquivos temporários de envio (planta, modelo, PDF original, logo, clima) ainda sem publicação:
-- a carência de 7 dias cobre o intervalo entre o envio e o registro no banco.
-- Só entram objetos com created_at anterior a 7 dias.
create function privado.varrer_orfaos_storage()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int;
begin
  create temporary table _orfaos_atuais on commit drop as
  with ref as (
    select 'fotos'::text as bucket, f.storage_path as caminho from public.foto f
    union all select 'plantas', p.imagem_path from public.planta p
    union all select 'plantas', p.imagem_hd_path from public.planta p where p.imagem_hd_path is not null
    union all select 'plantas', d.imagem_path from public.planta_detalhe d
    union all select 'originais', pp.pdf_path from public.publicacao_planta pp
    union all select 'modelos', m.caminho from public.modelo m
    union all select 'modelos', pm.caminho from public.publicacao_modelo pm where pm.caminho is not null
    union all select 'boletins', b.pdf_path from public.boletim b where b.pdf_path is not null
    union all select 'boletins', b.etapa_id::text || '/' || replace(b.numero, '/', '') || '-clima.png'
                from public.boletim b
    union all select 'boletins', regexp_replace(b.pdf_path, '\.pdf$', '') || '-clima.png'
                from public.boletim b where b.pdf_path is not null
    union all select 'organizacao', o.logo_path from public.organizacao o where o.logo_path is not null
  )
  select o.bucket_id as bucket, o.name as caminho,
         case when (o.metadata ->> 'size') ~ '^[0-9]+$' then (o.metadata ->> 'size')::bigint end as tamanho,
         o.created_at as criado_em
    from storage.objects o
   where o.bucket_id in ('fotos', 'plantas', 'originais', 'modelos', 'boletins', 'organizacao', 'relatorios')
     and o.created_at < now() - interval '7 days'
     and not exists (select 1 from ref r where r.bucket = o.bucket_id and r.caminho = o.name)
     and (o.bucket_id <> 'relatorios'
          or (privado.uuid_ou_nulo((storage.foldername(o.name))[1]) is not null
              and not exists (select 1 from public.obra ob
                               where ob.id = privado.uuid_ou_nulo((storage.foldername(o.name))[1]))
              and not exists (select 1 from public.etapa e
                               where e.id = privado.uuid_ou_nulo((storage.foldername(o.name))[1]))));

  -- Some da lista o que voltou a ter referência ou saiu do bucket (itens já removidos ficam como histórico).
  delete from public.orfao_storage t
   where t.removido_em is null
     and not exists (select 1 from _orfaos_atuais a where a.bucket = t.bucket and a.caminho = t.caminho);

  insert into public.orfao_storage (bucket, caminho, tamanho, criado_em)
  select a.bucket, a.caminho, a.tamanho, a.criado_em from _orfaos_atuais a
  on conflict (bucket, caminho) do update
    set tamanho = excluded.tamanho, criado_em = excluded.criado_em
    where public.orfao_storage.removido_em is null;

  select count(*) into v_total from public.orfao_storage where removido_em is null;
  drop table _orfaos_atuais;
  return v_total;
end;
$$;
revoke execute on function privado.varrer_orfaos_storage() from public, anon, authenticated;

-- Diário às 03:17 UTC (idempotente).
do $$
begin
  if exists (select 1 from cron.job j where j.jobname = 'varrer-orfaos-storage') then
    perform cron.unschedule(job_name := 'varrer-orfaos-storage');
  end if;
  perform cron.schedule(
    job_name := 'varrer-orfaos-storage',
    schedule := '17 3 * * *',
    command := $cmd$select privado.varrer_orfaos_storage()$cmd$
  );
end $$;

-- Resumo para o site admin: {buckets: [{bucket, quantidade, bytes}], maiores: [100 maiores], total}.
create function public.admin_resumo_orfaos()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return jsonb_build_object(
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', x.bucket, 'quantidade', x.qtd, 'bytes', x.bytes)
                       order by x.bucket)
        from (select o.bucket, count(*) as qtd, coalesce(sum(o.tamanho), 0)::bigint as bytes
                from public.orfao_storage o where o.removido_em is null group by o.bucket) x
    ), '[]'::jsonb),
    'maiores', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', m.bucket, 'caminho', m.caminho, 'tamanho', m.tamanho,
                                          'criado_em', m.criado_em, 'detectado_em', m.detectado_em)
                       order by m.tamanho desc nulls last, m.bucket, m.caminho)
        from (select * from public.orfao_storage o where o.removido_em is null
               order by o.tamanho desc nulls last, o.bucket, o.caminho limit 100) m
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_resumo_orfaos() from public, anon;
grant execute on function public.admin_resumo_orfaos() to authenticated;
