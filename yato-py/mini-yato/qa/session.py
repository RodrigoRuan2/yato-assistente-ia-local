"""Synthetic QA profile, real model; controlled by local test flag files."""
import json
import sys
import threading
import time
import urllib.request
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
from mini import Mini
mini=Mini(data=HERE.parent/'data/qa')
thread=threading.Thread(target=mini.run,daemon=True);thread.start()
deadline=time.monotonic()+90
while time.monotonic()<deadline:
    try:
        with urllib.request.urlopen(mini.url+'/saude',timeout=2) as reply:
            if reply.status==200:break
    except OSError:time.sleep(.5)
else:raise RuntimeError('Avatar did not start')
with urllib.request.urlopen(mini.url+'/controle?acao=movimento&nome=walking&valor=0',timeout=3) as reply:reply.read()
(HERE/'mini-ready.flag').write_text('ready')
while not (HERE/'mini-ask.flag').exists():time.sleep(.2)
answers=[]
for text in ['Para este teste, lembre que meu jogo fictício favorito se chama Nuvem Azul.',
             'Qual é o meu jogo fictício favorito? E quanto é 18 vezes 27?']:
    request=urllib.request.Request(mini.bridge.url,data=json.dumps({'text':text}).encode(),
        headers={'Authorization':'Bearer '+mini.bridge.token},method='POST')
    with urllib.request.urlopen(request,timeout=600) as response:answers.append(json.load(response))
    print(json.dumps(answers[-1],ensure_ascii=False),flush=True)
assert '486' in answers[-1]['text'],answers
assert 'Nuvem Azul' in answers[-1]['text'],answers
assert (mini.data/'fatos.json').exists(),'Memory not persisted'
assert mini.worker is None or mini.worker.poll() is not None
(HERE/'mini-answer.flag').write_text('ready')
(HERE/'functional-result.json').write_text(json.dumps({'ok':True,'answers':answers,'memorySaved':True}),encoding='utf-8')
while not (HERE/'mini-stop.flag').exists():time.sleep(.2)
mini.stop=True;thread.join(15)
assert not thread.is_alive()
