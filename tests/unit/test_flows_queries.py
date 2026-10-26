"""Detected DB queries: the SQL subset, the Spring Data derived-query grammar, which
call owns a query, the evidence each library needs, and SAVE vs UPSERT."""

import pytest

from queries import classify_sql, derived_query


def fn(rows, path, name, owner=None):
    return next(f for f in rows[path]["functions"] if f["name"] == name and f["owner"] == owner)


def queries(rows, path, name, owner=None):
    """[(call name, op, target, executes)] for the calls that carry a query."""
    return [(c["name"], c["query"]["op"], c["query"]["target"], c["query"]["executes"])
            for c in fn(rows, path, name, owner)["calls"] if "query" in c]


def query_on(rows, path, name, call, owner=None):
    return next(c["query"] for c in fn(rows, path, name, owner)["calls"]
                if c["name"] == call and "query" in c)


# --- SQL subset ------------------------------------------------------------------------

@pytest.mark.parametrize("sql,expected", [
    ("-- list\n/* all */ SELECT * FROM owners o WHERE o.id = 1", ("SELECT", "owners")),
    ('SELECT a FROM "public"."users"', ("SELECT", "public.users")),
    ("SELECT a FROM x JOIN y ON x.id = y.x", ("SELECT", None)),
    ("SELECT * FROM a, b", ("SELECT", None)),
    ("SELECT * FROM (SELECT 1) t", ("SELECT", None)),
    ("WITH a AS (SELECT 1) SELECT * FROM a", ("UNKNOWN", None)),
    ("INSERT INTO t (a) VALUES (1)", ("INSERT", "t")),
    ("INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = 2", ("UPSERT", "t")),
    ("INSERT INTO t VALUES (1) ON DUPLICATE KEY UPDATE a = 1", ("UPSERT", "t")),
    ("MERGE INTO t USING s ON (t.id = s.id)", ("UPSERT", "t")),
    ("REPLACE INTO t VALUES (1)", ("UPSERT", "t")),
    ("UPDATE users u SET name = 'x'", ("UPDATE", "users")),
    ("DELETE FROM sessions WHERE expired", ("DELETE", "sessions")),
    ("CREATE TABLE IF NOT EXISTS logs (id int)", ("OTHER", "logs")),
    ("CREATE INDEX i ON t (a)", ("OTHER", None)),
    ("SELECT 1; SELECT 2", ("UNKNOWN", None)),
    ("VACUUM", ("UNKNOWN", None)),
])
def test_sql_subset(sql, expected):
    assert classify_sql(sql) == expected


# --- Spring Data -------------------------------------------------------------------------

@pytest.mark.parametrize("method,params,text", [
    ("findByLastNameStartingWith", ["String", "Pageable"],
     "SELECT … FROM Owner WHERE lastName LIKE ?% (paged)"),
    ("findByAgeBetween", ["int", "int"], "SELECT … FROM Owner WHERE age BETWEEN ? AND ?"),
    ("findByNameIgnoreCase", ["String"], "SELECT … FROM Owner WHERE UPPER(name) = UPPER(?)"),
    ("findTop3ByAgeGreaterThanOrderByNameDesc", ["int"],
     "SELECT … FROM Owner WHERE age > ? ORDER BY name DESC LIMIT 3"),
    ("findByNameNot", ["String"], "SELECT … FROM Owner WHERE name <> ?"),
    ("findByEmailIsNull", [], "SELECT … FROM Owner WHERE email IS NULL"),
    ("findByEmailNotNull", [], "SELECT … FROM Owner WHERE email IS NOT NULL"),
    ("findByActiveTrue", [], "SELECT … FROM Owner WHERE active = true"),
    ("findByAgeLessThanEqual", ["int"], "SELECT … FROM Owner WHERE age <= ?"),
    ("findByStartBefore", ["Date"], "SELECT … FROM Owner WHERE start < ?"),
    ("findByNameLike", ["String"], "SELECT … FROM Owner WHERE name LIKE ?"),
    ("findByNameEndingWith", ["String"], "SELECT … FROM Owner WHERE name LIKE %?"),
    ("findByNameContaining", ["String"], "SELECT … FROM Owner WHERE name LIKE %?%"),
    ("findByNameNotContaining", ["String"], "SELECT … FROM Owner WHERE name NOT LIKE %?%"),
    ("findByIdIn", ["List"], "SELECT … FROM Owner WHERE id IN (?)"),
    ("findByIdNotIn", ["List"], "SELECT … FROM Owner WHERE id NOT IN (?)"),
    ("findByCityOrStateOrderByCityAsc", ["String", "String", "Sort"],
     "SELECT … FROM Owner WHERE city = ? OR state = ? ORDER BY city ASC (sorted)"),
    ("countByActiveTrue", [], "SELECT COUNT(*) FROM Owner WHERE active = true"),
    ("existsByEmail", ["String"], "SELECT EXISTS … FROM Owner WHERE email = ?"),
    ("deleteByIdIn", ["List"], "DELETE FROM Owner WHERE id IN (?)"),
])
def test_derived_query_grammar(method, params, text):
    assert derived_query(method, "Owner", params)["text"] == text


