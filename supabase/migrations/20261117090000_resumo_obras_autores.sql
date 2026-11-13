-- Início e Registros do Mini App (docs/contrato-inicio-registros.md).
--
-- `resumo_obras()`: por obra visível ao usuário, o papel dele e as contagens das barrinhas do
--   início (serviços, pendências abertas e pendências resolvidas, totais da obra).
-- `autores_registros()`: quem tem registro nas obras visíveis, para o filtro "Pessoa" de Registros.
--
-- Ambas são `security invoker`: a RLS de `obra`, `registro`, `participacao` e `usuario` decide o
-- que entra, como nas consultas diretas do app.

create function public.resumo_obras()
returns table (obra_id uuid, papel text, servicos bigint, abertas bigint, resolvidas bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id,
         (select p.papel from public.participacao p
           where p.obra_id = o.id and p.usuario_id = (select auth.uid())),
         count(r.id) filter (where r.tipo = 'servico'),
         count(r.id) filter (where r.tipo = 'pendencia' and r.situacao = 'aberta'),
         count(r.id) filter (where r.tipo = 'pendencia' and r.situacao = 'resolvida')
    from public.obra o
    left join public.registro r on r.obra_id = o.id
   group by o.id
$$;

revoke execute on function public.resumo_obras() from public, anon;
grant execute on function public.resumo_obras() to authenticated;

create function public.autores_registros()
returns table (id uuid, nome text, nome_exibicao text)
language sql
stable
security invoker
set search_path = ''
as $$
  select u.id, u.nome, u.nome_exibicao
    from public.usuario u
   where exists (select 1 from public.registro r where r.autor_id = u.id)
   order by coalesce(u.nome_exibicao, u.nome)
$$;

revoke execute on function public.autores_registros() from public, anon;
grant execute on function public.autores_registros() to authenticated;
