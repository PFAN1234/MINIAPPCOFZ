-- RA admin: admin_listar_ra passa a devolver, por ambiente, o contorno na página do PDF
-- (contorno_pagina) e a planta ativa do pavimento (imagem, página, recorte e tamanho), para o
-- admin desenhar a planta baixa. Sem planta ativa, 'planta' é null.

create or replace function public.admin_listar_ra(p_obra uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  if not exists (select 1 from public.obra o where o.id = p_obra) then
    raise exception 'Obra não encontrada' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'ambiente_id', a.id, 'codigo', a.codigo, 'nome', a.nome_operacional,
             'pavimento', pv.nome, 'contorno', g.contorno, 'y_piso', g.y_piso, 'y_teto', g.y_teto,
             'contorno_pagina', g.contorno_pagina,
             'planta', case when p.id is null then null else jsonb_build_object(
                     'imagem_path', coalesce(p.imagem_hd_path, p.imagem_path),
                     'pagina_pt', jsonb_build_array(p.pagina_largura_pt, p.pagina_altura_pt),
                     'recorte_pt', to_jsonb(p.recorte_pt),
                     'largura', case when p.imagem_hd_path is not null
                                     then p.imagem_hd_largura else p.imagem_largura end,
                     'altura', case when p.imagem_hd_path is not null
                                    then p.imagem_hd_altura else p.imagem_altura end) end,
             'qr', case when q.ambiente_id is null then null else jsonb_build_object(
                     'parede', q.parede, 'distancia_m', q.distancia_m,
                     'altura_m', q.altura_m, 'lado_m', q.lado_m) end
           ) order by pv.ordem, pv.codigo, a.ordem, a.codigo)
      from public.ambiente a
      join public.pavimento pv on pv.id = a.pavimento_id
      join public.ambiente_geometria g on g.ambiente_id = a.id
      left join public.ambiente_qr q on q.ambiente_id = a.id
      left join public.planta p on p.pavimento_id = pv.id and p.ativa
     where a.obra_id = p_obra and a.ativo
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_listar_ra(uuid) from public, anon;
grant execute on function public.admin_listar_ra(uuid) to authenticated;
