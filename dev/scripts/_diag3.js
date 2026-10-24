const path=require('path');
const {app,BrowserWindow,ipcMain}=require('electron');
const DEV=path.join(__dirname,'..');
app.whenReady().then(async()=>{
  ipcMain.handle('log:report',()=>true);
  const win=new BrowserWindow({show:false,webPreferences:{preload:path.join(DEV,'src','main','preload.js'),contextIsolation:true}});
  await win.loadFile(path.join(DEV,'src','renderer','index.html'));
  await new Promise(r=>setTimeout(r,1000));
  const s=`(function(){
    const V=window.__view, log=[];
    const dom=V.contentDOM;
    const doc=()=>V.state.doc.toString();
    const setDoc=(d,p)=>V.dispatch({changes:{from:0,to:V.state.doc.length,insert:d},selection:{anchor:p}});
    // 候选框阶段（未上屏）
    setDoc('- 列表项', 4);
    dom.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'zhong'}));
    log.push('候选框阶段 composing='+V.composing+' inputState='+V.inputState.composing);
    const ev=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,isComposing:true,keyCode:229});
    dom.dispatchEvent(ev);
    log.push('  Enter prevented='+ev.defaultPrevented+' (true=被吞 / false=放行✓)');
    log.push('  文档='+JSON.stringify(doc()));
    dom.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'}));
    // 正常 Enter 仍要工作
    setDoc('- 列表项', 4);
    const ev2=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true});
    dom.dispatchEvent(ev2);
    log.push('正常 Enter 文档='+JSON.stringify(doc()));
    return log.join('\\n');
  })()`;
  let out='';
  try{ out=await win.webContents.executeJavaScript(s,true); }catch(e){ out='ERR: '+e.message; }
  console.log(out);
  setTimeout(()=>app.exit(0),100);
});