def test_derived_query_outside_the_grammar_is_not_guessed():
    q = derived_query("findByLocationNear", "Owner", ["Point"])
    assert q["predicate"] == "unknown" and q["text"] == "SELECT … FROM Owner WHERE ?"
    assert derived_query("findAll", "Owner", []) is None  # a built-in, not derived


SPRING = {
    "src/Owner.java": """package app;
import jakarta.persistence.Entity;
@Entity public class Owner { @Id Integer id; String lastName; }""",
    "src/OwnerRepository.java": """package app;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.domain.Pageable;
public interface OwnerRepository extends JpaRepository<Owner, Integer> {
  Page<Owner> findByLastNameStartingWith(String lastName, Pageable pageable);
  @Query("SELECT o FROM Owner o WHERE o.city = :city")
  List<Owner> findByCityCustom(String city);
  @Query(value = "INSERT INTO owners (id) VALUES (1) ON CONFLICT DO NOTHING", nativeQuery = true)
  void insertNative();
}""",
    "src/OwnerService.java": """package app;
import org.springframework.jdbc.core.JdbcTemplate;
public class OwnerService {
  private final OwnerRepository owners;
  private final JdbcTemplate jdbc;
  void run(Owner o, String sql) {
    owners.save(o);
    owners.findById(1);
    owners.deleteById(1);
    owners.findByLastNameStartingWith("a", null);
    jdbc.update("UPDATE owners SET a = 1");
    jdbc.query(sql, null);
  }
}""",
}


def test_spring_repository_definitions_and_builtins(flows):
    rows, _ = flows(SPRING)
    repo = rows["src/OwnerRepository.java"]["functions"]
    derived = next(f for f in repo if f["name"] == "findByLastNameStartingWith")["query"]
    assert derived["kind"] == "derived" and derived["op"] == "SELECT"
    assert derived["text"] == "SELECT … FROM Owner WHERE lastName LIKE ?% (paged)"
    assert derived["entity"] == {"path": "src/Owner.java", "name": "Owner"}
    custom = next(f for f in repo if f["name"] == "findByCityCustom")["query"]
    assert custom["text"] == "SELECT o FROM Owner o WHERE o.city = :city"  # @Query wins
    assert custom["target"] == "Owner" and custom["entity"]["name"] == "Owner"
    native = next(f for f in repo if f["name"] == "insertNative")["query"]
    assert native["op"] == "UPSERT" and native["target"] == "owners"
    got = queries(rows, "src/OwnerService.java", "run", "OwnerService")
    assert ("save", "SAVE", "Owner", "yes") in got
    assert ("findById", "SELECT", "Owner", "yes") in got
    assert ("deleteById", "DELETE", "Owner", "yes") in got
    # A derived method is a call to the repository method; its query is attached at the
    # call site (in the chart), so the call itself carries none.
    assert not any(n == "findByLastNameStartingWith" for n, *_ in got)
    assert ("update", "UPDATE", "owners", "yes") in got
    jdbc = query_on(rows, "src/OwnerService.java", "run", "query", "OwnerService")
    assert jdbc["op"] == "UNKNOWN" and jdbc["text"] == "{…}"  # non-literal: needs JdbcTemplate


# --- TypeORM -----------------------------------------------------------------------------

TYPEORM = {
    "src/user.entity.ts": """import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
@Entity('user')
export class UserEntity { @PrimaryGeneratedColumn() id: number; @Column() email: string; }""",
    "src/user.service.ts": """import { Repository, getRepository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './user.entity';
export class UserService {
  constructor(
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
  ) {}
  async one(id: number) { return await this.userRepository.findOne({ where: { id } }); }
  async keep(u: UserEntity) { return await this.userRepository.save(u); }
  async chain() {
    return await this.userRepository.createQueryBuilder('u').where('u.id = 1').getMany();
  }
  async stored() {
    const qb = this.userRepository.createQueryBuilder('u');
    qb.where('u.id = 1');
    return await qb.getMany();
  }
  async awaitedStored() {
    const qb = await getRepository(UserEntity).createQueryBuilder('u').where('1 = 1');
    const n = await qb.getCount();
    return await qb.getMany();
  }
  builder() {
    const qb = this.userRepository.createQueryBuilder('u');
    return qb;
  }
  async upsert() {
    await this.userRepository.createQueryBuilder().insert().into(UserEntity)
      .values({}).orUpdate(['email']).execute();
  }
}""",
}


