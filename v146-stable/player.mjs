import {chooseAudioMode} from './audio-mode.mjs?v=146';
import {BufferedTrack,createDecodedStore} from './buffer-engine.mjs?v=146';
import {Transport} from './transport.mjs?v=146';
import {loadLibrary,readStore,writeLibrary} from './repository.mjs?v=146';
import {cleanEntry,validateList,digest} from './transfer.mjs?v=146';
import {initShare} from './share-ui.mjs?v=146';
const ICON_PLAY='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z"/></svg>';
const ICON_PAUSE='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/></svg>';
const ICON_GRIP='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
const ICON_UP='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6 11.5l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_DOWN='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v13M6 12.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// Which option of a two-option switch was tapped (-1 when not a pointer tap, e.g. keyboard: then the switch just toggles).
function segIndex(e,button){const o=e&&e.target&&typeof e.target.closest==='function'?e.target.closest('.opt'):null;if(o)return [...button.children].indexOf(o);if(e&&e.detail>0&&typeof e.clientX==='number'&&typeof button.getBoundingClientRect==='function'){const r=button.getBoundingClientRect();return e.clientX<r.left+r.width/2?0:1;}return -1;}
const ICON_CHEVRON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const openCards=new Set();
function seg(button,labels,active){button.classList.add('seg');button.replaceChildren(...labels.map((label,i)=>{const o=document.createElement('button');o.type='button';o.setAttribute('aria-pressed',String(i===active));o.className=i===active?'opt on':'opt';o.textContent=label;return o;}));}
// Play through the iPhone speaker/headphones even when the silent (ring/silent) switch is on: Web Audio is otherwise muted by it.
function usePlaybackAudioSession(){try{if(typeof navigator!=='undefined'&&navigator.audioSession&&navigator.audioSession.type!=='playback')navigator.audioSession.type='playback';}catch{}}
usePlaybackAudioSession();
// iPhone/iPad detection (used for iOS-only touch tweaks such as the share sheet).
const isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent||'')||(navigator.platform==='MacIntel'&&(navigator.maxTouchPoints||0)>1);
if(isIOS)document.documentElement?.classList?.add('ios');
const audioMode=chooseAudioMode({search:window.location?.search,userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints,vendor:navigator.vendor});
const useBufferedAudio=audioMode.engine==='buffer';
// Mac (non-iPhone) buffer engine: the song is played from the decoded buffer only, so do not also load the whole file into the <audio> element (double decoding/memory, and its load/seek waits stalled the controls).
const elementHoldsSong=!(useBufferedAudio&&!isIOS);
const $=id=>document.getElementById(id),audio=$('audio'),receiver=$('receiver');
let receiverReady=false,preparing=false,preparationSource=false,receiverSource,receiverGain;
let ctx,gain,outputGate,mediaSource,db,swReady=false,stored=false,busy=true,generation=0,cancelPlay=null,playAttempt=0;
let library={schemaVersion:2,activeId:null,lists:[]},entries=[],assets=new Map(),pendingAssets=new Map(),objectURLs=[];
const events=[];let sequence=0;window.__showPlayerEvents=events;
const stateNames={empty:'音源なし',stopped:'停止',starting:'再生準備中',playing:'再生中',paused:'一時停止',fadingIn:'フェードイン',fadingOut:'フェードアウト',waiting:'無音待機',ended:'曲終了',error:'再生エラー'};
const running=s=>['playing','paused','fadingIn','fadingOut','waiting','starting'].includes(s);
const editable=()=>!busy&&(!running(player.state)||(!$('edit').hidden&&['paused','waiting'].includes(player.state)));
function report(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);log('案内',message);}
function log(route,label,details={}){events.push({seq:++sequence,time:new Date().toISOString(),route,label,details});if(events.length>500)events.shift();const box=$('log');if(!box)return;box.replaceChildren();for(const e of events.slice(-40).reverse()){const row=document.createElement('div');row.textContent='#'+e.seq+' '+new Date(e.time).toLocaleTimeString('ja-JP')+' ['+e.route+'] '+e.label;box.append(row);}}
let currentGain=1;
// 診断パネル（Ctrl+Shift+D で表示/非表示）。通常は何も表示しない。反応が遅い時に、どこで時間がかかったかを見るため。
if(!isIOS){let last=performance.now();setInterval(()=>{const n=performance.now(),lag=n-last-250;last=n;if(lag>150)log('遅延','画面処理が止まっていた',{ms:Math.round(lag),visible:document.visibilityState});},250);}
function diagText(){const head='SHOW PLAYER 動作記録 版'+((document.querySelector?.('script[src*="player.mjs"]')?.getAttribute('src')||'').match(/v=(\d+)/)?.[1]||'?')+' '+new Date().toISOString()+'\nUA: '+navigator.userAgent+'\nengine: '+audioMode.engine+'('+audioMode.reason+') ctx: '+(ctx?ctx.state+' sr='+ctx.sampleRate+' base='+ctx.baseLatency+' out='+ctx.outputLatency:'未作成')+' state: '+player.state+' 曲数: '+entries.length+'\n';return head+events.slice(-300).map(e=>'#'+e.seq+' '+e.time.slice(11,23)+' ['+e.route+'] '+e.label+' '+(Object.keys(e.details||{}).length?JSON.stringify(e.details):'')).join('\n');}
// PC（iPhone以外）は動作記録を常に取り、右下の「記録」からコピーできる（反応が遅い・押せない時の原因調べ用）。
let diagBox=null,lastLoggedState=null,lastStateAt=performance.now();
function diagRefresh(){if(diagBox)diagBox.querySelector('pre').textContent=diagText().split('\n').slice(0,3).join('\n')+'\n…（下の「コピー」で全部コピーされます）\n'+events.slice(-25).map(e=>e.time.slice(14,23)+' ['+e.route+'] '+e.label).join('\n');}
async function diagCopy(btn){const text=diagText();try{await navigator.clipboard.writeText(text);btn.textContent='コピーしました';}catch{const t=document.createElement('textarea');t.value=text;t.style.cssText='position:fixed;left:-9999px';document.body.append(t);t.select();let ok=false;try{ok=document.execCommand('copy');}catch{}t.remove();btn.textContent=ok?'コピーしました':'コピー失敗';}setTimeout(()=>{btn.textContent='全部コピー';},2000);}
if(!isIOS&&document.body){
 const wrap=document.createElement('div');wrap.id='diagWrap';wrap.style.cssText='position:fixed;right:6px;bottom:6px;z-index:99999;font:11px/1.4 ui-monospace,monospace;color:#202e3a;text-align:right';
 const toggle=document.createElement('button');toggle.type='button';toggle.id='diagToggle';toggle.textContent='記録';toggle.style.cssText='padding:2px 8px;font-size:11px;border:1px solid #9aa;border-radius:6px;background:#fff;color:#202e3a;opacity:.75';
 const panel=document.createElement('div');panel.hidden=true;panel.style.cssText='background:#fff;border:1px solid #9aa;border-radius:8px;padding:6px;margin-bottom:4px;width:min(560px,92vw);max-height:40vh;overflow:auto;text-align:left';
 const copy=document.createElement('button');copy.type='button';copy.textContent='全部コピー';const clear=document.createElement('button');clear.type='button';clear.textContent='クリア';const pre=document.createElement('pre');pre.style.cssText='white-space:pre-wrap;margin:6px 0 0';
 for(const b of [copy,clear])b.style.cssText='padding:2px 8px;font-size:11px;margin-right:6px';
 panel.append(copy,clear,pre);wrap.append(panel,toggle);document.body.append(wrap);diagBox=panel;
 toggle.addEventListener('click',()=>{panel.hidden=!panel.hidden;if(!panel.hidden)diagRefresh();});copy.addEventListener('click',()=>diagCopy(copy));clear.addEventListener('click',()=>{events.length=0;diagRefresh();});
 setInterval(()=>{if(!panel.hidden)diagRefresh();toggle.textContent='記録 '+sequence;},1000);
 // 押したボタンを全て記録（無効だった・処理中だった場合も分かる）
 document.addEventListener('pointerdown',e=>{if(wrap.contains(e.target))return;const b=e.target?.closest?.('button,[role=button],input,select,summary');if(!b)return;log('操作',(b.id||b.className||b.tagName)+' 「'+(b.textContent||b.value||'').trim().slice(0,16)+'」',{disabled:!!b.disabled,busy,preparing,state:player.state});},{capture:true,passive:true});
 document.addEventListener('keydown',e=>{if(wrap.contains(e.target)||['Shift','Control','Alt','Meta'].includes(e.key))return;log('キー',e.key,{state:player.state});},{capture:true,passive:true});
 window.addEventListener('error',e=>log('JSエラー',e.message||'error',{line:e.lineno}));window.addEventListener('unhandledrejection',e=>log('JS未処理エラー',String(e.reason?.message||e.reason)));
}
function graph(){if(ctx)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('このブラウザでは音量フェードが利用できません');usePlaybackAudioSession();ctx=new AC();gain=ctx.createGain();mediaSource=ctx.createMediaElementSource(audio);mediaSource.connect(gain);outputGate=ctx.createGain();outputGate.gain.value=0;gain.gain.value=currentGain;gain.connect(outputGate);outputGate.connect(ctx.destination);receiverSource=ctx.createMediaElementSource(receiver);receiverGain=ctx.createGain();receiverGain.gain.value=0;receiverSource.connect(receiverGain);receiverGain.connect(ctx.destination);ctx.addEventListener('statechange',()=>{log('AudioContext',ctx.state,{sampleRate:ctx.sampleRate,outputLatency:ctx.outputLatency,player:player.state,receiverPaused:receiver.paused,receiverReady,mediaSession:navigator.mediaSession?.playbackState,focus:document.hasFocus(),visible:document.visibilityState});if(ctx.state!=='running'&&['playing','fadingIn','fadingOut'].includes(player.state)){if(isIOS){report('音声処理が中断されました。画面の一時停止→再生で復帰を確認してください。',true);log('AudioContext',ctx.state);}else setTimeout(()=>{if(ctx&&ctx.state!=='running'&&['playing','fadingIn','fadingOut'].includes(player.state)&&Date.now()-lastOsAction>2500)void recoverContext();},1200);}else if(ctx.state==='running'&&!isIOS)reassertNowPlaying();});}
// Mac only: when macOS/Safari suspends the audio engine during playback (output device change, system interruption), the song goes silent while the screen still says "playing".
// Resume it automatically (the position and fades continue exactly, because they follow the audio clock). If the browser refuses, the next click anywhere retries.
// Keep this page the system's "Now Playing" target so the Bluetooth remote's keys reach it: the silent carrier keeps playing and the handlers stay registered.
function reassertNowPlaying(){try{if(receiverReady&&receiver.paused)void receiver.play().catch(e=>log('リモコン用音声','再開できません',{message:e.message}));registerMediaActions();metadata();log('リモコン','Now Playingを再設定',{receiverPaused:receiver.paused,ctx:ctx?.state,mediaSession:navigator.mediaSession?.playbackState});}catch(e){log('リモコン','再設定失敗',{message:e.message});}}
if(!isIOS)setInterval(()=>{if(receiverReady&&ctx&&ctx.state==='running'&&receiver.paused){log('リモコン用音声','停止していたため再開');reassertNowPlaying();}},3000);
let recovering=false;const recoverEpisode={n:0,last:0,warned:false};
const sleepMs=ms=>new Promise(r=>setTimeout(r,ms));
async function recoverContext(){
 if(recovering||!ctx)return;
 const now=Date.now();if(now-recoverEpisode.last>10000){recoverEpisode.n=0;recoverEpisode.warned=false;}recoverEpisode.last=now;recoverEpisode.n++;
 // Another app (e.g. Music) or a device change can keep interrupting the audio engine. Retry with growing pauses and give up after a few tries instead of fighting it (no endless flicker).
 if(recoverEpisode.n>5){if(!recoverEpisode.warned){recoverEpisode.warned=true;report('音声処理が何度も中断されます。ミュージック等の他のアプリが音声やリモコンを使っていないか、出力先を確認してください。',true);}log('自動復帰','頻繁な中断のため自動復帰を一時停止',{n:recoverEpisode.n});return;}
 recovering=true;
 try{
  if(recoverEpisode.n===1)report('音声処理が中断されました。自動で復帰しています…',true);
  if(recoverEpisode.n>1)await sleepMs(Math.min(3000,400*2**(recoverEpisode.n-2)));
  for(let i=0;i<6&&ctx.state!=='running'&&ctx.state!=='closed'&&['playing','fadingIn','fadingOut'].includes(player.state);i++){
   try{await ctx.resume();}catch(e){log('自動復帰','resume失敗',{message:e.message,try:i+1});}
   if(ctx.state==='running')break;await sleepMs(500);
  }
  if(ctx.state==='running'){if(recoverEpisode.n===1)report('音声処理が一時中断しましたが、自動で復帰しました。');}
  else if(['playing','fadingIn','fadingOut'].includes(player.state)&&!recoverEpisode.warned){recoverEpisode.warned=true;report('音声処理が中断したままです。画面のどこかをクリックするか、一時停止→再生を押してください。',true);}
  if(ctx.state==='running')reassertNowPlaying();
  log('自動復帰',ctx.state,{player:player.state,n:recoverEpisode.n});
 }finally{recovering=false;}
}
if(!isIOS){
 const retry=()=>{if(ctx&&ctx.state!=='running'&&ctx.state!=='closed'&&['playing','fadingIn','fadingOut'].includes(player.state)){log('自動復帰','操作をきっかけに再試行',{state:ctx.state});void recoverContext();}};
 document.addEventListener('pointerdown',retry,{capture:true,passive:true});document.addEventListener('keydown',retry,{capture:true,passive:true});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')retry();});window.addEventListener('focus',retry);
 try{navigator.mediaDevices?.addEventListener?.('devicechange',()=>log('出力先','音声デバイスが変わりました',{ctx:ctx?.state,sampleRate:ctx?.sampleRate}));}catch{}
}
async function timedAudio(promise,message,ms=15000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]);}finally{clearTimeout(timer);}}
const buffered=new BufferedTrack({context:()=>{graph();return ctx;},destination:()=>gain,asset:assetBlob,beforeStart:openOutput,log:(label,details)=>log('音声データ再生',label,details),keepPlayed:!isIOS,store:(!isIOS&&typeof indexedDB!=='undefined')?createDecodedStore():null,offlineContext:()=>new (window.OfflineAudioContext||window.webkitOfflineAudioContext)(2,1,44100),changed:()=>queueMicrotask(()=>{try{refreshMarks();}catch{}}),ended:()=>{player.queue=player.queue.then(()=>{if(useBufferedAudio&&buffered.ended)player.naturalEnd();});}});
// Mac (non-iPhone) only: while a song plays, decode the next/selected song in the background so a switch starts at once instead of waiting for decoding.
let warmTimer=null;
function warmNext(){
 if(!useBufferedAudio||isIOS||warmTimer||player.state==='starting'||player.state==='empty'||player.state==='error'||!entries.length)return;
 warmTimer=setTimeout(()=>{warmTimer=null;try{if(player.state==='starting')return;const keys=[];const add=t=>{if(t&&!t.missing&&t.preflight!=='error'&&!keys.includes(t.assetId))keys.push(t.assetId);};if(player.selectedIndex!==null)add(entries[player.selectedIndex]);for(let i=player.index+1;i<entries.length;i++)add(entries[i]);for(let i=player.index-1;i>=0;i--)add(entries[i]);buffered.warmMany(keys);}catch(e){log('先読み',e.message);}},1200);
}
// 読み込み状況（Macのみ）：全曲を順に読み込み、曲ごとの✓と全体の件数を出す。
let convertTimer=null;
function convertNext(){
 if(!useBufferedAudio||isIOS||convertTimer||!entries.length)return;
 convertTimer=setTimeout(()=>{convertTimer=null;try{const keys=[];for(let i=Math.max(0,player.index);i<entries.length;i++){const t=entries[i];if(t&&!t.missing&&t.preflight!=='error'&&!keys.includes(t.assetId))keys.push(t.assetId);}for(let i=0;i<player.index;i++){const t=entries[i];if(t&&!t.missing&&!keys.includes(t.assetId))keys.push(t.assetId);}buffered.convertMany(keys);}catch(e){log('変換',e.message);}},3000);
}
// 曲ごとのチェック：グレー＝準備中、緑＝準備完了（メモリに展開済みで、いつでもすぐ再生できる）。Macのみ。
const markState=t=>{if(!useBufferedAudio||!t)return '';if(t.missing||t.preflight==='error')return 'bad';
 // iPhone: only the current song is ever decoded (green). 保存済み(薄い青)＝端末の保存領域から実際に音源を読み込めている曲。判定できない曲は表示なし。音声処理は一切動かさない。
 if(isIOS)return (t===entries[player.index]&&buffered.isReady(t.assetId))?'ready':assets.has(t.assetId)?'stored':'';
 return buffered.isReady(t.assetId)?'ready':'pending';};
