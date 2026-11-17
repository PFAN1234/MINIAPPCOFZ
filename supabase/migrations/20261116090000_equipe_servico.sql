-- Equipe de serviço (check-in e check-out) e abas de etapa no início, parte A: banco.
-- Contrato: docs/contrato-servico.md ("Parte A").
--
-- - `servico`: entrada e saída de quem está de serviço numa etapa (check-in a até 1 km da etapa).
-- - Funções internas: fechamento automático em 24 h, distância, participação, equipe e
--   responsáveis do dia.
-- - Snapshot do boletim: `privado.boletim_snapshot` passa a somar `responsaveis` e `equipe_servico`.
-- - Publicação no grupo: `publicacao_telegram` ganha `servico_id` e `servico_evento`.
-- - RPCs do Mini App: etapas_inicio, equipe_servico, fazer_checkin e fazer_checkout.

-- Tabela -----------------------------------------------------------------------------------------

create table public.servico (
  id uuid primary key default gen_random_uuid(),
  etapa_id uuid not null references public.etapa (id) on delete cascade,
  usuario_id uuid not null references public.usuario (id) on delete cascade,
  entrada_em timestamptz not null default now(),
  saida_em timestamptz,
  saida_automatica boolean not null default false,
  latitude double precision not null,
  longitude double precision not null,
  precisao_m double precision,
  distancia_m double precision not null,
  criado_em timestamptz not null default now(),
  constraint servico_saida_apos_entrada check (saida_em is null or saida_em >= entrada_em),
  constraint servico_automatica_com_saida check (not saida_automatica or saida_em is not null)
);
create unique index servico_um_aberto_idx on public.servico (usuario_id) where saida_em is null;
create index servico_etapa_entrada_idx on public.servico (etapa_id, entrada_em);
comment on table public.servico is
  'Equipe de serviço: check-in (a até 1 km da etapa) e check-out. Sem acesso direto: o Mini App usa equipe_servico/fazer_checkin/fazer_checkout.';
comment on column public.servico.saida_automatica is 'Saída fechada sozinha 24 h depois da entrada (esqueceu o check-out).';

alter table public.servico enable row level security;
revoke all on public.servico from public, anon, authenticated;

-- Funções internas -------------------------------------------------------------------------------

create function privado.fechar_servicos_vencidos()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.servico
     set saida_em = entrada_em + interval '24 hours', saida_automatica = true
   where saida_em is null and entrada_em + interval '24 hours' <= now();
$$;
revoke execute on function privado.fechar_servicos_vencidos() from public, anon, authenticated;

create function privado.distancia_m(lat1 double precision, lon1 double precision,
                                    lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  )));
$$;
revoke execute on function privado.distancia_m(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- `privado.participa_da_etapa(uuid)` já existe (20261112180000_etapas.sql): participação em obra ativa
-- de etapa ativa, com `auth.uid()`.

-- Saída efetiva: a registrada ou, passadas 24 h da entrada, a automática (null = em serviço).
create function privado.servico_saida_efetiva(s public.servico)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(s.saida_em,
                  case when s.entrada_em + interval '24 hours' <= now() then s.entrada_em + interval '24 hours' end);
$$;
revoke execute on function privado.servico_saida_efetiva(public.servico) from public, anon, authenticated;

-- Serviços da etapa cujo período toca o dia p_data (no fuso da etapa), por entrada.
create function privado.servicos_do_dia(p_etapa uuid, p_data date)
returns table (usuario_id uuid, entrada_em timestamptz, saida_em timestamptz, saida_automatica boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.usuario_id, s.entrada_em, privado.servico_saida_efetiva(s),
         (s.saida_automatica or (s.saida_em is null and privado.servico_saida_efetiva(s) is not null))
    from public.servico s
    join public.etapa e on e.id = s.etapa_id
   where s.etapa_id = p_etapa
     and s.entrada_em < ((p_data + 1)::timestamp) at time zone e.fuso
     and coalesce(privado.servico_saida_efetiva(s), now()) >= (p_data::timestamp) at time zone e.fuso
   order by s.entrada_em, s.id;
$$;
revoke execute on function privado.servicos_do_dia(uuid, date) from public, anon, authenticated;

create function privado.equipe_do_dia(p_etapa uuid, p_data date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome', privado.nome_pessoa(d.usuario_id), 'entrada_em', d.entrada_em,
           'saida_em', d.saida_em, 'saida_automatica', d.saida_automatica
         ) order by d.entrada_em), '[]'::jsonb)
    from privado.servicos_do_dia(p_etapa, p_data) d;
