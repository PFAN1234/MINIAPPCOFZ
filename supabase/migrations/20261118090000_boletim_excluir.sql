-- Exclusão de um boletim publicado pelo site de administração.
-- `admin_excluir_boletim` apaga o DIA INTEIRO do boletim pedido (todas as revisões da etapa e
-- data, e todos os pedidos de emissão do dia, em qualquer estado). Publicações e rascunhos saem
-- em cascata. Antes de apagar, devolve o que a Edge Function admin-excluir-obra precisa para
-- limpar o que está fora do banco: as mensagens do Telegram e os arquivos do bucket `boletins`.
-- O agendador automático pode reemitir o dia depois (desejado). Há emissão ou envio em
-- andamento → 55006, sem apagar nada.

create function public.admin_excluir_boletim(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.boletim;
  v_chat bigint;
  v_revisoes int;
  v_mensagens bigint[];
  v_arquivos text[];
begin
  perform privado.exigir_admin();
  select * into v_b from public.boletim b where b.id = p_id;
  if not found then
    raise exception 'Boletim não encontrado' using errcode = 'P0002';
  end if;
  -- Serializa com os pedidos da etapa.
  select e.telegram_chat_id into v_chat from public.etapa e where e.id = v_b.etapa_id for update;

  if exists (select 1 from public.boletim_emissao q
              where q.etapa_id = v_b.etapa_id and q.data = v_b.data and q.estado = 'gerando')
     or exists (select 1 from public.publicacao_telegram p
                  join public.boletim x on x.id = p.boletim_id
                 where x.etapa_id = v_b.etapa_id and x.data = v_b.data and p.estado = 'enviando') then
    raise exception 'Há uma emissão ou um envio em andamento para este dia. Tente de novo em alguns minutos.'
      using errcode = '55006';
  end if;

  select count(*) into v_revisoes
    from public.boletim x where x.etapa_id = v_b.etapa_id and x.data = v_b.data;

  select coalesce(array_agg(m order by m), '{}') into v_mensagens
    from public.publicacao_telegram p
    join public.boletim x on x.id = p.boletim_id,
    lateral unnest(p.message_ids) m
   where x.etapa_id = v_b.etapa_id and x.data = v_b.data and m is not null;

  select coalesce(array_agg(a order by a), '{}') into v_arquivos
    from public.boletim x,
    lateral unnest(array[x.pdf_path, regexp_replace(x.pdf_path, '\.pdf$', '') || '-clima.png']) a
   where x.etapa_id = v_b.etapa_id and x.data = v_b.data and x.pdf_path is not null;

  delete from public.boletim_emissao q where q.etapa_id = v_b.etapa_id and q.data = v_b.data;
  delete from public.boletim x where x.etapa_id = v_b.etapa_id and x.data = v_b.data;

  return jsonb_build_object(
    'numero', v_b.numero,
    'data', v_b.data,
    'etapa_id', v_b.etapa_id,
    'revisoes', v_revisoes,
    'chat_id', v_chat,
    'mensagens', to_jsonb(v_mensagens),
    'arquivos', to_jsonb(v_arquivos)
  );
end;
$$;

revoke execute on function public.admin_excluir_boletim(uuid) from public, anon;
grant execute on function public.admin_excluir_boletim(uuid) to authenticated;
