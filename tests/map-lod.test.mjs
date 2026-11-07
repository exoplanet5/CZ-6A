import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {TILE_CONFIG,TileCache,chooseLevel,boundaryLevel,projectedPixels,tileBounds,tileUV,worldPixels} from '../docs/js/map-lod.js';
import {boundarySegments,boundaryChunks,validateBoundaries} from '../docs/js/boundaries.js';

const tick=()=>new Promise((resolve)=>setImmediate(resolve));
const tile=(n)=>({key:String(n)});

test('image pyramid reaches but never exceeds the native Blue Marble pixels',()=>{
  const root=new URL('../docs/tex/tiles/',import.meta.url),manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
  assert.equal(manifest.source.width,21600);assert.equal(manifest.source.height,10800);
  assert.equal(manifest.tile_size,TILE_CONFIG.tileSize);assert.equal(manifest.max_level,TILE_CONFIG.maxLevel);assert.equal(manifest.min_level,TILE_CONFIG.minLevel);
  assert.equal(manifest.base_columns,TILE_CONFIG.baseColumns);assert.equal(manifest.gutter,TILE_CONFIG.gutter);
  assert.equal(Object.keys(manifest.tiles).length,640);assert.deepEqual(manifest.levels.map((entry)=>entry.level),[2,3]);
  assert.ok(!fs.existsSync(new URL('1/',root)),'The base maps cover views below level 2');
  for(const entry of manifest.levels){assert.equal(entry.width,worldPixels(entry.level));assert.ok(entry.width<=manifest.source.width);}
  let bytes=0;
  for(const [file,hash]of Object.entries(manifest.tiles)){const content=fs.readFileSync(new URL(file,root));bytes+=content.length;assert.equal(createHash('sha256').update(content).digest('hex'),hash,file);}
  assert.ok(bytes<50e6,'Static site image pyramid stays below 50 MB');
});

test('screen-space detail grows with zoom, viewport and pixel density, with a native cap',()=>{
  const far=projectedPixels(5,35,950),near=projectedPixels(1.1,35,950);
  assert.ok(near>far*20);assert.equal(chooseLevel(far),-1);assert.equal(chooseLevel(near),3);
  assert.equal(chooseLevel(1e9),3);assert.equal(chooseLevel(NaN),-1);
  assert.equal(projectedPixels(2,35,1000,4),projectedPixels(2,35,1000,2));
  assert.equal(boundaryLevel(far),'coarse');assert.equal(boundaryLevel(near),'fine');
  // The page opens on a 4K base, so tiles start above 4096 px, with 12% hysteresis at each step.
  assert.equal(chooseLevel(3000,-1,4096),-1);assert.equal(chooseLevel(4400,-1,4096),-1);assert.equal(chooseLevel(5000,-1,4096),2);
  assert.equal(chooseLevel(11000,2,4096),2);assert.equal(chooseLevel(12200,2,4096),3);
  assert.equal(chooseLevel(9600,3,4096),3);assert.equal(chooseLevel(9400,3,4096),2);
  assert.equal(chooseLevel(5000,-1,8192),-1,'An 8K base needs no tiles at this width');
  assert.equal(chooseLevel(5000,3,8192),-1,'Large zoom-out can drop several levels');
});

test('tile coordinates match the global equirectangular shader at seams and poles',()=>{
  for(const z of [2,3]){
    const first=tileBounds(z,0,0),last=tileBounds(z,first.columns-1,first.rows-1);
    assert.equal(first.west,-180);assert.equal(first.north,90);assert.equal(last.east,180);assert.equal(last.south,-90);
    assert.deepEqual(tileUV(first,0,1),[0,1]);assert.deepEqual(tileUV(last,1,0),[1,0]);
    const next=tileBounds(z,1,0);assert.deepEqual(tileUV(first,1,.4),tileUV(next,0,.4));
  }
  assert.throws(()=>tileBounds(3,-1,0));assert.throws(()=>tileBounds(4,0,0));assert.throws(()=>tileBounds(1,0,0));
});