$$;
revoke execute on function privado.equipe_do_dia(uuid, date) from public, anon, authenticated;

create function privado.responsaveis_do_dia(p_etapa uuid, p_data date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with equipe as (
    select d.usuario_id, min(d.entrada_em) as primeira
      from privado.servicos_do_dia(p_etapa, p_data) d
     group by d.usuario_id
  )
  select case
    when exists (select 1 from equipe) then (
      select jsonb_agg(jsonb_build_object(
               'nome', privado.nome_pessoa(q.usuario_id),
               'funcao', coalesce(r.funcao, 'Militar de serviço')
             ) order by q.primeira, q.usuario_id)
        from equipe q
        left join public.etapa_responsavel r on r.etapa_id = p_etapa and r.usuario_id = q.usuario_id
    )
    else coalesce((
      select jsonb_agg(jsonb_build_object('nome', privado.nome_pessoa(r.usuario_id), 'funcao', r.funcao)
                       order by r.ordem, r.usuario_id)
        from public.etapa_responsavel r where r.etapa_id = p_etapa
    ), '[]'::jsonb)
  end;
$$;
revoke execute on function privado.responsaveis_do_dia(uuid, date) from public, anon, authenticated;

-- Snapshot do boletim ----------------------------------------------------------------------------

alter function privado.boletim_snapshot(uuid, date) rename to boletim_snapshot_base;

create function privado.boletim_snapshot(p_etapa uuid, p_data date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select privado.boletim_snapshot_base(p_etapa, p_data)
         || jsonb_build_object('responsaveis', privado.responsaveis_do_dia(p_etapa, p_data),
                               'equipe_servico', privado.equipe_do_dia(p_etapa, p_data));
$$;
revoke execute on function privado.boletim_snapshot(uuid, date) from public, anon, authenticated;

-- Publicação no grupo ----------------------------------------------------------------------------

alter table public.publicacao_telegram
  add column servico_id uuid references public.servico (id) on delete cascade,
  add column servico_evento text,
  drop constraint publicacao_um_dono,
  drop constraint publicacao_obra_coerente,
  add constraint publicacao_um_dono
    check (num_nonnulls(registro_id, encerramento_id, boletim_id, servico_id) = 1),
  add constraint publicacao_obra_coerente
    check ((obra_id is null) = (boletim_id is not null or servico_id is not null)),
  add constraint publicacao_servico_evento_coerente
    check ((servico_id is null) = (servico_evento is null)),
  add constraint publicacao_servico_evento_valido
    check (servico_evento in ('entrada', 'saida'));
create unique index publicacao_servico_unica on public.publicacao_telegram (servico_id, servico_evento)
  where servico_id is not null;
comment on column public.publicacao_telegram.servico_id is
  'Check-in/check-out avisado no grupo da etapa (tópico Geral); obra_id fica null.';

create or replace function public.reivindicar_publicacoes(p_limite int default 10)
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
        and not exists (
          select 1 from public.obra o join public.etapa e on e.id = o.etapa_id
           where o.id = q.obra_id and (o.arquivada_em is not null or e.arquivada_em is not null)
        )
        and not exists (
          select 1 from public.boletim b join public.etapa e on e.id = b.etapa_id
           where b.id = q.boletim_id and e.arquivada_em is not null
        )
        and not exists (
          select 1 from public.servico s join public.etapa e on e.id = s.etapa_id
           where s.id = q.servico_id and e.arquivada_em is not null
        )
      order by q.id
      limit greatest(coalesce(p_limite, 10), 0)
      for update of q skip locked
   )
  returning p.*;
end;
$$;

-- RPCs do Mini App -------------------------------------------------------------------------------

-- Formato comum de equipe_servico/fazer_checkin/fazer_checkout (sem fechar vencidos nem checar etapa).
create function privado.equipe_servico_json(p_etapa uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'etapa_id', e.id,
    'participa', privado.participa_da_etapa(e.id),
    'tem_localizacao', e.latitude is not null and e.longitude is not null,
    'meu_servico', (
      select jsonb_build_object('id', s.id, 'etapa_id', s.etapa_id, 'etapa_nome', x.nome,
                                'entrada_em', s.entrada_em)
        from public.servico s join public.etapa x on x.id = s.etapa_id
       where s.usuario_id = auth.uid() and s.saida_em is null
    ),
    'equipe', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'usuario_id', s.usuario_id, 'nome', privado.nome_pessoa(s.usuario_id),
               'entrada_em', s.entrada_em, 'saida_em', s.saida_em,
               'saida_automatica', s.saida_automatica, 'eu', s.usuario_id = auth.uid()
             ) order by (s.saida_em is not null), s.entrada_em desc, s.id)
        from public.servico s
       where s.etapa_id = e.id
         and (s.saida_em is null or s.saida_em > now() - interval '24 hours')
    ), '[]'::jsonb)
  )
  from public.etapa e where e.id = p_etapa;
