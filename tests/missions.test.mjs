// The corridor has two ascent profiles: perigee 702 km (Yaogan-50 03) and perigee 732 km (Yaogan-50 04). Both are their own fits
// with the same stage-2 propulsion. The page opens on the latest mission.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from '../docs/js/astro.js';
import {validateManifest,validateMission,selectProfile,missionMenu,createFlight,solarEphemeris,sunlightMargin,setSunlightModel,computeJelly} from '../docs/js/profile.js';
const load=(name)=>JSON.parse(fs.readFileSync(new URL('../docs/data/'+name,import.meta.url)));
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
const index=load('profiles.json'),ref=load('yaogan50-03.json'),nov=load('yaogan50-04.json');
const T0=Date.parse(nov.tle_ref.t0),flight=createFlight(nov),sun=solarEphemeris(nov.sun);
const query=(text)=>selectProfile(index,new URLSearchParams(text));

test('manifest has one profile per perigee and opens on the latest mission',()=>{
  validateManifest(index);validateMission(nov);
  assert.deepEqual(index.profiles.map((p)=>[p.id,p.missions.map((m)=>m.id)]),[['retrograde-142',['yaogan50-03']],['retrograde-142-732',['yaogan50-04']]]);
  assert.equal(index.default_profile,'retrograde-142-732');
  assert.equal(query('').entry.id,'yaogan50-04');assert.ok(nov.meta.date>ref.meta.date);
  for(const p of index.profiles)assert.equal(p.default_mission,p.missions.at(-1).id);
});
test('the mission menu lists both flights, latest first, whichever profile is open',()=>{
  assert.deepEqual(index.mission_order,['yaogan50-04','yaogan50-03']);
  for(const p of index.profiles)assert.deepEqual(missionMenu(index,p).map(({profile,mission})=>[mission.id,profile.id]),
    [['yaogan50-04','retrograde-142-732'],['yaogan50-03','retrograde-142']]);
  const bad=structuredClone(index);bad.mission_order=['yaogan50-04','nope'];assert.throws(()=>validateManifest(bad));
  bad.mission_order=['yaogan50-04','yaogan50-04'];assert.throws(()=>validateManifest(bad));
  const partial=structuredClone(index);partial.mission_order=['yaogan50-03'];validateManifest(partial);
  assert.deepEqual(missionMenu(partial,partial.profiles[1]).map((x)=>x.mission.id),['yaogan50-03','yaogan50-04']);
  const plain=structuredClone(index);delete plain.mission_order;
  assert.deepEqual(missionMenu(plain,plain.profiles[1]).map((x)=>x.mission.id),['yaogan50-04']);
});
test('a mission id finds its profile, also in links made before the profiles were split',()=>{
  for(const q of ['mission=yaogan50-04','profile=retrograde-142&mission=yaogan50-04','profile=retrograde-142-732&mission=yaogan50-04','profile=retrograde-142-732']){
    const r=query(q);assert.equal(r.profile.id,'retrograde-142-732');assert.equal(r.entry.id,'yaogan50-04');}
  for(const q of ['mission=yaogan50-03','profile=retrograde-142-732&mission=yaogan50-03','profile=retrograde-142']){
    const r=query(q);assert.equal(r.profile.id,'retrograde-142');assert.equal(r.entry.id,'yaogan50-03');}
  assert.equal(query('profile=nope&mission=nope').entry.id,'yaogan50-04');
});
test('the two missions have their own tracks: same corridor and stage-2 burn, orbits 24 km apart',()=>{
  assert.equal(nov.tle_ref.t0,'2026-11-27T13:05:00Z');assert.equal(ref.tle_ref.t0,'2026-10-23T10:15:08Z');
  assert.equal(nov.meta.insertion_met,825);assert.equal(ref.meta.insertion_met,825);assert.deepEqual(ref.meta.powered_intervals,nov.meta.powered_intervals);
  assert.deepEqual(nov.meta.powered_intervals,[[0,238.5],[240,825]]);assert.equal(nov.meta.stack.burn_end,825);
  near(nov.meta.perigee_km,726.46,.05);near(nov.meta.apogee_km,955.69,.05);near(nov.meta.inc,142.01,.01);
  const end=flight.shipAt(825),other=createFlight(ref).shipAt(825);setSunlightModel(nov.meta.sunlight);
  near(end.alt,732.7,.1);near(other.alt,709.1,.1);near(A.vecToLL(...other.u).lon,82.47,.02);
  near(ref.meta.perigee_km,695.46,.05);near(ref.meta.apogee_km,954.52,.05);
  const ll=A.vecToLL(...end.u);near(ll.lon,82.47,.02);
  assert.equal(nov.zones[0].id,'A6107/26');nov.zones[0].centroid.forEach((v,i)=>near(v,ref.zones[0].centroid[i],1e-9));
  assert.deepEqual(nov.meta.sunlight,ref.meta.sunlight);
});
test('Yaogan-50 04 pickup with refraction is 20 s before the straight ray and brackets the observed shadow exit',()=>{
  const j=computeJelly(flight.tracks.ascent,sun,T0),observed=(Date.parse('2026-11-27T13:17:37Z')-T0)/1000;
  near(j.pickup.met,746.3953746990007,.1);near(j.pickup.alt,724.246,.05);
  assert.ok(sunlightMargin(flight.shipAt(j.pickup.met-.1).p,sun(T0+(j.pickup.met-.1)*1000))<0);
  assert.ok(sunlightMargin(flight.shipAt(j.pickup.met+.1).p,sun(T0+(j.pickup.met+.1)*1000))>0);
  setSunlightModel(null);
  try{const g=computeJelly(flight.tracks.ascent,sun,T0);near(g.pickup.met,766.8285423822327,.1);assert.ok(j.pickup.met<observed&&observed<g.pickup.met);}
  finally{setSunlightModel(nov.meta.sunlight);}
});
test('Yaogan-50 04 synthetic TLE is its own fit and follows the page T0 rule',()=>{
  const b=nov.tle_ref,set=b.sets[0];
  near(+set.l2.slice(8,16),142.0049,1e-4);near(+set.l2.slice(17,25),123.1912,1e-4);near(+set.l2.slice(52,63),14.15912161,1e-7);
  assert.notEqual(set.l2.slice(26,63),ref.tle_ref.sets[0].l2.slice(26,63));
  const later=A.tleForT0(set,b.t0,b.raan_rate_deg_per_min,T0+60000);
  near(+later.l2.slice(17,25)-+set.l2.slice(17,25),b.raan_rate_deg_per_min,.0001);near(A.tleEpochMs(later.l1)-A.tleEpochMs(set.l1),60000,1);
});
