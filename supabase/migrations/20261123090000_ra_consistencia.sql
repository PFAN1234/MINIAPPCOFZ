-- Consistência da RA no banco, no boletim e no cadastro de modelos:
-- 1. `privado.boletim_fotos` inclui `origem` ('normal', 'ra_limpa', 'ra_modelo') para rotular
--    as duas fotos do par nos PDFs (boletim e relatório de pendências) e no editor.
-- 2. `admin_registrar_modelo` limpa `modelo.matriz` ao republicar uma disciplina (nova revisão
--    não herda correção da revisão anterior).
-- 3. `admin_definir_qr` exige ambiente ativo, consistente com `admin_listar_ra`.
-- 4. Constraints garantem mesmo comprimento entre `contorno` e `contorno_pagina`, além de
--    rejeitar NaN/Infinity em `y_piso`, `y_teto` e `distancia_m`.

create or replace function privado.boletim_fotos(p_registro uuid, p_encerramento uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
                              'path', f.storage_path,
                              'largura', f.largura,
                              'altura', f.altura,
                              'origem', f.origem
                            ) order by f.ordem, f.id), '[]'::jsonb)
    from public.foto f
   where (p_registro is not null and f.registro_id = p_registro)
      or (p_encerramento is not null and f.encerramento_id = p_encerramento);
$$;
revoke execute on function privado.boletim_fotos(uuid, uuid) from public, anon, authenticated;

