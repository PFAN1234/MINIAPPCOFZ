-- Controle de acesso: admins do portal também controlam a lista; "nenhum" recusa pedidos pendentes.
-- Contrato: docs/contrato-controle-acesso.md (A).

create function privado.pode_controlar_acesso()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.eh_gestor_alguma() or privado.eh_admin();
$$;
revoke execute on function privado.pode_controlar_acesso() from public, anon;
grant execute on function privado.pode_controlar_acesso() to authenticated;

create or replace function public.matriz_acessos()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_obras jsonb;
  v_pessoas jsonb;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if not privado.pode_controlar_acesso() then
    raise exception 'Só gestores veem a lista de acessos.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'slug', o.slug, 'nome', o.nome)
                            order by o.ordem, o.nome, o.id), '[]'::jsonb)
    into v_obras
    from public.obra o
   where privado.obra_ativa(o.id);

  with ativas as (
    select o.id from public.obra o where privado.obra_ativa(o.id)
  ), pessoas as (
    select m.usuario_id from privado.membro_grupo m join ativas a on a.id = m.obra_id
    union
    select p.usuario_id from public.participacao p join ativas a on a.id = p.obra_id
  ), linhas as (
    select u.id,
           coalesce(u.nome_exibicao, u.nome) as nome,
           u.username,
           coalesce((select bool_or(m.admin) from privado.membro_grupo m
                      join ativas a on a.id = m.obra_id where m.usuario_id = u.id), false) as admin,
           (select max(m.conferido_em) from privado.membro_grupo m
             join ativas a on a.id = m.obra_id where m.usuario_id = u.id) as visto_em,
           coalesce((select jsonb_object_agg(p.obra_id::text, p.papel)
                      from public.participacao p join ativas a on a.id = p.obra_id
                     where p.usuario_id = u.id), '{}'::jsonb) as acessos,
           coalesce((select jsonb_agg(s.obra_id order by s.obra_id)
                      from public.solicitacao_acesso s join ativas a on a.id = s.obra_id
                     where s.usuario_id = u.id and s.estado = 'pendente'), '[]'::jsonb) as pedidos
      from public.usuario u
     where u.id in (select usuario_id from pessoas)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'nome', l.nome, 'username', l.username, 'admin', l.admin,
           'visto_em', l.visto_em, 'acessos', l.acessos, 'pedidos', l.pedidos)
         order by (jsonb_array_length(l.pedidos) > 0) desc, l.nome, l.id), '[]'::jsonb)
    into v_pessoas
    from linhas l;

  return jsonb_build_object('obras', v_obras, 'pessoas', v_pessoas);
end;
$$;

create or replace function public.definir_acesso(p_obra uuid, p_usuario uuid, p_papel text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atual text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if not privado.pode_controlar_acesso() then
    raise exception 'Só gestores alteram acessos.' using errcode = '42501';
  end if;
  if p_papel is null or p_papel not in ('nenhum', 'equipe', 'gestor') then
    raise exception 'Acesso inválido.' using errcode = '22023';
  end if;
  if p_obra is null or p_usuario is null or not privado.obra_ativa(p_obra) then
    raise exception 'Obra não encontrada.' using errcode = 'P0002';
  end if;

  if p_papel <> 'gestor' and exists (
    select 1 from privado.membro_grupo m
     where m.obra_id = p_obra and m.usuario_id = p_usuario and m.admin
  ) then
    raise exception 'Administradores do grupo são gestores de todas as obras.' using errcode = '22023';
  end if;

  -- Trava os gestores da obra para que dois rebaixamentos simultâneos não deixem a obra sem gestor.
  perform 1 from public.participacao p
   where p.obra_id = p_obra and p.papel = 'gestor'
   for update;

  select p.papel into v_atual from public.participacao p
   where p.obra_id = p_obra and p.usuario_id = p_usuario;

  if v_atual = 'gestor' and p_papel <> 'gestor' and (
    select count(*) from public.participacao p where p.obra_id = p_obra and p.papel = 'gestor'
  ) <= 1 then
    raise exception 'A obra precisa de pelo menos um gestor.' using errcode = '22023';
  end if;

  if p_papel = 'nenhum' then
    -- Mantém membro_grupo: a pessoa continua na lista.
    delete from public.participacao p where p.obra_id = p_obra and p.usuario_id = p_usuario;
    update public.solicitacao_acesso s
       set estado = 'recusada', decidido_por = auth.uid(), decidido_em = now()
     where s.obra_id = p_obra and s.usuario_id = p_usuario and s.estado = 'pendente';
    return;
  end if;

  insert into public.participacao (obra_id, usuario_id, papel)
  values (p_obra, p_usuario, p_papel)
  on conflict (obra_id, usuario_id) do update set papel = excluded.papel;

  update public.solicitacao_acesso s
     set estado = 'aprovada', decidido_por = auth.uid(), decidido_em = now()
   where s.obra_id = p_obra and s.usuario_id = p_usuario and s.estado = 'pendente';
end;
$$;

revoke execute on function public.matriz_acessos() from public, anon;
revoke execute on function public.definir_acesso(uuid, uuid, text) from public, anon;
grant execute on function public.matriz_acessos() to authenticated;
grant execute on function public.definir_acesso(uuid, uuid, text) to authenticated;
