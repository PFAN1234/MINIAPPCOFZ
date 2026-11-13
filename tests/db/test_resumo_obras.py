"""Testes de `resumo_obras()` e `autores_registros()` (20261117090000_resumo_obras_autores.sql)."""
import uuid

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')

from test_boletim_emissao import sql, su  # noqa: E402


def registro(c, obra, amb, autor, tipo='servico', situacao=None):
    su(c, 'insert into public.registro (id, obra_id, ambiente_id, tipo, legenda, autor_id, capturado_em, situacao) '
          "values (%s, %s, %s, %s, 'x', %s, now(), %s)", (uuid.uuid4(), obra, amb, tipo, autor, situacao))


def resumo(c, usuario):
    linhas = sql(c, 'select obra_id, papel, servicos, abertas, resolvidas from public.resumo_obras()', usuario=usuario)
    return {r[0]: r[1:] for r in linhas}


def test_resumo_conta_por_obra_e_traz_papel(cenario):
    c = cenario
    registro(c, c.obra_a, c.amb_a, c.equipe_a)
    registro(c, c.obra_a, c.amb_a2, c.gestor_a)
    registro(c, c.obra_a, c.amb_a, c.equipe_a, 'pendencia', 'aberta')
    registro(c, c.obra_a, c.amb_a, c.equipe_a, 'pendencia', 'resolvida')
    registro(c, c.obra_a, c.amb_a, c.equipe_a, 'pendencia', 'resolvida')
    registro(c, c.obra_b, c.amb_b, c.gestor_b, 'pendencia', 'aberta')

    assert resumo(c, c.gestor_a) == {c.obra_a: ('gestor', 2, 1, 2)}
    assert resumo(c, c.equipe_a) == {c.obra_a: ('equipe', 2, 1, 2)}
    assert resumo(c, c.gestor_b) == {c.obra_b: ('gestor', 0, 1, 0)}


def test_resumo_obra_sem_registros_vem_zerada(cenario):
    assert resumo(cenario, cenario.gestor_a) == {cenario.obra_a: ('gestor', 0, 0, 0)}


def test_resumo_sem_obra_vem_vazio(cenario):
    assert resumo(cenario, cenario.sem_obra) == {}


def test_resumo_anon_nao_executa(cenario):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        sql(cenario, 'select * from public.resumo_obras()', papel='anon')


def test_autores_so_das_obras_visiveis(cenario):
    c = cenario
    su(c, "update public.usuario set nome_exibicao = 'SD FULANO' where id = %s", (c.equipe_a,))
    registro(c, c.obra_a, c.amb_a, c.equipe_a)
    registro(c, c.obra_a, c.amb_a, c.equipe_a, 'pendencia', 'aberta')
    registro(c, c.obra_b, c.amb_b, c.gestor_b)

    autores = sql(c, 'select id, nome_exibicao from public.autores_registros()', usuario=c.gestor_a)
    assert autores == [(c.equipe_a, 'SD FULANO')]
    ids_b = [r[0] for r in sql(c, 'select id from public.autores_registros()', usuario=c.gestor_b)]
    assert ids_b == [c.gestor_b]
    assert sql(c, 'select id from public.autores_registros()', usuario=c.sem_obra) == []


def test_autores_anon_nao_executa(cenario):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        sql(cenario, 'select * from public.autores_registros()', papel='anon')


