"""Getting a project's source onto disk safely: zip extraction and GitHub clone.

Both paths enforce the same caps on what lands on disk (IMPORT_MAX_BYTES total bytes,
IMPORT_MAX_FILES files). Violations raise ImportRejected, which the worker treats as
a terminal, user-facing failure (retrying can't fix a bad archive).
"""

import io
import os
import re
import stat
import subprocess
import zipfile
import zlib
from pathlib import Path, PurePosixPath

from filters import keep_path

CHUNK = 64 * 1024

# Same validation the app applies; re-checked here so the worker never trusts its input.
GITHUB_NAME = re.compile(r"^(?![-.])[\w.-]+$")
GIT_REF = re.compile(r"^(?!-)(?!.*\.\.)[\w./-]+$")


class ImportRejected(Exception):
    """The input itself is unacceptable (unsafe, too large, not found). Not retried."""


class Caps:
    def __init__(self, max_bytes: int, max_files: int):
        self.max_bytes = max_bytes
        self.max_files = max_files
        self.bytes = 0
        self.files = 0

    def add_file(self):
        self.files += 1
        if self.files > self.max_files:
            raise ImportRejected(f"Repository has more than {self.max_files:,} files.")

    def add_bytes(self, n: int):
        self.bytes += n
        if self.bytes > self.max_bytes:
            raise ImportRejected(f"Repository is larger than {self.max_bytes // (1024 * 1024)}MB.")


def _safe_member_path(name: str) -> PurePosixPath:
    """Rejects any entry that could escape the extraction directory."""
    if "\\" in name or "\x00" in name:
        raise ImportRejected(f"Archive entry has an invalid path: {name!r}")
    p = PurePosixPath(name)
    if p.is_absolute() or re.match(r"^[A-Za-z]:", name):
        raise ImportRejected(f"Archive entry has an absolute path: {name!r}")
    if ".." in p.parts:
        raise ImportRejected(f"Archive entry escapes the archive root: {name!r}")
    return p


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    return stat.S_ISLNK(info.external_attr >> 16)


def extract_zip(data: bytes, dest: Path, caps: Caps) -> None:
    """Extracts only files that pass keep_path. Every entry's path is validated before
    anything is written; sizes are counted from the actual decompressed stream, not the
    archive's headers, so a lying archive is caught mid-extraction."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise ImportRejected("Upload is not a valid .zip file.") from e

    with zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        paths = [_safe_member_path(i.filename) for i in infos]  # validate all first
        # Strip a shared wrapper folder (GitHub's `repo-branch/`, or the uploaded folder's
        # own name) before filtering, so a project folder named e.g. `build` isn't ignored.
        strip = common_root([str(p) for p in paths])
        if strip:
            paths = [PurePosixPath(*p.parts[1:]) for p in paths]

        dest_root = dest.resolve()
        for info, rel in zip(infos, paths):
            if _is_symlink(info) or not keep_path(str(rel)):
                continue  # symlinks are never materialized
            target = (dest_root / rel).resolve()
            if not target.is_relative_to(dest_root):
                raise ImportRejected(f"Archive entry escapes the archive root: {info.filename!r}")

            caps.add_file()
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                with zf.open(info) as src, open(target, "wb") as out:
                    while chunk := src.read(CHUNK):
                        caps.add_bytes(len(chunk))
                        out.write(chunk)
            except (zipfile.BadZipFile, zlib.error, NotImplementedError) as e:
                raise ImportRejected(f"The archive is corrupt or unsupported ({e}).") from e


def clone_github(owner: str, repo: str, branch: str | None, dest: Path, caps: Caps,
                 timeout_s: int = 600) -> None:
    """Shallow clone of a public repo; caps are enforced on the checked-out tree."""
    if not GITHUB_NAME.match(owner) or not GITHUB_NAME.match(repo):
        raise ImportRejected("Invalid GitHub owner or repository name.")
    if branch is not None and not GIT_REF.match(branch):
        raise ImportRejected("Invalid branch name.")

    # Public repos only: disable every credential helper / prompt so a private or missing
    # repo fails fast instead of waiting on (or popping up) an interactive login.
    cmd = ["git", "-c", "core.symlinks=false", "-c", "credential.helper=", "clone", "--depth", "1", "--single-branch",
           "--no-tags", "--quiet"]
    if branch:
        cmd.append(f"--branch={branch}")
    cmd += ["--", f"https://github.com/{owner}/{repo}.git", str(dest)]
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "", "SSH_ASKPASS": "",
           "GCM_INTERACTIVE": "never", "GIT_LFS_SKIP_SMUDGE": "1"}
    try:
        res = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("git clone timed out") from e
    if res.returncode != 0:
        msg = res.stderr.strip()
        if "not found" in msg.lower() or "could not read username" in msg.lower():
            raise ImportRejected(
                f"Couldn't clone {owner}/{repo}"
                + (f" (branch {branch})" if branch else "")
                + " — check it exists and is public."
            )
        raise RuntimeError(f"git clone failed: {msg}")

    for root, dirs, files in os.walk(dest):
        dirs[:] = [d for d in dirs if d != ".git"]
        for f in files:
            p = Path(root, f)
            if p.is_symlink():
                continue
            caps.add_file()
            caps.add_bytes(p.stat().st_size)


def common_root(paths: list[str]) -> str:
    """The single top-level folder every path shares (GitHub's `repo-branch/` wrapper),
    or "" if there isn't one."""
    if not paths:
        return ""
    firsts = {PurePosixPath(p).parts[0] for p in paths}
    if len(firsts) == 1 and all(len(PurePosixPath(p).parts) > 1 for p in paths):
        return firsts.pop()
    return ""
