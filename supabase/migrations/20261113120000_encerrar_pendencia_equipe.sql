-- Encerrar pendência passa a valer para qualquer participante da obra (equipe ou gestor), e não
-- só para gestores (pedido do usuário em 2026-11-13). A coluna `encerramento.gestor_id` mantém o
-- nome e guarda quem encerrou. Obra ou etapa arquivada continua bloqueando (`eh_participante`).

create or replace function public.encerrar_pendencia(
  p_id uuid,
  p_registro_id uuid,
  p_observacao text,
  p_fotos jsonb
)
returns public.encerramento
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_obra uuid;
  v_reg public.registro;
  v_enc public.encerramento;
  v_obs text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if p_id is null or p_registro_id is null then
    raise exception 'Identificadores obrigatórios' using errcode = '22023';
  end if;

  -- Autoriza antes de travar a linha, para não permitir bloqueio por quem não participa da obra.
  select r.obra_id into v_obra from public.registro r where r.id = p_registro_id;
  if v_obra is null then
    raise exception 'Registro não encontrado' using errcode = 'P0002';
  end if;
  if not privado.eh_participante(v_obra) then
    raise exception 'Apenas participantes da obra podem encerrar pendências' using errcode = '42501';
  end if;

  select * into v_reg from public.registro r where r.id = p_registro_id for update;
  if v_reg.tipo <> 'pendencia' then
    raise exception 'Só pendências podem ser encerradas' using errcode = '22023';
  end if;

  -- Idempotência (depois do bloqueio, para enxergar o resultado de quem chegou antes).
  select * into v_enc from public.encerramento e where e.id = p_id;
  if found then
    if v_enc.registro_id = p_registro_id and v_enc.gestor_id = v_uid then
      return v_enc;
    end if;
    raise exception 'encerramento_id em uso' using errcode = '23505';
  end if;
  if v_reg.situacao = 'resolvida' then
    raise exception 'pendência já encerrada' using errcode = '23505';
  end if;

  v_obs := nullif(regexp_replace(p_observacao, '^\s+|\s+$', '', 'g'), '');
  if v_obs is not null and char_length(v_obs) > 1000 then
    raise exception 'A observação deve ter até 1000 caracteres' using errcode = '22023';
  end if;

  perform privado.exigir_objetos_fotos(v_obra, p_registro_id, p_fotos);

  insert into public.encerramento (id, registro_id, obra_id, gestor_id, observacao)
  values (p_id, p_registro_id, v_obra, v_uid, v_obs)
  returning * into v_enc;

  insert into public.foto (id, obra_id, encerramento_id, storage_path, largura, altura, bytes, ordem)
  select f.id, v_obra, p_id, format('%s/%s/%s.jpg', v_obra, p_registro_id, f.id),
         f.largura, f.altura, f.bytes, f.ordem
  from privado.normalizar_fotos(p_fotos) f;

  update public.registro set situacao = 'resolvida' where id = p_registro_id;

  insert into public.publicacao_telegram (obra_id, encerramento_id, estado)
  values (v_obra, p_id, 'pendente');

  return v_enc;
end;
$$;

revoke execute on function public.encerrar_pendencia(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.encerrar_pendencia(uuid, uuid, text, jsonb) to authenticated;