function applyMark(el,t){const st=markState(t);const text=st==='bad'?'✕':st?'✓':'';if(el.textContent!==text)el.textContent=text;const cls='ld'+(st?' '+st:'');if(el.className!==cls)el.className=cls;const label=st==='ready'?(isIOS?'現在の曲：展開済みで即時再生できます':'準備完了'):st==='pending'?'準備中':st==='stored'?'端末に保存済み':st==='bad'?'再生できません':'';if(el.title!==label){el.title=label;el.setAttribute('aria-label',label);}}
function refreshMarks(){const marks=document.querySelectorAll('#trackList .ld');if(marks.length===entries.length)entries.forEach((t,i)=>applyMark(marks[i],t));const ss=$('saveStatus');if(ss){setText(ss,headerText());ss.classList.toggle('all-ready',allReady());ss.classList.toggle('all-stored',allStored());}}
function allReady(){return useBufferedAudio&&!isIOS&&entries.length>0&&entries.every(t=>markState(t)==='ready');}
function loadSummary(){if(!useBufferedAudio||isIOS||!entries.length)return '';const ok=entries.filter(t=>markState(t)==='ready').length;return ok===entries.length?' · 全曲 準備完了 ✓':' · 準備 '+ok+'/'+entries.length;}
// iPhone: 「保存済み n/N」（Macの「準備完了」とは別の意味：端末に音源がある曲の数）。
const storedCount=()=>entries.filter(t=>!t.missing&&t.preflight!=='error'&&assets.has(t.assetId)).length;
function allStored(){return isIOS&&useBufferedAudio&&entries.length>0&&storedCount()===entries.length;}
function headerText(){if(isIOS&&useBufferedAudio&&entries.length)return (stored?'':'未保存 · ')+'保存済み '+storedCount()+'/'+entries.length;return (stored?'端末保存済み':'未保存')+loadSummary();}
const playbackPosition=()=>useBufferedAudio?buffered.position:audio.currentTime;
const playbackDuration=()=>useBufferedAudio?buffered.duration:audio.duration;
const playbackPaused=()=>useBufferedAudio?buffered.paused:audio.paused;
// One explicit gesture authorizes both media elements. The silent looping
// receiver keeps this page eligible for OS commands while the track is paused.
// This is a Safari compatibility experiment; real-device results are required.
async function prepareRemote(){
 if(preparing||busy||!entries.length||(!['stopped','ended','error','paused'].includes(player.state)||!!player.fade))return false;
 preparing=true;busy=true;render();let timer,failed=false;const position=playbackPosition(),level=currentGain,originalSource=audio.src;let restored=false;
 const restoreSource=async()=>{if(restored)return;generation++;audio.pause();preparationSource=false;if(!elementHoldsSong){audio.removeAttribute('src');audio.load();restored=true;return;}audio.src=originalSource;audio.load();await seekAudio(position);restored=true;};
 try{
  graph();closeOutput();io.gain(0);
  // Invoke all activation-sensitive APIs before the first await.
  // Never prime with show audio: zero-gain logs cannot prove zero audible
  // output through every Safari media route. The priming source is PCM silence.
  generation++;audio.pause();preparationSource=true;audio.src='receiver-silence.wav';audio.load();
  const attempt=++playAttempt;const resume=ctx.resume(),carrier=receiver.play(),prime=audio.play();
  for(const [promise,element]of [[carrier,receiver],[prime,audio]])Promise.resolve(promise).then(()=>{if(failed&&attempt===playAttempt)element.pause();},()=>{});
  const started=Promise.all([resume,carrier,prime]);
  await Promise.race([started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('準備が始まりません。出力先と音源を確認してください')),10000);})]);
  if(failed)throw Error('準備を中止しました');
  audio.pause();await restoreSource();if(useBufferedAudio){report('現在曲を再生用に準備しています…');await timedAudio(buffered.prepare(),'音声データの準備が完了しません。音源と出力先を確認してください',120000);}io.gain(level);
  if(ctx.state!=='running'||receiver.paused)throw Error('音声処理を準備できませんでした');
  receiverReady=true;metadata();report('GO準備完了。音はまだ鳴りません。中央で選択曲を開始できます。');
  log('GO','無音ファイルだけでリモコンを準備',{context:ctx.state,restoredPosition:audio.currentTime});return true;
 }catch(e){failed=true;audio.pause();receiver.pause();try{await restoreSource();}catch(restoreError){log('GO復帰エラー',restoreError.message);}io.gain(level);receiverReady=false;report('GO準備に失敗：'+e.message+'。Safariのこのサイトの自動再生設定も確認してください。',true);log('GOエラー',e.name,{message:e.message});return false;}
 finally{clearTimeout(timer);preparing=false;busy=false;render();}
}
$('go').addEventListener('click',()=>{void prepareRemote();});
$('releaseRemote').addEventListener('click',()=>{receiverReady=false;receiver.pause();void invoke('stop');render();report('リモコン準備を解除しました。再開時はGOを押してください。');});
receiver.addEventListener('pause',()=>{if(receiverReady){receiverReady=false;render();report('リモコン用の音声処理が停止しました。停止してGOを押し直してください。',true);}});
for(const event of ['play','pause','ended','error','stalled','waiting'])receiver.addEventListener(event,()=>log('リモコン用音声',event,{paused:receiver.paused,ctx:ctx?.state,receiverReady,mediaSession:navigator.mediaSession?.playbackState}));
for(const event of ['play','pause','ended','error'])audio.addEventListener(event,()=>log('音声イベント',event,{context:ctx?.state,paused:audio.paused,position:audio.currentTime,sourceRole:preparationSource?'silence':'show',fadeGain:currentGain,outputGain:outputGate?.gain.value,error:audio.error?.code}));
// Separate safety gate from per-track fade gain. No decoding, seek or GO
// priming may reach the output; opening has a short anti-click envelope.
function closeOutput(){if(!outputGate)return;const t=ctx.currentTime;outputGate.gain.cancelScheduledValues(t);outputGate.gain.value=0;outputGate.gain.setValueAtTime(0,t);}
function openOutput(scheduledAt){const t=ctx.currentTime;if(Number.isFinite(scheduledAt)){outputGate.gain.cancelScheduledValues(t);outputGate.gain.value=0;outputGate.gain.setValueAtTime(0,t);outputGate.gain.setValueAtTime(0,scheduledAt);outputGate.gain.linearRampToValueAtTime(1,scheduledAt+.006);log('出力ゲート','音声データと同時に開く',{position:playbackPosition(),scheduledAt});return;}outputGate.gain.cancelScheduledValues(t);outputGate.gain.value=0;outputGate.gain.setValueAtTime(0,t);outputGate.gain.setValueAtTime(0,t+.025);outputGate.gain.linearRampToValueAtTime(1,t+.040);log('出力ゲート','準備後に開く',{position:audio.currentTime,sourceRole:preparationSource?'silence':'show',fadeGain:currentGain,context:ctx.state});}
async function seekAudio(position){
 closeOutput();
 if(audio.readyState<1)await new Promise((resolve,reject)=>{
  let timer;const cleanup=()=>{clearTimeout(timer);audio.removeEventListener('loadedmetadata',ready);audio.removeEventListener('error',error);};
  const ready=()=>{cleanup();resolve();},error=()=>{cleanup();reject(Error('音源を読み込めません'));};
  audio.addEventListener('loadedmetadata',ready);audio.addEventListener('error',error);timer=setTimeout(()=>{cleanup();reject(Error('音源の読み込みが完了しません'));},8000);
 });
 const target=Math.max(0,Math.min(position,Number.isFinite(audio.duration)?Math.max(0,audio.duration-.001):position));
 if(Math.abs(audio.currentTime-target)<.0001)return;
 await new Promise((resolve,reject)=>{
  let timer;const cleanup=()=>{clearTimeout(timer);audio.removeEventListener('seeked',ready);audio.removeEventListener('error',error);};
  const ready=()=>{cleanup();resolve();},error=()=>{cleanup();reject(Error('再生位置を変更できません'));};
  audio.addEventListener('seeked',ready);audio.addEventListener('error',error);timer=setTimeout(()=>{cleanup();reject(Error('再生位置の変更が完了しません'));},8000);
  try{audio.currentTime=target;if(!audio.seeking)ready();}catch(e){cleanup();reject(e);}
 });
 log('位置変更','seek完了',{requested:position,actual:audio.currentTime});
}
const io={
 now:()=>ctx?.currentTime??performance.now()/1000,
 gain(value){currentGain=value;if(gain){gain.gain.cancelScheduledValues(ctx.currentTime);gain.gain.value=value;gain.gain.setValueAtTime(value,ctx.currentTime);}},
 ramp(value,seconds){gain.gain.linearRampToValueAtTime(value,ctx.currentTime+seconds);},
 load(t){generation++;closeOutput();audio.pause();if(useBufferedAudio)buffered.load(t);if(elementHoldsSong){audio.src=t.url;audio.load();}},
 pause(){closeOutput();if(useBufferedAudio)buffered.pause();if(cancelPlay){cancelPlay();cancelPlay=null;}audio.pause();},
 clear(){closeOutput();buffered.clear();audio.pause();audio.removeAttribute('src');audio.load();},
 seek:position=>useBufferedAudio?buffered.seek(position):seekAudio(position),
 async play(){graph();closeOutput();io.gain(currentGain);if(useBufferedAudio){try{await timedAudio(buffered.play(),'音声データの再生準備が完了しません',120000);return;}catch(e){buffered.pause();closeOutput();log('再生エラー',e.name,{message:e.message,engine:'buffer'});throw e;}}log('再生要求','audio.play',{context:ctx.state,receiverReady});const attempt=++playAttempt,g=generation;let aborted=false,timer;const resume=ctx.resume();const play=audio.play();const abort=new Promise((_,reject)=>{cancelPlay=()=>{aborted=true;reject(Error('再生準備を中止しました'));};timer=setTimeout(()=>{aborted=true;reject(Error('再生が始まりません。音源と出力先を確認してください'));},10000);});try{await Promise.race([Promise.all([resume,play]),abort]);if(ctx.state!=='running')throw Error('音声処理を開始できません。画面から再生し直してください');openOutput();}catch(e){closeOutput();log('再生エラー',e.name,{message:e.message,position:audio.currentTime});throw e;}finally{clearTimeout(timer);cancelPlay=null;if(aborted){closeOutput();audio.pause();play.then(()=>{if(attempt===playAttempt&&g===generation)audio.pause();},()=>{});}}}
};
const player=new Transport(io,render,message=>report(message));
function metadata(){if(!navigator.mediaSession)return;try{navigator.mediaSession.metadata=entries[player.index]?new MediaMetadata({title:entries[player.index].name,artist:'SHOW PLAYER'}):null;navigator.mediaSession.playbackState=['playing','fadingIn','fadingOut'].includes(player.state)?'playing':player.state==='empty'?'none':'paused';}catch(e){log('OS状態',e.message);}}
function format(t){if(!Number.isFinite(t))return '—:—';return Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');}
function fadeDescription(t){return (t.switchMode==='autoAfterFade'?'クロス':'手動')+(t.fullPlay?' · 完パケ':'')+(t.repeat?' · 繰り返し':'')+' · 開始 '+(t.inMode==='fade'?t.inSeconds+'秒':'カット')+' / 終了 '+(t.outMode==='fade'?t.outSeconds+'秒':'カット');}
// フェード状況の行：render()と100msタイマーの両方がこの関数を使う（片方が説明文に書き戻してチカチカするのを防ぐ）。
function fadeStatusText(){if(player.fade&&player.state!=='paused'){const left=Math.max(0,player.fade.seconds-(io.now()-player.fade.start)).toFixed(1);const left2=isIOS?left:left.padStart(4,'\u2007');return (player.fade.kind==='in'?'フェードイン':'フェードアウト')+' · 残り '+left2+'秒';}const t=entries[player.index];return t?fadeDescription(t):'曲ごとの開始・終了方法を設定できます。';}
function setText(el,text){if(el.textContent!==text)el.textContent=text;}
function render(){if(player.state!==lastLoggedState){const n=performance.now();log('状態',(lastLoggedState??'—')+' → '+player.state,{afterMs:Math.round(n-lastStateAt),index:player.index+1});lastLoggedState=player.state;lastStateAt=n;if(!isIOS&&['starting','playing','fadingIn'].includes(player.state)&&Date.now()-lastReassert>2000){lastReassert=Date.now();try{reassertNowPlaying();}catch{}}}renderPreparation();const selected=entries[player.selectedIndex];$('selectionPanel').hidden=!selected;$('selectedTitle').textContent=selected?.name??'';$('activateSelected').disabled=busy||preparing||!selected;$('cancelSelected').disabled=busy||preparing;$('releaseRemote').disabled=preparing;$('go').disabled=busy||!entries.length||(!['stopped','ended','error','paused'].includes(player.state)||!!player.fade);$('go').textContent=receiverReady?'GO · 準備済み':'GO · 音を出さずに準備';$('remoteStatus').textContent=receiverReady?'リモコン準備済み · 実機で中央・左右を確認してください':'この画面を開くたび、最初にGOをクリックしてください';const t=entries[player.index];$('number').textContent=String(t?player.index+1:0).padStart(2,'0')+' / '+String(entries.length).padStart(2,'0');$('state').textContent=stateNames[player.state];$('title').textContent=t?.name??'音源を選んでください';$('nextTitle').textContent=(selected?'次に開始（準備中）：':'次の曲：')+(selected?.name??entries[player.index+1]?.name??'—（末尾）');{const nxt=selected||entries[player.index+1];$('nextMeta').textContent=nxt?fadeDescription(nxt):'';}$('central').innerHTML=['playing','fadingIn','fadingOut','starting'].includes(player.state)?ICON_PAUSE:ICON_PLAY;$('state').dataset.state=player.state;$('live').dataset.state=player.state;$('go').dataset.ready=String(!!receiverReady);$('nextHint').textContent=player.state==='waiting'||player.state==='ended'?'右：次曲を開始':player.state==='fadingOut'?'右：今すぐ次曲を開始':player.state==='stopped'?'右：選択曲を開始':t?.switchMode==='autoAfterFade'?'右：音を消して次曲へ自動切替':'右：音を消して待機';setText($('fadeStatus'),fadeStatusText());$('saveStatus').textContent=headerText();$('saveStatus').classList.toggle('all-ready',allReady());$('saveStatus').classList.toggle('all-stored',allStored());$('editorSaveStatus').textContent=stored?'✓ 設定保存済み · '+new Date(currentList()?.updatedAt??Date.now()).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'未保存の変更があります';$('editorSaveStatus').classList.toggle('ready',stored);$('save').textContent=busy?'保存処理中…':stored?'設定を保存する（保存済み）':'設定を保存する';for(const id of ['central','next','previous'])$(id).disabled=!entries.length||busy||entries.some(t=>t.missing||t.preflight==='error');if($('demo'))$('demo').disabled=!editable();$('audioCheck').disabled=!editable()||!entries.length;$('files').disabled=!editable();$('save').disabled=!editable();metadata();renderTracks();offlineBanner();renderLibraryControls();warmNext();convertNext();}
function renderTracks(){
 const box=$('trackList');box.replaceChildren();
 if(!entries.length){const p=document.createElement('p');p.className='small muted';p.textContent='「曲・フェード設定」から音源を追加できます。';box.append(p);}
 entries.forEach((t,i)=>{
  const row=document.createElement('button');row.type='button';row.className='track track-select'+(i===player.index?' current':'');row.disabled=busy||preparing||!!t.missing||t.preflight==='error';row.setAttribute('aria-label',String(i+1)+'曲目 '+t.name+'を選択（再生しません）');
  const num=document.createElement('span');num.className='num';num.textContent=String(i+1).padStart(2,'0');
  const text=document.createElement('span'),name=document.createElement('span'),settings=document.createElement('small');text.className='track-info';name.className='name';name.textContent=t.name;settings.textContent=fadeDescription(t)+(t.missing?' / 音源不在':'');text.append(name,settings);
  const hint=document.createElement('span');hint.className='select-hint';hint.textContent=i===player.selectedIndex?'準備中':i===player.index?'現在曲':(i===player.index+1&&player.selectedIndex===null)?'次の曲':'準備';row.classList.toggle('queued',i===player.selectedIndex);row.classList.toggle('next-up',i===player.index+1&&player.selectedIndex===null);{if(useBufferedAudio){const ld=document.createElement('span');applyMark(ld,t);row.append(num,text,ld,hint);}else row.append(num,text,hint);}
  row.addEventListener('click',async()=>{if(busy||preparing)return;await invoke('select','曲選択',i);if(player.selectedIndex===i)report('「'+t.name+'」を次に開始する曲へ準備しました。現在の音はそのまま続きます。');});box.append(row);
 });
}

function renderPreparation(){
 const sourceOK=entries.length>0&&entries.every(t=>!t.missing&&t.preflight==='metadata');
 const states=[['prepSaved',stored&&sourceOK,'音源・設定保存'],['prepOffline',swReady,'画面のオフライン保存'],['prepRemote',receiverReady&&ctx?.state==='running','GO準備']];
 for(const [id,ok,label]of states){$(id).textContent=(ok?'✓ ':'○ ')+label;$(id).classList.toggle('ready',!!ok);}
}
function offlineBanner(){renderPreparation();const ready=swReady&&stored&&entries.length>0&&entries.every(t=>!t.missing&&t.preflight==='metadata');$('offlineStatus').classList.toggle('ready',ready);$('offlineStatus').textContent=ready?'✓ オフライン準備OK · 音源と設定は端末保存済み':!swReady?'画面をオフライン用に保存中（最初はネット接続が必要）':!entries.length?'✓ 画面保存済み · 次に音源を追加してください':entries.some(t=>t.missing)?'音源が見つかりません。再取り込みしてください':entries.some(t=>t.preflight!=='metadata')?'画面保存済み · 未確認の音源があります。「音源チェック」で確認してください':'画面保存済み · 音源・設定の保存を確認してください';}
// 読み込み中（曲の準備に時間がかかっている間）の曲送り・再生/一時停止の重ね押しは、完了後にまとめて実行されて曲が飛ぶのを防ぐため保留せず無視して知らせる（Macのみ）。
function loadingTooLong(){return useBufferedAudio&&!isIOS&&player.state==='starting'&&lastLoggedState==='starting'&&performance.now()-lastStateAt>800;}
function invoke(action,route='画面',value){if((action==='stop'||action==='edit')&&loadingTooLong()){log(route,'読み込み待ちを中止',{action});buffered.cancelPending();}if(['next','previous','toggle','play','pause','activateSelection'].includes(action)&&loadingTooLong()){log(route,'読み込み中のため操作を無視',{action});report('曲を読み込み中です。読み込みが終わってから操作してください。');return Promise.resolve();}if(preparing){log(route,'GO準備中の操作',{action});return Promise.resolve();}if(action!=='stop'&&(!$('edit').hidden||!$('share').hidden)){report('設定中です。本番画面に戻ってから再生してください。');return Promise.resolve();}if(action!=='stop'&&entries.some(t=>t.missing||t.preflight==='error')){report('音源が不足、または再生不可です。音源を確認してください。',true);return Promise.resolve();}log(route,action,{state:player.state,index:player.index+1,value});return player.dispatch(action,value);}
for(const [id,action]of [['central','toggle'],['next','next'],['previous','previous'],['stop','stop']])$(id).addEventListener('click',()=>invoke(action));
$('activateSelected').addEventListener('click',()=>invoke('activateSelection','選択曲の開始'));$('cancelSelected').addEventListener('click',()=>invoke('clearSelection','選択解除'));
let lastOsAction=0,lastReassert=0;
function registerMediaActions(){if(navigator.mediaSession){for(const [action,command]of [['nexttrack','next'],['previoustrack','previous'],['play','toggle'],['pause','toggle'],['stop','stop']]){try{navigator.mediaSession.setActionHandler(action,()=>{lastOsAction=Date.now();log('OS入力',action,{state:player.state,context:ctx?.state,receiverReady,trackPaused:playbackPaused(),position:playbackPosition(),engine:useBufferedAudio?'buffer':'media',receiverPaused:receiver.paused});return invoke(command,'リモコン／OS');});}catch(e){log('API',action+'登録不可',{error:e.message});}}}}
registerMediaActions();
audio.addEventListener('ended',()=>{if(useBufferedAudio)return;const g=generation;player.queue=player.queue.then(()=>{if(g===generation&&audio.ended)player.naturalEnd();});});
audio.addEventListener('error',()=>{if(preparing||!entries.length)return;const g=generation;player.queue=player.queue.then(()=>{if(g!==generation||!audio.error)return;player.cancelFade();io.pause();io.gain(0);player.state='error';if(entries[player.index])entries[player.index].preflight='error';stored=false;report('この音源を再生できません。ファイル形式や取り込みを確認してください。',true);log('音源エラー','再生不可',{code:audio.error.code});player.notify();});});
let seekDragging=false;
function paintSeek(){const el=$('seek');const max=Number(el.max);el.style.setProperty('--p',(max>0?Math.min(100,Number(el.value)/max*100):0)+'%');}
function updateSeek(){const slider=$('seek');const duration=playbackDuration();const allowed=!busy&&!preparing&&Number.isFinite(duration)&&duration>0&&['stopped','playing','paused','ended'].includes(player.state)&&!player.fade;
 slider.disabled=!allowed;slider.max=Number.isFinite(duration)?duration:0;slider.setAttribute('aria-valuetext',format(Number(slider.value))+' / '+format(duration));if(!seekDragging)slider.value=playbackPosition()||0;paintSeek();
 $('seekHint').textContent=allowed?'ドラッグ／タップで再生位置を変更（離すと反映）':'フェード中・無音待機中は位置変更できません';}
$('seek').addEventListener('input',()=>{seekDragging=true;paintSeek();$('position').textContent=format(Number($('seek').value));});
$('seek').addEventListener('change',()=>{const target=Number($('seek').value);seekDragging=false;void invoke('seek','シークバー',target);});
setInterval(()=>{player.tick();updateSeek();if(!seekDragging)$('position').textContent=format(playbackPosition());$('duration').textContent=format(playbackDuration());$('progressBar').style.width=(Number.isFinite(playbackDuration())&&playbackDuration()>0?Math.min(100,playbackPosition()/playbackDuration()*100):0)+'%';if(player.fade&&player.state!=='paused')setText($('fadeStatus'),fadeStatusText());},100);
function switchTab(edit){if(edit&&['playing','fadingIn','fadingOut','starting'].includes(player.state)){report('停止ボタンで止めてから、設定を開いてください。');return;}$('live').hidden=edit;$('edit').hidden=!edit;$('share').hidden=true;$('shareTab').classList.remove('selected');$('liveTab').classList.toggle('selected',!edit);$('editTab').classList.toggle('selected',edit);if(edit)renderEditor();}
$('testUnsaved').addEventListener('click',()=>{if(!editable()||!validSettings())return;switchTab(false);render();report(stored?'本番画面へ戻りました。':'未保存のままテストします。ページを閉じると変更を失う可能性があります。オフライン準備は未完了です。',!stored);});
$('liveTab').addEventListener('click',()=>{if(!$('share').hidden){switchTab(false);render();return;}if($('edit').hidden)return;void exclusive(async()=>{await persist();switchTab(false);},{saveFirst:false});});$('editTab').addEventListener('click',async()=>{if(busy||preparing)return;if(loadingTooLong()){log('画面','読み込み待ちを中止',{action:'edit'});buffered.cancelPending();}await player.dispatch('edit');switchTab(true);render();report('音を止めて設定画面を開きました。曲と位置を保持します。フェード途中の処理は終了します。');});$('back').addEventListener('click',()=>exclusive(async()=>{if(!validSettings())return;await persist();switchTab(false);},{saveFirst:false}));
function validSettings(){for(const t of entries)for(const d of ['in','out'])if(t[d+'Mode']==='fade'&&(!Number.isFinite(t[d+'Seconds'])||t[d+'Seconds']<=0)){report('「'+t.name+'」の'+(d==='in'?'開始':'終了')+'フェード秒数を入力してください。',true);return false;}return true;}
function serialEntries(){return entries.map(cleanEntry);}
function currentList(){return library.lists.find(x=>x.id===library.activeId);}
function snapshot(){const list=currentList();if(!list)throw Error('セットリストを選択してください');return {...list,name:$('listName').value.trim(),entries:serialEntries()};}
async function persist(){
 if(!db)throw Error('端末保存が使えません。サイトデータ設定を確認してください');
 const list=snapshot();validateList(list);list.revision++;list.updatedAt=new Date().toISOString();
 const next=structuredClone(library);next.lists[next.lists.findIndex(x=>x.id===list.id)]=list;
 await writeLibrary(db,next,[...pendingAssets]);library=next;pendingAssets.clear();stored=true;
 render();log('保存','端末保存完了',{tracks:entries.length,list:list.name,revision:list.revision});navigator.storage?.persist?.().catch(()=>{});
}
function moveEntry(from,to){
 if(!editable()||$('edit').hidden||!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=entries.length||to>=entries.length||from===to)return;
 const currentId=entries[player.index]?.id,selectedId=entries[player.selectedIndex]?.id;
 const [entry]=entries.splice(from,1);entries.splice(to,0,entry);
 player.tracks=entries;player.index=Math.max(0,entries.findIndex(t=>t.id===currentId));player.selectedIndex=selectedId?entries.findIndex(t=>t.id===selectedId):null;player.headArmed=false;
 stored=false;player.notify();renderEditor();$('orderStatus').textContent='「'+entry.name+'」を'+(to+1)+'曲目へ移動しました。保存すると次回もこの順番になります。';log('並べ替え','曲順変更',{id:entry.id,from:from+1,to:to+1});
}
function renderOrderList(){
 const list=$('orderList');list.replaceChildren();
 if(!entries.length){$('orderStatus').textContent='音源を追加すると曲順を変更できます。';return;}
 entries.forEach((track,index)=>{
  const row=document.createElement('div');row.className='order-row';
  const handle=document.createElement('button');handle.type='button';handle.className='order-handle';handle.innerHTML=ICON_GRIP;handle.setAttribute('aria-label',track.name+'をドラッグして並べ替え');handle.disabled=!editable();
  const name=document.createElement('span');name.className='order-name';name.textContent=String(index+1).padStart(2,'0')+' · '+track.name;row.append(handle,name);
  for(const [text,delta]of [['↑',-1],['↓',1]]){const button=document.createElement('button');button.type='button';button.className='order-step';button.innerHTML=delta<0?ICON_UP:ICON_DOWN;button.disabled=!editable()||index+delta<0||index+delta>=entries.length;button.setAttribute('aria-label',track.name+'を'+(delta<0?'上':'下')+'へ移動');button.addEventListener('click',()=>moveEntry(index,index+delta));row.append(button);}
  let drag;
  const locate=y=>{const rows=[...list.children];let target=rows.length-1;for(let i=0;i<rows.length;i++){const rect=rows[i].getBoundingClientRect();if(y<rect.bottom){target=i;break;}}drag.to=target;rows.forEach((r,i)=>r.classList.toggle('order-target',i===target));};
  const scroll=()=>{if(!drag)return;if(!editable()||$('edit').hidden){finish({pointerId:drag.pointer},false);return;}if(drag.y<90)window.scrollBy(0,-12);else if(drag.y>window.innerHeight-90)window.scrollBy(0,12);locate(drag.y);drag.frame=requestAnimationFrame(scroll);};
  handle.addEventListener('pointerdown',e=>{if(!editable()||e.button!==0)return;e.preventDefault();drag={pointer:e.pointerId,from:index,to:index,y:e.clientY};handle.setPointerCapture(e.pointerId);row.classList.add('order-dragging');drag.frame=requestAnimationFrame(scroll);});
  handle.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.pointer)return;e.preventDefault();drag.y=e.clientY;locate(drag.y);});
  const finish=(e,commit)=>{if(!drag||e.pointerId!==drag.pointer)return;const saved=drag;drag=null;cancelAnimationFrame(saved.frame);row.classList.remove('order-dragging');[...list.children].forEach(r=>r.classList.remove('order-target'));if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);if(commit)moveEntry(saved.from,saved.to);};
  handle.addEventListener('pointerup',e=>finish(e,true));handle.addEventListener('pointercancel',e=>finish(e,false));handle.addEventListener('lostpointercapture',e=>finish(e,false));list.append(row);
 });
}
function renderEditor(){renderOrderList();renderReusePicker();const box=$('editList');box.replaceChildren();if(entries.length&&!entries.some(t=>openCards.has(t.id)))openCards.add((entries[player.index]||entries[0]).id);entries.forEach((t,i)=>{const card=document.createElement('div');card.className='edit-card';card.classList.toggle('collapsed',!openCards.has(t.id));const name=document.createElement('h3');name.textContent=String(i+1).padStart(2,'0');const cardHeader=document.createElement('div');cardHeader.className='edit-card-header';const titleInput=document.createElement('input');titleInput.className='track-name-input';titleInput.value=t.name;titleInput.setAttribute('aria-label','曲名');titleInput.addEventListener('input',()=>{t.name=titleInput.value;stored=false;render();});const chev=document.createElement('button');chev.type='button';chev.className='card-toggle';chev.setAttribute('aria-label',t.name+'の設定を開く／閉じる');chev.setAttribute('aria-expanded',String(openCards.has(t.id)));chev.innerHTML=ICON_CHEVRON;chev.addEventListener('click',()=>{const closed=!card.classList.contains('collapsed');card.classList.toggle('collapsed',closed);if(closed)openCards.delete(t.id);else openCards.add(t.id);chev.setAttribute('aria-expanded',String(!closed));});cardHeader.append(name,titleInput,chev);card.append(cardHeader);for(const direction of ['in','out']){const row=document.createElement('div');row.className='fade-row';const label=document.createElement('div');label.className='row-label';label.textContent=direction==='in'?'開始方法':'終了方法';const mode=document.createElement('div');mode.setAttribute('role','group');mode.className='mode-toggle';const updateMode=()=>{const fade=t[direction+'Mode']==='fade';seg(mode,['カット','フェード'],fade?1:0);mode.classList.toggle('active',fade);mode.setAttribute('aria-pressed',String(fade));mode.setAttribute('aria-label',(direction==='in'?'開始':'終了')+'方法：'+(fade?'フェード':'カット')+'。タップして切り替え');};updateMode();label.append(mode);row.append(label);const seconds=document.createElement('div');seconds.className='seconds';seconds.hidden=t[direction+'Mode']!=='fade';const slider=document.createElement('input');slider.type='range';slider.min='0.1';slider.max=String(Math.max(10,t[direction+'Seconds']||0));slider.step='0.1';slider.value=String(t[direction+'Seconds']||.1);slider.setAttribute('aria-label',(direction==='in'?'開始':'終了')+'フェード秒数');const num=document.createElement('input');num.type='number';num.min='0.1';num.step='any';num.placeholder='秒数';num.value=t[direction+'Seconds']??'';num.setAttribute('aria-label','フェード秒数を入力');const unit=document.createElement('span');unit.textContent='秒';seconds.append(slider,num,unit);row.append(seconds);const changed=()=>{stored=false;render();};mode.addEventListener('click',e=>{const cur=t[direction+'Mode']==='fade'?1:0,tapped=segIndex(e,mode),next=tapped<0?1-cur:tapped;if(next===cur)return;t[direction+'Mode']=next?'fade':'cut';seconds.hidden=t[direction+'Mode']!=='fade';updateMode();changed();});slider.addEventListener('input',()=>{t[direction+'Seconds']=Number(slider.value);num.value=slider.value;changed();});num.addEventListener('input',()=>{const v=num.value===''?null:Number(num.value);t[direction+'Seconds']=v;if(v>0&&Number.isFinite(v)){slider.max=String(Math.max(10,v));slider.value=String(v);}changed();});card.append(row);}const switchRow=document.createElement('div');switchRow.className='switch-row';const switchLabel=document.createElement('div');switchLabel.className='row-label';switchLabel.textContent='曲送り';const switchButton=document.createElement('div');switchButton.setAttribute('role','group');switchButton.className='mode-toggle';const switchHelp=document.createElement('p');switchHelp.className='small muted';const updateSwitch=()=>{const automatic=t.switchMode==='autoAfterFade';seg(switchButton,['手動','クロス'],automatic?1:0);switchButton.classList.toggle('active',automatic);switchButton.setAttribute('aria-pressed',String(automatic));switchButton.setAttribute('aria-label','曲送り：'+(automatic?'クロス':'手動')+'。タップして切り替え');switchHelp.textContent=automatic?'右1回：終了後、次曲を開始。終了・開始の秒数を使います。':'右1回：音を消して待機。もう1回：次曲を開始。';};updateSwitch();switchButton.addEventListener('click',e=>{const cur=t.switchMode==='autoAfterFade'?1:0,tapped=segIndex(e,switchButton),next=tapped<0?1-cur:tapped;if(next===cur)return;t.switchMode=next?'autoAfterFade':'manualTwoStep';updateSwitch();stored=false;render();});switchLabel.append(switchButton);switchRow.append(switchLabel);card.append(switchRow);const fullRow=document.createElement('div');fullRow.className='switch-row pair-row';const fullLabel=document.createElement('label');fullLabel.textContent='流し切ったら';const fullButton=document.createElement('button');fullButton.type='button';fullButton.className='mode-toggle';fullButton.textContent='完パケ';const repeatButton=document.createElement('button');repeatButton.type='button';repeatButton.className='mode-toggle';repeatButton.textContent='繰り返し';const fullHelp=document.createElement('p');fullHelp.className='small muted';const updateFull=()=>{const full=t.fullPlay===true,again=t.repeat===true;fullButton.classList.toggle('active',full);fullButton.setAttribute('aria-pressed',String(full));fullButton.setAttribute('aria-label','完パケ：'+(full?'ON':'OFF')+'。タップして切り替え');repeatButton.classList.toggle('active',again);repeatButton.setAttribute('aria-pressed',String(again));repeatButton.setAttribute('aria-label','繰り返し：'+(again?'ON':'OFF')+'。タップして切り替え');fullHelp.textContent=full?'完パケ：最後まで流して、そのまま次曲へ。次曲は、次曲の開始方法（カット／フェード）で始まります。途中で右を押したときは、この曲の終了方法に従います。':again?'繰り返し：最後まで流したら、この曲を頭から流し直します。頭は、この曲の開始方法（カット／フェード）で始まります。右を押すと、この曲の終了方法に従って次曲へ進みます。':'どちらもOFF：曲が最後まで終わったら止まります。右を押すまで次曲は鳴りません。';};updateFull();fullButton.addEventListener('click',()=>{t.fullPlay=t.fullPlay!==true;if(t.fullPlay)t.repeat=false;updateFull();stored=false;render();});repeatButton.addEventListener('click',()=>{t.repeat=t.repeat!==true;if(t.repeat)t.fullPlay=false;updateFull();stored=false;render();});fullLabel.append(fullButton,repeatButton);fullRow.append(fullLabel);card.append(fullRow);const controls=document.createElement('div');controls.className='edit-actions';for(const [text,op]of [['この曲を削除',0]]){const b=document.createElement('button');b.textContent=text;b.disabled=op===-1&&i===0||op===1&&i===entries.length-1;b.addEventListener('click',()=>{if(!editable())return;if(op!==0){moveEntry(i,i+op);return;}entries.splice(i,1);stored=false;player.setTracks(entries);renderEditor();});controls.append(b);}card.append(controls);box.append(card);});}
$('save').addEventListener('click',()=>exclusive(async()=>{if(!validSettings())return;await persist();report('設定と音源を端末に保存しました。');},{saveFirst:false}));
function entry(id,name,url){return {id:crypto.randomUUID(),assetId:id,name,url,inMode:'cut',outMode:'cut',inSeconds:null,outSeconds:null,switchMode:'autoAfterFade',fullPlay:false,repeat:false};}
async function probe(file){return new Promise(resolve=>{const media=new Audio(),url=URL.createObjectURL(file);let timer;const finish=(status,duration=null)=>{clearTimeout(timer);media.removeAttribute('src');media.load();URL.revokeObjectURL(url);resolve({status,duration});};media.onloadedmetadata=()=>{media.onloadedmetadata=null;media.onerror=null;finish('metadata',Number.isFinite(media.duration)?media.duration:null);};media.onerror=()=>{media.onloadedmetadata=null;media.onerror=null;finish('error');};timer=setTimeout(()=>{media.onloadedmetadata=null;media.onerror=null;finish('unverified');},8000);media.preload='metadata';media.src=url;});}
async function importAudioFiles(incoming){
 if(!editable()||$('edit').hidden){report('音源の取り込みは「曲・フェード設定」画面で行ってください。現在の音は止めません。');return;}
 const files=[...incoming].filter(f=>f.type?.startsWith('audio/')||/\.(mp3|wav|m4a|aac|aif|aiff|flac|ogg|opus)$/i.test(f.name));
 if(!files.length){report('音源ファイルを選んでください。フォルダは開いて中の音源を選択してください。',true);return;}
 if(files.length<incoming.length)log('取り込み','音源以外のファイルを除外',{excluded:incoming.length-files.length});
 busy=true;render();player.queue=player.queue.catch(e=>log('復帰',e.message)).then(async()=>{try{await player.command('stop');$('importStatus').textContent='音源を確認して保存しています…';const added=[];for(const file of files){const check=await probe(file);if(check.status==='error'){log('取り込み','再生不可：'+file.name);continue;}const hash=await digest(file);assets.set(hash,file);pendingAssets.set(hash,file);const url=URL.createObjectURL(file);objectURLs.push(url);added.push({...entry(hash,file.name.replace(/\.[^.]+$/,''),url),duration:check.duration,preflight:check.status});}entries.push(...added);stored=false;player.setTracks(entries);await persist();$('importStatus').textContent=added.length+'曲を端末に保存しました'+(added.length<files.length?'（再生不可のファイルを除外）':'');report('取り込み完了。フェード方法と秒数を設定できます。');}catch(e){stored=false;report('取り込み・保存に失敗しました：'+e.message,true);}finally{busy=false;render();renderEditor();}});await player.queue;
}
$('files').addEventListener('change',async e=>{const files=[...e.target.files];e.target.value='';if(files.length)await importAudioFiles(files);});
const dropZone=$('audioDropZone');
const hasFiles=e=>[...(e.dataTransfer?.types||[])].includes('Files')||(e.dataTransfer?.files?.length>0);
for(const type of ['dragenter','dragover'])dropZone.addEventListener(type,e=>{if(!hasFiles(e))return;e.preventDefault();e.stopPropagation();dropZone.classList.toggle('drop-active',editable()&&!$('edit').hidden);if(e.dataTransfer)e.dataTransfer.dropEffect=editable()?'copy':'none';});
dropZone.addEventListener('dragleave',e=>{if(!dropZone.contains(e.relatedTarget))dropZone.classList.remove('drop-active');});
dropZone.addEventListener('drop',e=>{if(!hasFiles(e))return;e.preventDefault();e.stopPropagation();dropZone.classList.remove('drop-active');void importAudioFiles([...e.dataTransfer.files]);});
// Prevent dropping files outside the editor from navigating away mid-show.
document.addEventListener('dragover',e=>{if(hasFiles(e))e.preventDefault();});
document.addEventListener('drop',e=>{if(hasFiles(e)&&!dropZone.contains(e.target)){e.preventDefault();report('音源は「曲・フェード設定」の取り込み枠へドロップしてください。');}});

