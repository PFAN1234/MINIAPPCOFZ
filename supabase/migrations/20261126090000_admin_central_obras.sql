-- Central de modelos (admin › Modelos), etapa 1: lista de obras com os totais de cada uma.
-- `documentos` e `issues_abertas` valem 0 por enquanto: serão redefinidos nas etapas 6 e 7
-- com `create or replace`, sem mudar a assinatura.

create function public.admin_central_obras()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'obra_id', o.id,
             'slug', o.slug,
             'nome', o.nome,
             -- siglas com modelo publicado vigente (tabela `modelo`)
             'disciplinas', (select count(*) from public.modelo m where m.obra_id = o.id),
             'documentos', 0,
             'issues_abertas', 0,
             'atualizado_em', (select max(pm.publicado_em) from public.publicacao_modelo pm where pm.obra_id = o.id)
           ) order by o.nome)
      from public.obra o
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.admin_central_obras() from public, anon;
grant execute on function public.admin_central_obras() to authenticated;
