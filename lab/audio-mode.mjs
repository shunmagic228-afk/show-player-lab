export function chooseAudioMode({search='',userAgent='',platform='',maxTouchPoints=0,vendor=''}={}){
 const requested=new URLSearchParams(search).get('audio');
 if(requested==='media'||requested==='buffer')return {engine:requested,reason:'explicit'};
 const ios=/iPhone|iPad|iPod/i.test(userAgent)||(platform==='MacIntel'&&maxTouchPoints>1);
 if(ios)return {engine:'buffer',reason:'iOS-default'};
 // Mac Safari / Dock app (WebKit): the media-element -> Web Audio path repeats the last part and stutters on pause/resume/seek,
 // exactly as it did on iPhone, so use the decoded-buffer engine there too. Chrome and others keep the media element path.
 if(/Apple/i.test(vendor)&&!/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Firefox/i.test(userAgent))return {engine:'buffer',reason:'safari-default'};
 return {engine:'media',reason:'desktop-default'};
}
