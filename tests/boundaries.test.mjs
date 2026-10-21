import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BOUNDARY_LAYERS,validateBoundaries} from '../docs/js/boundaries.js';

const data=JSON.parse(fs.readFileSync(new URL('../docs/data/boundaries.json',import.meta.url)));

test('boundary data has worldwide country borders and China-only regions',()=>{
  validateBoundaries(data);
  assert.ok(data.layers.countries.length>300);
  assert.ok(data.layers.disputed.length>0);
  assert.equal(data.source.regional_scope,'China only');
  const allowed=new Set(['CHN','HKG','MAC','TWN']);
  assert.ok(Object.keys(data.coverage.region_line_counts).every((code)=>allowed.has(code)));
  assert.equal(data.coverage.region_line_owners.length,data.layers.regions.length);
  assert.ok(data.coverage.region_line_owners.every((code)=>allowed.has(code)));
  for(const code of ['IND','USA','RUS','CAN','VNM','JPN','NPL'])assert.equal(data.coverage.region_line_counts[code],undefined,code);
  assert.ok(data.coverage.region_line_counts.CHN>=50);
  const china=data.layers.regions.filter((line)=>line.every(([lon,lat])=>lon>105&&lon<115&&lat>30&&lat<42));
  assert.ok(china.length>5,'Regional boundaries near Shanxi, Shaanxi and Hebei');
  for(const key of BOUNDARY_LAYERS)assert.equal(data.coverage.line_counts[key],data.layers[key].length);
});

test('rendered boundary data retains source provenance and fits its size budget',()=>{
  assert.equal(data.source.license,'Public domain');
  assert.match(data.source.revision,/^[0-9a-f]{40}$/);
  for(const source of Object.values(data.source.files)){
    assert.match(source.sha256,/^[0-9a-f]{64}$/);
    assert.ok(source.url.includes(data.source.revision));
  }
  assert.ok(JSON.stringify(data).length<2e6);
});

test('invalid boundary coordinates and unsupported versions are rejected',()=>{
  for(const change of [(d)=>d.schema_version=2,(d)=>delete d.layers.regions,(d)=>d.layers.countries[0][0][0]=NaN,(d)=>d.layers.regions[0][0][1]=100,(d)=>d.layers.regions[0]=[]]){
    const d=structuredClone(data);change(d);assert.throws(()=>validateBoundaries(d));
  }
});
