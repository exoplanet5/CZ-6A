import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from '../docs/js/astro.js';
import {validateManifest,validateMission,selectProfile,createFlight,solarEphemeris,sunlightClearance,sunlightMargin,setSunlightModel,geodeticHeight,computeJelly,clockSeconds,Track} from '../docs/js/profile.js';
import {calculateVisibility,contour} from '../tools/visibility.js';
const load=(name)=>JSON.parse(fs.readFileSync(new URL('../docs/data/'+name,import.meta.url)));
const data=load('yaogan50-03.json'),index=load('profiles.json'),T0=Date.parse(data.tle_ref.t0),flight=createFlight(data),sun=solarEphemeris(data.sun);
const LEVEL=data.meta.visibility.levels[0];
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);

test('manifest has explicit default independent of profile order',()=>{
  validateManifest(index);
  const more=structuredClone(index);more.profiles.push({...structuredClone(more.profiles[0]),id:'test-polar-fixture',label:'Test fixture'});
  assert.equal(index.default_profile,'retrograde-142-732');   // the profile of the latest mission
  assert.equal(selectProfile(more,new URLSearchParams()).profile.id,index.default_profile);
  assert.equal(selectProfile(more,new URLSearchParams('profile=test-polar-fixture')).profile.id,'test-polar-fixture');
  assert.equal(selectProfile(more,new URLSearchParams('profile=unknown')).profile.id,index.default_profile);
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
test('refracted pickup matches the source model within 0.1 second; the straight ray is 12.1 s later',()=>{
  const j=computeJelly(flight.tracks.ascent,sun,T0);
  near(j.pickup.met,96.26646370003921,.1);near(j.pickup.alt,33.256,.1);
  assert.ok(sunlightMargin(flight.shipAt(j.pickup.met-.1).p,sun(T0+(j.pickup.met-.1)*1000))<0);
  assert.ok(sunlightMargin(flight.shipAt(j.pickup.met+.1).p,sun(T0+(j.pickup.met+.1)*1000))>0);
  setSunlightModel(null);   // the straight Sun-centre ray of the earlier revisions
  try{const g=computeJelly(flight.tracks.ascent,sun,T0);near(g.pickup.met,108.41477405305294,.1);near(g.pickup.alt,44.2413,.1);near(g.pickup.met-j.pickup.met,12.15,.1);}
  finally{setSunlightModel(data.meta.sunlight);}
});
test('refraction lights a point 700 km up when the Sun is 26.5 degrees below its horizontal, not at 27',()=>{
  const t=data.meta.sunlight,p=[A.RE+700,0,0],sunBelow=(deg)=>[-1.5e8*Math.sin(deg*A.D2R),0,1.5e8*Math.cos(deg*A.D2R)];
  near(2*t.half_bending_deg,1.0993,.002);near(t.partial_bending_deg.at(-1),t.half_bending_deg,1e-6);
  const dip=Math.acos(A.RE/(A.RE+700))*A.R2D;   // 25.7 deg: the straight-ray limit
  assert.ok(sunlightClearance(p,sunBelow(dip-.05))>0);assert.ok(sunlightClearance(p,sunBelow(dip+.05))<0);
  assert.ok(sunlightMargin(p,sunBelow(26.5))>0);assert.ok(sunlightMargin(p,sunBelow(27))<0);
  near(sunlightMargin(p,sunBelow(dip))-sunlightMargin(p,sunBelow(dip+1)),1,1e-3);   // the margin is in degrees
  // at the straight-ray limit it is the bending, less the small Bouguer term of the air at the grazing point
  near(sunlightMargin(p,sunBelow(dip)),2*t.half_bending_deg-(t.floor_index_of_refraction-1)/Math.tan(dip*A.D2R)*A.R2D,.003);
  near(geodeticHeight(A.geodeticToScene(100,35,12.5)),12.5,1e-6);near(geodeticHeight(A.geodeticToScene(-70,-80,-40)),-40,1e-6);
  assert.ok(geodeticHeight([0,0,0])<-6000&&geodeticHeight([10,0,0])<-6000);
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
test('visibility circle uses the 10-degree minimum elevation',()=>{
  assert.equal(A.MIN_ELEVATION_DEG,10);
  const h=300,lam=A.footprintDeg(h,A.MIN_ELEVATION_DEG)*A.D2R,r=A.RE+h;
  const edge=Math.atan2(r*Math.cos(lam)-A.RE,r*Math.sin(lam))*A.R2D;
  near(edge,10,1e-9);assert.ok(A.footprintDeg(h,10)>A.footprintDeg(h,15));
});
test('sunlight has correct dayside and nightside signs, with and without refraction',()=>{
  for(const f of [sunlightClearance,sunlightMargin]){assert.ok(f([A.RE+100,0,0],[1.5e8,0,0])>0);assert.ok(f([-A.RE-100,0,0],[1.5e8,0,0])<0);}
});
test('archived visibility threshold matches the viewer minimum elevation',()=>{
  assert.deepEqual(data.meta.visibility.levels,[A.MIN_ELEVATION_DEG]);
});
test('nominal visibility excludes day observers at insertion and meets the threshold',()=>{
  const r=calculateVisibility(data,T0);assert.ok(r.nonempty>0);assert.ok(r.area[LEVEL]>0);
  let checked=0;
  for(let i=0;i<r.mel.length;i++)if(r.mel[i]>=LEVEL){assert.ok(r.darkAtInsertion[i]>=0);checked++;}
  assert.equal(checked,r.nonempty);
  const segs=contour(Float32Array.from(r.mel,(v,i)=>Math.min(v-LEVEL,r.darkAtInsertion[i])),r.nx,r.ny,r.lon0,r.lat0,r.dx,r.dy,0);
  assert.ok(segs.length>0);assert.ok(segs.flat().every(Number.isFinite));
});
test('visibility requires vehicle sunlight and observer darkness at the same time',()=>{
  const d=structuredClone(data);d.meta.visibility={extent:[95,105,27,38],grid_step_deg:1,time_step_s:5,levels:[LEVEL]};
  const r=calculateVisibility(d,T0),count=Math.ceil(data.meta.insertion_met/5);
  for(let j=0;j<r.ny;j++)for(let i=0;i<r.nx;i++){const k=j*r.nx+i;if(r.mel[k]<LEVEL)continue;const fr=A.siteFrame(r.lon0+i*r.dx,r.lat0+j*r.dy);let witness=false;
    for(let n=0;n<=count;n++){const t=data.meta.insertion_met*n/count,p=flight.shipAt(t).p,s=sun(T0+t*1000);if(sunlightMargin(p,s)>0 && A.lookAngles(fr,s).el<=0 && A.lookAngles(fr,p).el>=LEVEL){witness=true;break;}}
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
