"""Runs the existing full app on monitor 1 for controlled measurement."""
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
import app
import avatar2d
original=avatar2d.subprocess.Popen
def start(args,**kwargs):
    if isinstance(args,list) and any('avatar-chibi-lab' in str(a) for a in args):
        args=args+['--monitor=1']
    return original(args,**kwargs)
avatar2d.subprocess.Popen=start
window=app.App()
window.geometry('1000x700+20+20')
avatar2d.mostrar()
stop=Path(__file__).with_name('baseline-stop.flag')
def poll():
    if stop.exists():
        avatar2d.esconder();window.destroy()
    else:window.after(500,poll)
window.after(500,poll)
window.mainloop()
