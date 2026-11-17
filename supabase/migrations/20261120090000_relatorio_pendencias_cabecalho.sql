-- Relatório de pendências com o mesmo cabeçalho do boletim diário: linhas da OM
-- (organizacao.cabecalho), obra/serviço (etapa.objeto), local e responsáveis.
-- Só acrescenta campos ao retorno de public.relatorio_pendencias; o resto não muda.

create or replace function public.relatorio_pendencias(p_etapa uuid, p_obra uuid default null)
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
    'organizacao', jsonb_build_object('nome', v_org.nome, 'logo_path', v_org.logo_path,
                                      'cabecalho', to_jsonb(coalesce(v_org.cabecalho, '{}'::text[]))),
    'etapa', jsonb_build_object('id', v_etapa.id, 'slug', v_etapa.slug, 'nome', v_etapa.nome,
                                'sigla', v_etapa.sigla, 'objeto', v_etapa.objeto,
                                'local', v_etapa.local, 'endereco', v_etapa.endereco),
    'responsaveis', privado.etapa_responsaveis(v_etapa.id),
    'obra', case when p_obra is null then null
                 else jsonb_build_object('id', v_obra.id, 'slug', v_obra.slug, 'nome', v_obra.nome) end,
    'pendencias', v_lista);
end;
$$;
