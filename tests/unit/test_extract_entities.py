"""ORM entity detection per style (repograph-spec.md §12), through tree-sitter."""

from pathlib import Path

from entities import Entity, Field, Relation
from extract import analyze_file

SAMPLE = Path(__file__).resolve().parents[2] / "fixtures" / "sample-project"


def entities(src: str, path: str) -> list[Entity]:
    lang = {"java": "java", "py": "py", "js": "js"}.get(path.rsplit(".", 1)[1], "ts")
    return analyze_file(path, lang, src).entities


def test_jpa_fields_table_and_relationships():
    src = """
package shop;
// @Entity class Commented {}
@javax.persistence.Entity
@Table(name = "orders")
public class Order {
    @Id @GeneratedValue private Long id;
    @Column(name = "st") private String status;
    @Column private String a, b;
    @ManyToOne private Customer customer;
    @OneToMany(mappedBy = "order") private List<Item> items;
    @ManyToMany private Set<com.x.Tag> tags;
    @OneToOne private Map<String, Invoice> invoice;
    private transient int notMapped;
}
@Entity class Plain { @Id String code; }
class NotAnEntity { @Id Long id; }
"""
    assert entities(src, "Order.java") == [
        Entity("Order", "orders", "jpa", [
            Field("id", "Long", True),
            Field("status", "String"),
            Field("a", "String"),
            Field("b", "String"),
        ], [
            Relation("customer", "N–1", "Customer"),
            Relation("items", "1–N", "Item"),
            Relation("tags", "N–N", "com.x.Tag"),
            Relation("invoice", "1–1", "Invoice"),
        ], 4),
        Entity("Plain", "Plain", "jpa", [Field("code", "String", True)], [], 16),
    ]


def test_typeorm_decorators_in_typescript_and_javascript():
    ts = """
@Entity("users")
export class User {
  @PrimaryGeneratedColumn() id: number;
  @Column({ nullable: true }) name?: string;
  @OneToMany(() => Photo, (photo) => photo.user) photos: Photo[];
  @ManyToOne(type => Org) org: Org;
  @ManyToMany("Tag") tags: Tag[];
  helper: string;
}
@Entity({ name: "accounts" }) class Account { @PrimaryColumn() code: string; }
@Entity() export default class Bare {}
class NotAnEntity { @Column() x: number; }
"""
    assert entities(ts, "user.ts") == [
        Entity("User", "users", "typeorm", [
            Field("id", "number", True),
            Field("name", "string"),
        ], [
            Relation("photos", "1–N", "Photo"),
            Relation("org", "N–1", "Org"),
            Relation("tags", "N–N", "Tag"),
        ], 3),
        Entity("Account", "accounts", "typeorm", [Field("code", "string", True)], [], 11),
        Entity("Bare", "Bare", "typeorm", [], [], 12),
    ]
    js = '@Entity() class Post { @PrimaryColumn() id; @ManyToOne(() => User) author = null; }'
    assert entities(js, "post.js") == [
        Entity("Post", "Post", "typeorm", [Field("id", "", True)],
               [Relation("author", "N–1", "User")], 1),
    ]


def test_django_columns_relations_and_implicit_pk():
    src = """
from django.db import models

class Book(models.Model):
    title = models.CharField(max_length=100)
    author = models.ForeignKey('Author', on_delete=models.CASCADE)
    tags = models.ManyToManyField(to="library.Tag")
    sequel = models.OneToOneField("self", null=True)
    shelf = models.ForeignKey(Shelf, on_delete=models.CASCADE)
    computed = property(lambda self: 1)

    class Meta:
        db_table = "books"

    def save(self):
        extra = models.CharField()

class Author(models.Model):
    code = models.CharField(primary_key=True, max_length=8)

class Mixin(object):
    x = models.CharField()
"""
    assert entities(src, "models.py") == [
        Entity("Book", "books", "django", [
            Field("id", "AutoField", True),
            Field("title", "CharField"),
            Field("author", "ForeignKey"),
            Field("tags", "ManyToManyField"),
            Field("sequel", "OneToOneField"),
            Field("shelf", "ForeignKey"),
        ], [
            Relation("author", "N–1", "Author"),
            Relation("tags", "N–N", "library.Tag"),
            Relation("sequel", "1–1", "Book"),
            Relation("shelf", "N–1", "Shelf"),
        ], 4),
        Entity("Author", "Author", "django", [Field("code", "CharField", True)], [], 18),
    ]


def test_sqlalchemy_tablename_or_db_model():
    src = """
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column("full_name", String(50), nullable=False)
    posts = relationship("Post", back_populates="author")
    group = relationship(Group)

class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)

class Plain(Base):
    id = Column(Integer, primary_key=True)
"""
    assert entities(src, "models.py") == [
        Entity("User", "users", "sqlalchemy", [
            Field("id", "Integer", True),
            Field("name", "String(50)"),
        ], [
            Relation("posts", "RelatedTo", "Post"),
            Relation("group", "RelatedTo", "Group"),
        ], 2),
        Entity("Post", "Post", "sqlalchemy", [Field("id", "db.Integer", True)], [], 9),
    ]


def test_sample_project_has_one_jpa_and_one_sqlalchemy_entity():
    order = SAMPLE / "jobs/src/main/java/com/example/jobs/model/Order.java"
    models = SAMPLE / "backend/models.py"
    assert [(e.name, e.table, e.orm) for e in entities(order.read_text(), "Order.java")] \
        == [("Order", "orders", "jpa")]
    [customer] = entities(models.read_text(), "models.py")
    assert (customer.name, customer.table, customer.orm) == ("Customer", "customers", "sqlalchemy")
    # Extracted as written; the app decides it names no SQLAlchemy entity in the repo.
    assert customer.relations == [Relation("orders", "RelatedTo", "Order")]
