// "プレイリスト共有" page: wires the ZIP export / import (share.mjs) to the page and to the device storage.
// It only reads the current library, and adds a NEW playlist on import. It never touches playback.
import {encodeAssets} from './storage.mjs?v=146';
import {writeLibrary} from './repository.mjs?v=146';
import {buildBundle,importBundle} from './share.mjs?v=146';

const idb=(db,mode,fn)=>new Promise((resolve,reject)=>{
 const tx=db.transaction('assets',mode);let value;
 tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('保存が中断しました'));
 try{fn(tx.objectStore('assets'),v=>{value=v;});}catch(e){try{tx.abort();}catch{}reject(e);}
});
const fmtBytes=n=>n>=1e9?(n/1e9).toFixed(2)+' GB':n>=1e6?(n/1e6).toFixed(1)+' MB':Math.max(1,Math.round(n/1e3))+' KB';

export function initShare(ctx){
 const {$,report}=ctx;
 let working=false,last=null;
 const setBar=(bar,f)=>{bar.hidden=false;bar.value=Math.max(0,Math.min(1,f));};
 const lockUI=on=>{working=on;for(const id of ['shareExport','shareList','shareSave','shareFile'])$(id).disabled=on;$('shareDrop').classList.toggle('busy',on);};
 function render(){
  const lib=ctx.getLibrary(),picker=$('shareList'),old=picker.value;picker.replaceChildren();
  for(const l of lib.lists){const o=document.createElement('option');o.value=l.id;o.textContent=l.name+'（'+l.entries.length+'曲）';picker.append(o);}
  picker.value=lib.lists.some(l=>l.id===old)?old:(lib.activeId??'');
  $('shareExport').disabled=working||!lib.lists.length;
  $('shareInfo').textContent=lib.lists.length?'':'書き出せるプレイリストがありません。';
 }
 function download(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.rel='noopener';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);
 }
 async function deliver(res){
  const file=new File([res.blob],res.fileName,{type:'application/zip'});
  if(ctx.isIOS&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]})){
   try{await navigator.share({files:[file],title:res.fileName});return 'shared';}catch(e){if(e&&e.name==='AbortError')return 'cancelled';}
  }
  download(res.blob,res.fileName);return 'downloaded';
 }
 async function exportZip(){
  if(working)return;const lib=ctx.getLibrary(),list=lib.lists.find(l=>l.id===$('shareList').value);if(!list){report('書き出すプレイリストを選んでください。',true);return;}
  lockUI(true);last=null;$('shareSave').hidden=true;$('shareExportStatus').textContent='準備しています…';setBar($('shareExportBar'),0);
  try{
   const res=await buildBundle(list,id=>ctx.assetBlob(id),{appVersion:ctx.appVersion,onProgress:(f,m)=>{setBar($('shareExportBar'),f);$('shareExportStatus').textContent=m||'';}});
   last=res;setBar($('shareExportBar'),1);
   const info=res.fileName+'（'+res.trackCount+'曲 / '+fmtBytes(res.blob.size)+'）';
   $('shareSave').textContent=ctx.isIOS?'保存・共有する（AirDropなど）':'もう一度保存する';$('shareSave').hidden=false;
   if(ctx.isIOS){$('shareExportStatus').textContent='作成しました：'+info+'。下のボタンから保存・共有してください。';report('ZIPを作成しました。「保存・共有する」から、AirDropや「ファイル」へ送れます。');}
   else{const how=await deliver(res);$('shareExportStatus').textContent='書き出しました：'+info+(how==='downloaded'?'（ダウンロードフォルダを確認してください）':'');report('ZIPを書き出しました。');}
  }catch(e){$('shareExportBar').hidden=true;$('shareExportStatus').textContent='書き出せませんでした：'+e.message;report('ZIPの書き出しに失敗しました：'+e.message,true);}
  finally{lockUI(false);render();}
 }
 async function importZip(file){
  if(working||!file)return;
  if(!/\.zip$/i.test(file.name||'')&&!/zip/i.test(file.type||'')){$('shareImportStatus').textContent='ZIPファイルを選んでください。';report('ZIPファイルを選んでください。',true);return;}
  const db=ctx.getDb();if(!db){report('端末保存が使えません。サイトデータの設定を確認してください。',true);return;}
  lockUI(true);$('shareImportStatus').textContent='読み込んでいます…';setBar($('shareImportBar'),0);
  let ran=false;
  await ctx.exclusive(async()=>{
   ran=true;try{
    const io={
     hasAsset:id=>idb(db,'readonly',(s,set)=>{const r=s.getKey(id);r.onsuccess=()=>set(r.result!==undefined);}),
     putAsset:async(id,blob)=>{const [[,rec]]=await encodeAssets([[id,blob]]);await idb(db,'readwrite',s=>{s.put(rec,id);});},
     deleteAsset:id=>idb(db,'readwrite',s=>{s.delete(id);}),
     commit:async draft=>{const next=structuredClone(ctx.getLibrary());next.lists.push(draft);next.activeId=draft.id;await writeLibrary(db,next);ctx.setLibrary(next);}
    };
    const res=await importBundle(file,io,{onProgress:(f,m)=>{setBar($('shareImportBar'),f);$('shareImportStatus').textContent=m||'';}});
    await ctx.activateList(res.list.id);
    navigator.storage?.persist?.().catch(()=>{});
    $('shareImportStatus').textContent='「'+res.list.name+'」を新しいプレイリストとして追加しました（'+res.trackCount+'曲）。本番画面で使えます。';
    report('プレイリスト「'+res.list.name+'」を読み込みました（'+res.trackCount+'曲）。既存のプレイリストはそのままです。');
   }catch(e){
    $('shareImportBar').hidden=true;$('shareImportStatus').textContent='読み込めませんでした：'+e.message+'（既存のプレイリストは変更していません）';
    report('ZIPを読み込めませんでした：'+e.message,true);
   }
  },{saveFirst:false});
  if(!ran){$('shareImportBar').hidden=true;$('shareImportStatus').textContent='いまは読み込めません。再生を止めて、少し待ってからもう一度お試しください。';}
  lockUI(false);render();
 }
 // events
 $('shareExport').addEventListener('click',()=>void exportZip());
 $('shareSave').addEventListener('click',async()=>{if(last)await deliver(last);});
 $('shareFile').addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';if(f)void importZip(f);});
 const zone=$('share'),hasFiles=e=>[...(e.dataTransfer?.types||[])].includes('Files')||(e.dataTransfer?.files?.length>0);
 for(const t of ['dragenter','dragover'])zone.addEventListener(t,e=>{if(!hasFiles(e))return;e.preventDefault();e.stopPropagation();$('shareDrop').classList.add('drop-active');});
 zone.addEventListener('dragleave',e=>{if(!zone.contains(e.relatedTarget))$('shareDrop').classList.remove('drop-active');});
 zone.addEventListener('drop',e=>{if(!hasFiles(e))return;e.preventDefault();e.stopPropagation();$('shareDrop').classList.remove('drop-active');const files=[...e.dataTransfer.files];if(files.length!==1){report('ZIPファイルを1つだけドロップしてください。',true);return;}void importZip(files[0]);});
 return {render};
}
