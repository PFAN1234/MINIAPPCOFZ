"""Testes da varredura de órfãos nos buckets (privado.varrer_orfaos_storage e admin_resumo_orfaos).

Contrato: docs/contrato-erros-orfaos.md (B). O banco é compartilhado na sessão: cada teste usa
caminhos próprios (prefixo uuid) e confere só os próprios.
"""
import uuid
from types import SimpleNamespace

import pytest

psycopg = pytest.importorskip('psycopg', reason='psycopg não instalado')
from psycopg import errors  # noqa: E402

from conftest import sessao  # noqa: E402


@pytest.fixture
def c(dsn):
    return SimpleNamespace(dsn=dsn)


def sql(c, comando, params=(), papel='authenticated', usuario=None):
    with sessao(c.dsn, usuario, papel=papel) as cur:
        cur.execute(comando, params)
        return cur.fetchall() if cur.description else None


def su(c, comando, params=()):
    return sql(c, comando, params, papel=None)


def novo_usuario(c, admin=False):
    uid = uuid.uuid4()
    su(c, 'insert into auth.users (id, email) values (%s, %s)', (uid, f'{uid}@teste.invalid'))
    su(c, 'insert into public.usuario (id, telegram_id, nome) values (%s, %s, %s)',
       (uid, uuid.uuid4().int % 10**15, 'Fulano ' + uid.hex[:6]))
    if admin:
        su(c, 'insert into public.admin_app (usuario_id) values (%s)', (uid,))
    return uid


def objeto(c, bucket, nome, antigo=True, tamanho=None):
    idade = "now() - interval '8 days'" if antigo else 'now()'
    meta = '{"size": %d}' % tamanho if tamanho is not None else None
    su(c, f'insert into storage.objects (bucket_id, name, created_at, metadata) '
          f'values (%s, %s, {idade}, %s::jsonb)', (bucket, nome, meta))


def varrer(c):
    su(c, 'select privado.varrer_orfaos_storage()')


def orfaos(c, prefixo):
    return {(b, n) for b, n in su(c, 'select bucket, caminho from public.orfao_storage '
                                     'where caminho like %s', (prefixo + '%',))}


def obra_etapa(c):
    sufixo = uuid.uuid4().hex[:8]
    etapa, obra = uuid.uuid4(), uuid.uuid4()
    su(c, 'insert into public.etapa (id, slug, nome) values (%s, %s, %s)', (etapa, f'et-{sufixo}', 'Etapa'))
    su(c, 'insert into public.obra (id, slug, nome, etapa_id) values (%s, %s, %s, %s)',
       (obra, f'ob-{sufixo}', 'Obra', etapa))
    return etapa, obra


def pavimento(c, obra):
    pav = uuid.uuid4()
    su(c, "insert into public.pavimento (id, obra_id, codigo, nome) values (%s, %s, 'terreo', 'T')", (pav, obra))
    return pav


def test_orfao_antigo_entra_e_recente_nao(c):
    p = uuid.uuid4().hex
    objeto(c, 'fotos', f'{p}/velho.jpg', tamanho=500)
    objeto(c, 'fotos', f'{p}/novo.jpg', antigo=False)
    varrer(c)
    assert orfaos(c, p) == {('fotos', f'{p}/velho.jpg')}
    assert su(c, 'select tamanho from public.orfao_storage where caminho = %s', (f'{p}/velho.jpg',))[0][0] == 500


