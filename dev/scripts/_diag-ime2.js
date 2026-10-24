const path=require('path');
const {app,BrowserWindow,ipcMain}=require('electron');
const DEV=path.join(__dirname,'..');
app.whenReady().then(async()=>{
  ipcMain.handle('log:report',()=>true);
  const win=new BrowserWindow({show:false,webPreferences:{preload:path.join(DEV,'src','main','preload.js'),contextIsolation:true}});
  await win.loadFile(path.join(DEV,'src','renderer','index.html'));
  await new Promise(r=>setTimeout(r,1000));
  const out=await win.webContents.executeJavaScript(`(() => {
    const V=window.__view, log=[];
    const dom=V.contentDOM;
    const doc=()=>V.state.doc.toString();
    const setDoc=(d,p)=>V.dispatch({changes:{from:0,to:V.state.doc.length,insert:d},selection:{anchor:p}});

    // ★ 真实 IME 场景：候选框阶段，文档里【还没有文字】
    setDoc('- 列表项', 4);
    dom.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'zhong'}));
    log.push('★ 候选框阶段（未上屏）: view.composing='+V.composing+' inputState.composing='+V.inputState.composing);

    // 用户按 Enter 选词
    const ev=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,isComposing:true,keyCode:229});
    dom.dispatchEvent(ev);
    log.push('  Enter defaultPrevented='+ev.defaultPrevented+'  (true=被吞了 ✗ / false=放行 ✓)');
    log.push('  文档='+JSON.stringify(doc()));
    dom.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'}));

    // 对照：普通段落里的同样操作
    setDoc('普通文字', 4);
    dom.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'zhong'}));
    const ev2=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,isComposing:true,keyCode:229});
    dom.dispatchEvent(ev2);
    log.push('  普通段落 Enter defaultPrevented='+ev2.defaultPrevented);
    log.push('  文档='+JSON.stringify(doc()));
    dom.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'}));
    return log.join('\\n');
  })()`);
  console.log(out);
  setTimeout(()=>app.exit(0),100);
});
