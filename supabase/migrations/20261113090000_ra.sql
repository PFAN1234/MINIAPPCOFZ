-- Realidade aumentada (RA): geometria dos ambientes, posição do QR e fotos com origem RA.
-- Contrato: docs/contrato-ra.md; plano: tasks/plano-ra.md.
--
-- - `ra_referencial`: coordenadas do .frag de referência (ARQ) da obra.
-- - `ambiente_geometria`: contorno e cotas do IfcSpace de cada ambiente, no referencial do ARQ.frag.
-- - `ambiente_qr`: onde o QR do ambiente está fixado na parede.
-- - `modelo.matriz`, `foto.origem`, `foto.ra`.
-- - `concluir_registro` passa a aceitar `origem` e `ra` por foto.
-- - RPCs `admin_listar_ra`, `admin_definir_qr` e `admin_remover_qr`.
-- Leitura: participantes da obra e admins. Escrita: só RPC de admin ou service_role (seed).

-- Tabelas ----------------------------------------------------------------------------------------

create table public.ra_referencial (
  obra_id uuid primary key references public.obra (id) on delete cascade,
  sigla text not null default 'ARQ',
  revisao text,
  coordenadas jsonb not null,           -- 9 números de getCoordinates() do .frag de referência
  atualizado_em timestamptz not null default now(),
  constraint ra_referencial_coordenadas check (
    jsonb_typeof(coordenadas) = 'array' and jsonb_array_length(coordenadas) = 9
  )
);

create table public.ambiente_geometria (
  ambiente_id uuid primary key references public.ambiente (id) on delete cascade,
  guid text,                            -- GlobalId do IfcSpace
  contorno jsonb not null,              -- [[x, z], ...] em metros, sem repetir o primeiro ponto, 3+ pontos
  y_piso double precision not null,     -- piso acabado
  y_teto double precision not null,     -- forro
  origem text not null default 'ifcspace',
  atualizado_em timestamptz not null default now(),
  constraint ambiente_geometria_contorno check (
    jsonb_typeof(contorno) = 'array' and jsonb_array_length(contorno) >= 3
  ),
  constraint ambiente_geometria_alturas check (y_teto > y_piso)
);

create table public.ambiente_qr (
  ambiente_id uuid primary key references public.ambiente (id) on delete cascade,
  parede int not null,                  -- aresta i do contorno: de contorno[i] a contorno[(i+1) % n]
  distancia_m double precision not null,-- de contorno[i] até o centro do QR, ao longo da parede
  altura_m double precision not null default 1.5,  -- centro do QR acima do piso acabado
  lado_m double precision not null default 0.18,   -- lado do quadrado do QR (sem a margem branca)
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.usuario (id) on delete set null,
  constraint ambiente_qr_parede check (parede >= 0),
  constraint ambiente_qr_distancia check (distancia_m >= 0),
  constraint ambiente_qr_altura check (altura_m between 0 and 5),
  constraint ambiente_qr_lado check (lado_m between 0.05 and 1)
);

alter table public.modelo
  add column matriz jsonb,              -- 16 números, ordem de THREE.Matrix4.elements; null = identidade
  add constraint modelo_matriz check (
    matriz is null or (jsonb_typeof(matriz) = 'array' and jsonb_array_length(matriz) = 16)
  );

alter table public.foto
  add column origem text not null default 'normal',
  add column ra jsonb,
  add constraint foto_origem check (origem in ('normal', 'ra_limpa', 'ra_modelo')),
  add constraint foto_ra_so_com_origem_ra check (origem <> 'normal' or ra is null);

comment on column public.modelo.matriz is
  'Correção opcional do modelo no referencial do ARQ.frag: 16 números (THREE.Matrix4.elements); null = identidade.';
comment on column public.foto.origem is
  'normal (câmera comum), ra_limpa (RA sem o modelo) ou ra_modelo (RA com o modelo sobreposto).';
comment on column public.foto.ra is
  'Metadados da captura em RA (par, modelos, alinhamento, pose, erro_cm); null quando origem = normal.';

-- RLS e grants -----------------------------------------------------------------------------------

alter table public.ra_referencial enable row level security;
alter table public.ambiente_geometria enable row level security;
alter table public.ambiente_qr enable row level security;

revoke all on public.ra_referencial, public.ambiente_geometria, public.ambiente_qr
  from public, anon, authenticated;
grant select on public.ra_referencial, public.ambiente_geometria, public.ambiente_qr to authenticated;

-- O seed/publicador (chave secreta) grava as três tabelas e localiza o ambiente pelo código.
grant select on public.ambiente to service_role;
grant select, insert, update, delete
  on public.ra_referencial, public.ambiente_geometria, public.ambiente_qr to service_role;

create policy ra_referencial_select on public.ra_referencial
  for select to authenticated
  using (privado.eh_participante(obra_id) or privado.eh_admin());

create policy ambiente_geometria_select on public.ambiente_geometria
  for select to authenticated
  using (
    privado.eh_admin()
    or exists (
      select 1 from public.ambiente a
       where a.id = ambiente_geometria.ambiente_id and privado.eh_participante(a.obra_id)
    )
  );

create policy ambiente_qr_select on public.ambiente_qr
  for select to authenticated
  using (
    privado.eh_admin()
    or exists (
      select 1 from public.ambiente a
       where a.id = ambiente_qr.ambiente_id and privado.eh_participante(a.obra_id)
    )
  );