def test_referenciados_nao_entram(c):
    etapa, obra = obra_etapa(c)
    o = str(obra)
    pav = pavimento(c, obra)
    plantas = (f'{o}/R01/terreo/planta.webp', f'{o}/R01/terreo/planta-hd.webp')
    su(c, 'insert into public.planta (obra_id, pavimento_id, revisao, pagina_largura_pt, pagina_altura_pt, '
          "recorte_pt, imagem_path, imagem_largura, imagem_altura, imagem_hd_path) values "
          "(%s, %s, 'R01', 100, 80, '{0,0,100,80}', %s, 10, 10, %s)", (obra, pav, plantas[0], plantas[1]))
    su(c, "insert into public.publicacao_planta (obra_id, pavimento_id, revisao, pdf_path, pdf_sha256) "
          "values (%s, %s, 'R01', %s, %s)", (obra, pav, f'{o}/R01/terreo/x.pdf', 'a' * 64))
    su(c, "insert into public.modelo (obra_id, sigla, caminho, bytes, hash) values (%s, 'ARQ', %s, 1, 'h')",
       (obra, f'{o}/ARQ/h.frag'))
    for b, n in (('plantas', plantas[0]), ('plantas', plantas[1]), ('plantas', f'{o}/R01/terreo/solto.webp'),
                 ('originais', f'{o}/R01/terreo/x.pdf'), ('modelos', f'{o}/ARQ/h.frag'),
                 ('relatorios', f'{o}/pendencias.pdf'), ('relatorios', f'{etapa}/p.pdf')):
        objeto(c, b, n)
    morto = f'{uuid.uuid4()}/morto.pdf'
    objeto(c, 'relatorios', morto)
    objeto(c, 'relatorios', f'{o}-solto.pdf')
    varrer(c)
    assert orfaos(c, o) == {('plantas', f'{o}/R01/terreo/solto.webp')}
    assert orfaos(c, str(etapa)) == set()
    assert orfaos(c, morto) == {('relatorios', morto)}


def test_ganhar_referencia_tira_da_lista_e_nada_e_apagado(c):
    etapa, obra = obra_etapa(c)
    nome = f'{obra}/ARQ/{uuid.uuid4().hex[:16]}.frag'
    objeto(c, 'modelos', nome)
    varrer(c)
    assert orfaos(c, str(obra)) == {('modelos', nome)}
    su(c, "insert into public.modelo (obra_id, sigla, caminho, bytes, hash) values (%s, 'ARQ', %s, 1, 'h')",
       (obra, nome))
    varrer(c)
    assert orfaos(c, str(obra)) == set()
    assert su(c, 'select count(*) from storage.objects where name = %s', (nome,))[0][0] == 1


def test_sumiu_do_bucket_sai_da_lista(c):
    p = uuid.uuid4().hex
    objeto(c, 'boletins', f'{p}/b.pdf')
    varrer(c)
    assert orfaos(c, p) == {('boletins', f'{p}/b.pdf')}
    su(c, 'delete from storage.objects where name = %s', (f'{p}/b.pdf',))
    varrer(c)
    assert orfaos(c, p) == set()


def test_resumo_so_admin_e_agrupa(c):
    p = uuid.uuid4().hex
    objeto(c, 'modelos', f'{p}/grande.frag', tamanho=10**9)
    objeto(c, 'modelos', f'{p}/pequeno.frag', tamanho=10)
    varrer(c)
    admin, comum = novo_usuario(c, admin=True), novo_usuario(c)
    r = sql(c, 'select public.admin_resumo_orfaos()', usuario=admin)[0][0]
    modelos = next(b for b in r['buckets'] if b['bucket'] == 'modelos')
    assert modelos['quantidade'] >= 2 and modelos['bytes'] >= 10**9 + 10
    assert r['maiores'][0]['tamanho'] >= 10**9 and len(r['maiores']) <= 100
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select public.admin_resumo_orfaos()', usuario=comum)
    assert sql(c, 'select count(*) from public.orfao_storage', usuario=comum)[0][0] == 0
    assert sql(c, 'select count(*) from public.orfao_storage', usuario=admin)[0][0] >= 2
    with pytest.raises(errors.InsufficientPrivilege):
        sql(c, 'select privado.varrer_orfaos_storage()', usuario=admin)


def test_cron_agendado(c):
    r = su(c, "select schedule, command from cron.job where jobname = 'varrer-orfaos-storage'")
    assert r == [('17 3 * * *', 'select privado.varrer_orfaos_storage()')]
