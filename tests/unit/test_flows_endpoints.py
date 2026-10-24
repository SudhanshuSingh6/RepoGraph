"""Endpoint extraction per framework, with prefix composition and its status:
'root' (on the app itself), 'resolved' (every mount up to an app found) or 'unknown'."""


def test_spring(endpoints):
    assert endpoints({"OwnerController.java": """
package p;
@RestController
@RequestMapping({"/api", "/v2"})
class OwnerController {
  @GetMapping("/owners/{id}") Owner one() { return null; }
  @PostMapping Owner make() { return null; }
  @RequestMapping(value = "/x", method = {RequestMethod.PUT, RequestMethod.PATCH}) void x() {}
  @RequestMapping(path = PATH) void any() {}
  void helper() {}
}
class NotAController { @GetMapping("/no") void no() {} }
"""}) == sorted([
        ("GET", "/api/owners/{id}", "root"), ("GET", "/v2/owners/{id}", "root"),
        ("POST", "/api", "root"), ("POST", "/v2", "root"),
        ("PUT", "/api/x", "root"), ("PATCH", "/api/x", "root"),
        ("PUT", "/v2/x", "root"), ("PATCH", "/v2/x", "root"),
        ("ANY", "/api/{PATH}", "root"), ("ANY", "/v2/{PATH}", "root"),
    ])


def test_spring_handler_points_at_the_method(flows):
    rows, _ = flows({"C.java": "@Controller class C { @GetMapping(\"/a\") String a() { return \"\"; } }"})
    (e,) = rows["C.java"]["endpoints"]
    assert e["handler"] == {"label": "C.a", "path": "C.java", "fn": 0, "line": 1}


def test_nest_with_global_prefix(endpoints):
    files = {
        "src/users.controller.ts": """
import { Controller, Get, Post, All } from '@nestjs/common';
@Controller('users')
export class UsersController {
  @Get(':id') find() {}
  @Post() create() {}
  @All('any') any() {}
  helper() {}
}""",
        "src/root.controller.ts": """
import { Controller, Get } from '@nestjs/common';
@Controller() export class RootController { @Get() root() {} }""",
    }
    assert endpoints(files) == sorted([("GET", "/users/:id", "root"), ("POST", "/users", "root"),
                                       ("ANY", "/users/any", "root"), ("GET", "/", "root")])
    files["src/main.ts"] = ("import { NestFactory } from '@nestjs/core';\n"
                            "async function boot() { const app = await NestFactory.create(M);\n"
                            "  app.setGlobalPrefix('api'); }")
    assert ("GET", "/api/users/:id", "resolved") in endpoints(files)


def test_express_mounts_across_files(endpoints):
    assert endpoints({
        "src/app.js": """
const express = require('express');
const users = require('./users');
const app = express();
app.use('/api', require('./api'));
app.use('/users', users);
app.get('/health', (req, res) => res.send('ok'));
app.get('title');  // a settings read, not a route
""",
        "src/api.ts": """
import { Router } from 'express';
import tags from './tags';
export default Router().use(tags).use('/v1', Router().get('/ping', h));
""",
        "src/tags.ts": """
import { Router } from 'express';
const router = Router();
router.get('/tags', (req, res) => {});
router.route('/tags/:id').get(one).delete(del);
export default router;
""",
        "src/users.js": """
const router = require('express').Router();
router.post('/', create);
router.all('/x', any);
module.exports = router;
""",
        "src/orphan.js": """
const { Router } = require('express');
const r = Router();
r.get('/lost', h);
""",
    }) == sorted([
        ("GET", "/health", "root"),
        ("GET", "/api/tags", "resolved"),
        ("GET", "/api/tags/:id", "resolved"), ("DELETE", "/api/tags/:id", "resolved"),
        ("GET", "/api/v1/ping", "resolved"),  # an inline router passed to .use()
        ("POST", "/users", "resolved"), ("ANY", "/users/x", "resolved"),
        ("GET", "/lost", "unknown"),  # never mounted: path is relative to the router
    ])


def test_express_router_passed_to_a_function(endpoints):
    assert endpoints({
        "server.js": "const express = require('express');\nconst app = express();\n"
                     "require('./routes')(app);\nregister(app);\nfunction register(a) {}",
        "routes.js": "module.exports = function (app) { app.get('/a', h); };",
    }) == [("GET", "/a", "resolved")]


def test_untyped_app_param_needs_a_slash_path_without_express_import(endpoints):
    assert endpoints({"x.js": "module.exports = (app) => { app.get('/a', h); app.get('b', h); };"}) \
        == [("GET", "/a", "unknown")]


def test_express_inline_handler_becomes_a_synthetic_function(flows):
    rows, _ = flows({"a.js": "const app = require('express')();\napp.post('/p', auth, (req, res) => {});"})
    (e,) = rows["a.js"]["endpoints"]
    fn = rows["a.js"]["functions"][e["handler"]["fn"]]
    assert fn["synthetic"] and fn["name"] == "POST /p"


