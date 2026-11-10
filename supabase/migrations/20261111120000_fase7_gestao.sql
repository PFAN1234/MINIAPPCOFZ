-- Fase 7: gestão de participantes e acompanhamento das publicações com problema.
-- Contrato: docs/contrato-fase7.md, seção A.
-- Todas as RPCs são security definer, só para authenticated e só para gestores da obra.

create function public.listar_participantes(p_obra uuid)
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
  select p.usuario_id, u.nome, u.username, p.papel, p.criado_em
    from public.participacao p
    join public.usuario u on u.id = p.usuario_id
   where p.obra_id = p_obra
   order by (p.papel = 'gestor') desc, u.nome, p.usuario_id;
end;
$$;

create function public.definir_papel(p_obra uuid, p_usuario uuid, p_papel text)
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
  if not privado.eh_gestor(p_obra) then
    raise exception 'Apenas gestores da obra podem alterar papéis' using errcode = '42501';
  end if;
  if p_papel is null or p_papel not in ('equipe', 'gestor') then
    raise exception 'Papel inválido. Use equipe ou gestor.' using errcode = '22023';
  end if;

  -- Trava os gestores da obra para que dois rebaixamentos simultâneos não deixem a obra sem gestor.
  perform 1 from public.participacao p
   where p.obra_id = p_obra and p.papel = 'gestor'
   for update;

  select p.papel into v_atual from public.participacao p
   where p.obra_id = p_obra and p.usuario_id = p_usuario;
  if not found then
    raise exception 'Participante não encontrado nesta obra.' using errcode = 'P0002';
  end if;

  if v_atual = 'gestor' and p_papel = 'equipe' and (
    select count(*) from public.participacao p where p.obra_id = p_obra and p.papel = 'gestor'
  ) <= 1 then
    raise exception 'A obra precisa de pelo menos um gestor.' using errcode = '22023';
  end if;

  update public.participacao p set papel = p_papel
   where p.obra_id = p_obra and p.usuario_id = p_usuario;
end;
$$;

create function public.remover_participante(p_obra uuid, p_usuario uuid)
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
  if not privado.eh_gestor(p_obra) then
    raise exception 'Apenas gestores da obra podem remover participantes' using errcode = '42501';
  end if;

  perform 1 from public.participacao p
   where p.obra_id = p_obra and p.papel = 'gestor'
   for update;

  select p.papel into v_atual from public.participacao p
   where p.obra_id = p_obra and p.usuario_id = p_usuario;
  if not found then
    raise exception 'Participante não encontrado nesta obra.' using errcode = 'P0002';
  end if;

  if v_atual = 'gestor' and (
    select count(*) from public.participacao p where p.obra_id = p_obra and p.papel = 'gestor'
  ) <= 1 then
    raise exception 'A obra precisa de pelo menos um gestor.' using errcode = '22023';
  end if;

  delete from public.participacao p where p.obra_id = p_obra and p.usuario_id = p_usuario;
  -- Sem a conferência do grupo, a pessoa precisa pedir acesso de novo.
  -- (Um admin do grupo volta a ser gestor no próximo login: fase 6, sincronizar_acesso.)
  delete from privado.membro_grupo m where m.obra_id = p_obra and m.usuario_id = p_usuario;
end;
$$;

create function public.listar_publicacoes_problema(p_obra uuid)
returns table (
  id bigint, estado text, erro text, tentativas int, atualizado_em timestamptz,
  registro_id uuid, encerramento_id uuid, tipo text, legenda text, ambiente text
)
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
    raise exception 'Apenas gestores da obra podem ver as publicações com problema' using errcode = '42501';
  end if;

  return query
  select p.id, p.estado, p.erro, p.tentativas, p.atualizado_em,
         r.id,
         p.encerramento_id,
         case when p.encerramento_id is not null then 'encerramento' else r.tipo end,
         case when p.encerramento_id is not null
              then coalesce(nullif(btrim(e.observacao), ''), 'Pendência resolvida')
              else r.legenda end,
         a.nome_operacional
    from public.publicacao_telegram p
    left join public.encerramento e on e.id = p.encerramento_id
    left join public.registro r on r.id = coalesce(p.registro_id, e.registro_id)
    left join public.ambiente a on a.id = r.ambiente_id
   where p.obra_id = p_obra
     and (p.estado in ('incerto', 'falhou') or (p.estado = 'pendente' and p.tentativas >= 3))
   order by p.atualizado_em desc, p.id desc;
end;
$$;

create function public.republicar(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pub public.publicacao_telegram;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;

  select * into v_pub from public.publicacao_telegram p where p.id = p_id for update;
  if not found then
    raise exception 'Publicação não encontrada' using errcode = 'P0002';
  end if;
  if not privado.eh_gestor(v_pub.obra_id) then
    raise exception 'Apenas gestores da obra podem republicar' using errcode = '42501';
  end if;
  if v_pub.estado not in ('incerto', 'falhou') then
    raise exception 'Só é possível republicar publicações incertas ou que falharam.' using errcode = '22023';
  end if;

  update public.publicacao_telegram p
     set estado = 'pendente', tentativas = 0, proxima_tentativa_em = now(),
         erro = null, atualizado_em = now()
   where p.id = p_id;

  -- O gatilho de disparo só roda em insert; aciona a publicação agora.
  perform privado.disparar_publicacao();
end;
$$;

create function public.marcar_publicada(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pub public.publicacao_telegram;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;

  select * into v_pub from public.publicacao_telegram p where p.id = p_id for update;
  if not found then
    raise exception 'Publicação não encontrada' using errcode = 'P0002';
  end if;
  if not privado.eh_gestor(v_pub.obra_id) then
    raise exception 'Apenas gestores da obra podem marcar como publicada' using errcode = '42501';
  end if;
  if v_pub.estado not in ('incerto', 'falhou') then
    raise exception 'Só é possível marcar como publicadas as publicações incertas ou que falharam.'
      using errcode = '22023';
  end if;

  update public.publicacao_telegram p
     set estado = 'publicado', erro = 'Marcada como publicada pelo gestor.', atualizado_em = now()
   where p.id = p_id;
end;
$$;

revoke execute on function public.listar_participantes(uuid) from public, anon;
revoke execute on function public.definir_papel(uuid, uuid, text) from public, anon;
revoke execute on function public.remover_participante(uuid, uuid) from public, anon;
revoke execute on function public.listar_publicacoes_problema(uuid) from public, anon;
revoke execute on function public.republicar(bigint) from public, anon;
revoke execute on function public.marcar_publicada(bigint) from public, anon;
grant execute on function public.listar_participantes(uuid) to authenticated;
grant execute on function public.definir_papel(uuid, uuid, text) to authenticated;
grant execute on function public.remover_participante(uuid, uuid) to authenticated;
grant execute on function public.listar_publicacoes_problema(uuid) to authenticated;
grant execute on function public.republicar(bigint) to authenticated;
grant execute on function public.marcar_publicada(bigint) to authenticated;
