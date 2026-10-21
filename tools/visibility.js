import * as A from '../docs/js/astro.js';
import {createFlight, solarEphemeris, sunlightClearance} from '../docs/js/profile.js';

export function calculateVisibility(data, T0) {
  const {tracks} = createFlight(data), asc = tracks.ascent, sunAt = solarEphemeris(data.sun), cfg = data.meta.visibility;
  const [lon0,lon1,lat0,lat1] = cfg.extent, step = cfg.grid_step_deg;
  const nx = Math.ceil((lon1-lon0)/step)+1, ny = Math.ceil((lat1-lat0)/step)+1;
  const dx = (lon1-lon0)/(nx-1), dy = (lat1-lat0)/(ny-1);
  const mel = new Float32Array(nx*ny).fill(-90), darkAtInsertion = new Float32Array(nx*ny), samples = [];
  const count = Math.ceil((asc.end-asc.met0)/cfg.time_step_s);
  for (let k = 0; k <= count; k++) {
    const met = asc.met0 + (asc.end-asc.met0)*k/count;
    const p = asc.sample(met).p, sun = sunAt(T0+met*1000);
    if (sunlightClearance(p,sun)>0) samples.push({p,sun});
  }
  const referenceSun = sunAt(T0+data.meta.insertion_met*1000), area = Object.fromEntries(cfg.levels.map((l) => [l,0]));
  let nonempty = 0;
  for (let j = 0; j < ny; j++) {
    const lat = lat0+j*dy;
    const cellArea = A.RE**2 * dx*A.D2R * (Math.sin(Math.min(lat1,lat+dy/2)*A.D2R)-Math.sin(Math.max(lat0,lat-dy/2)*A.D2R));
    for (let i = 0; i < nx; i++) {
      const index = j*nx+i, fr = A.siteFrame(lon0+i*dx,lat), {P:O,U} = fr;
      darkAtInsertion[index] = -A.lookAngles(fr,referenceSun).el;
      if (darkAtInsertion[index]<0) continue;
      let best = -1;
      for (const {p,sun} of samples) {
        if ((sun[0]-O[0])*U[0]+(sun[1]-O[1])*U[1]+(sun[2]-O[2])*U[2]>0) continue;
        const x=p[0]-O[0], y=p[1]-O[1], z=p[2]-O[2], r=Math.hypot(x,y,z);
        if (!r) continue;
        const sine=(x*U[0]+y*U[1]+z*U[2])/r;
        if (sine>best) best=sine;
      }
      mel[index] = Math.asin(Math.max(-1,Math.min(1,best)))*A.R2D;
      for (const l of cfg.levels) if (mel[index]>=l) area[l] += cellArea*(i===0 || i===nx-1 ? 0.5 : 1);
      if (mel[index]>=cfg.levels[0]) nonempty++;
    }
  }
  return {T0,nx,ny,lon0,lat0,dx,dy,mel,darkAtInsertion,area,nonempty,samples:samples.length};
}

export function contour(v,nx,ny,lon0,lat0,dx,dy,level) {
  const out=[], edges={1:'LB',2:'BR',3:'LR',4:'RT',5:'LTBR',6:'BT',7:'LT',8:'TL',9:'BT',10:'LBRT',11:'TR',12:'RL',13:'RB',14:'BL'};
  const ip=(x0,y0,v0,x1,y1,v1)=>{const t=(level-v0)/(v1-v0);return [x0+(x1-x0)*t,y0+(y1-y0)*t];};
  for(let j=0;j<ny-1;j++) for(let i=0;i<nx-1;i++) {
    const a=v[j*nx+i],b=v[j*nx+i+1],c=v[(j+1)*nx+i+1],d=v[(j+1)*nx+i];
    const k=(a>=level?1:0)|(b>=level?2:0)|(c>=level?4:0)|(d>=level?8:0);
    if(k===0 || k===15) continue;
    const x=lon0+i*dx,y=lat0+j*dy;
    let e=edges[k];
    if ((k===5 || k===10) && (a+b+c+d)/4>=level) e=k===5?'LBRT':'LTBR';
    const pt=(ch)=>ch==='B'?ip(x,y,a,x+dx,y,b):ch==='R'?ip(x+dx,y,b,x+dx,y+dy,c):ch==='T'?ip(x,y+dy,d,x+dx,y+dy,c):ip(x,y,a,x,y+dy,d);
    for(let q=0;q<e.length;q+=2) out.push(pt(e[q]),pt(e[q+1]));
  }
  return out;
}
