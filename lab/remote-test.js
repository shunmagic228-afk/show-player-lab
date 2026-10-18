'use strict';
const $=id=>document.getElementById(id);
const audio=$('audio');
const session=navigator.mediaSession;
const counts={next:0,prev:0,center:0};
const records=[];
const registrations={};
let active=false,seq=0,fileURL=null,source='内蔵テスト音';
const labels={nexttrack:'次曲（右）',previoustrack:'前曲（左）',play:'再生（中央）',pause:'一時停止（中央）',stop:'停止',seekforward:'早送り',seekbackward:'巻き戻し',seekto:'再生位置変更'};
function log(route,label,details={}){
 records.push({sequence:++seq,time:new Date().toISOString(),monotonic_ms:performance.now(),route,label,details,visibility:document.visibilityState});
 if(records.length>500)records.shift();
 renderLog();
}
function renderLog(){
 const box=$('log');box.replaceChildren();
 for(const r of records.slice(-60).reverse()){
  const row=document.createElement('div');row.className='log-row';
  row.textContent='#'+r.sequence+' '+new Date(r.time).toLocaleTimeString('ja-JP')+' ['+r.route+'] '+r.label;
  box.append(row);
 }
 if(!records.length)box.textContent='まだ入力はありません。';
}
function renderCounts(){
 for(const key of Object.keys(counts)){
  $(key+'Count').textContent=counts[key];
  $(key+'Status').textContent=counts[key]?'受信あり':'未受信';
  $(key+'Card').classList.toggle('received',counts[key]>0);
 }
}
function playbackState(){
 $('state').textContent=audio.paused?'一時停止':'再生中';
 if(session){try{session.playbackState=audio.paused?'paused':'playing';}catch(e){log('状態','再生状態の登録失敗',{error:e.message});}}
}
async function playAudio(){
 try{await audio.play();playbackState();return true;}
 catch(e){log('エラー','再生できません',{error:e.message});$('notice').textContent='再生できませんでした。開始ボタンをもう一度押すか、自分の音源を選んでください。';return false;}
}
function handleRemote(action,details){
 if(!active)return;
 const key=action==='nexttrack'?'next':action==='previoustrack'?'prev':(action==='play'||action==='pause')?'center':null;
 if(key)counts[key]++;
 log('OSメディア',labels[action]||action,{action,...details});
 renderCounts();
 $('latest').textContent=labels[action]||action;
 $('latestTime').textContent=new Date().toLocaleTimeString('ja-JP')+' · OSから受信';
 if(action==='play')void playAudio();
 if(action==='pause')audio.pause();
 if(action==='stop'){audio.pause();audio.currentTime=0;}
 // Next/previous/seek only report delivery; do not implement a show transport.
}
function registerHandlers(){
 if(!session){$('support').textContent='Media Session API：このブラウザでは利用できません。';log('状態','Media Session APIなし');return;}
 for(const action of Object.keys(labels)){
  try{session.setActionHandler(action,details=>handleRemote(action,details));registrations[action]=true;}
  catch(e){registrations[action]=false;log('API','登録不可：'+action,{error:e.message});}
 }
 if(typeof MediaMetadata!=='undefined'){
  session.metadata=new MediaMetadata({title:'SHOW PLAYER リモコン受信テスト',artist:'診断用サウンド'});
 }
 $('support').textContent='API登録：'+Object.entries(registrations).map(([a,ok])=>a+' '+(ok?'可':'不可')).join(' / ')+'。登録可は実機受信済みを意味しません。';
}
$('start').addEventListener('click',async()=>{
 $('start').disabled=true;active=true;registerHandlers();log('画面操作','テスト開始',{source});
 const ok=await playAudio();
 $('start').disabled=false;
 if(ok){$('start').hidden=true;$('finish').hidden=false;$('notice').textContent='テスト中。右 → 左 → 中央をリモコンで押してください。';}
 else{endSession();$('state').textContent='再生失敗';}
});
function endSession(){
 active=false;audio.pause();
 if(session){
  for(const action of Object.keys(labels)){try{session.setActionHandler(action,null);}catch{}}
  try{session.playbackState='none';session.metadata=null;}catch{}
 }
 $('start').hidden=false;$('finish').hidden=true;$('state').textContent='停止中';
}
$('finish').addEventListener('click',()=>{endSession();log('画面操作','テスト終了');$('notice').textContent='終了しました。結果を共有できます。';});
$('file').addEventListener('change',e=>{
 const f=e.target.files[0];if(!f)return;
 endSession();if(fileURL)URL.revokeObjectURL(fileURL);
 fileURL=URL.createObjectURL(f);audio.src=fileURL;source='ユーザー選択音源';
 $('audioTitle').textContent=f.name;
 $('notice').textContent='音源を選びました。開始ボタンを押してください。';
 log('画面操作','音源選択',{size:f.size,type:f.type});
});
for(const name of ['play','pause','ended','error']){
 audio.addEventListener(name,()=>{
  log('音声状態',name,{position:audio.currentTime,error:audio.error?.code??null});
  if(active&&name!=='error')playbackState();
  if(name==='error')$('notice').textContent='音源を再生できません。別の音源でも試してください。';
 });
}
document.addEventListener('visibilitychange',()=>log('画面状態',document.visibilityState));
document.addEventListener('keydown',e=>{
 if(!active||!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','MediaTrackNext','MediaTrackPrevious','MediaPlayPause'].includes(e.key))return;
 log('キーボード入力',e.key,{repeat:e.repeat,code:e.code});
 $('latest').textContent='キー：'+e.key;
 $('latestTime').textContent='OSメディア受信数とは別に記録';
});
document.querySelectorAll('input[name="volume"]').forEach(el=>el.addEventListener('change',()=>log('手動確認','音量：'+el.value)));
function payload(){return {version:'iphone-web-0.1',userAgent:navigator.userAgent,source,counts:{...counts},volume:document.querySelector('input[name="volume"]:checked').value,registrations:{...registrations},records:[...records],note:'OS commands do not identify the physical remote. Max 500 log entries. No raw HID or system volume key capture.'};}
function summary(){
 const p=payload();
 return ['SHOW PLAYER iPhone受信テスト','右 / 次曲：'+p.counts.next+'件','左 / 前曲：'+p.counts.prev+'件','中央 / 再生・一時停止：'+p.counts.center+'件','上下の音量（手動確認）：'+p.volume,'音源：'+source,'環境：'+p.userAgent,'※OSコマンドの受信結果。リモコンだけを押して確認。','',...records.slice(-20).map(r=>'#'+r.sequence+' ['+r.route+'] '+r.label)].join('\n');
}
function revealSummary(){const el=$('summary');el.value=summary();el.hidden=false;el.focus();el.select();}
$('copy').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(summary());$('exportNotice').textContent='結果をコピーしました。このチャットへ貼り付けてください。';}
 catch{revealSummary();$('exportNotice').textContent='下の結果欄を長押ししてコピーしてください。';}
});
$('share').addEventListener('click',async()=>{
 if(!navigator.share){revealSummary();$('exportNotice').textContent='結果欄をコピーして送ってください。';return;}
 try{await navigator.share({title:'SHOW PLAYER受信結果',text:summary()});}
 catch(e){if(e.name!=='AbortError'){revealSummary();$('exportNotice').textContent='共有できませんでした。結果欄をコピーしてください。';}}
});
$('download').addEventListener('click',async()=>{
 const blob=new Blob([JSON.stringify(payload(),null,2)],{type:'application/json'});
 const file=new File([blob],'SHOW_PLAYER_iPhone_test.json',{type:'application/json'});
 if(navigator.canShare?.({files:[file]})){
  try{await navigator.share({files:[file],title:'SHOW PLAYERログ'});return;}catch(e){if(e.name==='AbortError')return;}
 }
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 $('exportNotice').textContent='ログの保存を開始しました。Safariのダウンロードを確認してください。';
});
$('clear').addEventListener('click',()=>{
 records.length=0;seq=0;for(const k of Object.keys(counts))counts[k]=0;
 renderCounts();renderLog();$('latest').textContent='入力を待っています';$('latestTime').textContent='ログと受信数を消去しました';
 $('summary').hidden=true;$('exportNotice').textContent='';
});
$('support').textContent=session?'Media Session APIあり。開始時に各コマンドの登録を試します。':'Media Session APIなし。Safariで開き直してください。';
log('状態','ページ準備完了・実機未検証');
