// Render only the avatar's canvases; never capture the user's desktop.
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const before=process.argv.includes('--before');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:300,height:500,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true}});
  await win.loadFile(path.resolve(__dirname,'..','index.html'),{query:{desktop:'1'}});
  const js=code=>win.webContents.executeJavaScript(code);
  for(let i=0;i<100&&!(await js('window.avatarDebug().ready'));i++)await pause(50);
  assert.equal((await js('window.avatarDebug()')).ready,true);
  const result=await js(`(()=>{
    const measure=frame=>{
      const data=frame.getContext('2d').getImageData(0,0,384,560).data;
      let top=560,bottom=0,left=384,right=0;
      for(let y=0;y<560;y++)for(let x=0;x<384;x++)if(data[(y*384+x)*4+3]>180){top=Math.min(top,y);bottom=Math.max(bottom,y);}
      for(let y=top;y<top+140;y++)for(let x=0;x<384;x++)if(data[(y*384+x)*4+3]>180){left=Math.min(left,x);right=Math.max(right,x);}
      return {top,bottom,headWidth:right-left+1};
    };
    const contact=document.createElement('canvas');contact.width=960;contact.height=360;
    const c=contact.getContext('2d');c.fillStyle='#29252f';c.fillRect(0,0,960,360);
    const choices=[frames[0],walkFrames[0],walkFrames[2],walkFrames[6],walkFrames[8]];
    choices.forEach((frame,i)=>{
      c.drawImage(frame,i*192,35,192,280);
      c.fillStyle='#eee8f4';c.font='14px sans-serif';c.textAlign='center';
      c.fillText(['Parado','Direita · passo 1','Direita · passo 3','Esquerda · passo 1','Esquerda · passo 3'][i],i*192+96,25);
      c.fillText(measure(frame).headWidth+' px de cabeça',i*192+96,340);
    });
    return {neutral:measure(frames[0]),walk:walkFrames.map(measure),image:contact.toDataURL()};
  })()`);
  fs.writeFileSync(path.join(__dirname,`proportions-${before?'before':'after'}.png`),nativeImage.createFromDataURL(result.image).toPNG());
  delete result.image;
  if(!before){
    for(const frame of result.walk){
      assert.ok(Math.abs(frame.headWidth/result.neutral.headWidth-1)<.10,'Profile head must remain within 10% of the neutral silhouette');
      assert.ok(Math.abs(frame.top-result.neutral.top)<8,'Starting to walk must not change the avatar height');
      assert.ok(Math.abs(frame.bottom-result.neutral.bottom)<3,'Feet must remain on the same baseline');
    }
    const widths=result.walk.map(f=>f.headWidth);
    assert.ok(Math.max(...widths)-Math.min(...widths)<12,'Head must remain stable through both walk cycles');
    await js('window.setMovimento("breathing",false);window.setMovimento("idleMotion",false);window.setMovimento("following",false);window.setMovimento("blinking",false)');
    // Exercise a full left/right/start/stop sequence through the real renderer.
    for(const direction of [1,-1]){
      await js('nativeMotion={...nativeMotion,pace:0,mode:"idle"}');await pause(250);
      await js('nativeMotion={...nativeMotion,pace:1,mode:"walking",cycle:0,direction:'+direction+'}');
      await pause(250);assert.equal((await js('window.avatarDebug()')).view,'walk-'+direction);
      for(let frame=0;frame<6;frame++){
        await js('nativeMotion={...nativeMotion,cycle:'+((frame+.1)/6)+'}');await pause(40);
        assert.equal((await js('window.avatarDebug()')).frame,frame);
      }
      await js('nativeMotion={...nativeMotion,pace:0,mode:"idle"}');await pause(250);
      assert.equal((await js('window.avatarDebug()')).view,'front');
    }
    result.ok=true;
  }
  fs.writeFileSync(path.join(__dirname,`proportions-${before?'before':'result'}.json`),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
