"""Short-lived model worker. Imports heavy dependencies only for a message."""
import json
import os
import sys
import time
from pathlib import Path
import urllib.request

HERE=Path(__file__).resolve().parent
sys.path.insert(1,str(HERE/'runtime'))
sys.stdout.reconfigure(encoding='utf-8')
payload=json.load(sys.stdin)
import memoria
memoria.ARQUIVO_FATOS=Path(os.environ.get('YATO_MINI_DATA',HERE/'data'))/'fatos.json'
import brain
from personalidade import PERSONALIDADE
from bubble_bridge import TOOLS

def action(name,args):
    try:
        request=urllib.request.Request(os.environ['YATO_MINI_AVATAR_URL']+'/assistant-action',
            data=json.dumps(args).encode('utf-8'),headers={'Content-Type':'application/json',
            'Authorization':'Bearer '+os.environ['YATO_ASSISTANT_TOKEN']},method='POST')
        with urllib.request.urlopen(request,timeout=120) as reply:
            return json.load(reply)['text']
    except Exception:
        return 'Não consegui confirmar a ação. Não repita automaticamente.'

try:
    brain.garantir_ollama()
    for _ in range(20):
        if brain._ollama_no_ar():break
        time.sleep(.5)
    # No image tools in this version; no automatic screen/file inspection.
    brain.FERRAMENTAS=[f for f in brain.FERRAMENTAS if f['function']['name'] not in brain.FERRAMENTAS_IMAGEM]
    prompt=PERSONALIDADE+'\nModo Só mini Yato: você não monitora o computador. Aprenda preferências apenas do que o usuário conta. Anote fatos úteis que ele ensine, nunca suposições nem senhas. Quando solicitado, explique o que lembra e use esquecer_fato para apagar. Não altere seu código. Respostas por texto; voz indisponível neste modo leve.'
    cached={}
    def once(name,args):
        key=json.dumps([name,args],sort_keys=True)
        if key not in cached:cached[key]=action(name,args)
        return cached[key]
    result=brain.pensar([{'role':'system','content':prompt}]+payload['messages'],
        fonte_anterior=payload.get('source'),ferramentas_extras=TOOLS,executar_extra=once)
    print(json.dumps({'text':result.texto,'source':result.fonte},ensure_ascii=False))
except Exception as error:
    print(json.dumps({'text':f'Não consegui responder agora: {error}', 'error':True},ensure_ascii=False))
