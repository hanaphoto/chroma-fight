'use strict';
/* クロマファイト - all processing on device, no external transmission */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const ASPECTS = { '16:9':[16,9], '4:3':[4,3], '9:16':[9,16] };
const SETTINGS_KEY = 'chromafight_settings_v1';
const MAX_PROCESS = 2560;

function defaultPlayerSettings(name, x){
  return { name, health:100, keyColor:'#00b140', threshold:38, feather:28, spill:50,
           x, y:0.58, scale:90, flip:false, locked:false };
}
function defaultSettings(){
  return { version:1, aspect:'16:9', mode:'1', bgId:'dojo', hudStyle:'classic',
    timer:99, ko:false, textEffect:'none', eventName:'', showDate:true,
    activePlayer:'p1',
    p1: defaultPlayerSettings('PLAYER 1', 0.32),
    p2: defaultPlayerSettings('PLAYER 2', 0.68) };
}
let settings = defaultSettings();
try {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw){ const p = JSON.parse(raw); if (p && p.version===1) settings = Object.assign(defaultSettings(), p, {p1:Object.assign(defaultPlayerSettings('PLAYER 1',0.32), p.p1||{}), p2:Object.assign(defaultPlayerSettings('PLAYER 2',0.68), p.p2||{})}); }
} catch(e){}
function saveSettings(){ try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){} }
function status(msg){ $('#status').textContent = msg || ''; }

/* runtime state (not persisted as JSON; images in IndexedDB) */
const players = {
  p1:{ source:null, sourceName:'', cutout:null },
  p2:{ source:null, sourceName:'', cutout:null }
};
let stream = null, facing = 'environment', liveOn = false, eyedropperOn = false, showBefore = false;
let customBgs = []; // {id,name,img,url}
let selectedCustomBgImg = null;

/* ---------- IndexedDB ---------- */
function idbOpen(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open('chromafight-db',1);
    r.onupgradeneeded = ()=>{ r.result.createObjectStore('images',{keyPath:'id'}); };
    r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error);
  });
}
async function idbPut(id, blob, name, kind){
  const db = await idbOpen();
  return new Promise((res,rej)=>{ const tx=db.transaction('images','readwrite'); tx.objectStore('images').put({id,blob,name,kind}); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); });
}
async function idbGetAll(){
  const db = await idbOpen();
  return new Promise((res,rej)=>{ const rq=db.transaction('images').objectStore('images').getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>rej(rq.error); });
}
async function idbDelete(id){
  const db = await idbOpen();
  return new Promise((res)=>{ const tx=db.transaction('images','readwrite'); tx.objectStore('images').delete(id); tx.oncomplete=res; tx.onerror=res; });
}

