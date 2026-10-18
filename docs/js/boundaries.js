export const BOUNDARY_STYLES = {
  regions: {width:0.7, color:'rgba(232,234,237,.32)', halo:'rgba(5,8,12,.28)', dash:[]},
  countries: {width:1.3, color:'rgba(232,234,237,.65)', halo:'rgba(5,8,12,.55)', dash:[]},
  disputed: {width:1.3, color:'rgba(232,234,237,.65)', halo:'rgba(5,8,12,.55)', dash:[3,2]},
};

export function validateBoundaries(data) {
  if (data?.schema_version !== 1 || !data.layers) throw new Error('Unsupported boundary data');
  let points = 0;
  for (const key of Object.keys(BOUNDARY_STYLES)) {
    if (!Array.isArray(data.layers[key])) throw new Error(`Missing ${key} boundaries`);
    for (const line of data.layers[key]) {
      if (!Array.isArray(line) || line.length < 2) throw new Error('Invalid boundary line');
      points += line.length;
      for (const p of line) {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw new Error('Invalid boundary coordinate');
      }
    }
  }
  if (points > 250000) throw new Error('Boundary dataset exceeds the rendering budget');
  return data;
}

export function wrappedLines(line) {
  const unwrapped = [line[0]];
  let west = line[0][0], east = west;
  for (let i = 1; i < line.length; i++) {
    const prev = unwrapped.at(-1)[0];
    const lon = prev + ((line[i][0]-prev+540)%360)-180;
    unwrapped.push([lon,line[i][1]]);
    west = Math.min(west,lon); east = Math.max(east,lon);
  }
  const copies = [];
  for (let shift = Math.ceil((-180-east)/360)*360; west+shift <= 180; shift += 360) {
    copies.push(unwrapped.map(([lon,lat])=>[lon+shift,lat]));
  }
  return copies;
}

export function drawBoundaries(ctx, data, width, height) {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const [key, style] of Object.entries(BOUNDARY_STYLES)) {
    ctx.beginPath(); ctx.setLineDash(style.dash);
    for (const line of data.layers[key]) for (const copy of wrappedLines(line)) {
      copy.forEach(([lon,lat],i)=>{
        const x=(lon+180)/360*width, y=(90-lat)/180*height;
        if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
      });
    }
    ctx.strokeStyle = style.halo; ctx.lineWidth = style.width+1.4; ctx.stroke();
    ctx.strokeStyle = style.color; ctx.lineWidth = style.width; ctx.stroke();
  }
  ctx.restore();
}
