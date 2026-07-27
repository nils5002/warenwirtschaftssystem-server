"""Ermittlung der Build-Version aus dem Git-Checkout (Systemupdate).

Geprüft wird die reine Logik aus ``scripts/derive_build_info.py`` sowie die
Auflösungsreihenfolge in ``app/config/build_info.py``. Es wird kein ``git``
aufgerufen — die Testfälle legen die Metadaten-Dateien selbst an, genau so wie
sie in einem Checkout aussehen.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from app.config import build_info as build_info_module

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "derive_build_info.py"
SHA = "44159e7c2b5d381decc0645ec61471cd7c841ac4"


def _load_script():
    spec = importlib.util.spec_from_file_location("derive_build_info", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


derive = _load_script()


def _git_repo(tmp_path: Path, *, head: str, refs: dict[str, str] | None = None,
              packed: str | None = None) -> Path:
    git_dir = tmp_path / ".git"
    git_dir.mkdir()
    (git_dir / "HEAD").write_text(head, encoding="utf-8")
    for ref, sha in (refs or {}).items():
        target = git_dir / ref
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"{sha}\n", encoding="utf-8")
    if packed is not None:
        (git_dir / "packed-refs").write_text(packed, encoding="utf-8")
    return tmp_path


def test_reads_commit_and_branch_from_loose_ref(tmp_path):
    repo = _git_repo(
        tmp_path, head="ref: refs/heads/main\n", refs={"refs/heads/main": SHA}
    )
    assert derive.read_git_head(repo) == (SHA, "main")


def test_reads_commit_from_packed_refs(tmp_path):
    """Frische Clones haben oft keine losen Ref-Dateien."""
    repo = _git_repo(
        tmp_path,
        head="ref: refs/heads/main\n",
        packed=f"# pack-refs with: peeled fully-peeled sorted \n{SHA} refs/heads/main\n",
    )
    assert derive.read_git_head(repo) == (SHA, "main")


def test_handles_detached_head(tmp_path):
    repo = _git_repo(tmp_path, head=f"{SHA}\n")
    commit, branch = derive.read_git_head(repo)
    assert commit == SHA
    assert branch is None


def test_missing_git_directory_yields_unknown(tmp_path):
    assert derive.read_git_head(tmp_path) == (None, None)


def test_git_file_pointing_nowhere_yields_unknown(tmp_path):
    (tmp_path / ".git").write_text("gitdir: /nicht/vorhanden\n", encoding="utf-8")
    assert derive.read_git_head(tmp_path) == (None, None)


def test_script_writes_json_and_never_fails_without_git(tmp_path):
    """Ohne .git (Deploy via git archive) darf der Build nicht abbrechen."""
    target = tmp_path / "out" / "build_info.json"
    assert derive.main(["derive_build_info.py", str(tmp_path), str(target)]) == 0
    data = json.loads(target.read_text(encoding="utf-8"))
    assert data["commit"] is None
    assert data["buildTime"]


def test_script_writes_commit_when_git_present(tmp_path):
    repo = _git_repo(tmp_path, head="ref: refs/heads/main\n", refs={"refs/heads/main": SHA})
    target = tmp_path / "build_info.json"
    assert derive.main(["derive_build_info.py", str(repo), str(target)]) == 0
    data = json.loads(target.read_text(encoding="utf-8"))
    assert data == {"commit": SHA, "branch": "main", "buildTime": data["buildTime"]}


# --- Auflösungsreihenfolge zur Laufzeit ---------------------------------------


def _build_info(monkeypatch, *, env_commit=None, file_payload=None, tmp_path=None):
    from app.config.settings import Settings

    settings = Settings(app_git_commit=env_commit, app_git_branch=None, app_build_time=None)
    monkeypatch.setattr(build_info_module, "get_settings", lambda: settings)
    if file_payload is None:
        monkeypatch.setattr(build_info_module, "BUILD_INFO_FILE", tmp_path / "fehlt.json")
    else:
        path = tmp_path / "build_info.json"
        path.write_text(json.dumps(file_payload), encoding="utf-8")
        monkeypatch.setattr(build_info_module, "BUILD_INFO_FILE", path)
    build_info_module.get_build_info.cache_clear()
    try:
        return build_info_module.get_build_info()
    finally:
        build_info_module.get_build_info.cache_clear()


def test_env_variable_wins_over_file(monkeypatch, tmp_path):
    info = _build_info(
        monkeypatch,
        env_commit=SHA,
        file_payload={"commit": "b" * 40, "branch": "andere", "buildTime": "x"},
        tmp_path=tmp_path,
    )
    assert info.commit == SHA
    assert info.source == "env"


def test_env_commit_still_takes_build_time_from_file(monkeypatch, tmp_path):
    """Feldweiser Vorrang: Portainer liefert nur den Commit, nicht die Buildzeit.

    Ohne diesen Rueckfall bliebe die Buildzeit im Adminbereich dauerhaft leer,
    sobald APP_GIT_COMMIT gesetzt ist — und genau das ist unter Portainer der
    Normalfall.
    """
    info = _build_info(
        monkeypatch,
        env_commit=SHA,
        file_payload={"commit": None, "branch": "main", "buildTime": "2026-07-27T09:00:00Z"},
        tmp_path=tmp_path,
    )
    assert info.commit == SHA
    assert info.branch == "main"
    assert info.build_time == "2026-07-27T09:00:00Z"
    assert info.source == "env"


def test_file_is_used_when_env_is_empty(monkeypatch, tmp_path):
    info = _build_info(
        monkeypatch,
        file_payload={"commit": SHA, "branch": "main", "buildTime": "2026-07-27T09:00:00Z"},
        tmp_path=tmp_path,
    )
    assert info.commit == SHA
    assert info.branch == "main"
    assert info.build_time == "2026-07-27T09:00:00Z"
    assert info.source == "file"


def test_unknown_without_env_and_file(monkeypatch, tmp_path):
    info = _build_info(monkeypatch, tmp_path=tmp_path)
    assert info.commit is None
    assert info.source == "unknown"


def test_broken_file_does_not_raise(monkeypatch, tmp_path):
    path = tmp_path / "build_info.json"
    path.write_text("{kein json", encoding="utf-8")
    monkeypatch.setattr(build_info_module, "BUILD_INFO_FILE", path)
    from app.config.settings import Settings

    monkeypatch.setattr(build_info_module, "get_settings", lambda: Settings(app_git_commit=None))
    build_info_module.get_build_info.cache_clear()
    try:
        assert build_info_module.get_build_info().commit is None
    finally:
        build_info_module.get_build_info.cache_clear()


def test_invalid_commit_values_are_rejected(monkeypatch, tmp_path):
    info = _build_info(
        monkeypatch, file_payload={"commit": "kein-sha!", "branch": "main"}, tmp_path=tmp_path
    )
    assert info.commit is None