/* ---------- Sample backgrounds (original, procedurally drawn) ---------- */
function drawStage(ctx,W,H,id){
  const g = ctx.createLinearGradient(0,0,0,H);
  if (id==='dojo'){
    g.addColorStop(0,'#3a2415'); g.addColorStop(0.62,'#6b4423'); g.addColorStop(0.63,'#8a5a2b'); g.addColorStop(1,'#5a3a1a');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#e8dcc0'; ctx.fillRect(W*0.08,H*0.06,W*0.84,H*0.5);
    ctx.strokeStyle='#4a2f18'; ctx.lineWidth=Math.max(2,W*0.004);
    for(let i=0;i<=4;i++){ const x=W*0.08+ (W*0.84/4)*i; ctx.beginPath(); ctx.moveTo(x,H*0.06); ctx.lineTo(x,H*0.56); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(W*0.08,H*0.31); ctx.lineTo(W*0.92,H*0.31); ctx.stroke();
    ctx.fillStyle='#a01822'; ctx.beginPath(); ctx.arc(W*0.5,H*0.30,W*0.07,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#7a4a20';
    for(let i=0;i<9;i++) ctx.fillRect(0,H*0.64+i*H*0.04,W,H*0.012);
    ctx.fillStyle='rgba(0,0,0,.25)'; ctx.fillRect(0,H*0.56,W,H*0.08);
  } else if (id==='city'){
    g.addColorStop(0,'#060818'); g.addColorStop(0.7,'#141a3a'); g.addColorStop(1,'#241040');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#f5f3ce'; ctx.beginPath(); ctx.arc(W*0.82,H*0.14,W*0.045,0,Math.PI*2); ctx.fill();
    const cols=['#0d1026','#11142e','#0a0e24'];
    for(let b=0;b<12;b++){
      const bw=W*0.09, bx=(W/12)*b+W*0.005, bh=H*(0.3+((b*37)%40)/100), by=H*0.78-bh;
      ctx.fillStyle=cols[b%3]; ctx.fillRect(bx,by,bw,bh);
      ctx.fillStyle=(b%2?'#00e5ff':'#ffea00');
      for(let wy=0;wy<6;wy++) for(let wx=0;wx<3;wx++) if(((b+wy+wx)%3)!==0) ctx.fillRect(bx+bw*0.15+wx*bw*0.25, by+bh*0.12+wy*bh*0.13, bw*0.13, bh*0.07);
    }
    ctx.fillStyle='#191926'; ctx.fillRect(0,H*0.78,W,H*0.22);
    ctx.strokeStyle='#ff2d95'; ctx.lineWidth=Math.max(2,H*0.006); ctx.beginPath(); ctx.moveTo(0,H*0.78); ctx.lineTo(W,H*0.78); ctx.stroke();
    ctx.fillStyle='rgba(255,45,149,.16)'; ctx.fillRect(0,H*0.78,W,H*0.05);
  } else if (id==='sunset'){
    g.addColorStop(0,'#2b1055'); g.addColorStop(0.45,'#7597de'); g.addColorStop(0.62,'#ff9a3d'); g.addColorStop(0.78,'#ff5e62'); g.addColorStop(1,'#2b1055');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    const sg=ctx.createRadialGradient(W*0.5,H*0.62,10,W*0.5,H*0.62,W*0.28);
    sg.addColorStop(0,'#fff3b0'); sg.addColorStop(0.5,'#ffd200'); sg.addColorStop(1,'rgba(255,120,40,0)');
    ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(W*0.5,H*0.62,W*0.28,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#ffd76a'; ctx.beginPath(); ctx.arc(W*0.5,H*0.62,W*0.11,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#1c1030';
    ctx.beginPath(); ctx.moveTo(0,H*0.72); ctx.lineTo(W*0.25,H*0.58); ctx.lineTo(W*0.5,H*0.72); ctx.lineTo(W*0.75,H*0.60); ctx.lineTo(W,H*0.72); ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#120a20'; ctx.fillRect(0,H*0.82,W,H*0.18);
  } else { /* industrial */
    g.addColorStop(0,'#23262b'); g.addColorStop(0.7,'#3a3f47'); g.addColorStop(1,'#17181c');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='#596068'; ctx.lineWidth=W*0.02;
    for(const px of [0.12,0.88]){ ctx.beginPath(); ctx.moveTo(W*px,0); ctx.lineTo(W*px,H*0.7); ctx.stroke(); }
    ctx.strokeStyle='#7d858f'; ctx.lineWidth=W*0.008; ctx.beginPath(); ctx.moveTo(0,H*0.18); ctx.lineTo(W,H*0.18); ctx.stroke();
    ctx.fillStyle='#c9a227'; for(let i=0;i<10;i++){ ctx.save(); ctx.translate(i*W*0.11,H*0.86); ctx.rotate(-0.5); ctx.fillRect(0,0,W*0.06,H*0.03); ctx.restore(); }
    ctx.fillStyle='#101114'; ctx.fillRect(0,H*0.90,W,H*0.10);
    ctx.fillStyle='rgba(255,90,0,.20)'; ctx.beginPath(); ctx.arc(W*0.5,H*0.42,W*0.16,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#2e3238'; ctx.fillRect(W*0.38,H*0.26,W*0.24,H*0.34);
    ctx.strokeStyle='#9aa2ab'; ctx.lineWidth=3; ctx.strokeRect(W*0.38,H*0.26,W*0.24,H*0.34);
  }
}
const SAMPLE_BGS = [
  {id:'dojo', name:'道場'},
  {id:'city', name:'市街地・ネオン'},
  {id:'sunset', name:'夕景'},
  {id:'industrial', name:'工業エリア'}
];
function getBackgroundCanvas(W,H){
  const c=document.createElement('canvas'); c.width=W; c.height=H; const ctx=c.getContext('2d');
  if (settings.bgId.startsWith('custom:')){
    if (selectedCustomBgImg){ drawCover(ctx, selectedCustomBgImg, W, H); } else { ctx.fillStyle='#333'; ctx.fillRect(0,0,W,H); }
  } else drawStage(ctx,W,H,settings.bgId);
  return c;
}
function drawCover(ctx, img, W, H){
  const iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;
  const s=Math.max(W/iw,H/ih), dw=iw*s, dh=ih*s;
  ctx.drawImage(img,(W-dw)/2,(H-dh)/2,dw,dh);
}

/* ---------- Chroma key ---------- */
function hexToRgb(hex){ const n=parseInt(hex.slice(1),16); return [n>>16&255, n>>8&255, n&255]; }
function rgbToCbCr(r,g,b){ return [128 -0.168736*r -0.331264*g +0.5*b, 128 +0.5*r -0.418688*g -0.081312*b]; }
function smoothstep(a,b,x){ const t=Math.min(1,Math.max(0,(x-a)/(b-a||1))); return t*t*(3-2*t); }

function processChroma(source, ps){
  const sw = source.naturalWidth||source.width, sh = source.naturalHeight||source.height;
  const scale = Math.min(1, MAX_PROCESS/Math.max(sw,sh));
  const W=Math.round(sw*scale), H=Math.round(sh*scale);
  const c=document.createElement('canvas'); c.width=W; c.height=H;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(source,0,0,W,H);
  let img; try{ img=ctx.getImageData(0,0,W,H); }catch(e){ return c; }
  const d=img.data;
  const [kr,kg,kb]=hexToRgb(ps.keyColor);
  const [kCb,kCr]=rgbToCbCr(kr,kg,kb);
  const thr = 8 + (ps.threshold/100)*95;          // chroma distance threshold
  const feather = 4 + (ps.feather/100)*70;
  const spillAmt = ps.spill/100;
  const isGreen = kg>=kr && kg>=kb, isBlue = kb>=kr && kb>=kg;
  for(let i=0;i<d.length;i+=4){
    const r=d[i], gg=d[i+1], b=d[i+2];
    const [cb,cr]=rgbToCbCr(r,gg,b);
    const dist=Math.hypot(cb-kCb, cr-kCr);
    let alpha = smoothstep(thr, thr+feather, dist);
    // also fade pixels that are strongly the key hue even if bright/dark
    d[i+3] = Math.round(d[i+3]*alpha);
    if (spillAmt>0 && alpha<0.98){
      const s = spillAmt*(1-alpha)*0.9 + spillAmt*0.25*(dist<thr+feather?1:0);
      if (s>0){
        if (isGreen){ const m=Math.max(r,b); d[i+1]=Math.round(gg-(gg-m)*Math.min(1,s)); }
        else if (isBlue){ const m=Math.max(r,gg); d[i+2]=Math.round(b-(b-m)*Math.min(1,s)); }
        else { d[i]=Math.round(r-(r-((gg+b)/2))*Math.min(1,s)*0.5); d[i+1]=Math.round(gg-(gg-((r+b)/2))*Math.min(1,s)*0.5); d[i+2]=Math.round(b-(b-((r+gg)/2))*Math.min(1,s)*0.5); }
      }
    }
  }
  ctx.putImageData(img,0,0);
  return c;
}
function reprocess(key){
  const p = players[key]; if(!p.source) return;
  p.cutout = processChroma(p.source, settings[key]);
  renderMain();
}

/* ---------- Composite rendering ---------- */
function canvasDims(base){
  const [aw,ah]=ASPECTS[settings.aspect]||[16,9];
  if (aw>=ah) return [base, Math.round(base*ah/aw)];
  return [Math.round(base*aw/ah), base];
}
function drawPlayer(ctx,W,H,key,useOriginal){
  const p=players[key]; const img = useOriginal? p.source : p.cutout; if(!img) return;
  const ps=settings[key];
  const iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height;
  const dh = H*0.86*(ps.scale/100), dw = dh*iw/ih;
  const cx=ps.x*W, cy=ps.y*H;
  ctx.save();
  ctx.translate(cx,cy); if(ps.flip) ctx.scale(-1,1);
  ctx.drawImage(img,-dw/2,-dh/2,dw,dh);
  ctx.restore();
}
function healthColor(h){ return h>50?'#57d92e':(h>25?'#ffd200':'#ff2d2d'); }
function drawBar(ctx,x,y,w,h,ps,mirror,style){
  ctx.save();
  if (style==='classic'){
    ctx.transform(1,0,mirror?0.18:-0.18,1,0,0);
  }
  ctx.fillStyle='#111'; roundRect(ctx,x,y,w,h,style==='simple'?h/2:3); ctx.fill();
  ctx.strokeStyle= style==='neon' ? '#00e5ff' : '#f5f5f5'; ctx.lineWidth=Math.max(2,h*0.10);
  if (style==='neon'){ ctx.shadowColor='#00e5ff'; ctx.shadowBlur=12; }
  roundRect(ctx,x,y,w,h,style==='simple'?h/2:3); ctx.stroke(); ctx.shadowBlur=0;
  const fw = w*(ps.health/100);
  const fx = mirror? x+w-fw : x;
  const grad=ctx.createLinearGradient(0,y,0,y+h);
  const col=healthColor(ps.health); grad.addColorStop(0,'#ffffff'); grad.addColorStop(0.25,col); grad.addColorStop(1,col);
  ctx.fillStyle=grad; if(fw>0){ roundRect(ctx,fx,y,fw,h,style==='simple'?h/2:3); ctx.fill(); }
  ctx.restore();
  // name
  ctx.save();
  ctx.font=`700 ${Math.max(12,h*0.72)}px system-ui, sans-serif`;
  ctx.fillStyle='#fff'; ctx.strokeStyle='#000'; ctx.lineWidth=4;
  ctx.textAlign = mirror? 'right':'left';
  const nx = mirror? x+w : x, ny = y+h+Math.max(14,h*0.85);
  ctx.strokeText(ps.name||'', nx, ny); ctx.fillText(ps.name||'', nx, ny);
  ctx.restore();
}
function roundRect(ctx,x,y,w,h,r){ r=Math.min(r,w/2,h/2); ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function drawHUD(ctx,W,H){
  const barW=W*0.40, barH=Math.max(14,H*0.045), y=H*0.045;
  const two = settings.mode!=='1';
  drawBar(ctx, W*0.03, y, barW, barH, settings.p1, false, settings.hudStyle);
  if (two) drawBar(ctx, W*0.57, y, barW, barH, settings.p2, true, settings.hudStyle);
  // timer
  const tw=W*0.09, th=barH*1.5, tx=W/2-tw/2, ty=y- barH*0.2;
  ctx.save(); ctx.fillStyle='#111'; roundRect(ctx,tx,ty,tw,th,6); ctx.fill();
  ctx.strokeStyle='#ffd200'; ctx.lineWidth=2; roundRect(ctx,tx,ty,tw,th,6); ctx.stroke();
  ctx.fillStyle='#fff'; ctx.font=`900 ${th*0.62}px system-ui, sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(String(settings.timer).padStart(2,'0'), W/2, ty+th/2+1); ctx.restore();
  if (settings.ko) drawBigText(ctx,W,H,'K.O.','#ff1a1a');
}
function drawBigText(ctx,W,H,text,color){
  ctx.save(); ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font=`italic 900 ${H*0.20}px system-ui, sans-serif`;
  ctx.lineWidth=H*0.02; ctx.strokeStyle='#000';
  const grad=ctx.createLinearGradient(0,H*0.32,0,H*0.68); grad.addColorStop(0,'#fff'); grad.addColorStop(0.45,color); grad.addColorStop(1,'#7a0000');
  if (text==='VS'){ grad.addColorStop(0,'#fff'); }
  ctx.shadowColor='rgba(0,0,0,.6)'; ctx.shadowBlur=16;
  ctx.strokeText(text,W/2,H/2); ctx.fillStyle= (text==='K.O.'||text==='FIGHT!')? grad : '#ffd200';
  if (text!=='K.O.' && text!=='FIGHT!') ctx.fillStyle='#ffd200';
  ctx.fillText(text,W/2,H/2); ctx.restore();
}
function drawFooterText(ctx,W,H){
  const parts=[];
  if (settings.showDate){ const d=new Date(); parts.push(`${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`); }
  if (settings.eventName) parts.push(settings.eventName);
  if(!parts.length) return;
  const txt=parts.join('  ');
  ctx.save(); ctx.font=`600 ${Math.max(12,H*0.028)}px system-ui, sans-serif`; ctx.textAlign='center';
  const w=ctx.measureText(txt).width+24;
  ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(W/2-w/2, H-H*0.055, w, H*0.04);
  ctx.fillStyle='#fff'; ctx.textBaseline='middle'; ctx.fillText(txt,W/2,H-H*0.035); ctx.restore();
}
function renderComposite(ctx,W,H){
  // background
  if (settings.bgId.startsWith('custom:') && selectedCustomBgImg) drawCover(ctx, selectedCustomBgImg, W, H);
  else drawStage(ctx,W,H,settings.bgId.startsWith('custom:')?'dojo':settings.bgId);
  drawPlayer(ctx,W,H,'p1', showBefore);
  if (settings.mode==='2-separate') drawPlayer(ctx,W,H,'p2', showBefore);
  drawHUD(ctx,W,H);
  if (settings.textEffect && settings.textEffect!=='none') drawBigText(ctx,W,H,settings.textEffect, settings.textEffect==='K.O.'?'#ff1a1a':'#ff7a00');
  drawFooterText(ctx,W,H);
}
function drawChecker(ctx,W,H){ const s=24; for(let y=0;y<H;y+=s) for(let x=0;x<W;x+=s){ ctx.fillStyle=((x+y)/s)%2?'#bbb':'#eee'; ctx.fillRect(x,y,s,s);} }
function renderMain(){
  const cv=$('#mainCanvas'); const [W,H]=canvasDims(960);
  if (cv.width!==W||cv.height!==H){ cv.width=W; cv.height=H; }
  const ctx=cv.getContext('2d');
  const check=$('#checkBg').value;
  if (check!=='actual'){
    if (check==='checker') drawChecker(ctx,W,H); else { ctx.fillStyle=check; ctx.fillRect(0,0,W,H); }
    // show active player cutout centered
    const key=settings.activePlayer; const p=players[key];
    if (p.cutout){ const tmp=settings[key].scale; const save={...settings[key]}; settings[key].x=0.5; settings[key].y=0.55; settings[key].scale=110; drawPlayer(ctx,W,H,key,false); Object.assign(settings[key],save); }
    else { ctx.fillStyle='#888'; ctx.font='20px sans-serif'; ctx.textAlign='center'; ctx.fillText('写真がまだありません',W/2,H/2); }
    return;
  }
  renderComposite(ctx,W,H);
  if ($('#guideToggle').checked){
    ctx.save(); ctx.strokeStyle='rgba(255,210,0,.9)'; ctx.setLineDash([10,8]); ctx.lineWidth=2;
    ctx.strokeRect(W*0.06,H*0.16,W*0.88,H*0.78);
    ctx.beginPath(); ctx.moveTo(0,H*0.94); ctx.lineTo(W,H*0.94); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle='rgba(255,210,0,.9)'; ctx.font='14px sans-serif'; ctx.fillText('足元ライン',10,H*0.92); ctx.restore();
  }
  syncLayoutControls();
}

/* ---------- Source preview / eyedropper ---------- */
function drawSourcePreview(){
  const cv=$('#sourceCanvas'); const key=settings.activePlayer; const p=players[key];
  const ctx=cv.getContext('2d'); ctx.fillStyle='#222'; ctx.fillRect(0,0,cv.width,cv.height);
  if(!p.source){ ctx.fillStyle='#999'; ctx.font='16px sans-serif'; ctx.textAlign='center'; ctx.fillText('元写真なし',cv.width/2,cv.height/2); return; }
  drawCover(ctx,p.source,cv.width,cv.height);
}
$('#sourceCanvas').addEventListener('click', e=>{
  if(!eyedropperOn) return;
  const key=settings.activePlayer; const p=players[key]; if(!p.source) return;
  const cv=$('#sourceCanvas'); const rect=cv.getBoundingClientRect();
  const x=Math.floor((e.clientX-rect.left)/rect.width*cv.width), y=Math.floor((e.clientY-rect.top)/rect.height*cv.height);
  const d=cv.getContext('2d').getImageData(x,y,1,1).data;
  // Note: source preview is cover-cropped; sampling is approximate when aspect differs.
  const hex='#'+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
  settings[key].keyColor=hex; $('#keyColor').value=hex; saveSettings(); reprocess(key);
  status(`キー色を ${hex} にしました`); eyedropperOn=false; $('#eyedropperBtn').textContent='スポイト（ONにして写真をタップ）';
});

/* ---------- Camera ---------- */
async function listCameras(){
  try{
    const devs=await navigator.mediaDevices.enumerateDevices();
    const sel=$('#cameraSelect'); const cur=sel.value; sel.innerHTML='<option value="">自動</option>';
    devs.filter(d=>d.kind==='videoinput').forEach((d,i)=>{ const o=document.createElement('option'); o.value=d.deviceId; o.textContent=d.label||`カメラ ${i+1}`; sel.appendChild(o); });
    sel.value=cur;
  }catch(e){}
}
function updateLiveVisibility(){
  const showLive = !!(liveOn && stream);
  $('#liveCanvas').classList.toggle('hidden', !showLive);
  $('#liveBadge').classList.toggle('hidden', !showLive);
  $('#mainCanvas').classList.toggle('hidden', showLive);
}
async function startCamera(){
  stopCamera();
  const devId=$('#cameraSelect').value;
  const constraints={ video: devId? {deviceId:{exact:devId}, width:{ideal:1920}, height:{ideal:1080}} : {facingMode:facing, width:{ideal:1920}, height:{ideal:1080}}, audio:false };
  try{ stream=await navigator.mediaDevices.getUserMedia(constraints); const v=$('#cameraVideo'); v.srcObject=stream; await v.play(); listCameras(); status('カメラ起動中'); updateLiveVisibility(); if(liveOn) requestAnimationFrame(liveLoop); }
  catch(e){ status('カメラを起動できませんでした: '+e.message); }
}
function stopCamera(){ if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } updateLiveVisibility(); }
function captureFrame(){
  const v=$('#cameraVideo'); if(!stream||!v.videoWidth) { status('カメラが起動していません'); return null; }
  const c=document.createElement('canvas'); c.width=v.videoWidth; c.height=v.videoHeight; c.getContext('2d').drawImage(v,0,0);
  return c;
}
function setPlayerSource(key, source, name){
  players[key].source=source; players[key].sourceName=name||'';
  reprocess(key); drawSourcePreview();
  // persist original (as jpeg blob) to IndexedDB for project restore
  const tmp=document.createElement('canvas'); const sw=source.naturalWidth||source.width, sh=source.naturalHeight||source.height;
  const s=Math.min(1,1920/Math.max(sw,sh)); tmp.width=Math.round(sw*s); tmp.height=Math.round(sh*s); tmp.getContext('2d').drawImage(source,0,0,tmp.width,tmp.height);
  tmp.toBlob(b=>{ if(b) idbPut('player:'+key, b, name||key, 'player').catch(()=>{}); },'image/jpeg',0.92);
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function countdown(sec){
  if(!sec) return; const el=$('#countdown'); el.classList.remove('hidden');
  for(let i=sec;i>0;i--){ el.textContent=i; await sleep(1000); }
  el.textContent='!'; await sleep(250); el.classList.add('hidden');
}
async function doShoot(){
  await countdown(parseInt($('#timerSec').value,10)||0);
  const frame=captureFrame(); if(!frame) return;
  setPlayerSource(settings.activePlayer, frame, 'camera'); status('撮影しました。「2 抜く」で調整できます');
}
async function doBurst(){
  await countdown(parseInt($('#timerSec').value,10)||0);
  const wrap=$('#burstThumbs'); wrap.innerHTML='';
  for(let i=0;i<3;i++){
    const frame=captureFrame(); if(!frame) return;
    const img=document.createElement('img'); img.src=frame.toDataURL('image/jpeg',0.7); img.alt=`連写 ${i+1}`;
    img.addEventListener('click',()=>{ setPlayerSource(settings.activePlayer, frame, 'burst'); status(`連写 ${i+1}枚目を選びました`); });
    wrap.appendChild(img); await sleep(600);
  }
  status('連写しました。サムネイルをタップして選んでください');
}
/* live preview loop */
let lastLive=0;
function liveLoop(ts){
  if(!liveOn||!stream){ return; }
  requestAnimationFrame(liveLoop);
  if(ts-lastLive<66) return; lastLive=ts;
  const v=$('#cameraVideo'); if(!v.videoWidth) return;
  const cv=$('#liveCanvas'); const maxW=720; const s=Math.min(1,maxW/v.videoWidth);
  const W=Math.round(v.videoWidth*s), H=Math.round(v.videoHeight*s);
  // process a small frame
  const frame=document.createElement('canvas'); frame.width=W; frame.height=H; frame.getContext('2d').drawImage(v,0,0,W,H);
  const keyed=processChroma(frame, settings[settings.activePlayer]);
  // compose at canvas aspect
  const [cw,ch]=canvasDims(640); if(cv.width!==cw||cv.height!==ch){ cv.width=cw; cv.height=ch; }
  const ctx=cv.getContext('2d');
  if (settings.bgId.startsWith('custom:') && selectedCustomBgImg) drawCover(ctx,selectedCustomBgImg,cw,ch); else drawStage(ctx,cw,ch,settings.bgId.startsWith('custom:')?'dojo':settings.bgId);
  ctx.globalAlpha=0.92; // onion-skin feel: person over semi background already drawn
  const save={...settings[settings.activePlayer]}; const k=settings.activePlayer;
  const iw=keyed.width, ih=keyed.height; const dh=ch*0.86*(save.scale/100), dw=dh*iw/ih;
  ctx.drawImage(keyed, save.x*cw-dw/2, save.y*ch-dh/2, dw, dh); ctx.globalAlpha=1;
  drawHUD(ctx,cw,ch);
}

/* ---------- Import ---------- */
async function loadImageFile(file){
  try{
    if (window.createImageBitmap){
      try{ return await createImageBitmap(file,{imageOrientation:'from-image'}); }catch(e){ return await createImageBitmap(file); }
    }
    throw new Error('fallback');
  }catch(e){
    return new Promise((res,rej)=>{ const url=URL.createObjectURL(file); const img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=url; });
  }
}
$('#importFile').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  const img=await loadImageFile(f);
  setPlayerSource(settings.activePlayer, img, f.name); status('写真を取り込みました');
  e.target.value='';
});

/* ---------- Backgrounds UI ---------- */
function buildBgList(){
  const wrap=$('#bgList'); wrap.innerHTML='';
  SAMPLE_BGS.forEach(bg=>{
    const div=document.createElement('div'); div.className='bg-item'+(settings.bgId===bg.id?' selected':'');
    const c=document.createElement('canvas'); c.width=300; c.height=169; drawStage(c.getContext('2d'),300,169,bg.id);
    const sp=document.createElement('span'); sp.textContent=bg.name; div.appendChild(c); div.appendChild(sp);
    div.addEventListener('click',()=>{ settings.bgId=bg.id; selectedCustomBgImg=null; saveSettings(); buildBgList(); renderMain(); });
    wrap.appendChild(div);
  });
}
function buildCustomBgList(){
  const wrap=$('#customBgList'); wrap.innerHTML='';
  customBgs.forEach(bg=>{
    const div=document.createElement('div'); div.className='bg-item'+(settings.bgId==='custom:'+bg.id?' selected':'');
    const img=document.createElement('img'); img.src=bg.url; img.alt=bg.name;
    const sp=document.createElement('span'); sp.textContent=bg.name;
    const del=document.createElement('button'); del.textContent='削除'; del.type='button';
    del.addEventListener('click', async ev=>{ ev.stopPropagation(); await idbDelete(bg.id); customBgs=customBgs.filter(b=>b.id!==bg.id); buildCustomBgList(); });
    div.appendChild(img); div.appendChild(sp); div.appendChild(del);
    div.addEventListener('click',()=>{ settings.bgId='custom:'+bg.id; selectedCustomBgImg=bg.img; saveSettings(); buildBgList(); buildCustomBgList(); renderMain(); });
    wrap.appendChild(div);
  });
}
$('#bgFile').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  const id='bg-'+Date.now(); await idbPut(id,f,f.name,'bg');
  const img=await loadImageFile(f); customBgs.push({id,name:f.name,img,url:URL.createObjectURL(f)});
  settings.bgId='custom:'+id; selectedCustomBgImg=img; saveSettings(); buildBgList(); buildCustomBgList(); renderMain();
  status('背景を追加しました'); e.target.value='';
});

/* ---------- Layout interaction (drag / pinch) ---------- */
(function(){
  const cv=$('#mainCanvas'); const pointers=new Map(); let lastDist=0;
  function toNorm(e){ const r=cv.getBoundingClientRect(); return { x:(e.clientX-r.left)/r.width, y:(e.clientY-r.top)/r.height }; }
  function activeKey(){ return settings.activePlayer; }
  cv.addEventListener('pointerdown', e=>{ pointers.set(e.pointerId,toNorm(e)); cv.setPointerCapture(e.pointerId); lastDist=0; });
  cv.addEventListener('pointermove', e=>{
    if(!pointers.has(e.pointerId)) return;
    const prev=pointers.get(e.pointerId); const cur=toNorm(e); pointers.set(e.pointerId,cur);
    const key=activeKey(); const ps=settings[key]; if(ps.locked) return;
    if (pointers.size===1){ ps.x=Math.min(1,Math.max(0,ps.x+(cur.x-prev.x))); ps.y=Math.min(1,Math.max(0,ps.y+(cur.y-prev.y))); renderMain(); }
    else if (pointers.size===2){
      const pts=Array.from(pointers.values()); const dist=Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      if(lastDist>0){ ps.scale=Math.min(250,Math.max(20, ps.scale*(dist/lastDist))); renderMain(); }
      lastDist=dist;
    }
  });
  const end=e=>{ pointers.delete(e.pointerId); if(pointers.size<2) lastDist=0; saveSettings(); };
  cv.addEventListener('pointerup',end); cv.addEventListener('pointercancel',end);
})();

/* ---------- Controls wiring ---------- */
function syncLayoutControls(){
  const ps=settings[settings.activePlayer];
  $('#scaleRange').value=ps.scale; $('#scaleVal').textContent=Math.round(ps.scale)+'%';
  $('#xRange').value=ps.x*100; $('#xVal').textContent=Math.round(ps.x*100)+'%';
  $('#yRange').value=ps.y*100; $('#yVal').textContent=Math.round(ps.y*100)+'%';
  $('#lockToggle').checked=!!ps.locked;
}
function syncKeyControls(){
  const key=settings.activePlayer; const ps=settings[key];
  $('#keyTargetLabel').textContent = key==='p1'?'プレイヤー1':'プレイヤー2';
  $('#keyColor').value=ps.keyColor;
  $('#threshold').value=ps.threshold; $('#thresholdVal').textContent=ps.threshold;
  $('#feather').value=ps.feather; $('#featherVal').textContent=ps.feather;
  $('#spill').value=ps.spill; $('#spillVal').textContent=ps.spill;
}
function syncAll(){
  $('#playerMode').value=settings.mode; $('#aspect').value=settings.aspect; $('#activePlayer').value=settings.activePlayer;
  $('#hudStyle').value=settings.hudStyle; $('#timerValue').value=settings.timer; $('#koToggle').checked=settings.ko;
  $('#p1Name').value=settings.p1.name; $('#p2Name').value=settings.p2.name;
  $('#p1Health').value=settings.p1.health; $('#p1HealthVal').textContent=settings.p1.health;
  $('#p2Health').value=settings.p2.health; $('#p2HealthVal').textContent=settings.p2.health;
  $('#textEffect').value=settings.textEffect; $('#eventName').value=settings.eventName; $('#showDate').checked=settings.showDate;
  syncKeyControls(); syncLayoutControls();
}
const STEP_NAMES = {1:'撮る・取り込む',2:'抜く',3:'背景',4:'配置',5:'体力バー・文字',6:'保存'};
let currentStep = 1;
function goStep(n, scroll){
  currentStep = Math.min(6, Math.max(1, n));
  $$('#stepsNav button').forEach(b=>b.classList.toggle('active', b.dataset.step===String(currentStep)));
  $$('.step-panel').forEach(p=>p.classList.toggle('hidden', p.dataset.panel!==String(currentStep)));
  if(currentStep===2){ syncKeyControls(); drawSourcePreview(); }
  const lbl=$('#stepBarLabel'); if(lbl) lbl.textContent = currentStep+' / 6 '+STEP_NAMES[currentStep];
  const pv=$('#prevStepBtn'), nv=$('#nextStepBtn');
  if(pv) pv.disabled = currentStep===1;
  if(nv) nv.disabled = currentStep===6;
  if(scroll){
    const panel=$('.step-panel:not(.hidden)');
    if(panel){
      const pvWrap=$('.preview-wrap');
      const offset = (pvWrap? pvWrap.offsetHeight:0) + 58;
      const y = panel.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({top: Math.max(0,y), behavior:'smooth'});
    }
  }
}
$('#stepsNav').addEventListener('click', e=>{
  const btn=e.target.closest('button[data-step]'); if(!btn) return;
  goStep(parseInt(btn.dataset.step,10), true);
});
$('#prevStepBtn').addEventListener('click', ()=>goStep(currentStep-1, true));
$('#nextStepBtn').addEventListener('click', ()=>goStep(currentStep+1, true));
goStep(1, false);
$('#playerMode').addEventListener('change', e=>{ settings.mode=e.target.value; saveSettings(); renderMain(); });
$('#aspect').addEventListener('change', e=>{ settings.aspect=e.target.value; saveSettings(); renderMain(); });
$('#activePlayer').addEventListener('change', e=>{ settings.activePlayer=e.target.value; saveSettings(); syncKeyControls(); syncLayoutControls(); drawSourcePreview(); renderMain(); });
$('#checkBg').addEventListener('change', renderMain);
$('#guideToggle').addEventListener('change', renderMain);
const ba=$('#beforeAfterBtn');
ba.addEventListener('pointerdown', ()=>{ showBefore=true; renderMain(); });
ba.addEventListener('pointerup', ()=>{ showBefore=false; renderMain(); });
ba.addEventListener('pointerleave', ()=>{ if(showBefore){ showBefore=false; renderMain(); } });

$('#startCamera').addEventListener('click', startCamera);
$('#stopCamera').addEventListener('click', ()=>{ stopCamera(); status('カメラ停止'); });
$('#switchCamera').addEventListener('click', ()=>{ facing = facing==='environment'?'user':'environment'; if(stream) startCamera(); });
$('#refreshCameras').addEventListener('click', listCameras);
$('#cameraSelect').addEventListener('change', ()=>{ if(stream) startCamera(); });
$('#shootBtn').addEventListener('click', doShoot);
$('#burstBtn').addEventListener('click', doBurst);
$('#liveToggle').addEventListener('change', e=>{ liveOn=e.target.checked; updateLiveVisibility(); if(liveOn){ if(!stream) startCamera(); else requestAnimationFrame(liveLoop); } });
$('#clearPlayer').addEventListener('click', ()=>{ const k=settings.activePlayer; players[k].source=null; players[k].cutout=null; idbDelete('player:'+k); drawSourcePreview(); renderMain(); });

$$('.key-preset').forEach(b=>b.addEventListener('click',()=>{ const k=settings.activePlayer; settings[k].keyColor=b.dataset.color; $('#keyColor').value=b.dataset.color; saveSettings(); reprocess(k); }));
$('#keyColor').addEventListener('input', e=>{ const k=settings.activePlayer; settings[k].keyColor=e.target.value; saveSettings(); });
$('#keyColor').addEventListener('change', ()=>reprocess(settings.activePlayer));
$('#eyedropperBtn').addEventListener('click', ()=>{ eyedropperOn=!eyedropperOn; $('#eyedropperBtn').textContent=eyedropperOn?'スポイトON：元写真をタップ':'スポイト（ONにして写真をタップ）'; drawSourcePreview(); });
let reTimer=null;
function scheduleReprocess(){ clearTimeout(reTimer); reTimer=setTimeout(()=>reprocess(settings.activePlayer),180); }
for (const [id,field,label] of [['threshold','threshold','thresholdVal'],['feather','feather','featherVal'],['spill','spill','spillVal']]){
  $('#'+id).addEventListener('input', e=>{ const k=settings.activePlayer; settings[k][field]=parseInt(e.target.value,10); $('#'+label).textContent=e.target.value; saveSettings(); scheduleReprocess(); });
}
$('#reprocessBtn').addEventListener('click', ()=>reprocess(settings.activePlayer));

$('#scaleRange').addEventListener('input', e=>{ settings[settings.activePlayer].scale=parseInt(e.target.value,10); saveSettings(); renderMain(); });
$('#xRange').addEventListener('input', e=>{ settings[settings.activePlayer].x=parseInt(e.target.value,10)/100; saveSettings(); renderMain(); });
$('#yRange').addEventListener('input', e=>{ settings[settings.activePlayer].y=parseInt(e.target.value,10)/100; saveSettings(); renderMain(); });
$('#flipBtn').addEventListener('click', ()=>{ const ps=settings[settings.activePlayer]; ps.flip=!ps.flip; saveSettings(); renderMain(); });
$('#lockToggle').addEventListener('change', e=>{ settings[settings.activePlayer].locked=e.target.checked; saveSettings(); });
$('#resetLayoutBtn').addEventListener('click', ()=>{ const k=settings.activePlayer; const d=defaultPlayerSettings(settings[k].name, k==='p1'?0.32:0.68); settings[k].x=d.x; settings[k].y=d.y; settings[k].scale=d.scale; settings[k].flip=false; saveSettings(); renderMain(); });

$('#hudStyle').addEventListener('change', e=>{ settings.hudStyle=e.target.value; saveSettings(); renderMain(); });
$('#timerValue').addEventListener('input', e=>{ settings.timer=Math.min(99,Math.max(0,parseInt(e.target.value||'0',10))); saveSettings(); renderMain(); });
$('#koToggle').addEventListener('change', e=>{ settings.ko=e.target.checked; saveSettings(); renderMain(); });
$('#p1Name').addEventListener('input', e=>{ settings.p1.name=e.target.value; saveSettings(); renderMain(); });
$('#p2Name').addEventListener('input', e=>{ settings.p2.name=e.target.value; saveSettings(); renderMain(); });
$('#p1Health').addEventListener('input', e=>{ settings.p1.health=parseInt(e.target.value,10); $('#p1HealthVal').textContent=e.target.value; saveSettings(); renderMain(); });
$('#p2Health').addEventListener('input', e=>{ settings.p2.health=parseInt(e.target.value,10); $('#p2HealthVal').textContent=e.target.value; saveSettings(); renderMain(); });
$('#textEffect').addEventListener('change', e=>{ settings.textEffect=e.target.value; saveSettings(); renderMain(); });
$('#eventName').addEventListener('input', e=>{ settings.eventName=e.target.value; saveSettings(); renderMain(); });
$('#showDate').addEventListener('change', e=>{ settings.showDate=e.target.checked; saveSettings(); renderMain(); });

/* ---------- Output ---------- */
function fileStamp(){ const d=new Date(); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
function outputCanvas(){
  let longEdge=1920;
  if ($('#outRes').value==='light') longEdge=1280;
  else { const srcs=[players.p1.source,players.p2.source].filter(Boolean); if(srcs.length) longEdge=Math.min(3200, Math.max(...srcs.map(s=>Math.max(s.naturalWidth||s.width, s.naturalHeight||s.height)))); }
  const [W,H]=canvasDims(longEdge);
  const c=document.createElement('canvas'); c.width=W; c.height=H; renderComposite(c.getContext('2d'),W,H); return c;
}
function downloadBlob(blob, name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); }
$('#dlComposite').addEventListener('click', ()=>{ outputCanvas().toBlob(b=>{ if(b) downloadBlob(b,`chromafight_${fileStamp()}_${settings.aspect.replace(':','x')}.jpg`); },'image/jpeg',0.92); });
$('#dlCutout').addEventListener('click', ()=>{ const p=players[settings.activePlayer]; if(!p.cutout){ status('抜き画像がありません'); return; } p.cutout.toBlob(b=>{ if(b) downloadBlob(b,`chromafight_cutout_${fileStamp()}.png`); },'image/png'); });
$('#dlOriginal').addEventListener('click', ()=>{
  const p=players[settings.activePlayer]; if(!p.source){ status('元写真がありません'); return; }
  const sw=p.source.naturalWidth||p.source.width, sh=p.source.naturalHeight||p.source.height;
  const c=document.createElement('canvas'); c.width=sw; c.height=sh; c.getContext('2d').drawImage(p.source,0,0);
  c.toBlob(b=>{ if(b) downloadBlob(b,`chromafight_original_${fileStamp()}.jpg`); },'image/jpeg',0.95);
});
$('#printBtn').addEventListener('click', ()=>{
  const c=outputCanvas(); $('#printImg').src=c.toDataURL('image/jpeg',0.92);
  setTimeout(()=>window.print(),350);
});
$('#exportSettings').addEventListener('click', ()=>{
  const blob=new Blob([JSON.stringify(settings,null,2)],{type:'application/json'});
  downloadBlob(blob,`chromafight_settings_${fileStamp()}.json`);
});
$('#importSettings').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return;
  try{ const obj=JSON.parse(await f.text()); if(obj.version!==1) throw new Error('version mismatch');
    settings=Object.assign(defaultSettings(),obj,{p1:Object.assign(defaultPlayerSettings('PLAYER 1',0.32),obj.p1||{}),p2:Object.assign(defaultPlayerSettings('PLAYER 2',0.68),obj.p2||{})});
    saveSettings(); syncAll(); buildBgList(); if(settings.bgId.startsWith('custom:')){ const bg=customBgs.find(b=>'custom:'+b.id===settings.bgId); if(bg) selectedCustomBgImg=bg.img; }
    reprocess('p1'); reprocess('p2'); renderMain(); status('設定を読み込みました');
  }catch(err){ status('設定の読み込みに失敗: '+err.message); }
  e.target.value='';
});

/* ---------- Init ---------- */
(async function init(){
  syncAll(); buildBgList(); drawSourcePreview(); renderMain(); listCameras();
  try{
    const all=await idbGetAll();
    for(const rec of all){
      if(rec.kind==='bg'){ const img=await loadImageFile(rec.blob); customBgs.push({id:rec.id,name:rec.name,img,url:URL.createObjectURL(rec.blob)}); }
      if(rec.kind==='player'){ const key=rec.id.split(':')[1]; if(players[key]){ const img=await loadImageFile(rec.blob); players[key].source=img; players[key].cutout=processChroma(img, settings[key]); } }
    }
    buildCustomBgList();
    if (settings.bgId.startsWith('custom:')){ const bg=customBgs.find(b=>'custom:'+b.id===settings.bgId); if(bg) selectedCustomBgImg=bg.img; }
    drawSourcePreview(); renderMain();
  }catch(e){ /* IndexedDB unavailable: app still works in-memory */ }
})();
