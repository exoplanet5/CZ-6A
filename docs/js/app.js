import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {CSS2DRenderer, CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';
import * as A from './astro.js';
import {fetchJSON, validateManifest, validateMission, selectProfile, createFlight, solarEphemeris, sunlightClearance, computeJelly, clockSeconds, clamp, escapeHTML as esc} from './profile.js';
import {createSkyChart} from './skychart.js';
import {validateBoundaries} from './boundaries.js';
import {createMapTiles} from './map-tiles.js';
import {createBoundaryLayer} from './boundary-layer.js';

const $ = (id) => document.getElementById(id);
const C = {sun:'#ffd54f',accent:'#4fc3f7',ink:'#e8eaed',dim:'#9aa4ae',ascent:'#d95926',orbit:'#3987e5',footprint:'#199e70'};
const qs = new URLSearchParams(location.search);
const message = (text) => { $('notice').textContent = text; };
function fail(error) {
  console.error(error);
  if ($('loading')) $('loadmsg').textContent = `Unable to start: ${error.message}. Check the local server and reload.`;
  else message(error.message);
}
addEventListener('unhandledrejection',(e) => fail(e.reason instanceof Error ? e.reason : new Error(String(e.reason))));

try { await start(); } catch (error) { fail(error); }
async function start() {
  const index = validateManifest(await fetchJSON('./data/profiles.json'));
  const {profile,entry} = selectProfile(index,qs);
  const data = validateMission(await fetchJSON('./'+entry.file)), M = data.meta;
  const {tracks:T,flight,shipAt,poweredAt,end:MET_END} = createFlight(data), ASC = T.ascent;
  const sunAt = solarEphemeris(data.sun), sunVecAt = (utc) => { const p=sunAt(utc),r=Math.hypot(...p);return p.map((v)=>v/r); };
  const sunSubpoint = (utc) => A.vecToLL(...sunAt(utc));
  const t0Min=clockSeconds(M.t0_min), t0Max=clockSeconds(M.t0_max), metMin=-600;
  const num = (key,def,lo,hi) => qs.has(key) && Number.isFinite(+qs.get(key)) ? clamp(+qs.get(key),lo,hi) : def;
  const requestedT0=clockSeconds(qs.get('t0'));
  const state = {date:M.date,t0:Number.isFinite(requestedT0)?clamp(requestedT0,t0Min,t0Max):clockSeconds(M.t0_default),
    met:num('met',300,metMin,MET_END),follow:qs.get('follow')==='1',playing:false,live:false,speed:num('speed',10,1,300),
    show:Object.fromEntries(['term','zones','labels','gt','jelly','grid','lights','cities','fp','borders'].map((k)=>[k,qs.get(k)!=='0']))};
  const t0ms=()=>A.dateT0ms(M.date,state.t0), phaseOf=(met)=>(M.phases.find((p)=>met<p.until)||M.phases.at(-1)).label;
  function styleAt(met,T0) {
    const s=shipAt(met),lit=sunlightClearance(s.p,sunAt(T0+met*1000))>0,powered=poweredAt(met);
    return {lit,powered,color:powered?(lit?C.sun:C.ascent):C.orbit};
  }
  let J=computeJelly(ASC,sunAt,t0ms()), tablesDirty=true;
  const dirty=()=>{tablesDirty=true;};
  document.title='CZ-6A Launch Profiles';
  $('ttl').textContent=M.vehicle; $('ttlsub').textContent=M.date;
  $('subt').textContent=`${M.mission} · ${M.inc.toFixed(1)}° · ${M.orbit_revolutions} revolutions`;
  $('profile-summary').textContent=`${M.perigee_km.toFixed(0)} × ${M.apogee_km.toFixed(0)} km · i ${M.inc.toFixed(2)}°`;
  $('datev').textContent=M.date;
  $('model-badge').textContent='Provisional model';

  const view=$('view'), renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2)); view.appendChild(renderer.domElement);
  const labels=new CSS2DRenderer(); Object.assign(labels.domElement.style,{position:'absolute',inset:'0',pointerEvents:'none'});view.appendChild(labels.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#05070a');
  const camera=new THREE.PerspectiveCamera(35,1,0.005,200);
  const controls=new OrbitControls(camera,renderer.domElement);
  Object.assign(controls,{enableDamping:true,dampingFactor:.08,enablePan:false,minDistance:1.05,maxDistance:14,zoomSpeed:.9});
  const materials=new Set(), Y=new THREE.Vector3(0,1,0);
  function line(flat,{color=C.ink,width=1.8,opacity=1,dashed=false}={}) {
    const g=new LineGeometry();g.setPositions(flat);
    const m=new LineMaterial({color,linewidth:width,transparent:opacity<1||dashed,opacity,dashed,dashSize:.008,gapSize:.006,depthTest:true});
    m.resolution.set(view.clientWidth,view.clientHeight); materials.add(m);
    const l=new Line2(g,m);if(dashed)l.computeLineDistances();return l;
  }
  function group() {const g=new THREE.Group();scene.add(g);return g;}
  function clear(g) {
    g.traverse((o)=>{o.geometry?.dispose();if(o.material){materials.delete(o.material);o.material.dispose();}if(o.isCSS2DObject)o.element.remove();});g.clear();
  }
  function label(text,cls='') {const el=document.createElement('div');el.className='lbl '+cls;el.textContent=text;const o=new CSS2DObject(el);o.center.set(0,.5);return o;}
  function texture(draw,size=64) {const cv=document.createElement('canvas');cv.width=cv.height=size;draw(cv.getContext('2d'),size);return new THREE.CanvasTexture(cv);}
  function sprite(tex,size=.016) {const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,sizeAttenuation:false,transparent:true,depthTest:true}));s.scale.set(size,size,1);return s;}
  const dotTex=texture((g,s)=>{g.fillStyle='#c9ccd1';g.strokeStyle='#080a0e';g.lineWidth=7;g.beginPath();g.arc(s/2,s/2,s/2-9,0,2*Math.PI);g.fill();g.stroke();});
  const squareTex=texture((g,s)=>{g.fillStyle=C.ink;g.strokeStyle='#080a0e';g.lineWidth=6;g.fillRect(s*.28,s*.28,s*.44,s*.44);g.strokeRect(s*.28,s*.28,s*.44,s*.44);});
  const starTex=texture((g,s)=>{g.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=s*(i%2?.18:.42);g.lineTo(s/2+r*Math.cos(a),s/2+r*Math.sin(a));}g.closePath();g.fillStyle=C.ink;g.strokeStyle='#080a0e';g.lineWidth=4;g.fill();g.stroke();});
  function circle(colat,r=1.002,n=360) {const out=[],a=colat*A.D2R;for(let i=0;i<=n;i++){const p=i/n*2*Math.PI;out.push(r*Math.sin(a)*Math.cos(p),r*Math.cos(a),r*Math.sin(a)*Math.sin(p));}return out;}
  const drawPoint=(s)=>s.u.map((v)=>v*(1+s.alt/A.RE));
  function visible(p) {
    const d=p.clone().sub(camera.position),t=clamp(-camera.position.dot(d)/d.lengthSq(),0,1);
    return camera.position.clone().addScaledVector(d,t).lengthSq()>=.9999 && p.clone().project(camera).z<1;
  }

  const loader=new THREE.TextureLoader();
  const loadTex=(url)=>new Promise((resolve,reject)=>loader.load(url,(t)=>{t.colorSpace=THREE.NoColorSpace;t.anisotropy=renderer.capabilities.getMaxAnisotropy();resolve(t);},undefined,()=>reject(new Error(`Texture missing: ${url}`))));
  $('loadmsg').textContent='Loading Blue Marble…';
  const [dayTex,nightTex,boundaryRaw]=await Promise.all([loadTex('./tex/earth_day_4k.jpg'),loadTex('./tex/earth_night.jpg'),fetchJSON('./data/boundaries.json')]);
  const boundaryData=validateBoundaries(boundaryRaw);
  const ovCanvas=document.createElement('canvas');ovCanvas.width=4096;ovCanvas.height=2048;
  const ovCtx=ovCanvas.getContext('2d'),ovTex=new THREE.CanvasTexture(ovCanvas);ovTex.colorSpace=THREE.NoColorSpace;
  function drawOverlay() {
    const W=ovCanvas.width,H=ovCanvas.height,X=(lon)=>(lon+180)/360*W,Y=(lat)=>(90-lat)/180*H;
    ovCtx.clearRect(0,0,W,H);
    if(state.show.grid){ovCtx.lineWidth=1;ovCtx.strokeStyle='rgba(255,255,255,.13)';
      for(let lon=-180;lon<=180;lon+=10){ovCtx.beginPath();ovCtx.moveTo(X(lon),0);ovCtx.lineTo(X(lon),H);ovCtx.stroke();}
      for(let lat=-80;lat<=80;lat+=10){ovCtx.beginPath();ovCtx.moveTo(0,Y(lat));ovCtx.lineTo(W,Y(lat));ovCtx.stroke();}}
    if(state.show.zones)for(const z of data.zones){const ring=[];for(const [lon,lat]of z.ring){const prev=ring.at(-1)?.[0]??lon;ring.push([prev+((lon-prev+540)%360)-180,lat]);}for(const shift of [-360,0,360]){ovCtx.beginPath();ring.forEach(([lon,lat],i)=>(i?ovCtx.lineTo:ovCtx.moveTo).call(ovCtx,X(lon+shift),Y(lat)));ovCtx.closePath();ovCtx.fillStyle='rgba(232,234,237,.18)';ovCtx.fill();}}
    ovTex.needsUpdate=true;
  }
  const earthMat=new THREE.ShaderMaterial({uniforms:{dayTex:{value:dayTex},nightTex:{value:nightTex},ovTex:{value:ovTex},sunDir:{value:new THREE.Vector3(1,0,0)},lights:{value:1},tileRect:{value:new THREE.Vector4(0,0,1,1)},imageRect:{value:new THREE.Vector4(0,0,1,1)}},
    vertexShader:`varying vec2 vUv;varying vec3 vP;void main(){vUv=uv;vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform sampler2D dayTex,nightTex,ovTex;uniform vec3 sunDir;uniform float lights;uniform vec4 tileRect,imageRect;varying vec2 vUv;varying vec3 vP;void main(){vec2 globalUV=tileRect.xy+vUv*tileRect.zw;vec2 imageUV=imageRect.xy+vUv*imageRect.zw;float mu=dot(normalize(vP),sunDir);vec3 col=texture2D(dayTex,imageUV).rgb*mix(.20,1.,smoothstep(-.2079,.03,mu));vec3 nl=texture2D(nightTex,globalUV).rgb;col+=nl*nl*vec3(1.,.86,.62)*1.25*(1.-smoothstep(-.2079,-.0523,mu))*lights;vec4 ov=texture2D(ovTex,globalUV);gl_FragColor=vec4(mix(col,ov.rgb,ov.a),1.);}`});
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1,256,128),earthMat));
  const mapTiles=createMapTiles({scene,camera,renderer,earthMaterial:earthMat,loadTexture:loadTex});
  const boundaryLayer=createBoundaryLayer({scene,camera,initialData:boundaryData});
  const termGroup=group();termGroup.add(line(circle(90),{color:C.sun,width:1.8}),line(circle(102),{color:C.accent,width:1.5}));
  const zoneGroup=group(),zoneLabels=group(),trajGroup=group(),gtGroup=group(),eventGroup=group(),jellyGroup=group(),cityGroup=group();
  const PAD=A.llToVec(...M.pad),pad=sprite(squareTex,.021);pad.position.set(...PAD.map((v)=>v*1.002));scene.add(pad);
  const padLabel=label(M.pad_name);padLabel.position.copy(pad.position);eventGroup.add(padLabel);
  for(const z of data.zones){const pts=[];for(let i=0;i<z.ring.length-1;i++){const a=z.ring[i],b=z.ring[i+1],dl=((b[0]-a[0]+540)%360)-180,n=Math.max(1,Math.ceil(Math.max(Math.abs(dl),Math.abs(b[1]-a[1]))/.1));for(let j=0;j<n;j++)pts.push(...A.llToVec(a[0]+dl*j/n,a[1]+(b[1]-a[1])*j/n,1.0015));}pts.push(...A.llToVec(...z.ring.at(-1),1.0015));zoneGroup.add(line(pts,{color:z.color,width:1.5}));
    const o=label(`${z.role==='boosters'?'Booster':z.role} drop zone\n${z.id} · ${z.t0}–${z.t1} UTC`,'zone below');o.position.set(...A.llToVec(...z.centroid,1.002));zoneLabels.add(o);}
  const CITIES=[['Beijing',116.4,39.9,1],['Shanghai',121.5,31.2,1],['Taiyuan',112.55,37.87,2],['Hohhot',111.7,40.8,2],['Chengdu',104.07,30.66,1],['Chongqing',106.55,29.56,1],['Lhasa',91.13,29.65,1],['Ürümqi',87.6,43.8,1],['Kunming',102.71,25.04,1],["Xi'an",108.94,34.34,1],['Guangzhou',113.3,23.1,1],['Wuhan',114.3,30.6,1],['Lanzhou',103.83,36.06,1],['Xining',101.78,36.62,1],['Yinchuan',106.23,38.49,2],['Jiuquan',98.49,39.73,1],['Dunhuang',94.66,40.14,2],['Zhangye',100.45,38.93,2],['Golmud',94.9,36.4,1],['Yushu',97.01,33,2],['Chamdo',97.17,31.14,2],['Hong Kong',114.2,22.3,2],['Kathmandu',85.3,27.7,1],['New Delhi',77.2,28.6,1],['Hanoi',105.8,21,1]];
  for(const [name,lon,lat,tier] of CITIES){const p=A.llToVec(lon,lat,1.001),dot=sprite(dotTex,.007);dot.position.set(...p);dot.userData.tier=tier;cityGroup.add(dot);const o=label(name,'city');o.position.set(...p);o.userData.tier=tier;o.element.title=`Sky chart over ${name}`;o.element.tabIndex=0;o.element.setAttribute('role','button');o.element.addEventListener('click',()=>openSky({name,lon,lat}));o.element.addEventListener('keydown',(e)=>{if(e.key==='Enter')openSky({name,lon,lat});});cityGroup.add(o);}
  const pickup=sprite(starTex,.025),pickupLabel=label('','below');scene.add(pickup,pickupLabel);
  function buildJellyLayer(){clear(jellyGroup);let run=[];
    const flush=()=>{if(run.length>=6){jellyGroup.add(line(run,{color:C.sun,width:8,opacity:.16}),line(run,{color:C.sun,width:2.6}));}run=[];};
    for(let i=0;i<ASC.n;i++){if(J.lit[i] && poweredAt(ASC.metAt(i)))run.push(...ASC.pt(i,1));else flush();}flush();
    let shadow=[];const flushShadow=()=>{if(shadow.length>=6)jellyGroup.add(line(shadow,{color:C.dim,width:1.2,dashed:true,opacity:.8}));shadow=[];};
    for(let i=0;i<ASC.n;i++){if(J.h[i]>0 && J.h[i]<1500)shadow.push(...ASC.pt(i,1,J.h[i]));else flushShadow();}flushShadow();
    if(J.pickup){pickup.position.set(...drawPoint(J.pickup));pickupLabel.position.copy(pickup.position);pickupLabel.element.textContent=`Sunlight pickup\n${A.fmtMET(J.pickup.met)} · ${J.pickup.alt.toFixed(1)} km`;}
  }
  function buildTrajectory(){clear(trajGroup);clear(gtGroup);clear(eventGroup);
    const p=label(M.pad_name);p.position.copy(pad.position);eventGroup.add(p);
    for(const [key,tr] of Object.entries(T)){const seg=data.tracks[key];trajGroup.add(line(tr.pts(1),{color:seg.color,width:1.8,dashed:!!seg.dashed}));if(M.flight_segments.includes(key))gtGroup.add(line(tr.pts(1,0,tr.n-1,true),{color:C.ink,width:1,opacity:.26,dashed:true}));}
    for(const e of data.events){if(!e.major || e.met===0)continue;const tr=e.track?T[e.track]:null,s=tr?tr.sample(e.met):shipAt(e.met);const p=drawPoint(s),dot=sprite(squareTex,.016);dot.position.set(...p);eventGroup.add(dot);const o=label(`${e.label}\n${A.fmtMET(e.met)}`,'small');o.position.set(...p);eventGroup.add(o);}
    buildJellyLayer();
  }
  function onT0Change(){J=computeJelly(ASC,sunAt,t0ms());buildJellyLayer();dirty();}

  const rocketTex=texture((g,s)=>{g.strokeStyle='#080a0e';g.lineWidth=2;g.fillStyle='#c9cfd5';
    for(const side of [-1,1]){const x=s/2+side*s*.15;g.beginPath();g.moveTo(x-s*.045,s*.87);g.lineTo(x-s*.045,s*.48);g.lineTo(x,s*.38);g.lineTo(x+s*.045,s*.48);g.lineTo(x+s*.045,s*.87);g.closePath();g.fill();g.stroke();}
    g.beginPath();g.moveTo(s*.44,s*.9);g.lineTo(s*.44,s*.23);g.quadraticCurveTo(s*.40,s*.14,s*.5,s*.05);g.quadraticCurveTo(s*.60,s*.14,s*.56,s*.23);g.lineTo(s*.56,s*.9);g.closePath();g.fillStyle='#edf0f3';g.fill();g.stroke();g.fillStyle='#4e5964';g.fillRect(s*.44,s*.4,s*.12,s*.035);},128);
  const ship=sprite(rocketTex,.038),shipLabel=label(M.vehicle,'vehicle');scene.add(ship,shipLabel);
  const glowTex=texture((g,s)=>{const r=s/2,gr=g.createRadialGradient(r,r,0,r,r,r);gr.addColorStop(0,'rgba(255,244,211,.9)');gr.addColorStop(.22,'rgba(255,230,150,.5)');gr.addColorStop(.7,'rgba(120,190,255,.1)');gr.addColorStop(1,'rgba(120,190,255,0)');g.fillStyle=gr;g.fillRect(0,0,s,s);},128);
  const glow=sprite(glowTex,.10);glow.material.blending=THREE.AdditiveBlending;glow.material.depthWrite=false;scene.add(glow);
  let fp=null,fpLam=-1;
  function updateFootprint(s){if(!state.show.fp){if(fp)fp.visible=false;return;}const lam=A.footprintDeg(s.alt,15);if(!fp||Math.abs(lam-fpLam)>.03){if(fp){scene.remove(fp);fp.geometry.dispose();materials.delete(fp.material);fp.material.dispose();}fp=line(circle(lam),{color:C.footprint,dashed:true,width:1.5});scene.add(fp);fpLam=lam;}fp.quaternion.setFromUnitVectors(Y,new THREE.Vector3(...s.u));fp.visible=s.alt>1;}
  let skySite=null;
  const sky=createSkyChart({shipAt,metEnd:()=>MET_END,styleAt,seco:M.insertion_met,vehicle:M.vehicle,fmtMET:A.fmtMET,sunSubpoint,
    sunPosition:sunAt,getState:()=>({met:state.met,t0ms:t0ms()}),onJump:(met)=>{setPlaying(false);setMet(met);},onSite:(site)=>{skySite=site;}});
  function openSky(site,focus=false){sky.open(site,focus).catch((e)=>message(`Sky chart: ${e.message}`));}
  $('skybtn').onclick=()=>openSky(skySite||{name:'Chengdu',lat:30.66,lon:104.07},true);

  let fly=null;
  function setFollow(on){state.follow=on;$('o-follow').checked=on;}
  const cameraScale=()=>Math.max(1,1.4/camera.aspect);
  function flyTo(lon,lat,dist){setFollow(false);const d=clamp(1+(dist-1)*cameraScale(),1.05,14);fly={from:camera.position.clone(),to:new THREE.Vector3(...A.llToVec(lon,lat,d)),start:performance.now()};}
  function setMet(v){if(!Number.isFinite(v))return;state.met=clamp(v,metMin,MET_END);state.live=false;$('live').classList.remove('on');dirty();}
  function setPlaying(on){if(on){state.live=false;$('live').classList.remove('on');if(state.met>=MET_END)state.met=0;}state.playing=on;$('play').textContent=on?'❚❚ Pause':'▶ Play';}
  function setT0(v){if(!Number.isFinite(v))return;state.t0=clamp(v,t0Min,t0Max);$('t0').value=state.t0;onT0Change();}
  function option(select,value,text){const o=document.createElement('option');o.value=value;o.textContent=text;select.appendChild(o);}
  for(const p of index.profiles)option($('profilesel'),p.id,p.label);$('profilesel').value=profile.id;
  for(const m of profile.missions)option($('launchsel'),m.id,m.label);$('launchsel').value=entry.id;
  function selectMission(p,m){const q=new URLSearchParams(location.search);q.set('profile',p);q.set('mission',m);for(const k of ['t0','met','cam','sky','follow'])q.delete(k);location.search=q;}
  $('profilesel').onchange=()=>{const p=index.profiles.find((p)=>p.id===$('profilesel').value);selectMission(p.id,p.default_mission);};
  $('launchsel').onchange=()=>selectMission(profile.id,$('launchsel').value);
  Object.assign($('t0'),{min:t0Min,max:t0Max,value:state.t0});Object.assign($('met'),{min:metMin,max:MET_END,value:state.met});
  $('t0presets').innerHTML=M.t0_presets.map((p)=>`<button class="btn" data-t0="${esc(p.time)}">${esc(p.label)}</button>`).join('');
  $('views').innerHTML=M.views.map((v,i)=>`<button class="btn" data-view="${i}">${esc(v[0])}</button>`).join('');
  $('t0').oninput=()=>setT0(+$('t0').value);$('t0presets').onclick=(e)=>{if(e.target.dataset.t0)setT0(clockSeconds(e.target.dataset.t0));};
  $('met').oninput=()=>{setPlaying(false);setMet(+$('met').value);};$('play').onclick=()=>setPlaying(!state.playing);
  $('speed').value=String(state.speed);$('speed').onchange=()=>{state.speed=+$('speed').value;};
  $('back').onclick=()=>setMet(state.met-30);$('fwd').onclick=()=>setMet(state.met+30);
  $('live').onclick=()=>{if(state.live){state.live=false;$('live').classList.remove('on');return;}const met=(Date.now()-t0ms())/1000;if(met<metMin||met>MET_END){message('The wall clock is outside this modeled flight. Use playback to explore the scenario.');return;}message('');setPlaying(false);state.live=true;$('live').classList.add('on');};
  $('views').onclick=(e)=>{const v=M.views[+e.target.dataset.view];if(v)flyTo(v[1],v[2],v[3]);};
  for(const k of Object.keys(state.show)){$('o-'+k).checked=state.show[k];$('o-'+k).onchange=()=>{state.show[k]=$('o-'+k).checked;drawOverlay();dirty();};}
  $('o-follow').checked=state.follow;$('o-follow').onchange=()=>setFollow($('o-follow').checked);
  async function copyText(text,button){const old=button.textContent;let copied=false;try{await navigator.clipboard.writeText(text);copied=true;}catch{const box=document.createElement('textarea');box.value=text;document.body.appendChild(box);box.select();copied=document.execCommand('copy');box.remove();}button.textContent=copied?'Copied':'Copy unavailable';if(!copied)message('Clipboard unavailable. Select the TLE text or copy the browser address.');setTimeout(()=>{button.textContent=old;},1600);}
  function shareURL(){const ll=A.vecToLL(camera.position.x,camera.position.y,camera.position.z),q=new URLSearchParams({profile:profile.id,mission:entry.id,t0:A.fmtHMS(t0ms()),met:state.met.toFixed(3),cam:`${ll.lon.toFixed(3)},${ll.lat.toFixed(3)},${camera.position.length().toFixed(3)}`,follow:state.follow?'1':'0',speed:state.speed});for(const [k,v]of Object.entries(state.show))q.set(k,v?'1':'0');if(sky.isOpen()&&skySite)q.set('sky',`${skySite.lat.toFixed(4)},${skySite.lon.toFixed(4)}`);return `${location.origin}${location.pathname}?${q}`;}
  $('link').onclick=()=>{const url=shareURL();history.replaceState(null,'',url);copyText(url,$('link'));};$('copytle').onclick=()=>copyText($('tle').textContent,$('copytle'));
  $('events').onclick=(e)=>{const row=e.target.closest('[data-met]');if(row){setPlaying(false);setMet(+row.dataset.met);}};
  $('legend').innerHTML=`<div>${M.flight_segments.map((k)=>`<span><i style="border-color:${data.tracks[k].color}"></i>${esc(data.tracks[k].label)}</span>`).join('')}<span><i style="border-color:${C.sun};border-top-width:3px"></i>Sunlit ascent</span></div><div><span><i class="d" style="border-color:${C.footprint}"></i>15° circle</span><span><i style="border-color:${C.sun}"></i>Sun 0°</span><span><i style="border-color:${C.accent}"></i>Sun −12°</span></div>`;
  $('about').innerHTML='<p>Conditional model, not an observed trajectory.</p><p>WGS84 geometry · JPL DE440s sunlight.</p><p><a href="https://github.com/exoplanet5/CZ-6A#scientific-limitations" target="_blank" rel="noopener noreferrer">Model notes & sources ↗</a></p>';
  const narrow=matchMedia('(max-width:860px)');let panels={ctl:!narrow.matches,info:!narrow.matches};
  try{const saved=JSON.parse(localStorage.getItem('cz6a-panels'));if(saved&&!narrow.matches)panels={ctl:!!saved.ctl,info:!!saved.info};}catch{}
  function applyPanels(){document.body.classList.toggle('ctl-open',panels.ctl);document.body.classList.toggle('info-open',panels.info);document.querySelectorAll('[data-panel]').forEach((b)=>{b.classList.toggle('on',panels[b.dataset.panel]);b.setAttribute('aria-expanded',String(panels[b.dataset.panel]));});}
  document.querySelectorAll('[data-panel]').forEach((b)=>b.onclick=()=>{const k=b.dataset.panel,on=!panels[k];if(narrow.matches)panels={ctl:false,info:false};panels[k]=on;applyPanels();try{localStorage.setItem('cz6a-panels',JSON.stringify(panels));}catch{}});
  narrow.onchange=()=>{panels={ctl:!narrow.matches,info:!narrow.matches};applyPanels();};applyPanels();
  addEventListener('keydown',(e)=>{if(document.activeElement?.matches('input,select,textarea,button,[role="button"]'))return;if(e.code==='Space'){e.preventDefault();setPlaying(!state.playing);}if(e.key==='ArrowRight')setMet(state.met+(e.shiftKey?300:10));if(e.key==='ArrowLeft')setMet(state.met-(e.shiftKey?300:10));});

  const timeline=()=>[...data.events,...(J.pickup&&!J.pickup.fromLiftoff?[{met:J.pickup.met,label:'Sunlight pickup'}]:[])].sort((a,b)=>a.met-b.met);
  function buildTables(){const T0=t0ms();$('t0v').textContent=A.fmtHMS(T0)+'Z';
    $('hazard').querySelector('tbody').innerHTML=data.zones.map((z)=>`<tr><td>${esc(z.id)}<br>${esc(z.role)}</td><td>${z.t0.slice(0,2)}:${z.t0.slice(2)}–${z.t1.slice(0,2)}:${z.t1.slice(2)}Z</td><td>${z.impact?A.fmtHMS(T0+z.impact.met*1000)+'Z':'Not modeled'}</td></tr>`).join('');
    $('events').querySelector('tbody').innerHTML=timeline().map((e)=>`<tr><td><button class="time-jump" data-met="${e.met}">${A.fmtMET(e.met)}</button></td><td>${A.fmtHMS(T0+e.met*1000)}</td><td>${esc(e.label)}</td></tr>`).join('');
    const R=data.tle_ref,sets=R?.sets||[];$('tle').textContent=sets.length?sets.map((s)=>{const t=A.tleForT0(s,R.t0,R.raan_rate_deg_per_min,T0);return `${t.name}\n${t.l1}\n${t.l2}`;}).join('\n\n'):'No TLE supplied for this profile.';$('copytle').disabled=!sets.length;
    document.querySelectorAll('[data-t0]').forEach((b)=>b.classList.toggle('on',clockSeconds(b.dataset.t0)===state.t0));tablesDirty=false;
  }
  function updateUI(s){const utc=t0ms()+state.met*1000,st=styleAt(state.met,t0ms()),ll=A.vecToLL(...s.u),fr=A.siteFrame(ll.lon,ll.lat),sunAlt=A.lookAngles(fr,sunAt(utc)).el;
    $('c-date').textContent=A.fmtDate(utc);$('c-utc').textContent=A.fmtHMS(utc);$('c-met').textContent=A.fmtMET(state.met);$('c-cst').textContent=A.fmtHMS(utc,8);$('metv').textContent=A.fmtMET(state.met);if(document.activeElement!==$('met'))$('met').value=state.met;
    if(tablesDirty)buildTables();
    const a=shipAt(state.met-1),b=shipAt(state.met+1),v=b.p.map((x,i)=>(x-a.p[i])/2),w=7.2921158553e-5;
    const speed=state.met>1&&state.met<MET_END-1?Math.hypot(v[0]+w*s.p[2],v[1],v[2]-w*s.p[0]).toFixed(2)+' km/s':'—';
    const rows=[['Phase',phaseOf(state.met)],['Altitude',s.alt.toFixed(1)+' km WGS84'],['Inertial speed',speed],['Sub-point',`${ll.lat.toFixed(2)}°, ${ll.lon.toFixed(2)}°`],['Illumination',st.lit?(st.powered?'Sunlit powered arc':'Sunlit'):'Earth shadow'],['Ground below',`${A.lightingClass(sunAlt)} · ${sunAlt.toFixed(1)}°`],['Orbit progress',state.met>=M.insertion_met?`${((state.met-M.insertion_met)/M.period_s).toFixed(2)} / ${M.orbit_revolutions} rev`:'Before insertion']];
    $('status').querySelector('tbody').innerHTML=rows.map(([k,v])=>`<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('');
    const next=timeline().find((e)=>e.met>state.met);document.querySelectorAll('#events [data-met]').forEach((b)=>{b.closest('tr').classList.toggle('past',+b.dataset.met<=state.met);b.closest('tr').classList.toggle('next',next?.met===+b.dataset.met);});
  }
  let down=null,hoverMet=null;
  renderer.domElement.addEventListener('pointerdown',(e)=>{down=[e.clientX,e.clientY];fly=null;setFollow(false);});
  renderer.domElement.addEventListener('pointerup',(e)=>{if(down&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<4&&hoverMet!==null){setPlaying(false);setMet(hoverMet);}down=null;});
  renderer.domElement.addEventListener('pointerleave',()=>{$('inspect').hidden=true;hoverMet=null;});
  renderer.domElement.addEventListener('pointermove',(e)=>{if(e.buttons)return;const r=view.getBoundingClientRect();let nearest=null,best=13;
    for(const tr of flight)for(let i=0;i<tr.n;i+=3){const p=new THREE.Vector3(...tr.pt(i,1));if(!visible(p))continue;const q=p.project(camera),d=Math.hypot((q.x+1)*r.width/2+r.left-e.clientX,(1-q.y)*r.height/2+r.top-e.clientY);if(d<best){best=d;nearest={met:tr.metAt(i),alt:tr.alt[i]};}}
    hoverMet=nearest?.met??null;$('inspect').hidden=!nearest;renderer.domElement.style.cursor=nearest?'pointer':'';if(nearest){$('inspect').textContent=`${A.fmtMET(nearest.met)} · ${nearest.alt.toFixed(1)} km\nClick to seek`;Object.assign($('inspect').style,{left:Math.max(16,Math.min(innerWidth-240,e.clientX+15))+'px',top:Math.min(innerHeight-80,e.clientY+15)+'px'});}});
  function declutterLabels(){
    const boxes=['ctl','info','legend'].map((id)=>$(id)).filter((el)=>el.getClientRects().length).map((el)=>el.getBoundingClientRect());
    const overlap=(a,b)=>a.left<b.right+4 && a.right+4>b.left && a.top<b.bottom+3 && a.bottom+3>b.top;
    const objects=[shipLabel,pickupLabel,...eventGroup.children,...zoneLabels.children,...cityGroup.children];
    for(const o of objects){if(!o.isCSS2DObject || o.element.style.display==='none')continue;const r=o.element.getBoundingClientRect();const show=r.left>=16 && r.right<=innerWidth-16 && r.top>=50 && r.bottom<=innerHeight-24 && !boxes.some((b)=>overlap(r,b));o.element.style.visibility=show?'visible':'hidden';if(show)boxes.push(r);}
  }
  let last=null,lastUI=0;
  function frame(now){const dt=Math.min(.1,(now-(last??now))/1000);last=now;
    if(state.live){const met=(Date.now()-t0ms())/1000;state.met=clamp(met,metMin,MET_END);if(met>=MET_END){state.live=false;$('live').classList.remove('on');message('Modeled flight complete.');}}
    else if(state.playing){state.met=Math.min(MET_END,state.met+dt*state.speed);if(state.met===MET_END)setPlaying(false);}
    const s=shipAt(state.met),sv=sunVecAt(t0ms()+state.met*1000),sty=styleAt(state.met,t0ms());earthMat.uniforms.sunDir.value.set(...sv);earthMat.uniforms.lights.value=state.show.lights?1:0;termGroup.quaternion.setFromUnitVectors(Y,new THREE.Vector3(...sv));termGroup.visible=state.show.term;
    ship.position.set(...drawPoint(s));shipLabel.position.copy(ship.position);ship.material.color.setScalar(sty.lit?1:.45);glow.position.copy(ship.position);glow.visible=state.show.jelly&&sty.lit&&sty.powered;
    const ahead=shipAt(Math.min(MET_END,state.met+2)),p0=ship.position.clone().project(camera),p1=new THREE.Vector3(...drawPoint(ahead)).project(camera);if(state.met>0&&state.met<MET_END)ship.material.rotation=Math.atan2((p1.y-p0.y)*view.clientHeight,(p1.x-p0.x)*view.clientWidth)-Math.PI/2;
    updateFootprint(s);gtGroup.visible=state.show.gt;zoneGroup.visible=state.show.zones;zoneLabels.visible=state.show.zones;jellyGroup.visible=state.show.jelly;cityGroup.visible=state.show.cities;
    if(fly){const k=clamp((now-fly.start)/1200,0,1),t=k*k*(3-2*k),d=THREE.MathUtils.lerp(fly.from.length(),fly.to.length(),t);camera.position.copy(fly.from.clone().normalize().lerp(fly.to.clone().normalize(),t).normalize().multiplyScalar(d));if(k===1)fly=null;}
    else if(state.follow){const d=camera.position.length();camera.position.normalize().lerp(new THREE.Vector3(...s.u),1-Math.exp(-dt*2.5)).normalize().multiplyScalar(d);}
    controls.rotateSpeed=Math.min(1,.12+.3*(camera.position.length()-1));controls.update();
    mapTiles.update(now,view.clientWidth,view.clientHeight);
    boundaryLayer.update(now,view.clientWidth,view.clientHeight,renderer.getPixelRatio(),state.show.borders);
    for(const g of [zoneLabels,eventGroup])for(const o of g.children)if(o.isCSS2DObject)o.visible=state.show.labels&&visible(o.position);
    pickup.visible=!!J.pickup&&state.show.jelly;pickupLabel.visible=pickup.visible&&state.show.labels&&visible(pickup.position);shipLabel.visible=state.show.labels&&visible(ship.position);
    for(const o of cityGroup.children)o.visible=visible(o.position)&&camera.position.length()<(o.userData.tier===1?2.9:1.75)&&(!o.isCSS2DObject||state.show.labels);
    renderer.render(scene,camera);labels.render(scene,camera);declutterLabels();if(sky.isOpen()&&now-lastUI>80)sky.render();if(now-lastUI>100){lastUI=now;updateUI(s);}requestAnimationFrame(frame);
  }
  function resize(){const w=view.clientWidth,h=view.clientHeight,oldScale=cameraScale();camera.aspect=w/h;const d=camera.position.length();if(d>0)camera.position.setLength(clamp(1+(d-1)*cameraScale()/oldScale,1.05,14));renderer.setSize(w,h);labels.setSize(w,h);camera.updateProjectionMatrix();for(const m of materials)m.resolution.set(w,h);}
  addEventListener('resize',resize);resize();
  const cam=(qs.get('cam')||'').split(',').map(Number),v=M.views[Math.min(2,M.views.length-1)];
  const [lon,lat,dist]=cam.length===3&&cam.every(Number.isFinite)?[cam[0],clamp(cam[1],-90,90),clamp(cam[2],1.05,14)]:v.slice(1);
  camera.position.set(...A.llToVec(lon,lat,qs.has('cam')?dist:clamp(1+(dist-1)*cameraScale(),1.05,14)));camera.lookAt(0,0,0);drawOverlay();buildTrajectory();
  requestAnimationFrame((t)=>{frame(t);$('loading').remove();});
  const want=qs.get('sky'),city=CITIES.find((c)=>c[0].toLowerCase()===want?.toLowerCase()),ll=(want||'').split(',').map(Number);
  if(city)openSky({name:city[0],lon:city[1],lat:city[2]});else if(ll.length===2&&ll.every(Number.isFinite)&&Math.abs(ll[0])<=90&&Math.abs(ll[1])<=180)openSky({lat:ll[0],lon:ll[1],custom:true});
  window.__cz6a={state,setMet,setT0,setPlaying,flyTo,camera,shareURL,sky,shipAt,jelly:()=>J,footprint:()=>fp,boundaryCoverage:boundaryData.coverage,mapOverlay:ovCanvas,mapLOD:mapTiles,boundaries:boundaryLayer,meta:M,groups:{trajGroup,jellyGroup,termGroup},profile:profile.id,mission:entry.id};
}