create or replace function public.admin_registrar_modelo(p_slug text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_obra public.obra;
  v_sigla text;
  v_revisao text;
  v_hash text;
  v_caminho text;
  v_bytes bigint;
  v_ifc_bytes bigint;
  v_origem text;
  v_arquivo text;
  v_meta jsonb;
  v_achou boolean;
  v_tamanho text;
  v_modelo public.modelo;
begin
  perform privado.exigir_admin();
  v_obra := privado.obra_do_slug(p_slug);
  -- Serializa publicações e edições da mesma obra.
  perform 1 from public.obra o where o.id = v_obra.id for update;

  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados do modelo inválidos' using errcode = '22023';
  end if;

  v_sigla := p ->> 'sigla';
  if jsonb_typeof(p -> 'sigla') is distinct from 'string' or v_sigla !~ '^[A-Z]{2,4}$' then
    raise exception 'Sigla da disciplina inválida: use de 2 a 4 letras maiúsculas (ex.: ARQ)' using errcode = '22023';
  end if;

  if p ? 'revisao' and jsonb_typeof(p -> 'revisao') <> 'null' then
    v_revisao := p ->> 'revisao';
    if jsonb_typeof(p -> 'revisao') <> 'string' or v_revisao !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$' then
      raise exception 'Revisão inválida: use letras, dígitos, ponto, hífen ou sublinhado (ex.: R07)' using errcode = '22023';
    end if;
  end if;

  v_hash := p ->> 'hash';
  if jsonb_typeof(p -> 'hash') is distinct from 'string' or v_hash !~ '^[0-9a-f]{16}$' then
    raise exception 'Hash do modelo inválido: são 16 caracteres hexadecimais minúsculos' using errcode = '22023';
  end if;

  v_bytes := privado.bytes_jsonb(p -> 'bytes', 'bytes');
  v_ifc_bytes := privado.bytes_jsonb(p -> 'ifc_bytes', 'ifc_bytes', true);

  v_origem := p ->> 'origem';
  if jsonb_typeof(p -> 'origem') is distinct from 'string' or v_origem not in ('ifc', 'frag') then
    raise exception 'Origem inválida: use ifc ou frag' using errcode = '22023';
  end if;

  if p ? 'arquivo_nome' and jsonb_typeof(p -> 'arquivo_nome') <> 'null' then
    if jsonb_typeof(p -> 'arquivo_nome') <> 'string' or char_length(p ->> 'arquivo_nome') > 200 then
      raise exception 'O nome do arquivo precisa ser texto de até 200 caracteres' using errcode = '22023';
    end if;
    v_arquivo := nullif(btrim(p ->> 'arquivo_nome'), '');
  end if;

  v_caminho := v_obra.id::text || '/' || v_sigla || '/' || v_hash || '.frag';
  if (p ->> 'caminho') is distinct from v_caminho then
    raise exception 'Caminho do modelo inválido (esperado %)', v_caminho using errcode = '22023';
  end if;

  select true, o.metadata into v_achou, v_meta
    from storage.objects o where o.bucket_id = 'modelos' and o.name = v_caminho;
  if v_achou is null then
    raise exception 'Modelo não encontrado no Storage (modelos/%): envie o arquivo antes de registrar', v_caminho
      using errcode = 'P0002';
  end if;
  v_tamanho := v_meta ->> 'size';
  if v_tamanho is null or v_tamanho !~ '^\d{1,18}$' then
    raise exception 'O Storage ainda não informou o tamanho de modelos/%: aguarde o fim do envio e tente de novo', v_caminho
      using errcode = '22023';
  end if;
  if v_tamanho::bigint <> v_bytes then
    raise exception 'O arquivo no Storage tem % bytes, e não %: envie o arquivo de novo', v_tamanho, v_bytes
      using errcode = '22023';
  end if;

  insert into public.modelo (obra_id, sigla, revisao, caminho, bytes, hash)
  values (v_obra.id, v_sigla, v_revisao, v_caminho, v_bytes, v_hash)
  on conflict (obra_id, sigla) do update
    set revisao = excluded.revisao, caminho = excluded.caminho, bytes = excluded.bytes,
        hash = excluded.hash, matriz = null, atualizado_em = now()
  returning * into v_modelo;

  insert into public.publicacao_modelo (obra_id, acao, sigla, revisao, caminho, bytes, hash, origem,
                                        arquivo_nome, ifc_bytes, publicado_por)
  values (v_obra.id, 'publicado', v_sigla, v_revisao, v_caminho, v_bytes, v_hash, v_origem,
          v_arquivo, v_ifc_bytes, auth.uid());

  return jsonb_build_object(
    'sigla', v_modelo.sigla, 'revisao', v_modelo.revisao, 'caminho', v_modelo.caminho,
    'bytes', v_modelo.bytes, 'hash', v_modelo.hash, 'atualizado_em', v_modelo.atualizado_em
  );
end;
$$;
revoke execute on function public.admin_registrar_modelo(text, jsonb) from public, anon;
grant execute on function public.admin_registrar_modelo(text, jsonb) to authenticated;

create or replace function public.admin_definir_qr(
  p_ambiente uuid,
  p_parede int,
  p_distancia_m double precision,
  p_altura_m double precision,
  p_lado_m double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ativo boolean;
  v_contorno jsonb;
  v_n int;
  v_a jsonb;
  v_b jsonb;
  v_compr double precision;
  v_qr public.ambiente_qr;
begin
  perform privado.exigir_admin();
  select a.ativo into v_ativo from public.ambiente a where a.id = p_ambiente;
  if not found then
    raise exception 'Ambiente não encontrado' using errcode = 'P0002';
  end if;
  if not v_ativo then
    raise exception 'Ambiente inativo' using errcode = '22023';
  end if;
  select g.contorno into v_contorno from public.ambiente_geometria g where g.ambiente_id = p_ambiente;
  if v_contorno is null then
    raise exception 'O ambiente não tem geometria' using errcode = '22023';
  end if;
  if p_parede is null or p_distancia_m is null or p_altura_m is null or p_lado_m is null then
    raise exception 'Parede, distância, altura e lado são obrigatórios' using errcode = '22023';
  end if;

  v_n := jsonb_array_length(v_contorno);
  if p_parede < 0 or p_parede >= v_n then
    raise exception 'Parede % fora do contorno (0 a %)', p_parede, v_n - 1 using errcode = '22023';
  end if;
  v_a := v_contorno -> p_parede;
  v_b := v_contorno -> ((p_parede + 1) % v_n);
  v_compr := sqrt(
    power((v_b ->> 0)::double precision - (v_a ->> 0)::double precision, 2)
    + power((v_b ->> 1)::double precision - (v_a ->> 1)::double precision, 2)
  );
  if not (p_distancia_m >= 0 and p_distancia_m <= v_compr) then
    raise exception 'A distância deve ficar entre 0 e % m (comprimento da parede)', round(v_compr::numeric, 3)
      using errcode = '22023';
  end if;
  if not (p_altura_m >= 0 and p_altura_m <= 5) then
    raise exception 'A altura do QR deve ficar entre 0 e 5 m' using errcode = '22023';
  end if;
  if not (p_lado_m >= 0.05 and p_lado_m <= 1) then
    raise exception 'O lado do QR deve ficar entre 0,05 e 1 m' using errcode = '22023';
  end if;

  insert into public.ambiente_qr (ambiente_id, parede, distancia_m, altura_m, lado_m, atualizado_em, atualizado_por)
  values (p_ambiente, p_parede, p_distancia_m, p_altura_m, p_lado_m, now(), auth.uid())
  on conflict (ambiente_id) do update
    set parede = excluded.parede, distancia_m = excluded.distancia_m, altura_m = excluded.altura_m,
        lado_m = excluded.lado_m, atualizado_em = excluded.atualizado_em,
        atualizado_por = excluded.atualizado_por
  returning * into v_qr;

  return jsonb_build_object(
    'ambiente_id', v_qr.ambiente_id, 'parede', v_qr.parede, 'distancia_m', v_qr.distancia_m,
    'altura_m', v_qr.altura_m, 'lado_m', v_qr.lado_m, 'atualizado_em', v_qr.atualizado_em
  );
end;
$$;
revoke execute on function public.admin_definir_qr(uuid, int, double precision, double precision, double precision)
  from public, anon;
grant execute on function public.admin_definir_qr(uuid, int, double precision, double precision, double precision)
  to authenticated;

alter table public.ambiente_geometria
  add constraint ambiente_geometria_contorno_pagina_comprimento check (
    contorno_pagina is null or jsonb_array_length(contorno_pagina) = jsonb_array_length(contorno)
  ),
  add constraint ambiente_geometria_alturas_finitas check (
    y_piso > '-infinity'::double precision and y_teto < 'infinity'::double precision
  );

alter table public.ambiente_qr
  add constraint ambiente_qr_distancia_finita check (
    distancia_m < 'infinity'::double precision
  );
