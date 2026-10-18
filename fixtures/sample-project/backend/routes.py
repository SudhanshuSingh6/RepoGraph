from flask import jsonify

from .models import Customer


def register(app):
    @app.get("/api/customers")
    def list_customers():
        return jsonify([{"id": c.id, "name": c.name} for c in Customer.query.all()])
