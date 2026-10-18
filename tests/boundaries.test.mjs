import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BOUNDARY_STYLES,validateBoundaries,wrappedLines,drawBoundaries} from '../docs/js/boundaries.js';

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
  for(const key of Object.keys(BOUNDARY_STYLES))assert.equal(data.coverage.line_counts[key],data.layers[key].length);
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

test('wrapping puts antimeridian crossings at both map edges without long diagonals',()=>{
  const source=[[179,40],[-179,41]],before=JSON.stringify(source);
  const parts=wrappedLines(source);assert.equal(parts.length,2);
  assert.equal(JSON.stringify(source),before);
  for(const part of parts)assert.ok(Math.abs(part[1][0]-part[0][0])<3);
  assert.ok(parts.some((p)=>p[0][0]===179&&p[1][0]===181));
  assert.ok(parts.some((p)=>p[0][0]===-181&&p[1][0]===-179));
  assert.deepEqual(wrappedLines([[100,35],[110,40]]),[[[100,35],[110,40]]]);
});

test('renderer keeps subpaths separate and uses lighter regional lines',()=>{
  const paths=[],strokes=[],ctx={
    save(){this.saved=true;},restore(){this.restored=true;},
    beginPath(){paths.push([]);},setLineDash(dash){this.dash=dash;},
    moveTo(x,y){paths.at(-1).push(['M',x,y]);},lineTo(x,y){paths.at(-1).push(['L',x,y]);},
    stroke(){strokes.push({color:this.strokeStyle,width:this.lineWidth,dash:this.dash});},
  };
  drawBoundaries(ctx,{layers:{regions:[[[100,35],[110,40]],[[80,20],[85,22]]],countries:[[[179,40],[-179,41]]],disputed:[[[40,0],[45,5]]]}},360,180);
  assert.ok(ctx.saved&&ctx.restored);
  assert.equal(paths.length,3);assert.equal(paths[0].filter(([type])=>type==='M').length,2);
  assert.equal(strokes.length,6);
  assert.ok(BOUNDARY_STYLES.countries.width>BOUNDARY_STYLES.regions.width);
  assert.deepEqual(strokes[3].dash,[]);assert.ok(strokes[5].dash.length>0);
  assert.ok(paths.flat().every(([,x,y])=>Number.isFinite(x)&&Number.isFinite(y)));
});
