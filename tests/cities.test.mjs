import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CHINA_CITIES,CITIES,CITY_DISTANCES,cityInRange} from '../docs/js/cities.js';

test('expanded China catalog has unique names and finite city-centre coordinates',()=>{
  assert.ok(CHINA_CITIES.length>=100);
  assert.equal(new Set(CITIES.map(([name])=>name.toLowerCase())).size,CITIES.length);
  for(const [name,lon,lat,tier]of CITIES){
    assert.ok(name.length>0&&name.length<30,name);
    assert.ok(Number.isFinite(lon)&&Math.abs(lon)<=180,name);
    assert.ok(Number.isFinite(lat)&&Math.abs(lat)<=90,name);
    assert.ok(Object.hasOwn(CITY_DISTANCES,tier),name);
  }
});

test('all mainland provincial capitals have primary-priority labels',()=>{
  const capitals=['Beijing','Tianjin','Shijiazhuang','Taiyuan','Hohhot','Shenyang','Changchun','Harbin','Shanghai','Nanjing','Hangzhou','Hefei','Fuzhou','Nanchang','Jinan','Zhengzhou','Wuhan','Changsha','Guangzhou','Nanning','Haikou','Chongqing','Chengdu','Guiyang','Kunming','Lhasa',"Xi'an",'Lanzhou','Xining','Yinchuan','Ürümqi'];
  for(const name of capitals)assert.equal(CHINA_CITIES.find((c)=>c[0]===name)?.[3],1,name);
});

test('regional coverage includes the launch corridor, coasts, northeast and far west',()=>{
  for(const name of ['Jiuquan','Golmud','Dunhuang','Zhangye','Jiayuguan','Wuwei','Tianshui','Baoji',"Yan'an",'Yulin','Yushu','Chamdo','Nyingchi','Shigatse','Kashgar','Hotan','Korla','Hami','Qiqihar','Dalian','Qingdao','Suzhou','Ningbo','Xiamen','Shenzhen','Sanya','Hong Kong','Macau','Taipei'])assert.ok(CHINA_CITIES.some((c)=>c[0]===name),name);
});

test('existing observer defaults and nearby reference cities are preserved',()=>{
  assert.deepEqual(CITIES.find((c)=>c[0]==='Chengdu'),['Chengdu',104.07,30.66,1]);
  for(const name of ['Kathmandu','New Delhi','Hanoi'])assert.ok(CITIES.some((c)=>c[0]===name));
});

test('zoom progressively reveals regional and local city tiers',()=>{
  assert.ok(CITY_DISTANCES[1]>CITY_DISTANCES[2]&&CITY_DISTANCES[2]>CITY_DISTANCES[3]);
  assert.ok(cityInRange(1,2.15));assert.ok(!cityInRange(2,2.15));assert.ok(!cityInRange(3,2.15));
  assert.ok(cityInRange(2,1.6));assert.ok(!cityInRange(3,1.6));assert.ok(cityInRange(3,1.2));
  for(const [tier,distance]of Object.entries(CITY_DISTANCES))assert.ok(!cityInRange(tier,distance));
  assert.ok(!cityInRange(99,1.2));assert.ok(!cityInRange(1,NaN));
});
