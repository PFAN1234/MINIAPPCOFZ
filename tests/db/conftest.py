"""Fixtures dos testes de banco.

Usa `DATABASE_URL` (um servidor PostgreSQL já em execução, caso do CI) ou sobe um
cluster efêmero com os binários locais do PostgreSQL. Sem nenhum dos dois, pula os testes.
Cada sessão de testes cria um banco novo, aplica o stub do Supabase e as migrations em ordem.
"""
import glob
import os
import shutil
import socket
import subprocess
import tempfile
import uuid
from contextlib import contextmanager
from pathlib import Path

import pytest

try:
    import psycopg
    from psycopg import sql
    from psycopg.conninfo import conninfo_to_dict, make_conninfo
except ImportError:  # os testes são pulados em servidor_dsn
    psycopg = None

RAIZ = Path(__file__).resolve().parents[2]
STUB = Path(__file__).with_name('stub_supabase.sql')
MIGRATIONS = sorted((RAIZ / 'supabase' / 'migrations').glob('*.sql'))


def _achar_bin_postgres():
    """Diretório com initdb/pg_ctl, ou None."""
    if shutil.which('initdb') and shutil.which('pg_ctl'):
        return Path(shutil.which('initdb')).parent
    candidatos = sorted(glob.glob('/usr/lib/postgresql/*/bin/initdb'), reverse=True)
    return Path(candidatos[0]).parent if candidatos else None


def _porta_livre():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


@pytest.fixture(scope='session')
def servidor_dsn():
    """DSN de um servidor PostgreSQL (banco `postgres`), com superusuário."""
    if psycopg is None:
        pytest.skip('psycopg não instalado (pip install "psycopg[binary]")')
    if os.environ.get('DATABASE_URL'):
        yield os.environ['DATABASE_URL']
        return

    bindir = _achar_bin_postgres()
    if bindir is None:
        pytest.skip('Sem DATABASE_URL e sem binários do PostgreSQL (initdb/pg_ctl) para um cluster efêmero')

    raiz_tmp = Path(tempfile.mkdtemp(prefix='pgtest-'))
    os.chmod(raiz_tmp, 0o755)
    eh_root = os.geteuid() == 0
    prefixo = []
    if eh_root:
        # initdb/postgres recusam rodar como root.
        if not shutil.which('runuser'):
            shutil.rmtree(raiz_tmp, ignore_errors=True)
            pytest.skip('Rodando como root sem `runuser` para trocar de usuário')
        prefixo = ['runuser', '-u', 'postgres', '--']
        shutil.chown(raiz_tmp, user='postgres')
    dados = raiz_tmp / 'dados'
    porta = _porta_livre()

    def rodar(*args, **kw):
        return subprocess.run([*prefixo, *map(str, args)], check=True, capture_output=True, text=True, **kw)

    try:
        rodar(bindir / 'initdb', '-D', dados, '-U', 'postgres', '--auth=trust', '-E', 'UTF8')
        rodar(
            bindir / 'pg_ctl', '-D', dados, '-w', '-l', raiz_tmp / 'pg.log',
            '-o', f'-p {porta} -k {raiz_tmp} -c listen_addresses=127.0.0.1 -c fsync=off',
            'start',
        )
    except subprocess.CalledProcessError as e:
        shutil.rmtree(raiz_tmp, ignore_errors=True)
        pytest.skip(f'Não foi possível subir o PostgreSQL efêmero: {e.stderr or e}')
    try:
        yield f'postgresql://postgres@127.0.0.1:{porta}/postgres'
    finally:
        subprocess.run([*prefixo, str(bindir / 'pg_ctl'), '-D', str(dados), '-m', 'immediate', 'stop'],
                       capture_output=True)
        shutil.rmtree(raiz_tmp, ignore_errors=True)