def test_typeorm_ownership_and_ops(flows):
    rows, _ = flows(TYPEORM)
    path = "src/user.service.ts"
    one = query_on(rows, path, "one", "findOne", "UserService")
    assert one["op"] == "SELECT" and one["executes"] == "yes"
    assert one["entity"] == {"path": "src/user.entity.ts", "name": "UserEntity"}
    assert queries(rows, path, "keep", "UserService") == [("save", "SAVE", "UserEntity", "yes")]
    # One chain, one query, on the terminal call.
    assert queries(rows, path, "chain", "UserService") == [
        ("getMany", "SELECT", "UserEntity", "terminal")]
    # A builder stored once and run by a later call: the query moves to that call.
    assert queries(rows, path, "stored", "UserService") == [
        ("getMany", "SELECT", "UserEntity", "terminal")]
    # `const qb = await …` is still a stored builder; each run of it is a query.
    assert queries(rows, path, "awaitedStored", "UserService") == [
        ("getCount", "SELECT", "UserEntity", "terminal"),
        ("getMany", "SELECT", "UserEntity", "terminal")]
    count = query_on(rows, path, "awaitedStored", "getCount", "UserService")
    assert count["text"].endswith("→ qb.getCount()")  # which call ran the builder
    # Returned without running: stays on the builder, may not execute.
    assert queries(rows, path, "builder", "UserService") == [
        ("createQueryBuilder", "SELECT", "UserEntity", "unknown")]
    assert queries(rows, path, "upsert", "UserService") == [
        ("execute", "UPSERT", "UserEntity", "terminal")]


# --- Prisma and knex ---------------------------------------------------------------------

PRISMA = {
    "src/prisma/prisma-client.ts": """import { PrismaClient } from '@prisma/client';
const prisma = global.prisma || new PrismaClient();
export default prisma;""",
    "src/auth.service.ts": """import prisma from './prisma/prisma-client';
export const find = async (email: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  const lazy = prisma.user.count();
  await prisma.user.upsert({ where: { email }, create: {}, update: {} });
  return user;
};""",
    "src/other.ts": """const client = { user: { findUnique: () => null } };
export const f = async () => await client.user.findUnique({});""",
}


def test_prisma_through_the_exported_client(flows):
    rows, _ = flows(PRISMA)
    got = queries(rows, "src/auth.service.ts", "find")
    assert ("findUnique", "SELECT", "user", "terminal") in got
    assert ("count", "SELECT", "user", "unknown") in got  # not awaited: may not run
    assert ("upsert", "UPSERT", "user", "terminal") in got
    assert queries(rows, "src/other.ts", "f") == []  # not a Prisma client


def test_knex_lazy_until_awaited(flows):
    rows, _ = flows({"src/db.ts": """import knex from 'knex';
const db = knex({ client: 'pg' });
export async function f() { return await db('users').where({ id: 1 }).first(); }
export function g() { return db('users').insert({}); }
export async function h() { await db('t').insert({}).onConflict('id').merge(); }"""})
    assert queries(rows, "src/db.ts", "f") == [("first", "SELECT", "users", "terminal")]
    # Returned unrun: stays on the builder's first call, `db('users')`.
    assert queries(rows, "src/db.ts", "g") == [("db", "INSERT", "users", "unknown")]
    assert queries(rows, "src/db.ts", "h") == [("merge", "UPSERT", "t", "terminal")]


# --- raw SQL evidence ----------------------------------------------------------------------

def test_raw_sql_needs_a_driver_or_a_literal(flows):
    rows, _ = flows({
        "src/pool.ts": "import { Pool } from 'pg';\nexport const pool = new Pool();",
        "src/a.ts": """import { pool } from './pool';
export async function f(sql: string, obj: any) {
  await thing.query("SELECT * FROM t WHERE id = $1");
  await obj.query(sql);
  await pool.query(sql);
  await obj.query("not sql at all");
}"""})
    got = queries(rows, "src/a.ts", "f")
    assert ("query", "SELECT", "t", "yes") in got  # literal SQL is its own evidence
    assert ("query", "UNKNOWN", None, "yes") in got  # pool from pg: non-literal → {…}
    assert len(got) == 2  # obj.query(sql) and a non-SQL literal aren't queries


def test_python_cursor_from_django_connection(flows):
    rows, _ = flows({"app/views.py": """from django.db import connection
def f(sql):
    with connection.cursor() as cursor:
        cursor.execute(sql)
"""})
    assert queries(rows, "app/views.py", "f") == [("execute", "UNKNOWN", None, "yes")]