def test_express_handler_resolves_through_bindings(flows):
    rows, _ = flows({
        "app.js": "const app = require('express')();\nconst ctrl = require('./ctrl');\n"
                  "import { show } from './show';\napp.get('/a', ctrl.list);\napp.get('/b', show);",
        "ctrl.js": "module.exports = { list: (req, res) => {} };",
        "show.js": "export function show(req, res) {}",
    })
    by_path = {e["path"]: e["handler"] for e in rows["app.js"]["endpoints"]}
    assert by_path["/a"]["path"] == "ctrl.js" and by_path["/a"]["fn"] is not None
    assert by_path["/b"]["path"] == "show.js" and by_path["/b"]["fn"] is not None


def test_flask_blueprints(endpoints):
    assert endpoints({
        "app/__init__.py": """
from flask import Flask
from .admin import bp as admin_bp
from .shop import shop
app = Flask(__name__)
app.register_blueprint(admin_bp)
app.register_blueprint(shop, url_prefix='/store')
@app.route('/')
def index(): pass
""",
        "app/admin.py": """
from flask import Blueprint
bp = Blueprint('admin', __name__, url_prefix='/admin')
@bp.route('/users', methods=['GET', 'POST'])
def users(): pass
""",
        "app/shop.py": """
from flask import Blueprint
shop = Blueprint('shop', __name__, url_prefix='/ignored')
@shop.get('/items/<int:id>')
def item(id): pass
""",
        "app/lost.py": """
from flask import Blueprint
lost = Blueprint('lost', __name__, url_prefix='/l')
@lost.get('/x')
def x(): pass
""",
    }) == sorted([
        ("GET", "/", "root"),
        ("GET", "/admin/users", "resolved"), ("POST", "/admin/users", "resolved"),
        ("GET", "/store/items/<int:id>", "resolved"),  # register's url_prefix overrides
        ("GET", "/l/x", "unknown"),
    ])


def test_flask_app_imported_from_another_file(endpoints):
    assert endpoints({
        "app.py": "from flask import Flask\napp = Flask(__name__)",
        "views.py": "from app import app\n@app.route('/v')\ndef v(): pass\n"
                    "from cache import cache\n@cache.get('/c')\ndef c(): pass",
        "cache.py": "cache = Cache()",
    }) == [("GET", "/v", "root")]  # @cache.get isn't a route: cache isn't an app


def test_fastapi_routers(endpoints):
    assert endpoints({
        "main.py": """
from fastapi import FastAPI
from api import routes
app = FastAPI()
app.include_router(routes.router, prefix=settings.API)
""",
        "api/__init__.py": "",
        "api/routes.py": """
from fastapi import APIRouter
router = APIRouter(prefix='/items')
@router.get('/{id}')
def read(id: int): pass
@router.api_route('/', methods=['PUT', 'PATCH'])
def write(): pass
""",
    }) == sorted([("GET", "/{settings.API}/items/{id}", "resolved"),
                  ("PUT", "/{settings.API}/items/", "resolved"),
                  ("PATCH", "/{settings.API}/items/", "resolved")])


def test_django_urls_views_and_drf(endpoints):
    assert endpoints({
        "site/settings.py": "ROOT_URLCONF = 'site.urls'",
        "site/urls.py": """
from django.urls import include, path
from django.contrib import admin
urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('shop.urls')),
]
""",
        "shop/__init__.py": "",
        "shop/urls.py": """
from django.urls import path, re_path, include
from rest_framework.routers import DefaultRouter
from . import views
from .views import ItemList, ItemViewSet
router = DefaultRouter()
router.register(r'items', ItemViewSet)
urlpatterns = [
    path('hello/', views.hello),
    re_path(r'^list/$', ItemList.as_view()),
    path('', include(router.urls)),
]
""",
        "shop/views.py": """
from rest_framework import generics, viewsets, mixins
from rest_framework.decorators import action
def hello(request): pass
class ItemList(generics.ListCreateAPIView): pass
class ItemViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    def destroy(self, request, pk=None): pass
    @action(detail=True, methods=['post'], url_path='buy')
    def purchase(self, request, pk=None): pass
""",
    }) == sorted([
        ("ANY", "/api/hello/", "resolved"),
        ("GET", "/api/list/", "resolved"), ("POST", "/api/list/", "resolved"),
        ("GET", "/api/items/", "resolved"), ("GET", "/api/items/{pk}/", "resolved"),
        ("DELETE", "/api/items/{pk}/", "resolved"), ("POST", "/api/items/{pk}/buy/", "resolved"),
    ])  # admin.site.urls is a library URLconf: no endpoint


def test_django_urls_not_included_anywhere_are_unknown(endpoints):
    assert endpoints({"app/urls.py": "from django.urls import path\nfrom . import v\n"
                                     "urlpatterns = [path('x/', v.x)]",
                      "app/v.py": "def x(r): pass"}) == [("ANY", "/x/", "unknown")]


def test_join_path():
    from flows import join_path
    assert join_path("/api/", "/x") == "/api/x"
    assert join_path("", "") == "/"
    assert join_path("api", "x/") == "/api/x/"
    assert join_path("/a", "") == "/a"
