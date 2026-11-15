"""Verifica os bytes do subconjunto público do beta-1, sem dependências externas."""
import hashlib
import json
from pathlib import Path


def main():
    here = Path(__file__).resolve().parent
    manifest = json.loads((here / "beta-1-publicado.sha256.json").read_text(encoding="utf-8"))
    snapshot = here.parent / manifest["snapshot"]
    failed = []
    for entry in manifest["files"]:
        file = snapshot / entry["path"]
        if not file.is_file():
            failed.append(entry["path"] + ": ausente")
            continue
        content = file.read_bytes()
        if len(content) != entry["bytes"] or hashlib.sha256(content).hexdigest().upper() != entry["sha256"].upper():
            failed.append(entry["path"] + ": diferente do original")
    if failed:
        raise SystemExit("Falha na preservação:\n" + "\n".join(failed))
    print(f"Beta-1 preservado: {len(manifest['files'])} arquivos públicos conferidos.")


if __name__ == "__main__":
    main()
