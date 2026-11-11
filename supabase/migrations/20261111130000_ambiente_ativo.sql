-- Revisões de planta: ambiente ativo/inativo.
-- Contrato: docs/contrato-fase3.md (seção F).
--
-- O código do ambiente não muda depois do primeiro registro, e o ambiente não
-- pode ser apagado (`registro` e `planta_detalhe` o referenciam). Quando uma nova
-- revisão da planta deixa de ter um ambiente, o seed (scripts/gerar_seed.py) o
-- marca com `ativo = false`: o app o tira da lista, da busca e da planta, mas
-- continua abrindo a tela dele (histórico e links antigos). A RPC
-- `concluir_registro` não verifica `ativo`, de propósito: um registro feito em
-- campo antes da troca, ainda na fila offline, não pode ser perdido.
--
-- Sem índice novo: as consultas do app filtram por `obra_id`, já coberto pelo
-- índice de `ambiente_codigo_unico (obra_id, codigo)`, e quase todas as linhas
-- ficam ativas. O `grant select` da tabela já cobre a coluna nova.

alter table public.ambiente add column ativo boolean not null default true;

comment on column public.ambiente.ativo is
  'false quando o ambiente não existe na planta vigente; registros mantidos como histórico';
