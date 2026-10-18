import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const base=process.env.VIEWER_URL||'http://127.0.0.1:8766/';
const chromePath=process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const output=new URL('../.test-artifacts/',import.meta.url);await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'cz6a-browser-'));
const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
const delay=(ms)=>new Promise((r)=>setTimeout(r,ms));
const errors=[],checks=[],requests=[],requestURLs=new Map();let ws;
try{
  let port;
  for(let i=0;i<200;i++){try{port=+(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await delay(100);}}
  assert.ok(port,'Chrome debugging endpoint');
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find((t)=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0;const waiting=new Map();
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=waiting.get(m.id);if(p){waiting.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}}
    if(m.method==='Network.requestWillBeSent'){requests.push(m.params.request.url);requestURLs.set(m.params.requestId,m.params.request.url);}
    if(m.method==='Network.loadingFailed')errors.push(`${m.params.errorText} ${requestURLs.get(m.params.requestId)||''}`);
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map((a)=>a.value||a.description).join(' '));
    if(m.method==='Network.responseReceived'&&m.params.response.status>=400)errors.push(`${m.params.response.status} ${m.params.response.url}`);
  };
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;waiting.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  async function wait(expression,timeout=30000){const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await delay(100);}throw new Error('Timed out: '+expression);}
  async function navigate(url){await call('Page.navigate',{url});await wait('!!window.__cz6a && !document.getElementById("loading")');}
  async function shot(name){await delay(300);const r=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(new URL(name,output),Buffer.from(r.data,'base64'));}
  const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
  await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await navigate(base);
  check('default 142-degree profile',await evaluate('__cz6a.profile==="retrograde-142" && Math.abs(__cz6a.meta.inc-142)<.01'));
  check('nominal sunlight pickup',await evaluate('Math.abs(__cz6a.jelly().pickup.met-106.068932)<.1'));
  check('visibility envelope and Twilight jellyfish panel removed',await evaluate('!__cz6a.groups.visGroup && !document.getElementById("jelly") && !document.body.innerText.includes("Twilight jellyfish") && !document.getElementById("legend").textContent.includes("envelope")'));
  check('15-degree circle is green and enabled by default',await evaluate('__cz6a.state.show.fp && document.getElementById("o-fp").checked && __cz6a.footprint().visible && __cz6a.footprint().material.color.getHexString()==="199e70"'));
  check('circle legend matches its green dashed style',await evaluate('(()=>{const s=getComputedStyle(document.querySelector("#legend>div:nth-child(2) span:first-child i"));return s.borderTopColor==="rgb(25, 158, 112)" && s.borderTopStyle==="dashed";})()'));
  check('two solid solar contours',await evaluate('__cz6a.groups.termGroup.children.every(x=>!x.material.dashed) && __cz6a.groups.termGroup.children[0].material.color.getHexString()==="ffd54f" && __cz6a.groups.termGroup.children[1].material.color.getHexString()==="4fc3f7"'));
  check('no Zhuque-specific user-facing text',await evaluate('!(/ZQ-2|TQ-12|SECO-1|circularisation|34′/.test(document.body.innerText))'));
  check('country and regional boundaries are enabled by default',await evaluate('__cz6a.state.show.borders && document.getElementById("o-borders").checked'));
  check('worldwide regional data includes China provinces',await evaluate('__cz6a.boundaryCoverage.region_line_counts.CHN>=50 && Object.keys(__cz6a.boundaryCoverage.region_line_counts).length>150'));
  const boundaryPixels=await evaluate('__cz6a.mapOverlay.getContext("2d").getImageData(2900,390,690,480).data.reduce((s,v)=>s+v,0)');
  await shot('desktop.png');
  await evaluate('document.getElementById("o-borders").click()');
  const withoutBoundaryPixels=await evaluate('__cz6a.mapOverlay.getContext("2d").getImageData(2900,390,690,480).data.reduce((s,v)=>s+v,0)');
  check('border toggle removes visible boundary pixels without hiding other layers',boundaryPixels!==withoutBoundaryPixels && await evaluate('!__cz6a.state.show.borders && __cz6a.state.show.grid && __cz6a.state.show.zones && __cz6a.groups.trajGroup.visible'));
  await shot('boundaries-off.png');
  await evaluate('document.getElementById("o-borders").click()');
  const restoredBoundaryPixels=await evaluate('__cz6a.mapOverlay.getContext("2d").getImageData(2900,390,690,480).data.reduce((s,v)=>s+v,0)');
  check('border toggle restores the boundary overlay',restoredBoundaryPixels>withoutBoundaryPixels*1.5 && await evaluate('__cz6a.state.show.borders'));

  await evaluate('document.getElementById("o-jelly").click()');await delay(200);
  check('jelly toggle does not hide ascent or 15-degree circle',await evaluate('!__cz6a.groups.jellyGroup.visible && __cz6a.groups.trajGroup.visible && __cz6a.groups.trajGroup.children.length>=2 && __cz6a.footprint().visible'));
  await evaluate('__cz6a.setT0(39600)');
  check('T0 changes illumination',await evaluate('!__cz6a.jelly().pickup || Math.abs(__cz6a.jelly().pickup.met-106)>1'));
  await evaluate('__cz6a.setT0(36900);document.getElementById("o-jelly").click()');
  await evaluate('document.getElementById("o-fp").click()');await wait('!__cz6a.footprint().visible');
  check('15-degree circle can still be switched off',await evaluate('!__cz6a.state.show.fp && !__cz6a.footprint().visible'));
  await evaluate('document.getElementById("o-fp").click()');await wait('__cz6a.footprint().visible');
  await evaluate('__cz6a.setMet(100);__cz6a.setPlaying(true)');await delay(400);await evaluate('__cz6a.setPlaying(false)');
  check('playback advances MET',await evaluate('__cz6a.state.met>100'));
  await evaluate('__cz6a.setMet(__cz6a.meta.insertion_met+1.5*__cz6a.meta.period_s)');await delay(200);
  check('full 1.5-revolution endpoint renders',await evaluate('document.getElementById("status").textContent.includes("1.50 / 1.5")'));
  await evaluate('document.querySelector("[data-view=\\"0\\"]").click()');await delay(1400);await shot('global-orbit.png');
  check('global camera preset',await evaluate('Math.abs(__cz6a.camera.position.length()-3.6)<.01'));
  await evaluate('document.querySelector("[data-view=\\"2\\"]").click()');await delay(1400);
  check('visibility checkbox and height slider removed',await evaluate('!document.getElementById("o-vis") && !document.getElementById("exag")'));
  check('configuration and launch-time explanations removed',await evaluate('!document.getElementById("family-note") && !document.getElementById("ctl").textContent.includes("Scenario time range")'));
  check('model notes are concise and link to full sources',await evaluate('document.getElementById("about").textContent.length<200 && !!document.querySelector("#about a[href*=scientific-limitations]")'));
  await evaluate('__cz6a.setMet(300)');
  check('trajectory uses true-scale height',await evaluate('(()=>{const p=__cz6a.groups.trajGroup.children[0].geometry.attributes.instanceStart;return Math.abs(Math.hypot(p.getX(0),p.getY(0),p.getZ(0))-(1+__cz6a.shipAt(0).alt/6378.137))<1e-6;})()'));
  await evaluate('document.getElementById("skybtn").click()');
  await wait('!!document.querySelector(".skw") && document.querySelector(".skw-title .sub").textContent.includes("Chengdu")');
  check('sky chart loads star data and pass geometry',await evaluate('document.querySelector(".skc-passes").textContent.length>0 && document.querySelector(".skc-hud").textContent.includes("AZ")'));
  await shot('sky-chart.png');await evaluate('__cz6a.sky.close();__cz6a.setMet(-90);document.getElementById("o-grid").click();document.getElementById("o-borders").click()');
  const url=await evaluate('__cz6a.shareURL()');await navigate(url);
  check('share link restores negative MET and toggles',await evaluate('__cz6a.state.met===-90 && !__cz6a.state.show.grid && __cz6a.state.show.fp && !__cz6a.state.show.borders && !document.getElementById("o-borders").checked'));
  await navigate(base+'?t0=bad&met=NaN&exag=NaN&cam=1,2,0');
  check('malformed URL input safely defaults or clamps',await evaluate('__cz6a.state.t0===36900 && __cz6a.state.met===300 && __cz6a.camera.position.length()>=1.049'));
  await navigate(base+'?vis=0&exag=5');
  check('obsolete layer and height URL controls are ignored',await evaluate('!__cz6a.groups.visGroup && !new URL(__cz6a.shareURL()).searchParams.has("vis") && !new URL(__cz6a.shareURL()).searchParams.has("exag")'));
  await navigate(base+'?borders=0');
  check('explicit borders-off link overrides the default',await evaluate('!__cz6a.state.show.borders && !document.getElementById("o-borders").checked'));
  await navigate(base+'?fp=0');
  check('explicit circle-off link overrides the default',await evaluate('!__cz6a.state.show.fp && !document.getElementById("o-fp").checked && (!__cz6a.footprint() || !__cz6a.footprint().visible)'));
  await navigate(base);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(250);
  check('mobile page has no horizontal overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await shot('mobile.png');await evaluate('document.querySelector("[data-panel=ctl]").click()');await delay(100);
  check('mobile controls have 16px gutters',await evaluate('(()=>{const r=document.getElementById("ctl").getBoundingClientRect();return r.left>=16 && r.right<=innerWidth-16 && getComputedStyle(document.getElementById("ctl")).display!=="none";})()'));
  await shot('mobile-controls.png');await evaluate('document.getElementById("skybtn").click()');await wait('document.querySelector(".skw-title .sub")?.textContent.includes("Chengdu")');
  check('mobile sky chart stays within viewport',await evaluate('(()=>{const r=document.querySelector(".skw").getBoundingClientRect();return r.left>=16 && r.right<=innerWidth-16;})()'));
  await shot('mobile-sky-chart.png');
  await call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});await delay(200);
  check('320px viewport has no horizontal page overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  check('boundary data loads from the site itself',requests.some((url)=>url.startsWith(new URL(base).origin)&&url.endsWith('/data/boundaries.json')));
  check('no visibility analysis or worker is loaded',!requests.some((url)=>/\/visibility(?:-worker)?\.js(?:[?#]|$)/.test(url)));
  check('no JavaScript or failed-resource errors',errors.length===0);
  const storageBlock=await call('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(window,"localStorage",{get(){throw new Error("Storage disabled by test");}})'});
  await navigate(base);check('blocked browser storage is tolerated',await evaluate('!!__cz6a && !document.getElementById("loading")'));
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:storageBlock.identifier});
  const report={checks_passed:checks.length,checks,errors};await fs.writeFile(new URL('browser-validation.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){console.error(JSON.stringify({browser_errors:errors},null,2));throw error;
}finally{ws?.close();chrome.kill('SIGTERM');if(chrome.exitCode===null)await new Promise((r)=>chrome.once('exit',r));await fs.rm(profile,{recursive:true,force:true});}