-- concluir_registro: fotos com origem e ra -----------------------------------------------------
-- Mesma assinatura (os grants ficam). Cada item de p_fotos aceita, além dos campos de sempre,
-- `origem` ('normal' | 'ra_limpa' | 'ra_modelo'; ausente = 'normal') e `ra` (objeto; ausente ou
-- null = null; só com origem 'ra_*'). `encerrar_pendencia` não muda: as colunas têm default.

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
  v_item jsonb;
  v_origem text;
  v_ra jsonb;
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

  -- `normalizar_fotos` (dentro de exigir_objetos_fotos) já garantiu que p_fotos é uma lista de objetos.
  for v_item in select * from jsonb_array_elements(p_fotos) loop
    if v_item -> 'origem' is not null and jsonb_typeof(v_item -> 'origem') <> 'null' then
      if jsonb_typeof(v_item -> 'origem') <> 'string'
         or (v_item ->> 'origem') not in ('normal', 'ra_limpa', 'ra_modelo') then
        raise exception 'Origem da foto inválida' using errcode = '22023';
      end if;
    end if;
    if v_item -> 'ra' is not null and jsonb_typeof(v_item -> 'ra') <> 'null' then
      if jsonb_typeof(v_item -> 'ra') <> 'object' then
        raise exception 'Os dados de RA da foto são inválidos' using errcode = '22023';
      end if;
      if coalesce(v_item ->> 'origem', 'normal') = 'normal' then
        raise exception 'Foto com dados de RA precisa ter origem ra_limpa ou ra_modelo'
          using errcode = '22023';
      end if;
    end if;
  end loop;

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

  insert into public.foto (id, obra_id, registro_id, storage_path, largura, altura, bytes, ordem, origem, ra)
  select f.id, v_obra, p_id, format('%s/%s/%s.jpg', v_obra, p_id, f.id),
         f.largura, f.altura, f.bytes, f.ordem,
         coalesce(nullif(e.item ->> 'origem', ''), 'normal'),
         case when jsonb_typeof(e.item -> 'ra') = 'object' then e.item -> 'ra' end
  from privado.normalizar_fotos(p_fotos) f
  join lateral (
    select x.item
      from jsonb_array_elements(p_fotos) with ordinality as x(item, pos)
     where x.pos - 1 = f.ordem
  ) e on true;

  insert into public.publicacao_telegram (obra_id, registro_id, estado)
  values (v_obra, p_id, 'pendente');

  return v_reg;
end;
$$;

-- RPCs de admin ----------------------------------------------------------------------------------

-- Ambientes ativos da obra com geometria, por pavimento e ambiente, com o QR (ou null).
create function public.admin_listar_ra(p_obra uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform privado.exigir_admin();
  if not exists (select 1 from public.obra o where o.id = p_obra) then
    raise exception 'Obra não encontrada' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'ambiente_id', a.id, 'codigo', a.codigo, 'nome', a.nome_operacional,
             'pavimento', pv.nome, 'contorno', g.contorno, 'y_piso', g.y_piso, 'y_teto', g.y_teto,
             'qr', case when q.ambiente_id is null then null else jsonb_build_object(
                     'parede', q.parede, 'distancia_m', q.distancia_m,
                     'altura_m', q.altura_m, 'lado_m', q.lado_m) end
           ) order by pv.ordem, pv.codigo, a.ordem, a.codigo)
      from public.ambiente a
      join public.pavimento pv on pv.id = a.pavimento_id
      join public.ambiente_geometria g on g.ambiente_id = a.id
      left join public.ambiente_qr q on q.ambiente_id = a.id
     where a.obra_id = p_obra and a.ativo
  ), '[]'::jsonb);
end;
$$;

-- Define (ou atualiza) o QR de um ambiente. Valida a parede e a distância pelo contorno.
create function public.admin_definir_qr(
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
  v_contorno jsonb;
  v_n int;
  v_a jsonb;
  v_b jsonb;
  v_compr double precision;
  v_qr public.ambiente_qr;
begin
  perform privado.exigir_admin();
  if p_ambiente is null or not exists (select 1 from public.ambiente a where a.id = p_ambiente) then
    raise exception 'Ambiente não encontrado' using errcode = 'P0002';
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
  if p_distancia_m < 0 or p_distancia_m > v_compr then
    raise exception 'A distância deve ficar entre 0 e % m (comprimento da parede)', round(v_compr::numeric, 3)
      using errcode = '22023';
  end if;
  if p_altura_m < 0 or p_altura_m > 5 then
    raise exception 'A altura do QR deve ficar entre 0 e 5 m' using errcode = '22023';
  end if;
  if p_lado_m < 0.05 or p_lado_m > 1 then
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

-- Remove o QR do ambiente (idempotente). Devolve se havia algo a remover.
create function public.admin_remover_qr(p_ambiente uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  perform privado.exigir_admin();
  delete from public.ambiente_qr q where q.ambiente_id = p_ambiente;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke execute on function public.admin_listar_ra(uuid) from public, anon;
revoke execute on function public.admin_definir_qr(uuid, int, double precision, double precision, double precision)
  from public, anon;
revoke execute on function public.admin_remover_qr(uuid) from public, anon;
grant execute on function public.admin_listar_ra(uuid) to authenticated;
grant execute on function public.admin_definir_qr(uuid, int, double precision, double precision, double precision)
  to authenticated;
grant execute on function public.admin_remover_qr(uuid) to authenticated;
