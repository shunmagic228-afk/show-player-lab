// Pure transport state machine. Browser audio adapter is injected for testing.
export class Transport {
 constructor(io,changed=()=>{},report=()=>{}){this.io=io;this.changed=changed;this.report=report;this.tracks=[];this.index=0;this.state='empty';this.fade=null;this.pausedMode=null;this.level=1;this.headArmed=false;this.editStart=false;this.selectedIndex=null;this.autoEpoch=0;this.queue=Promise.resolve();}
 notify(){this.changed(this);}
 dispatch(action,value){if(['next','stop','previous','edit','activateSelection'].includes(action))this.cancelAuto();this.queue=this.queue.then(()=>this.command(action,value)).catch(e=>{if(e&&e.cancelled){this.io.pause();this.fade=null;this.level=1;this.io.gain(1);this.pausedMode=null;this.headArmed=false;this.state=this.tracks.length?'stopped':'empty';this.notify();return;}this.io.pause();this.fade=null;this.level=0;this.io.gain(0);this.state='error';this.report('操作できません：'+e.message);this.notify();});return this.queue;}
 cancelAuto(){this.autoEpoch++;}
 finishOutgoing(){const automatic=this.tracks[this.index]?.switchMode==='autoAfterFade';this.wait();if(!automatic)return;const ticket=++this.autoEpoch,index=this.index;this.dispatch('autoAdvance',{ticket,index});}
 setTracks(tracks){this.cancelAuto();if(!['empty','stopped','ended','error','paused','waiting'].includes(this.state))throw Error('停止してから音源を変更してください');this.io.pause();this.editStart=false;this.selectedIndex=null;this.fade=null;this.tracks=tracks;this.index=0;this.headArmed=false;this.state=tracks.length?'stopped':'empty';if(tracks.length)this.io.load(tracks[0]);else this.io.clear?.();this.level=1;this.io.gain(1);this.notify();}
 config(direction){const t=this.tracks[this.index];const mode=t[direction+'Mode'];const seconds=t[direction+'Seconds'];if(mode==='fade'&&(!Number.isFinite(seconds)||seconds<=0))throw Error('フェード秒数を設定してください');return mode==='fade'?seconds:0;}
 value(){if(!this.fade||this.state==='paused')return this.level;const f=this.fade;const p=Math.min(1,Math.max(0,(this.io.now()-f.start)/f.seconds));return f.from+(f.to-f.from)*p;}
 cancelFade(){this.level=this.value();this.io.gain(this.level);this.fade=null;}
 ramp(from,to,seconds,kind){this.level=from;this.io.gain(from);if(seconds===0){this.level=to;this.io.gain(to);if(kind==='out')this.finishOutgoing();else this.state='playing';return;}this.fade={from,to,seconds,start:this.io.now(),kind};this.state=kind==='in'?'fadingIn':'fadingOut';this.io.ramp(to,seconds);}
 async start(fresh){const applyStart=fresh||this.editStart;if(applyStart){this.level=this.config('in')>0?0:1;this.io.gain(this.level);if(fresh)await this.io.seek(0);this.editStart=false;}this.io.gain(this.level);this.state='starting';this.notify();await this.io.play();if(applyStart)this.ramp(this.level,1,this.config('in'),'in');else this.state='playing';}
 wait(){this.io.pause();this.fade=null;this.level=0;this.io.gain(0);this.state='waiting';}
 async next(){this.headArmed=false;
  if(this.state==='fadingOut'||(this.state==='paused'&&this.pausedMode==='fadingOut')){this.cancelFade();this.wait();await this.advance();return;}
  if(this.state==='paused'&&this.pausedMode==='fadingIn'){this.cancelFade();this.wait();return;}
  if(this.state==='fadingIn'){this.cancelFade();this.level=1;this.io.gain(1);this.ramp(1,0,this.config('out'),'out');return;}
  if(this.state==='waiting'||this.state==='ended'){await this.advance();return;}
  if(this.state==='playing'){this.ramp(this.level,0,this.config('out'),'out');return;}
  if(this.state==='paused'){this.wait();return;}
  if(this.state==='stopped'){if(this.selectedIndex!==null)await this.activateSelection();else await this.start(true);return;}
 }
 async advance(){if(this.selectedIndex!==null){await this.activateSelection();return;}if(this.index+1>=this.tracks.length){this.wait();this.report('セットリスト末尾です。次曲はありません。');return;}this.index++;this.io.load(this.tracks[this.index]);await this.start(true);}
 async central(){this.headArmed=false;
  if(['playing','fadingIn','fadingOut'].includes(this.state)){
   this.pausedMode=this.state;
   const f=this.fade;if(f){const remain=Math.max(0,f.seconds-(this.io.now()-f.start));this.level=this.value();this.io.gain(this.level);this.fade={...f,from:this.level,seconds:remain,start:this.io.now()};}
   this.io.pause();this.state='paused';return;
  }
  if(this.state==='paused'){
   const f=this.fade;await this.start(false);
   if(f){this.fade=null;this.ramp(this.level,f.to,f.seconds,f.kind);}return;
  }
  if(this.state==='waiting'){this.report('無音待機中です。右で次曲を開始します。');return;}
  if(['stopped','ended','error'].includes(this.state)){if(this.selectedIndex!==null)await this.activateSelection();else await this.start(true);}
 }
 async previous(){
  this.selectedIndex=null;this.editStart=false;const running=['playing','fadingIn','fadingOut'].includes(this.state);
  this.cancelFade();this.io.pause();
  if(this.headArmed&&this.index>0){this.index--;this.io.load(this.tracks[this.index]);}
  await this.io.seek(0);this.level=1;this.io.gain(1);this.headArmed=true;this.pausedMode=null;
  this.state='stopped';if(running){await this.io.play();this.state='playing';}
 }
 tick(){if(!this.fade||this.state==='paused'||this.state==='starting')return;this.level=this.value();if(this.io.now()-this.fade.start>=this.fade.seconds){const kind=this.fade.kind;this.fade=null;this.level=kind==='in'?1:0;this.io.gain(this.level);if(kind==='out')this.finishOutgoing();else this.state='playing';this.notify();}}
 naturalEnd(){if(!['playing','fadingIn','fadingOut'].includes(this.state))return;const wasFadingOut=this.state==='fadingOut';this.cancelFade();this.io.pause();this.state='ended';this.level=0;this.io.gain(0);this.headArmed=false;
  // 完パケ: play the whole song, then continue; the next song starts by its own in-settings. A right press during the end fade keeps the old safe behavior.
  // 繰り返し: replay the same song from the start by its own in-settings (right/stop/left/edit cancel it like an automatic advance).
  if(this.tracks[this.index]?.repeat===true&&!wasFadingOut){this.report('繰り返し：曲が最後まで終わりました。同じ曲を頭から流します。');this.notify();const ticket=++this.autoEpoch,index=this.index;this.dispatch('autoRepeat',{ticket,index});return;}
  if(this.tracks[this.index]?.fullPlay===true&&!wasFadingOut&&(this.index+1<this.tracks.length||this.selectedIndex!==null)){this.report('完パケ：曲が最後まで終わりました。次曲を開始します。');this.notify();const ticket=++this.autoEpoch,index=this.index;this.dispatch('autoAdvance',{ticket,index});return;}
  this.report('曲が終了しました。右を押すまで次曲は鳴りません。');this.notify();}
 holdForEdit(){
 this.io.pause();this.fade=null;this.pausedMode=null;this.headArmed=false;
 if(['playing','fadingIn','fadingOut','paused'].includes(this.state)){
  this.editStart=true;this.state='paused';
 }
 // Waiting/ended/stopped stay silent in the same state and same entry.
 }
 selectTo(index){
 if(!Number.isSafeInteger(index)||index<0||index>=this.tracks.length)return;
 const target=this.tracks[index];if(target.missing||target.preflight==='error'){this.report('この音源は選択できません');return;}
 // Stage only. No pause/load/seek/gain change while selecting a cue.
 this.selectedIndex=index===this.index?null:index;
 }
 async activateSelection(){
 if(this.selectedIndex===null)return;
 const index=this.selectedIndex;this.selectedIndex=null;
 this.io.pause();this.fade=null;this.pausedMode=null;this.level=0;this.io.gain(0);this.state='starting';this.notify();
 this.editStart=false;this.index=index;this.io.load(this.tracks[index]);this.headArmed=false;await this.start(true);
 }
 async seekTo(position){
 if(!Number.isFinite(position)||position<0||!['stopped','playing','paused','ended'].includes(this.state)||this.fade){this.report('現在の状態では再生位置を変更できません');return;}
 const wasPlaying=this.state==='playing';this.editStart=false;this.io.pause();await this.io.seek(position);this.headArmed=false;this.pausedMode=null;
 // A stopped/ended seek becomes a paused cue, so central resumes at the cue.
 if(!wasPlaying){if(this.state!=='paused'){this.level=1;this.io.gain(1);}this.state='paused';}
 else{await this.io.play();this.state='playing';}
}
 async command(action,value){if(['next','stop','previous','edit','activateSelection'].includes(action))this.cancelAuto();if(action==='autoRepeat'){if(value.ticket===this.autoEpoch&&this.state==='ended'&&this.index===value.index){this.cancelAuto();await this.start(true);}this.notify();return;}if(action==='autoAdvance'){if(value.ticket===this.autoEpoch&&(this.state==='waiting'||this.state==='ended')&&this.index===value.index){this.cancelAuto();await this.advance();}this.notify();return;}if(action==='edit')this.holdForEdit();else if(action==='stop'){this.selectedIndex=null;this.editStart=false;this.io.pause();this.fade=null;this.level=1;this.io.gain(1);if(this.tracks.length)await this.io.seek(0);this.headArmed=false;this.state=this.tracks.length?'stopped':'empty';}
 else if(this.tracks.length){if(action==='select')this.selectTo(value);if(action==='activateSelection')await this.activateSelection();if(action==='clearSelection')this.selectedIndex=null;if(action==='seek')await this.seekTo(value);if(action==='next')await this.next();if(action==='previous')await this.previous();if(action==='toggle')await this.central();if(action==='pause'&&['playing','fadingIn','fadingOut'].includes(this.state))await this.central();if(action==='play'&&!['playing','fadingIn','fadingOut','starting'].includes(this.state))await this.central();}
 this.notify();}
}
