-- Corrige corrida em concluir_registro: duas chamadas simultâneas com o mesmo id
-- falhavam com 23505 em registro_id_obra_unico em vez de devolver o registro.
-- O create or replace mantém os grants da função.

create or replace function public.concluir_registro(
  p_id uuid,
  p_ambiente_id uuid,
  p_tipo text,
  p_legenda text,
  p_capturado_em timestamptz,
  p_fotos jsonb
)
returns public.registro
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_obra uuid;
  v_legenda text;
  v_reg public.registro;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '28000';
  end if;
  if p_id is null or p_ambiente_id is null then
    raise exception 'Identificadores obrigatórios' using errcode = '22023';
  end if;

  select a.obra_id into v_obra from public.ambiente a where a.id = p_ambiente_id;
  if v_obra is null then
    raise exception 'Ambiente não encontrado' using errcode = 'P0002';
  end if;
  if not privado.eh_participante(v_obra) then
    raise exception 'Sem permissão nesta obra' using errcode = '42501';
  end if;

  -- Idempotência: mesma chamada repetida devolve o registro existente.
  select * into v_reg from public.registro r where r.id = p_id;
  if found then
    if v_reg.autor_id = v_uid and v_reg.ambiente_id = p_ambiente_id then
      return v_reg;
    end if;
    raise exception 'registro_id em uso' using errcode = '23505';
  end if;

  if p_tipo is null or p_tipo not in ('servico', 'pendencia') then
    raise exception 'Tipo de registro inválido' using errcode = '22023';
  end if;
  -- btrim só remove espaços; aparar também tabulações e quebras de linha.
  v_legenda := regexp_replace(p_legenda, '^\s+|\s+$', '', 'g');
  if v_legenda is null or char_length(v_legenda) not between 1 and 1000 then
    raise exception 'A legenda deve ter de 1 a 1000 caracteres' using errcode = '22023';
  end if;
  if p_capturado_em is null or p_capturado_em > now() + interval '5 minutes' then
    raise exception 'Data de captura inválida' using errcode = '22023';
  end if;

  perform privado.exigir_objetos_fotos(v_obra, p_id, p_fotos);

  insert into public.registro (id, obra_id, ambiente_id, tipo, legenda, autor_id, capturado_em, situacao)
  values (
    p_id, v_obra, p_ambiente_id, p_tipo, v_legenda, v_uid, p_capturado_em,
    case when p_tipo = 'pendencia' then 'aberta' end
  )
  -- Sem alvo: cobre a pk e a única (id, obra_id); com alvo só na pk, uma chamada
  -- simultânea com o mesmo id ainda falhava na segunda restrição.
  on conflict do nothing
  returning * into v_reg;

  if not found then
    -- Outra chamada simultânea inseriu primeiro (e já confirmou): reavalia.
    select * into v_reg from public.registro r where r.id = p_id;
    if found and v_reg.autor_id = v_uid and v_reg.ambiente_id = p_ambiente_id then
      return v_reg;
    end if;
    raise exception 'registro_id em uso' using errcode = '23505';
  end if;

  insert into public.foto (id, obra_id, registro_id, storage_path, largura, altura, bytes, ordem)
  select f.id, v_obra, p_id, format('%s/%s/%s.jpg', v_obra, p_id, f.id),
         f.largura, f.altura, f.bytes, f.ordem
  from privado.normalizar_fotos(p_fotos) f;

  insert into public.publicacao_telegram (obra_id, registro_id, estado)
  values (v_obra, p_id, 'pendente');

  return v_reg;
end;
$$;
