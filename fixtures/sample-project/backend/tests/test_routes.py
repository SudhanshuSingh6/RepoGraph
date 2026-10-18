from backend.app import create_app


def test_list_customers_route_exists():
    app = create_app()
    assert any(r.rule == "/api/customers" for r in app.url_map.iter_rules())