$('demo')?.addEventListener('click',async()=>{if(!editable())return;busy=true;render();player.queue=player.queue.catch(e=>log('復帰',e.message)).then(async()=>{try{await player.command('stop');if(entries.length&&!confirm('選択中の曲をデモ2曲へ置き換えますか？ 他のセットリストは変わりません。'))return;entries=[];for(const [id,name]of [['demo-a','DEMO A · 低い音'],['demo-b','DEMO B · 高い音']]){const blob=await assetBlob(id),hash=await digest(blob),url=URL.createObjectURL(blob);assets.set(hash,blob);pendingAssets.set(hash,blob);objectURLs.push(url);entries.push({...entry(hash,name,url),duration:30,preflight:'metadata'});}player.setTracks(entries);await persist();report('デモ2曲を用意しました。曲・フェード設定で秒数を指定してください。');}catch(e){report('デモを保存できません：'+e.message,true);}finally{busy=false;render();}});await player.queue;});
async function assetBlob(id){if(assets.has(id))return assets.get(id);let blob;
 if(id==='demo-a'||id==='demo-b'){const response=await fetch(id+'.wav');if(!response.ok)throw Error('デモ音源を読み込めません');blob=await response.blob();}
 else blob=await readStore(db,'assets',id);
 if(blob)assets.set(id,blob);return blob;
}
async function activateList(id){
 const list=library.lists.find(x=>x.id===id);if(!list)throw Error('セットリストがありません');
 io.pause();player.setTracks([]);for(const url of objectURLs)URL.revokeObjectURL(url);objectURLs=[];entries=[];
 for(const t of list.entries){const blob=await assetBlob(t.assetId);const url=blob?URL.createObjectURL(blob):'';if(url)objectURLs.push(url);entries.push({...t,url,missing:!blob});}
 library.activeId=id;$('listName').value=list.name;player.setTracks(entries);stored=true;renderEditor();render();
}
async function pruneDecodedCache(){try{if(!useBufferedAudio||isIOS)return;const st=buffered.store;if(!st)return;const used=new Set();for(const l of library.lists)for(const t of l.entries)used.add(t.assetId);if(!used.size)return;for(const k of await st.keys())if(!used.has(k)){await st.remove(k);buffered.stored.delete(k);log('変換キャッシュ','不要な変換データを削除',{key:k});}}catch(e){log('変換キャッシュ',e.message);}}
async function restore(){try{const restored=await loadLibrary();db=restored.db;library=restored.library;if(library.lists.length)await activateList(library.activeId);void pruneDecodedCache();report(restored.migrated?'以前の音源と設定を残して、新しい保存形式へ移行しました。':'保存済みセットリストを読み込みました。');}catch(e){report('保存データを読み込めません。データを消去せず停止しています：'+e.message,true);render();}}

