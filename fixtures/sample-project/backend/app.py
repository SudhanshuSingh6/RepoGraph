from flask import Flask

from .routes import register


def create_app():
    app = Flask(__name__)
    register(app)
    return app


if __name__ == "__main__":
    create_app().run()
