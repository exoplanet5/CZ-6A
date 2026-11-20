// Re-timed missions (add_mission.py in the source project) reuse the Yaogan-50 03 Earth-fixed ascent at a new T0.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as A from '../docs/js/astro.js';
import {validateManifest,validateMission,selectProfile,createFlight,solarEphemeris,sunlightClearance,computeJelly} from '../docs/js/profile.js';
const load=(name)=>JSON.parse(fs.readFileSync(new URL('../docs/data/'+name,import.meta.url)));
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
const index=load('profiles.json'),ref=load('yaogan50-03.json'),nov=load('yaogan50-04.json');
const T0=Date.parse(nov.tle_ref.t0),flight=createFlight(nov),sun=solarEphemeris(nov.sun);

test('manifest lists both missions and keeps the Yaogan-50 03 default',()=>{
  validateManifest(index);validateMission(nov);
  const p=index.profiles.find((x)=>x.id==='retrograde-142');
  assert.deepEqual(p.missions.map((m)=>m.id),['yaogan50-03','yaogan50-04']);
  assert.equal(p.default_mission,'yaogan50-03');
  assert.equal(selectProfile(index,new URLSearchParams('mission=yaogan50-04')).entry.id,'yaogan50-04');
  assert.equal(selectProfile(index,new URLSearchParams()).entry.id,'yaogan50-03');
});
test('Yaogan-50 04 flies the same Earth-fixed track',()=>{
  for(const k of ['ascent','orbit'])for(const f of ['lon','lat','alt']){
    assert.equal(nov.tracks[k][f].length,ref.tracks[k][f].length);
    nov.tracks[k][f].forEach((v,i)=>near(v,ref.tracks[k][f][i],1e-7));   // degrees or km: about 1 cm
  }
  assert.equal(nov.zones[0].id,'A6107/26');nov.zones[0].centroid.forEach((v,i)=>near(v,ref.zones[0].centroid[i],1e-9));
});
test('Yaogan-50 04 pickup at nominal T0 is 1.5 s before cutoff; later T0 leaves the ascent in shadow',()=>{
  assert.equal(nov.tle_ref.t0,'2026-11-27T13:01:00Z');
  const j=computeJelly(flight.tracks.ascent,sun,T0);
  near(j.pickup.met,771.8909498990465,.1);near(j.pickup.alt,706.638,.01);
  assert.ok(sunlightClearance(flight.shipAt(j.pickup.met-.1).p,sun(T0+(j.pickup.met-.1)*1000))<0);
  assert.ok(sunlightClearance(flight.shipAt(j.pickup.met+.1).p,sun(T0+(j.pickup.met+.1)*1000))>0);
  assert.equal(computeJelly(flight.tracks.ascent,sun,T0+30000).pickup,null);
  near(computeJelly(flight.tracks.ascent,sun,T0-8*60000).pickup.met,742.7,.2);
});
test('re-timed TLE equals the October TLE shifted by the page T0 rule',()=>{
  const a=ref.tle_ref,b=nov.tle_ref,shifted=A.tleForT0(a.sets[0],a.t0,a.raan_rate_deg_per_min,T0);
  near(+shifted.l2.slice(17,25),+b.sets[0].l2.slice(17,25),.0002);
  assert.equal(shifted.l2.slice(8,17),b.sets[0].l2.slice(8,17));
  assert.equal(shifted.l2.slice(26,63),b.sets[0].l2.slice(26,63));
  near(A.tleEpochMs(shifted.l1),A.tleEpochMs(b.sets[0].l1),1);
});
