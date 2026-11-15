"""Reutiliza a medição de volume do Yato; não precisa carregar o Piper."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from voz import _envelope

if __name__ == '__main__':
    values, ms = _envelope((ROOT / 'assets' / 'fala-demo.wav').read_bytes())
    (ROOT / 'assets' / 'fala-demo.json').write_text(
        json.dumps({'ms': ms, 'values': [round(v, 4) for v in values]}),
        encoding='utf-8',
    )
    print(f'{len(values)} janelas de {ms} ms; envelope gerado pelo voz.py existente.')