test('tile cache bounds resident and concurrent textures during repeated views',async()=>{
  const jobs=[],disposed=[],cache=new TileCache({max:6,concurrency:2,load:(t)=>new Promise((resolve)=>jobs.push({t,resolve})),dispose:(value)=>disposed.push(value)});
  cache.select(Array.from({length:20},(_,i)=>tile(i)));await tick();
  assert.equal(cache.wanted.size,6);assert.equal(cache.active,2);
  for(let cycle=0;cycle<18;cycle++){
    for(const job of jobs.splice(0))job.resolve(job.t.key);
    await tick();cache.select(Array.from({length:6},(_,i)=>tile(cycle*10+i)));await tick();
    assert.ok(cache.entries.size<=6);assert.ok(cache.active<=2);
  }
  cache.select([tile('final')]);
  for(let cycle=0;cycle<6;cycle++){for(const job of jobs.splice(0))job.resolve(job.t.key);await tick();}
  assert.equal(cache.ready().length,1);assert.equal(cache.ready()[0].tile.key,'final');assert.ok(disposed.length>0);
  assert.ok(cache.peak<=6);cache.clear();assert.equal(cache.entries.size,0);
});

test('a paused cache starts nothing new but lets tiles in flight finish',async()=>{
  const jobs=[],cache=new TileCache({max:6,concurrency:2,load:(t)=>new Promise((resolve)=>jobs.push({t,resolve})),dispose:()=>{}});
  cache.select([tile(1)]);await tick();assert.equal(cache.active,1);
  cache.paused=true;cache.select([tile(1),tile(2),tile(3)]);await tick();assert.equal(cache.active,1,'No new loads while paused');
  jobs[0].resolve('a');await tick();assert.equal(cache.ready().length,1,'The tile in flight still lands');assert.equal(cache.active,0);
  cache.paused=false;cache.pump();await tick();assert.equal(cache.active,2,'Loading resumes');cache.clear();
});

test('failed tiles leave a usable fallback and do not cause a retry storm',async()=>{
  const cache=new TileCache({load:async()=>{throw new Error('Offline');},dispose:()=>{}});
  cache.select([tile(1)]);await tick();cache.select([tile(1)]);await tick();
  assert.equal(cache.failures,1);assert.equal(cache.loads,1);assert.equal(cache.ready().length,0);cache.clear();
});

test('boundary detail increases without changing worldview or semantic coverage',()=>{
  const levels=['boundaries.json','boundaries-medium.json','boundaries-fine.json'].map((name)=>validateBoundaries(JSON.parse(fs.readFileSync(new URL('../docs/data/'+name,import.meta.url)))));
  let before=0;
  for(const data of levels){
    assert.equal(data.source.worldview,'China claims');
    const count=Object.values(data.layers).flat().reduce((n,line)=>n+line.length,0);
    assert.ok(count>before);before=count;assert.ok(count<=350000);
    assert.equal(data.coverage.region_line_counts.CHN,77);
    assert.equal(data.source.regional_scope,'China only');
    assert.ok(data.coverage.region_line_owners.every((code)=>['CHN','HKG','MAC','TWN'].includes(code)));
    assert.deepEqual(data.coverage.line_counts,levels[0].coverage.line_counts);
  }
});

test('boundary vectors preserve independent lines and avoid dateline chords through Earth',()=>{
  const p=boundarySegments([[[179,40],[-179,41]],[[100,35],[101,35]]]);
  assert.equal(p.length%6,0);assert.ok(p.length<100);
  for(let i=0;i<p.length;i+=6){
    assert.ok(Math.abs(Math.hypot(...p.slice(i,i+3))-1.0005)<1e-6);
    assert.ok(Math.hypot(p[i]-p[i+3],p[i+1]-p[i+4],p[i+2]-p[i+5])<.01);
  }
  assert.throws(()=>boundarySegments([],0));
});

test('border chunks keep every segment and each chunk stays local',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../docs/data/boundaries.json',import.meta.url))),p=boundarySegments(data.layers.countries),chunks=boundaryChunks(p);
  assert.equal(chunks.reduce((n,c)=>n+c.length,0),p.length);assert.ok(chunks.length>20);
  const key=(a,i)=>Array.from(a.slice(i,i+6)).join(),all=(list)=>list.flatMap((a)=>Array.from({length:a.length/6},(_,i)=>key(a,i*6))).sort();
  assert.deepEqual(all(chunks),all([p]));
  for(const c of chunks){const y=[];for(let i=1;i<c.length;i+=6)y.push(Math.asin(c[i]/1.0005)*180/Math.PI);assert.ok(Math.max(...y)-Math.min(...y)<=15.001,'A chunk spans one 15-degree cell');}
});