$$;
revoke execute on function privado.equipe_servico_json(uuid) from public, anon, authenticated;

create function public.etapas_inicio()
returns table (id uuid, slug text, nome text, ordem int, participa boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.slug, e.nome, e.ordem, privado.participa_da_etapa(e.id)
    from public.etapa e
   where e.arquivada_em is null
   order by e.ordem, e.nome;
$$;

create function public.equipe_servico(p_etapa uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform privado.fechar_servicos_vencidos();
  if not exists (select 1 from public.etapa e where e.id = p_etapa and e.arquivada_em is null) then
    raise exception 'Etapa não encontrada' using errcode = 'P0002';
  end if;
  return privado.equipe_servico_json(p_etapa);
end;
$$;

create function public.fazer_checkin(p_etapa uuid, p_latitude double precision, p_longitude double precision,
                                     p_precisao double precision default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e public.etapa;
  v_aberto public.servico;
  v_dist double precision;
  v_id uuid;
begin
  perform privado.fechar_servicos_vencidos();
  select * into e from public.etapa x where x.id = p_etapa and x.arquivada_em is null;
  if not found then
    raise exception 'Etapa não encontrada' using errcode = 'P0002';
  end if;
  if not privado.participa_da_etapa(p_etapa) then
    raise exception 'Você não participa desta etapa' using errcode = '42501';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Localização inválida' using errcode = '22023';
  end if;
  if e.latitude is null or e.longitude is null then
    raise exception 'A localização da etapa não está cadastrada. Peça ao administrador para preencher no site.'
      using errcode = 'P0001';
  end if;
  select s.* into v_aberto from public.servico s where s.usuario_id = auth.uid() and s.saida_em is null;
  if found then
    raise exception 'Você já está de serviço na %', (select x.nome from public.etapa x where x.id = v_aberto.etapa_id)
      using errcode = '23505';
  end if;
  v_dist := privado.distancia_m(p_latitude, p_longitude, e.latitude, e.longitude);
  if v_dist > 1000 then
    raise exception 'Você está a % da etapa. O check-in só vale até 1 km.',
      case when v_dist < 1000 then round(v_dist)::text || ' m'
           else replace(to_char(round((v_dist / 1000)::numeric, 1), 'FM999990.0'), '.', ',') || ' km' end
      using errcode = 'P0001';
  end if;

  insert into public.servico (etapa_id, usuario_id, latitude, longitude, precisao_m, distancia_m)
  values (p_etapa, auth.uid(), p_latitude, p_longitude, p_precisao, v_dist)
  returning id into v_id;
  insert into public.publicacao_telegram (servico_id, servico_evento) values (v_id, 'entrada');
  return privado.equipe_servico_json(p_etapa);
end;
$$;

create function public.fazer_checkout()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_servico public.servico;
begin
  perform privado.fechar_servicos_vencidos();
  update public.servico s set saida_em = now()
   where s.usuario_id = auth.uid() and s.saida_em is null
  returning s.* into v_servico;
  if not found then
    raise exception 'Você não está de serviço' using errcode = 'P0002';
  end if;
  insert into public.publicacao_telegram (servico_id, servico_evento) values (v_servico.id, 'saida');
  return privado.equipe_servico_json(v_servico.etapa_id);
end;
$$;

revoke execute on function public.etapas_inicio() from public, anon;
revoke execute on function public.equipe_servico(uuid) from public, anon;
revoke execute on function public.fazer_checkin(uuid, double precision, double precision, double precision)
  from public, anon;
revoke execute on function public.fazer_checkout() from public, anon;
grant execute on function public.etapas_inicio() to authenticated;
grant execute on function public.equipe_servico(uuid) to authenticated;
grant execute on function public.fazer_checkin(uuid, double precision, double precision, double precision)
  to authenticated;
grant execute on function public.fazer_checkout() to authenticated;