async function offlineSetup(){
 if(!('serviceWorker'in navigator)){report('オフライン保存が使えません。Safariで開いてください。',true);return;}
 const check=()=>{const worker=navigator.serviceWorker.controller;if(!worker)return;const channel=new MessageChannel();channel.port1.onmessage=e=>{swReady=e.data.ready&&e.data.version==='show-player-archive-v146';offlineBanner();channel.port1.close();};worker.postMessage('OFFLINE_STATUS',[channel.port2]);};
 navigator.serviceWorker.addEventListener('controllerchange',check);check();
 try{await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});await navigator.serviceWorker.ready;check();}
 catch(e){if(navigator.serviceWorker.controller){check();log('オフライン','既存の保存画面を使用');}else{report('画面のオフライン保存に失敗しました。ネット接続時に開き直してください。',true);log('オフライン',e.message);}}
}
window.addEventListener('offline',()=>{log('接続','オフライン');offlineBanner();});window.addEventListener('online',()=>{log('接続','オンライン');offlineBanner();});document.addEventListener('visibilitychange',()=>log('画面',document.visibilityState));
function renderLibraryControls(){
 const picker=$('listPicker');const old=picker.value;picker.replaceChildren();for(const list of library.lists){const o=document.createElement('option');o.value=list.id;o.textContent=list.name;picker.append(o);}picker.value=library.activeId??old;
 const list=currentList();$('listVersion').textContent=list?'更新 '+new Date(list.updatedAt).toLocaleString('ja-JP')+' · 版 '+list.revision:'セットリストを作成してください';
 for(const id of ['newList','duplicateList','deleteList','listPicker'])$(id).disabled=!editable()||!db||(id!=='newList'&&!list);
}
async function exclusive(work,{saveFirst=true}={}){
 if(!editable()||!db)return;busy=true;render();
 player.queue=player.queue.catch(e=>log('復帰',e.message)).then(async()=>{try{if($('edit').hidden)await player.command('stop');else await player.command('edit');if(saveFirst&&!stored&&currentList())await persist();await work();}catch(e){stored=false;report(e.message,true);}finally{busy=false;render();}});
 await player.queue;
}
$('listName').addEventListener('input',()=>{stored=false;render();});
$('listPicker').addEventListener('change',e=>{const id=e.target.value;void exclusive(async()=>{const next=structuredClone(library);next.activeId=id;await writeLibrary(db,next);library=next;await activateList(id);report('セットリストを切り替えました。');});});
$('newList').addEventListener('click',()=>exclusive(async()=>{const name=prompt('新しいセットリスト名','セットリスト '+(library.lists.length+1));if(name===null)return;if(!name.trim())throw Error('名前を入力してください');const list={id:crypto.randomUUID(),name:name.trim(),revision:1,updatedAt:new Date().toISOString(),entries:[]};const next=structuredClone(library);next.lists.push(list);next.activeId=list.id;await writeLibrary(db,next);library=next;await activateList(list.id);switchTab(true);report('セットリストを作成しました。音源を追加できます。');}));
$('duplicateList').addEventListener('click',()=>exclusive(async()=>{const list=structuredClone(currentList());list.id=crypto.randomUUID();list.name+='（コピー）';list.revision=1;list.updatedAt=new Date().toISOString();list.entries=list.entries.map(t=>({...t,id:crypto.randomUUID()}));const next=structuredClone(library);next.lists.push(list);next.activeId=list.id;await writeLibrary(db,next);library=next;await activateList(list.id);report('音源を再利用して、セットリストを複製しました。');}));
$('deleteList').addEventListener('click',()=>exclusive(async()=>{if(!confirm('「'+currentList().name+'」を削除しますか？ 音源は他のセットリストで再利用できるよう残します。'))return;const next=structuredClone(library);next.lists=next.lists.filter(l=>l.id!==next.activeId);next.activeId=next.lists[0]?.id??null;await writeLibrary(db,next);library=next;if(next.activeId)await activateList(next.activeId);else{entries=[];player.setTracks(entries);stored=true;$('listName').value='';renderEditor();}report('セットリストを削除しました。');},{saveFirst:false}));
function renderReusePicker(){const map=new Map();for(const l of library.lists)for(const t of l.entries)if(!map.has(t.assetId))map.set(t.assetId,t.name);const picker=$('reusePicker');picker.replaceChildren();const first=document.createElement('option');first.value='';first.textContent='保存済み音源を選ぶ';picker.append(first);for(const [id,name]of map){const o=document.createElement('option');o.value=id;o.textContent=name;picker.append(o);}}
$('reuseAdd').addEventListener('click',()=>{const id=$('reusePicker').value,name=$('reusePicker').selectedOptions[0]?.textContent;if(!id)return;void exclusive(async()=>{const blob=await assetBlob(id);if(!blob)throw Error('保存済み音源が見つかりません');const check=await probe(blob);if(check.status==='error')throw Error('この端末では音源を再生できません');const url=URL.createObjectURL(blob);objectURLs.push(url);entries.push({...entry(id,name,url),duration:check.duration,preflight:check.status});stored=false;player.setTracks(entries);await persist();renderEditor();report('保存済み音源を追加しました。');});});
$('audioCheck').addEventListener('click',()=>exclusive(async()=>{report('保存済み音源を確認しています…');let bad=0;for(const t of entries){const blob=await assetBlob(t.assetId);if(!blob){t.missing=true;t.preflight='error';bad++;continue;}const check=await probe(blob);t.missing=false;t.preflight=check.status;if(check.duration)t.duration=check.duration;if(check.status!=='metadata')bad++;}stored=false;await persist();report(bad?'確認できない音源が'+bad+'曲あります。再取り込みか、実際の再生で確認してください。':'全曲の音源読み込みを確認しました。実際の出力とリモコンは再生して確認してください。',bad>0);},{saveFirst:false}));
// プレイリスト共有（ZIP書き出し/読み込み）。再生処理には触れず、独立したページとして追加。
const share=initShare({$,report,getLibrary:()=>library,setLibrary:v=>{library=v;},getDb:()=>db,assetBlob,activateList,exclusive,isIOS,appVersion:'1.1.0'});
function openShare(){$('live').hidden=true;$('edit').hidden=true;$('share').hidden=false;$('liveTab').classList.remove('selected');$('editTab').classList.remove('selected');$('shareTab').classList.add('selected');share.render();render();}
$('shareTab').addEventListener('click',()=>{if(busy||preparing||!$('share').hidden)return;if(!$('edit').hidden){void exclusive(async()=>{if(!validSettings())return;await persist();openShare();},{saveFirst:false});return;}if(running(player.state)){report('再生を止めてから「プレイリスト共有」を開いてください。');return;}openShare();});
// セットリスト管理メニュー（歯車）：スマホでは新規・複製・削除を普段は隠して画面を空ける。PCでは常時表示（CSS）。
const closeListMenu=()=>{$('sideList').classList.remove('menu-open');$('listMenu').setAttribute('aria-expanded','false');};
$('listMenu').addEventListener('click',()=>{const open=!$('sideList').classList.contains('menu-open');$('sideList').classList.toggle('menu-open',open);$('listMenu').setAttribute('aria-expanded',String(open));});
document.addEventListener('click',e=>{if(!$('sideList').contains(e.target))closeListMenu();});
$('sideList').addEventListener('click',e=>{if(e.target?.closest?.('.library-actions button'))closeListMenu();});
$('engineNote').hidden=!useBufferedAudio;render();await restore();busy=false;render();void offlineSetup();
