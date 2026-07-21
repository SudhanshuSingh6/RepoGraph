from services.user_service import UserService

service = UserService()


@app.route("/users", methods=["POST"])
def create_user():
    return service.get_user(1)
