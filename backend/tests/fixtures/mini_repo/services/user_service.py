from repos.user_repo import UserRepo


class UserService:
    def __init__(self):
        self.repo = UserRepo()

    def get_user(self, uid):
        if uid is None:
            return None
        return self.repo.find_by_id(uid)
