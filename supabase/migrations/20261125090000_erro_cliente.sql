-- Registro de erros do cliente (Mini App e site admin). Contrato: docs/contrato-erros-orfaos.md (A).

create table public.erro_cliente (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  usuario_id uuid,
  app text not null check (app in ('miniapp', 'admin')),
  versao text,
  rota text,
  mensagem text not null,
  pilha text,
  agente text,
  contexto jsonb
);
create index erro_cliente_criado_em_idx on public.erro_cliente (criado_em desc);
create index erro_cliente_usuario_idx on public.erro_cliente (usuario_id, criado_em desc);

-- Sem políticas de escrita; só admin lê. Gravação apenas pela RPC (security definer).
alter table public.erro_cliente enable row level security;
revoke all on public.erro_cliente from public, anon, authenticated;
grant select on public.erro_cliente to authenticated;

create policy erro_cliente_admin_le on public.erro_cliente
  for select to authenticated
  using (privado.eh_admin());

create function public.registrar_erro_cliente(
  p_app text,
  p_versao text,
  p_rota text,
  p_mensagem text,
  p_pilha text,
  p_agente text,
  p_contexto jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Sem sessão, entrada inválida ou excesso de envios: ignora em silêncio.
  if v_uid is null then
    return;
  end if;
  if p_app is null or p_app not in ('miniapp', 'admin') or p_mensagem is null or p_mensagem = '' then
    return;
  end if;
  if (select count(*) from public.erro_cliente e
       where e.usuario_id = v_uid and e.criado_em > now() - interval '1 minute') >= 20 then
    return;
  end if;

  insert into public.erro_cliente (usuario_id, app, versao, rota, mensagem, pilha, agente, contexto)
  values (
    v_uid,
    p_app,
    left(p_versao, 50),
    left(p_rota, 300),
    left(p_mensagem, 1000),
    left(p_pilha, 8000),
    left(p_agente, 300),
    case when p_contexto is not null and pg_column_size(p_contexto) <= 4096 then p_contexto end
  );
end;
$$;

create function public.admin_listar_erros_cliente(p_limite int default 200)
returns table (
  id bigint,
  criado_em timestamptz,
  usuario_id uuid,
  usuario_nome text,
  app text,
  versao text,
  rota text,
  mensagem text,
  pilha text,
  agente text,
  contexto jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return query
  select e.id, e.criado_em, e.usuario_id, coalesce(u.nome_exibicao, u.nome), e.app, e.versao, e.rota,
         e.mensagem, e.pilha, e.agente, e.contexto
    from public.erro_cliente e
    left join public.usuario u on u.id = e.usuario_id
   order by e.criado_em desc, e.id desc
   limit greatest(1, least(coalesce(p_limite, 200), 1000));
end;
$$;

revoke execute on function public.registrar_erro_cliente(text, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.admin_listar_erros_cliente(int) from public, anon;
grant execute on function public.registrar_erro_cliente(text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.admin_listar_erros_cliente(int) to authenticated;

-- Retenção: apaga registros com mais de 90 dias, todo dia às 03:30 UTC (idempotente).
do $$
begin
  if exists (select 1 from cron.job j where j.jobname = 'limpar-erro-cliente') then
    perform cron.unschedule(job_name := 'limpar-erro-cliente');
  end if;
  perform cron.schedule(
    job_name := 'limpar-erro-cliente',
    schedule := '30 3 * * *',
    command := $cmd$delete from public.erro_cliente where criado_em < now() - interval '90 days'$cmd$
  );
end $$;
