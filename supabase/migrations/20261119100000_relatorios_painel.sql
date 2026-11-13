-- Painel e exportação de pendências na aba Relatórios do Mini App (docs/contrato-relatorios-painel.md).
--
-- `painel_relatorios(etapa)`: obras da etapa e, por obra e dia (no fuso da etapa), serviços e pendências
--   capturados e pendências resolvidas. Somando todos os dias, pendências menos resolvidas dá as abertas.
-- `relatorio_pendencias(etapa, obra)`: dados do PDF de pendências (abertas e resolvidas), acumulado até agora.
-- Bucket privado `relatorios`: guarda os PDFs gerados; sem policies, só a chave secreta grava e assina.

insert into storage.buckets (id, name, public)
values ('relatorios', 'relatorios', false)
on conflict (id) do nothing;

create function public.painel_relatorios(p_etapa uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa%rowtype;
  v_obras jsonb;
  v_dias jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  select * into v_etapa from public.etapa e where e.id = p_etapa;
  if not found then
    raise exception 'Etapa não encontrada' using errcode = 'P0002';
  end if;
  if not (privado.eh_admin() or privado.participa_da_etapa(v_etapa.id)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'slug', o.slug, 'nome', o.nome)
                            order by o.ordem, o.nome, o.id), '[]'::jsonb)
    into v_obras
    from public.obra o
   where o.etapa_id = v_etapa.id and o.arquivada_em is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'obra_id', x.obra_id, 'dia', x.dia,
           'servicos', x.servicos, 'pendencias', x.pendencias, 'resolvidas', x.resolvidas
         ) order by x.dia, x.ordem, x.nome, x.obra_id), '[]'::jsonb)
    into v_dias
    from (
      select m.obra_id, m.dia, o.ordem, o.nome,
             count(*) filter (where m.k = 's')::int as servicos,
             count(*) filter (where m.k = 'p')::int as pendencias,
             count(*) filter (where m.k = 'r')::int as resolvidas
        from (
          select r.obra_id, (r.capturado_em at time zone v_etapa.fuso)::date as dia,
                 case r.tipo when 'servico' then 's' else 'p' end as k
            from public.registro r
           where r.tipo in ('servico', 'pendencia')
          union all
          select en.obra_id, (en.encerrado_em at time zone v_etapa.fuso)::date, 'r'
            from public.encerramento en
            join public.registro r on r.id = en.registro_id
           where r.situacao = 'resolvida'
        ) m
        join public.obra o on o.id = m.obra_id
       where o.etapa_id = v_etapa.id and o.arquivada_em is null
       group by m.obra_id, m.dia, o.ordem, o.nome
    ) x;

  return jsonb_build_object(
    'etapa', jsonb_build_object('id', v_etapa.id, 'slug', v_etapa.slug, 'nome', v_etapa.nome,
                                'hoje', (now() at time zone v_etapa.fuso)::date),
    'obras', v_obras,
    'dias', v_dias);
end;
$$;

revoke execute on function public.painel_relatorios(uuid) from public, anon;
grant execute on function public.painel_relatorios(uuid) to authenticated;

comment on function public.painel_relatorios(uuid) is
  'Mini App, aba Relatórios: {etapa, obras (não arquivadas), dias (por obra e dia no fuso da etapa: servicos, pendencias, resolvidas)}. Exige admin ou participante da etapa.';

create function public.relatorio_pendencias(p_etapa uuid, p_obra uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa%rowtype;
  v_obra public.obra%rowtype;
  v_org public.organizacao%rowtype;
  v_hoje date;
  v_lista jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  select * into v_etapa from public.etapa e where e.id = p_etapa;
  if not found then
    raise exception 'Etapa não encontrada' using errcode = 'P0002';
  end if;
  if not (privado.eh_admin() or privado.participa_da_etapa(v_etapa.id)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_obra is not null then
    select * into v_obra from public.obra o where o.id = p_obra and o.etapa_id = v_etapa.id;
    if not found then
      raise exception 'Obra não pertence à etapa' using errcode = '22023';
    end if;
  end if;

  v_hoje := (now() at time zone v_etapa.fuso)::date;
  select * into v_org from public.organizacao limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'obra', o.nome, 'pavimento', pv.nome, 'ambiente', a.nome_operacional,
           'situacao', r.situacao, 'aberta_em', r.capturado_em,
           'autor', privado.nome_pessoa(r.autor_id), 'legenda', r.legenda,
           'dias', case when r.situacao = 'resolvida' and en.id is not null
                        then (en.encerrado_em at time zone v_etapa.fuso)::date
                             - (r.capturado_em at time zone v_etapa.fuso)::date
                        else v_hoje - (r.capturado_em at time zone v_etapa.fuso)::date end,
           'fotos', privado.boletim_fotos(r.id, null),
           'encerramento', case when en.id is null then null else jsonb_build_object(
              'em', en.encerrado_em, 'autor', privado.nome_pessoa(en.gestor_id),
              'observacao', en.observacao, 'fotos', privado.boletim_fotos(null, en.id)) end
         ) order by (r.situacao = 'resolvida'), o.ordem, o.nome, pv.ordem, pv.nome,
                    a.ordem, a.nome_operacional, r.capturado_em, r.id), '[]'::jsonb)
    into v_lista
    from public.registro r
    join public.obra o on o.id = r.obra_id
    join public.ambiente a on a.id = r.ambiente_id
    join public.pavimento pv on pv.id = a.pavimento_id
    left join public.encerramento en on en.registro_id = r.id
   where r.tipo = 'pendencia'
     and o.etapa_id = v_etapa.id and o.arquivada_em is null
     and (p_obra is null or o.id = p_obra);

  return jsonb_build_object(
    'gerado_em', now(),
    'fuso', v_etapa.fuso,
    'organizacao', jsonb_build_object('nome', v_org.nome, 'logo_path', v_org.logo_path),
    'etapa', jsonb_build_object('id', v_etapa.id, 'slug', v_etapa.slug, 'nome', v_etapa.nome,
                                'sigla', v_etapa.sigla),
    'obra', case when p_obra is null then null
                 else jsonb_build_object('id', v_obra.id, 'slug', v_obra.slug, 'nome', v_obra.nome) end,
    'pendencias', v_lista);
end;
$$;

revoke execute on function public.relatorio_pendencias(uuid, uuid) from public, anon;
grant execute on function public.relatorio_pendencias(uuid, uuid) to authenticated;

comment on function public.relatorio_pendencias(uuid, uuid) is
  'Dados do PDF de pendências da etapa (ou de uma obra), acumulado até agora: abertas antes das resolvidas, com fotos e encerramento. Exige admin ou participante da etapa.';
