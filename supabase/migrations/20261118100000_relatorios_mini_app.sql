-- Relatórios no Mini App: etapas do usuário com o estado do boletim de hoje e a lista de boletins emitidos.

create function public.listar_relatorios()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
  v_etapas jsonb;
  v_boletins jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  v_admin := privado.eh_admin();

  -- registros_hoje: mesmo critério de privado.boletim_snapshot para o dia "hoje" (data no fuso da etapa):
  -- registro.capturado_em em [hoje 00:00, hoje+1 00:00) no fuso da etapa, só de obras da etapa que não
  -- estavam arquivadas (arquivada_em nula ou >= início do dia).
  select coalesce(jsonb_agg(x.j order by x.ordem, x.nome), '[]'::jsonb)
    into v_etapas
    from (
      select e.ordem, e.nome,
             jsonb_build_object(
               'id', e.id,
               'slug', e.slug,
               'nome', e.nome,
               'sigla', e.sigla,
               'horario', to_char(e.boletim_horario, 'HH24:MI'),
               'hoje', h.dia,
               'registros_hoje', (
                 select count(*)::int
                   from public.registro r
                   join public.obra o on o.id = r.obra_id
                  where o.etapa_id = e.id
                    and (o.arquivada_em is null or o.arquivada_em >= h.dia::timestamp at time zone e.fuso)
                    and r.capturado_em >= h.dia::timestamp at time zone e.fuso
                    and r.capturado_em < (h.dia + 1)::timestamp at time zone e.fuso),
               'boletim_hoje', (
                 select jsonb_build_object('id', b.id, 'numero', b.numero, 'revisao', b.revisao,
                                           'emitido_em', b.emitido_em)
                   from public.boletim b
                  where b.etapa_id = e.id and b.data = h.dia
                  order by b.revisao desc
                  limit 1),
               'pedido_hoje', (
                 select jsonb_build_object('estado', p.estado,
                                           'erro', case when v_admin then p.erro end)
                   from public.boletim_emissao p
                  where p.etapa_id = e.id and p.data = h.dia and p.estado <> 'emitido'
                  order by p.atualizado_em desc, p.id desc
                  limit 1)
             ) as j
        from public.etapa e
        cross join lateral (select (now() at time zone e.fuso)::date as dia) h
       where e.arquivada_em is null
         and (v_admin or privado.participa_da_etapa(e.id))
    ) x;

  select coalesce(jsonb_agg(y.j order by y.data desc, y.nome, y.revisao desc), '[]'::jsonb)
    into v_boletins
    from (
      select b.data, e.nome, b.revisao,
             jsonb_build_object(
               'id', b.id,
               'etapa_id', b.etapa_id,
               'etapa_slug', e.slug,
               'etapa_nome', e.nome,
               'data', b.data,
               'revisao', b.revisao,
               'numero', b.numero,
               'emitido_em', b.emitido_em,
               'pdf_path', b.pdf_path,
               'publicado', exists (select 1 from public.publicacao_telegram pt
                                     where pt.boletim_id = b.id and pt.estado = 'publicado'),
               'ultima_revisao', not exists (select 1 from public.boletim b2
                                              where b2.etapa_id = b.etapa_id and b2.data = b.data
                                                and b2.revisao > b.revisao)
             ) as j
        from public.boletim b
        join public.etapa e on e.id = b.etapa_id
       where v_admin or privado.participa_da_etapa(b.etapa_id)
       order by b.data desc, e.nome, b.revisao desc
       limit 200
    ) y;

  return jsonb_build_object('admin', v_admin, 'etapas', v_etapas, 'boletins', v_boletins);
end;
$$;

revoke execute on function public.listar_relatorios() from public, anon;
grant execute on function public.listar_relatorios() to authenticated;

comment on function public.listar_relatorios() is
  'Mini App, aba Relatórios: {admin, etapas (do usuário, com registros e boletim/pedido de hoje), boletins (até 200, mais recentes primeiro)}. O erro do pedido só vai para admin.';
