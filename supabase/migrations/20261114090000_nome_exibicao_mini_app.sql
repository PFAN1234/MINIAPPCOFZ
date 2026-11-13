-- Boletim, parte 2: o Mini App mostra o nome de exibição (`coalesce(nome_exibicao, nome)`).
-- Contrato: docs/contrato-boletim.md, parte 2, "Nome mostrado".
--
-- Recria, sem mudar assinatura nem formato, as RPCs do Mini App que devolvem nome de pessoa:
-- - `listar_participantes` (tela Gestão) e
-- - `listar_solicitacoes` (pedidos de acesso vistos pelo gestor).
-- As duas passam a devolver `privado.nome_pessoa` na coluna `nome` e a ordenar por ele.
-- As RPCs de observações já usam `privado.nome_pessoa` (migration 20261113150000_boletim_base);
-- as consultas por PostgREST pedem `usuario(nome, nome_exibicao)` e o app escolhe.
-- As RPCs do site de administração ficam como estão (mostram o nome do Telegram).

create or replace function public.listar_participantes(p_obra uuid)
returns table (usuario_id uuid, nome text, username text, papel text, desde timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if not privado.eh_gestor(p_obra) then
    raise exception 'Apenas gestores da obra podem ver os participantes' using errcode = '42501';
  end if;

  return query
  select p.usuario_id, privado.nome_pessoa(p.usuario_id), u.username, p.papel, p.criado_em
    from public.participacao p
    join public.usuario u on u.id = p.usuario_id
   where p.obra_id = p_obra
   order by (p.papel = 'gestor') desc, coalesce(u.nome_exibicao, u.nome), p.usuario_id;
end;
$$;

create or replace function public.listar_solicitacoes(p_obra uuid)
returns table (id uuid, usuario_id uuid, nome text, username text, criado_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if not privado.eh_gestor(p_obra) then
    raise exception 'Apenas gestores da obra podem ver os pedidos de acesso' using errcode = '42501';
  end if;

  return query
  select s.id, s.usuario_id, privado.nome_pessoa(s.usuario_id), u.username, s.criado_em
    from public.solicitacao_acesso s
    join public.usuario u on u.id = s.usuario_id
   where s.obra_id = p_obra and s.estado = 'pendente'
   order by s.criado_em, s.id;
end;
$$;

-- `create or replace` mantém os grants; repetidos aqui para deixar a migration autossuficiente.
revoke execute on function public.listar_participantes(uuid) from public, anon;
revoke execute on function public.listar_solicitacoes(uuid) from public, anon;
grant execute on function public.listar_participantes(uuid) to authenticated;
grant execute on function public.listar_solicitacoes(uuid) to authenticated;
