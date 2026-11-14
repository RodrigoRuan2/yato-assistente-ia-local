"""Mini Yato: stdlib-only host; no Tk, microphone, voice or model preload."""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from bubble_bridge import BubbleBridge

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent

class Mini:
    def __init__(self,monitor='1',data=None):
        self.data=Path(data or HERE/'data');self.data.mkdir(exist_ok=True,parents=True)
        self.messages=[];self.source='';self.worker=None;self.avatar=None;self.stop=False
        try:
            state=json.loads((self.data/'conversation.json').read_text(encoding='utf-8'))
            self.messages=[m for m in state['messages'] if isinstance(m,dict) and m.get('role') in ('user','assistant') and isinstance(m.get('content'),str)][-120:]
            self.source=state.get('source','')
        except (OSError,ValueError,KeyError,TypeError):pass
        self.bridge=BubbleBridge()
        with socket.socket() as s:
            s.bind(('127.0.0.1',0));port=s.getsockname()[1]
        self.url=f'http://127.0.0.1:{port}'
        self.env=dict(os.environ);self.env.pop('ELECTRON_RUN_AS_NODE',None)
        self.env.update(YATO_MINI='1',YATO_CHIBI_LAB_PORTA=str(port),YATO_ASSISTANT_URL=self.bridge.url,
            YATO_ASSISTANT_TOKEN=self.bridge.token,YATO_MINI_AVATAR_URL=self.url,YATO_MINI_DATA=str(self.data),PYTHONIOENCODING='utf-8')
        executable=ROOT/'avatar-electron/node_modules/electron/dist/electron.exe'
        self.avatar=subprocess.Popen([str(executable),str(HERE/'avatar'), '--desktop','--chat',f'--monitor={monitor}'],env=self.env,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        (self.data/'session.json').write_text(json.dumps({'pid':os.getpid(),'url':self.url}),encoding='utf-8')

    def state(self,name):
        try:
            with urllib.request.urlopen(self.url+'/controle?'+urllib.parse.urlencode({'acao':'estado','nome':name}),timeout=1) as response:response.read()
        except OSError:pass

    def answer(self,request):
        self.state('pensando')
        messages=self.messages+[{'role':'user','content':request.text}]
        try:
            self.worker=subprocess.Popen([str(ROOT/'.venv/Scripts/python.exe'),'-X','utf8',str(HERE/'worker.py')],
                env=self.env,cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                text=True,encoding='utf-8',creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            deadline=time.monotonic()+540
            payload=json.dumps({'messages':messages,'source':self.source})
            while True:
                try:
                    output,errors=self.worker.communicate(payload,timeout=1)
                    break
                except subprocess.TimeoutExpired:
                    payload=None
                    if self.stop or self.avatar.poll() is not None or time.monotonic()>deadline:
                        raise RuntimeError('A conversa foi interrompida ou excedeu o tempo de espera')
            if self.worker.returncode:raise RuntimeError('O processo da IA encerrou inesperadamente.')
            result=json.loads(output)
            if not result.get('error'):
                self.messages=(messages+[{'role':'assistant','content':result['text']}])[-120:]
                self.source=result.get('source') or self.source
                temporary=self.data/'conversation.tmp'
                temporary.write_text(json.dumps({'messages':self.messages,'source':self.source},ensure_ascii=False,indent=2),encoding='utf-8')
                temporary.replace(self.data/'conversation.json')
            request.finish(result['text'])
        except Exception as error:
            request.finish(f'Não consegui concluir: {error}. Confira antes de repetir uma ação.',False)
        finally:
            if self.worker and self.worker.poll() is None:
                self.worker.kill();self.worker.wait()
            self.worker=None;self.state('ociosa')

    def run(self):
        try:
            while not self.stop and self.avatar.poll() is None:
                request=self.bridge.poll()
                if request:self.answer(request)
                else:time.sleep(.12)
        finally:self.close()

    def close(self):
        self.stop=True
        if self.worker and self.worker.poll() is None:self.worker.terminate()
        if self.avatar and self.avatar.poll() is None:self.avatar.terminate();self.avatar.wait(timeout=10)
        self.bridge.server.shutdown();self.bridge.server.server_close()

if __name__=='__main__':
    # Separate single-instance lock; never closes the main Yato app.
    lock=socket.socket()
    try:lock.bind(('127.0.0.1',49518))
    except OSError:sys.exit(0)
    mini=Mini()
    mini.run()
