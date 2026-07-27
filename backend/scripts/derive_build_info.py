"""Ermittelt beim Image-Build den Commit des ausgelieferten Git-Standes.

Hintergrund: Portainer baut den Stack aus einem frischen Git-Clone, reicht den
gezogenen Commit aber nirgends als Variable durch. Ohne diesen Wert koennte die
Anwendung nach einem Redeploy nicht pruefen, ob wirklich die Zielversion laeuft
(siehe ``services/system_update_service.py``). Dieses Skript liest den Commit
deshalb direkt aus den Git-Metadaten des Build-Kontexts und legt ihn als kleine
JSON-Datei ins Image.

Bewusste Eigenschaften:
* **Nur Standardbibliothek** — im Build-Image ist kein ``git`` installiert.
* **Bricht den Build nie ab.** Fehlt ``.git`` (z. B. beim Deploy ueber
  ``git archive``), wird eine Datei ohne Commit geschrieben; die Anwendung
  behandelt die Version dann als unbekannt und meldet niemals faelschlich
  Erfolg.
* Es werden ausschliesslich Commit-SHA, Branch und Buildzeit ermittelt —
  keine Autoren, keine Nachrichten, keine Zugangsdaten.

Aufruf: ``python derive_build_info.py <repo-root> <ziel-datei>``
"""
from __future__ import annotations

import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return None


def _resolve_git_dir(repo_root: Path) -> Path | None:
    """Liefert das .git-Verzeichnis — auch wenn ``.git`` eine Datei ist.

    Bei Worktrees/Submodulen ist ``.git`` eine Textdatei mit ``gitdir: <pfad>``.
    Zeigt sie aus dem Build-Kontext heraus, ist der Pfad im Image nicht
    aufloesbar; dann gilt die Version als unbekannt.
    """
    candidate = repo_root / ".git"
    if candidate.is_dir():
        return candidate
    if candidate.is_file():
        content = _read_text(candidate) or ""
        if content.startswith("gitdir:"):
            target = Path(content.split(":", 1)[1].strip())
            if not target.is_absolute():
                target = (repo_root / target).resolve()
            if target.is_dir():
                return target
    return None


def _lookup_packed_ref(git_dir: Path, ref: str) -> str | None:
    packed = _read_text(git_dir / "packed-refs")
    if not packed:
        return None
    for line in packed.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "^")):
            continue
        parts = line.split(" ", 1)
        if len(parts) == 2 and parts[1].strip() == ref:
            sha = parts[0].strip().lower()
            if SHA_PATTERN.match(sha):
                return sha
    return None


def read_git_head(repo_root: Path) -> tuple[str | None, str | None]:
    """Liefert ``(commit, branch)`` des Checkouts — beides optional."""
    git_dir = _resolve_git_dir(repo_root)
    if git_dir is None:
        return None, None

    head = _read_text(git_dir / "HEAD")
    if not head:
        return None, None

    # Detached HEAD: die Datei enthaelt direkt den Commit.
    if SHA_PATTERN.match(head.lower()):
        return head.lower(), None

    if not head.startswith("ref:"):
        return None, None

    ref = head.split(":", 1)[1].strip()
    branch = ref.rsplit("/", 1)[-1] if "/" in ref else ref

    loose = _read_text(git_dir / ref)
    if loose and SHA_PATTERN.match(loose.lower()):
        return loose.lower(), branch

    packed_sha = _lookup_packed_ref(git_dir, ref)
    if packed_sha:
        return packed_sha, branch

    return None, branch


def build_info(repo_root: Path) -> dict[str, str | None]:
    commit, branch = read_git_head(repo_root)
    return {
        "commit": commit,
        "branch": branch,
        "buildTime": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("Aufruf: derive_build_info.py <repo-root> <ziel-datei>", file=sys.stderr)
        return 2
    repo_root = Path(argv[1])
    target = Path(argv[2])
    try:
        info = build_info(repo_root)
    except Exception as exc:  # noqa: BLE001 — darf den Build nie abbrechen.
        print(f"Hinweis: Build-Version nicht ermittelbar ({type(exc).__name__})", file=sys.stderr)
        info = {"commit": None, "branch": None, "buildTime": None}
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(info, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"Hinweis: {target} nicht schreibbar ({exc})", file=sys.stderr)
        return 0
    print(f"Build-Version: {info['commit'] or 'unbekannt'} (Branch {info['branch'] or '-'})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