def test_long_sql_is_capped_with_its_length(flows):
    sql = "SELECT * FROM t WHERE " + " OR ".join(f"a = {i}" for i in range(80))
    sql = sql[:600]
    rows, _ = flows({"a.py": f'def f(cur):\n    cur.execute("{sql}")\n'})
    q = query_on(rows, "a.py", "f", "execute")
    assert q["truncated"] and q["textLength"] == 600 and len(q["text"]) == 500


# --- Django, Flask-SQLAlchemy, SQLModel --------------------------------------------------

DJANGO = {
    "app/models.py": """from django.db import models
class TimestampedModel(models.Model):
    created = models.DateTimeField()
class Article(TimestampedModel):
    title = models.CharField()
class Tag(models.Model):
    name = models.CharField()
""",
    "app/views.py": """from .models import Article, Tag
class NotAModel:
    objects = None
def count():
    return Article.objects.filter(title='x').count()
def listing():
    return Article.objects.filter(title='x')
def keep():
    Tag.objects.update_or_create(name='x')
def stored():
    qs = Article.objects.all()
    return qs.count()
def fake():
    NotAModel.objects.filter(a=1).count()
""",
}


def test_django_querysets(flows):
    rows, _ = flows(DJANGO)
    assert queries(rows, "app/views.py", "count") == [("count", "SELECT", "Article", "terminal")]
    assert queries(rows, "app/views.py", "listing") == [
        ("filter", "SELECT", "Article", "unknown")]
    assert queries(rows, "app/views.py", "keep") == [("update_or_create", "SAVE", "Tag",
                                                      "terminal")]
    assert queries(rows, "app/views.py", "stored") == [("count", "SELECT", "Article",
                                                        "terminal")]
    assert queries(rows, "app/views.py", "fake") == []  # not a Django model


def test_flask_sqlalchemy_query_all(flows):
    rows, _ = flows({
        "backend/models.py": """from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()
class Customer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
""",
        "backend/routes.py": """from .models import Customer
def list_customers():
    return [c.id for c in Customer.query.all()]
"""})
    q = query_on(rows, "backend/routes.py", "list_customers", "all")
    assert (q["op"], q["target"], q["executes"]) == ("SELECT", "Customer", "terminal")
    assert q["entity"] == {"path": "backend/models.py", "name": "Customer"}


SQLMODEL = {
    "app/models.py": """from sqlmodel import SQLModel, Field
class UserBase(SQLModel):
    email: str
class User(UserBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
""",
    "app/deps.py": """from typing import Annotated
from sqlmodel import Session
SessionDep = Annotated[Session, Depends(get_db)]
""",
    "app/crud.py": """from sqlmodel import Session, select
from app.models import User
from app.deps import SessionDep
def by_email(session: Session, email: str):
    statement = select(User).where(User.email == email)
    return session.exec(statement).first()
def inline(session: SessionDep):
    return session.exec(select(User)).all()
def get(session: SessionDep, id: int):
    return session.get(User, id)
def create(session: SessionDep, data):
    db_obj = User.model_validate(data)
    session.add(db_obj)
    session.commit()
def built():
    return select(User)
""",
}


def test_sqlmodel_statements_and_sessions(flows):
    rows, _ = flows(SQLMODEL)
    path = "app/crud.py"
    assert queries(rows, path, "by_email") == [("exec", "SELECT", "User", "yes")]
    assert queries(rows, path, "inline") == [("exec", "SELECT", "User", "yes")]
    assert queries(rows, path, "get") == [("get", "SELECT", "User", "yes")]
    assert queries(rows, path, "create") == [("add", "INSERT", "User", "unknown")]
    assert queries(rows, path, "built") == [("select", "SELECT", "User", "unknown")]
    q = query_on(rows, path, "by_email", "exec")
    assert q["entity"] == {"path": "app/models.py", "name": "User"}


# --- SAVE is not UPSERT ------------------------------------------------------------------

def test_orm_saves_are_save_and_real_upserts_are_upsert(flows):
    spring = queries(flows(SPRING)[0], "src/OwnerService.java", "run", "OwnerService")
    typeorm = flows(TYPEORM)[0]
    django = flows(DJANGO)[0]
    prisma = flows(PRISMA)[0]
    saves = [
        next(op for n, op, *_ in spring if n == "save"),
        queries(typeorm, "src/user.service.ts", "keep", "UserService")[0][1],
        queries(django, "app/views.py", "keep")[0][1],
    ]
    upserts = [
        classify_sql("INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = 2")[0],
        queries(typeorm, "src/user.service.ts", "upsert", "UserService")[0][1],
        next(op for n, op, *_ in queries(prisma, "src/auth.service.ts", "find")
             if n == "upsert"),
    ]
    assert saves == ["SAVE", "SAVE", "SAVE"]
    assert upserts == ["UPSERT", "UPSERT", "UPSERT"]
