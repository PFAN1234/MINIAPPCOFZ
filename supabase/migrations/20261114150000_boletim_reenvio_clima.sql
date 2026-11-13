-- Boletim de Acompanhamento Diário: reenvio ao Telegram e clima de um boletim anterior do dia.
-- Contrato: docs/contrato-boletim.md ("Reenvio ao Telegram e clima de boletim anterior").
--
-- - `admin_reenviar_boletim`: o site recoloca na fila o envio de um boletim cuja publicação falhou
--   (ou ficou incerta) e acorda a publish-outbox.
-- - `admin_listar_boletins`: passa a trazer `publicacao_erro` e `publicacao_tentativas`.
-- - `boletim_clima_anterior`: só para o gerador; devolve o clima (com imagem) do boletim de maior
--   revisão já emitido na data, para uma retificação reaproveitar o mesmo clima.

-- Reenvio ----------------------------------------------------------------------------------------

-- Falhou ou incerto → volta a pendente (tentativas zeradas) e aciona a publish-outbox. Pendente ou
-- enviando → 23505; publicado → 22023; boletim de outra etapa → P0002; etapa sem grupo → 22023.
-- Sem linha em publicacao_telegram, cria a pendente. Retorno: {boletim_id, publicacao_estado}.
create function public.admin_reenviar_boletim(p_slug text, p_boletim uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
  v_pub public.publicacao_telegram;
begin
  perform privado.exigir_admin();
  v_etapa := privado.etapa_do_slug(p_slug);
  if not exists (select 1 from public.boletim b where b.id = p_boletim and b.etapa_id = v_etapa.id) then
    raise exception 'Boletim não encontrado' using errcode = 'P0002';
  end if;
  if v_etapa.telegram_chat_id is null then
    raise exception 'A etapa não tem grupo do Telegram vinculado' using errcode = '22023';
  end if;

  select * into v_pub from public.publicacao_telegram pt where pt.boletim_id = p_boletim for update;
  if not found then
    insert into public.publicacao_telegram (boletim_id, estado) values (p_boletim, 'pendente');
  elsif v_pub.estado in ('falhou', 'incerto') then
    update public.publicacao_telegram
       set estado = 'pendente', tentativas = 0, proxima_tentativa_em = now(), erro = null, atualizado_em = now()
     where id = v_pub.id;
    perform privado.disparar_publicacao();
  elsif v_pub.estado = 'publicado' then
    raise exception 'Este boletim já foi publicado no grupo' using errcode = '22023';
  else
    raise exception 'O envio deste boletim já está em andamento' using errcode = '23505';
  end if;
  return jsonb_build_object('boletim_id', p_boletim, 'publicacao_estado', 'pendente');
end;
$$;
revoke execute on function public.admin_reenviar_boletim(text, uuid) from public, anon;
grant execute on function public.admin_reenviar_boletim(text, uuid) to authenticated;

-- Lista de boletins ------------------------------------------------------------------------------

-- Igual à anterior, com `publicacao_erro` e `publicacao_tentativas` em cada boletim.
create or replace function public.admin_listar_boletins(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_etapa public.etapa;
begin
  perform privado.exigir_admin();
  v_etapa := privado.etapa_do_slug(p_slug);
  return jsonb_build_object(
    'boletins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'data', b.data, 'revisao', b.revisao, 'numero', b.numero, 'emitido_em', b.emitido_em,
               'emitido_por_nome', privado.nome_pessoa(b.emitido_por), 'pdf_path', b.pdf_path,
               'publicado', coalesce(pt.estado = 'publicado', false),
               'publicacao_estado', pt.estado,
               'publicacao_erro', pt.erro,
               'publicacao_tentativas', coalesce(pt.tentativas, 0)
             ) order by b.data desc, b.revisao desc)
        from public.boletim b
        left join public.publicacao_telegram pt on pt.boletim_id = b.id
       where b.etapa_id = v_etapa.id
    ), '[]'::jsonb),
    'pedidos', coalesce((
      select jsonb_agg(privado.pedido_emissao_json(q) order by q.data desc, q.revisao desc, q.id desc)
        from public.boletim_emissao q
       where q.etapa_id = v_etapa.id and q.estado <> 'emitido'
    ), '[]'::jsonb)
  );
end;
$$;

-- Clima do boletim anterior ----------------------------------------------------------------------

-- {numero, revisao, clima}: o boletim de maior revisão da etapa na data cujo clima tem imagem
-- (`snapshot->'clima'->>'imagem_path'`); null se não houver. Só o gerador (service_role).
create function public.boletim_clima_anterior(p_etapa uuid, p_data date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('numero', b.numero, 'revisao', b.revisao, 'clima', b.snapshot->'clima')
    from public.boletim b
   where b.etapa_id = p_etapa and b.data = p_data and b.snapshot->'clima'->>'imagem_path' is not null
   order by b.revisao desc
   limit 1;
$$;
revoke execute on function public.boletim_clima_anterior(uuid, date) from public, anon, authenticated;
grant execute on function public.boletim_clima_anterior(uuid, date) to service_role;
