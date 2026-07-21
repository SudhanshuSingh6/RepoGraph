import pytest
from fastapi import HTTPException

from app.ingestion.clone import validate_github_url


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/pallets/flask",
        "https://github.com/pallets/flask.git",
        "https://github.com/user-name/repo.name",
        "https://github.com/a/b/",  # trailing slash stripped
    ],
)
def test_valid_urls(url):
    validate_github_url(url)  # should not raise


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/pallets/flask",  # not https
        "https://gitlab.com/pallets/flask",  # wrong host
        "https://github.com/pallets",  # missing repo
        "https://github.com/pallets/flask; rm -rf /",  # injection
        "https://github.com/pallets/flask && echo pwned",
        "git@github.com:pallets/flask.git",  # ssh form
        "https://github.com/../../etc/passwd",
        "",
    ],
)
def test_invalid_urls(url):
    with pytest.raises(HTTPException) as exc:
        validate_github_url(url)
    assert exc.value.status_code == 422