@pytest.fixture(scope='session')
def dsn(servidor_dsn):
    """DSN de um banco novo com stub + migrations aplicados."""
    nome = 'teste_' + uuid.uuid4().hex[:10]
    with psycopg.connect(servidor_dsn, autocommit=True) as c:
        c.execute(sql.SQL('create database {}').format(sql.Identifier(nome)))
    base = conninfo_to_dict(servidor_dsn)
    base['dbname'] = nome
    dsn_banco = make_conninfo(**base)
    with psycopg.connect(dsn_banco, autocommit=True) as c:
        c.execute(STUB.read_text())
        assert MIGRATIONS, 'nenhuma migration encontrada em supabase/migrations'
        for m in MIGRATIONS:
            try:
                c.execute(m.read_text())
            except psycopg.Error as e:
                raise AssertionError(f'Falha na migration {m.name}: {e}') from e
    yield dsn_banco
    with psycopg.connect(servidor_dsn, autocommit=True) as c:
        c.execute(sql.SQL('drop database if exists {} with (force)').format(sql.Identifier(nome)))


@contextmanager
def sessao(dsn, usuario=None, papel='authenticated'):
    """Transação executada "como" um usuário do Supabase.

    `usuario=None` e `papel=None`: superusuário (preparação de dados).
    `papel='anon'`: sem usuário. Confirma ao sair sem erro; desfaz se houver exceção.
    """
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            if papel:
                cur.execute(sql.SQL('set local role {}').format(sql.Identifier(papel)))
            if usuario:
                cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(usuario),))
            yield cur


class Cenario:
    """Duas obras (A e B) com usuários e ambientes. Ids novos a cada teste."""

    def __init__(self, dsn):
        self.dsn = dsn
        u = uuid.uuid4
        self.obra_a, self.obra_b = u(), u()
        self.gestor_a, self.equipe_a, self.gestor_b, self.sem_obra = u(), u(), u(), u()
        self.amb_a, self.amb_a2, self.amb_b = u(), u(), u()
        sufixo = uuid.uuid4().hex[:8]
        with sessao(dsn, papel=None) as cur:
            for obra, nome in ((self.obra_a, 'a'), (self.obra_b, 'b')):
                cur.execute('insert into public.obra (id, slug, nome) values (%s, %s, %s)',
                            (obra, f'{nome}-{sufixo}', f'Obra {nome}'))
            for i, uid in enumerate((self.gestor_a, self.equipe_a, self.gestor_b, self.sem_obra)):
                cur.execute('insert into auth.users (id, email) values (%s, %s)', (uid, f'{uid}@teste.invalid'))
                cur.execute('insert into public.usuario (id, telegram_id, nome) values (%s, %s, %s)',
                            (uid, uuid.uuid4().int % 10**15, f'Usuário {i}'))
            for obra, uid, papel in ((self.obra_a, self.gestor_a, 'gestor'), (self.obra_a, self.equipe_a, 'equipe'),
                                     (self.obra_b, self.gestor_b, 'gestor')):
                cur.execute('insert into public.participacao (obra_id, usuario_id, papel) values (%s, %s, %s)',
                            (obra, uid, papel))
            for obra in (self.obra_a, self.obra_b):
                pav = uuid.uuid4()
                cur.execute('insert into public.pavimento (id, obra_id, codigo, nome) values (%s, %s, %s, %s)',
                            (pav, obra, 'terreo', 'Térreo'))
                ambs = {self.obra_a: (self.amb_a, self.amb_a2), self.obra_b: (self.amb_b,)}[obra]
                for i, amb in enumerate(ambs):
                    cur.execute(
                        'insert into public.ambiente (id, obra_id, pavimento_id, codigo, nome_operacional) '
                        'values (%s, %s, %s, %s, %s)', (amb, obra, pav, f'amb{i}', f'Ambiente {i}'))

    def foto(self, obra, registro, subir=True, **extra):
        """Cria uma foto (id novo) e, por padrão, o objeto correspondente no Storage."""
        fid = uuid.uuid4()
        if subir:
            with sessao(self.dsn, papel=None) as cur:
                cur.execute('insert into storage.objects (bucket_id, name, owner_id) values (%s, %s, %s)',
                            ('fotos', f'{obra}/{registro}/{fid}.jpg', str(self.gestor_a)))
        return {'id': str(fid), 'largura': 800, 'altura': 600, 'bytes': 12345, **extra}


@pytest.fixture
def cenario(dsn):
    return Cenario(dsn)
