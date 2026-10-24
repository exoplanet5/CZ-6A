import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from '../docs/js/astro.js';
import {validateManifest,validateMission,selectProfile,createFlight,solarEphemeris,sunlightClearance,computeJelly,clockSeconds,Track} from '../docs/js/profile.js';
import {calculateVisibility,contour} from '../tools/visibility.js';
const load=(name)=>JSON.parse(fs.readFileSync(new URL('../docs/data/'+name,import.meta.url)));
const data=load('yaogan50-03.json'),index=load('profiles.json'),T0=Date.parse(data.tle_ref.t0),flight=createFlight(data),sun=solarEphemeris(data.sun);
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);

test('manifest has explicit default independent of profile order',()=>{
  validateManifest(index);
  const more=structuredClone(index);more.profiles.push({...structuredClone(more.profiles[0]),id:'test-polar-fixture',label:'Test fixture'});
  assert.equal(selectProfile(more,new URLSearchParams()).profile.id,'retrograde-142');
  assert.equal(selectProfile(more,new URLSearchParams('profile=test-polar-fixture')).profile.id,'test-polar-fixture');
  assert.equal(selectProfile(more,new URLSearchParams('profile=unknown')).profile.id,'retrograde-142');
  more.default_profile='missing';assert.throws(()=>validateManifest(more));
});
test('mission schema rejects gaps, nonfinite samples and incomplete solar coverage',()=>{
  validateMission(data);
  for(const change of [(d)=>d.tracks.orbit.met0++, (d)=>d.tracks.ascent.alt.pop(), (d)=>d.tracks.ascent.lon[3]=NaN, (d)=>d.sun.vectors.length=2]){
    const bad=structuredClone(data);change(bad);assert.throws(()=>validateMission(bad));
  }
});
test('insertion joins are continuous and endpoint is exactly 1.5 nominal periods',()=>{
  const a=flight.tracks.ascent.sample(data.meta.insertion_met),b=flight.tracks.orbit.sample(data.meta.insertion_met);
  near(Math.hypot(...a.p.map((v,i)=>v-b.p[i])),0);near(flight.end-data.meta.insertion_met,1.5*data.meta.period_s);
  near(flight.shipAt(flight.end+100).alt,flight.shipAt(flight.end).alt);
});
test('generic flight traversal supports a third coast segment',()=>{
  const d=structuredClone(data),o=d.tracks.orbit,k=100;
  d.tracks.coast={...o};d.tracks.orbit={...o,met0:o.met0+k*o.dt};
  for(const field of ['lon','lat','alt']){d.tracks.coast[field]=o[field].slice(0,k+1);d.tracks.orbit[field]=o[field].slice(k);}
  d.meta.flight_segments=['ascent','coast','orbit'];validateMission(d);const f=createFlight(d);
  for(const t of [500,1000,1500,8000])near(Math.hypot(...f.shipAt(t).p.map((v,i)=>v-flight.shipAt(t).p[i])),0,1e-8);
});
test('Cartesian track interpolation crosses the antimeridian locally',()=>{
  const t=new Track({met0:0,dt:10,lon:[179,-179],lat:[0,0],alt:[100,100]});
  assert.ok(Math.abs(A.vecToLL(...t.sample(5).u).lon)>179.99);
});
test('DE440s table and ellipsoid ray reproduce original pickup within 0.1 second',()=>{
  const j=computeJelly(flight.tracks.ascent,sun,T0);
  near(j.pickup.met,101.00075462383785,.1);near(j.pickup.alt,43.180315,.001);
  assert.ok(sunlightClearance(flight.shipAt(j.pickup.met-.1).p,sun(T0+(j.pickup.met-.1)*1000))<0);
  assert.ok(sunlightClearance(flight.shipAt(j.pickup.met+.1).p,sun(T0+(j.pickup.met+.1)*1000))>0);
});
test('solar table covers extreme T0 and MET combinations; no extrapolation',()=>{
  for(const t of ['09:30:00','11:00:00'])for(const met of [-600,flight.end])assert.ok(sun(A.dateT0ms(data.meta.date,clockSeconds(t))+met*1000).every(Number.isFinite));
  assert.throws(()=>sun(T0-86400000));
});
test('time shift changes illumination but never the physical track',()=>{
  const before=flight.shipAt(150).p;
  const a=computeJelly(flight.tracks.ascent,sun,T0-120000),b=computeJelly(flight.tracks.ascent,sun,T0+120000);
  assert.notEqual(a.pickup?.met,b.pickup?.met);assert.deepEqual(flight.shipAt(150).p,before);
});
test('geometric sunlight has correct dayside and nightside signs',()=>{
  assert.ok(sunlightClearance([A.RE+100,0,0],[1.5e8,0,0])>0);
  assert.ok(sunlightClearance([-A.RE-100,0,0],[1.5e8,0,0])<0);
});
test('nominal visibility excludes day observers at insertion and meets the threshold',()=>{
  const r=calculateVisibility(data,T0);assert.ok(r.nonempty>0);assert.ok(r.area[15]>0);
  let checked=0;
  for(let i=0;i<r.mel.length;i++)if(r.mel[i]>=15){assert.ok(r.darkAtInsertion[i]>=0);checked++;}
  assert.equal(checked,r.nonempty);
  const segs=contour(Float32Array.from(r.mel,(v,i)=>Math.min(v-15,r.darkAtInsertion[i])),r.nx,r.ny,r.lon0,r.lat0,r.dx,r.dy,0);
  assert.ok(segs.length>0);assert.ok(segs.flat().every(Number.isFinite));
});
test('visibility requires vehicle sunlight and observer darkness at the same time',()=>{
  const d=structuredClone(data);d.meta.visibility={extent:[95,105,27,38],grid_step_deg:1,time_step_s:5,levels:[15]};
  const r=calculateVisibility(d,T0),count=Math.ceil(data.meta.insertion_met/5);
  for(let j=0;j<r.ny;j++)for(let i=0;i<r.nx;i++){const k=j*r.nx+i;if(r.mel[k]<15)continue;const fr=A.siteFrame(r.lon0+i*r.dx,r.lat0+j*r.dy);let witness=false;
    for(let n=0;n<=count;n++){const t=data.meta.insertion_met*n/count,p=flight.shipAt(t).p,s=sun(T0+t*1000);if(sunlightClearance(p,s)>0 && A.lookAngles(fr,s).el<=0 && A.lookAngles(fr,p).el>=15){witness=true;break;}}
    assert.ok(witness,'Every visible cell must have a simultaneous witness');
  }
});
test('synthetic TLE identity, fractional epoch and shifted checksums remain valid',()=>{
  const r=data.tle_ref,s=r.sets[0],same=A.tleForT0(s,r.t0,r.raan_rate_deg_per_min,T0),later=A.tleForT0(s,r.t0,r.raan_rate_deg_per_min,T0+60000);
  assert.equal(same.l1,s.l1);assert.equal(same.l2,s.l2);assert.equal(later.l1[68],A.tleChecksum(later.l1));assert.equal(later.l2[68],A.tleChecksum(later.l2));
  near(A.tleEpochMs(later.l1)-A.tleEpochMs(s.l1),60000,1);
  near(+later.l2.slice(17,25)-+s.l2.slice(17,25),r.raan_rate_deg_per_min,.0001);
  assert.equal(A.tleEpochString(Date.UTC(2026,11,31,23,59,59,999)+.9),'27001.00000000');
});
test('unknown impact and staging times are not invented',()=>{
  assert.equal(data.zones[0].role,'boosters');assert.equal(data.zones[0].impact,undefined);
  assert.ok(!data.events.some((e)=>/stage|dogleg|separation|impact/i.test(e.label)));
  const d=structuredClone(data);delete d.tle_ref;d.zones=[];validateMission(d);
});
test('strict URL time parser rejects malformed input',()=>{
  near(clockSeconds('10:15'),36900);near(clockSeconds('10:15:30'),36930);
  for(const s of ['NaN','25:00','10:60','10:00:99',null,'-1:00'])assert.ok(Number.isNaN(clockSeconds(s)));
});
