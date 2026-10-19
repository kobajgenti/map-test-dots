/** Display geometry only. Join unique travel-ordered continuations before
 * offsetting, so measurement/colour boundaries share one lateral path. Reverse
 * edges never count as continuations, and forks/merges remain separate. */
export function directionalTrafficPaths(data, zoom, {drivingSide='right', snapMetres=1}={}) {
 if(zoom<14)return data;
 const records=[], untouched=[], snap=Number.isFinite(snapMetres)&&snapMetres>0?snapMetres:1;
 for(const feature of data.features){
  const p=feature.properties??{};
  if(feature.geometry?.type!=='LineString'||(!p.traffic_direction_verified&&!p.traffic_direction_inferred&&p.traffic_layout!=='shared')||(!p.traffic_road_oneway&&p.traffic_layout!=='shared')){untouched.push(feature);continue;}
  const input=p.traffic_layout==='shared'&&p.direction_sign===-1?[...feature.geometry.coordinates].reverse():feature.geometry.coordinates;
  const coordinates=input.filter((point,i)=>!i||point[0]!==input[i-1][0]||point[1]!==input[i-1][1]);
  if(coordinates.length<2){untouched.push(feature);continue;}
  const explicitLevel=p.level??p.layer, level=explicitLevel!=null&&Number.isFinite(Number(explicitLevel))?Number(explicitLevel):'unknown';
  records.push({feature,coordinates,key:[level,p.brunnel??'','travel'].join(':')});
 }
 const latitude=records[0]?.coordinates[0][1]??0, sx=111195*Math.cos(latitude*Math.PI/180),sy=111195;
 const xy=p=>[p[0]*sx,p[1]*sy], distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 const bucket=(key,p)=>key+':'+Math.floor(p[0]/snap)+','+Math.floor(p[1]/snap);
 const starts=new Map(),ends=new Map();
 // Endpoint headings look past sub-metre repeated/clipped vertices where possible.
 function heading(coordinates,start){
  const end=xy(start?coordinates[0]:coordinates.at(-1));let other;
  for(let i=1;i<coordinates.length;i++){other=xy(start?coordinates[i]:coordinates[coordinates.length-1-i]);if(distance(end,other)>=2)break;}
  const dx=start?other[0]-end[0]:end[0]-other[0],dy=start?other[1]-end[1]:end[1]-other[1],length=Math.hypot(dx,dy);
  return [dx/length,dy/length];
 }
 for(const r of records){
  r.start=xy(r.coordinates[0]);r.end=xy(r.coordinates.at(-1));r.incoming=heading(r.coordinates,false);r.outgoing=heading(r.coordinates,true);
  for(const [map,point] of [[starts,r.start],[ends,r.end]]){const key=bucket(r.key,point);if(!map.has(key))map.set(key,[]);map.get(key).push(r);}
 }
 function nearby(map,r,point){
  const result=[],x=Math.floor(point[0]/snap),y=Math.floor(point[1]/snap);
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const c of map.get(r.key+':'+(x+dx)+','+(y+dy))??[])
   if(distance(point,map===starts?c.start:c.end)<=snap)result.push(c);
  return result;
 }
 function canFollow(a,b){
  if(a===b||a.key!==b.key||distance(a.end,b.start)>snap)return false;
  // A reversed copy can have different measurement splits, so endpoint equality
  // alone is insufficient. Also reject a heading that immediately turns back.
  const dot=a.incoming[0]*b.outgoing[0]+a.incoming[1]*b.outgoing[1];
  return dot>-.8;
 }
 const next=new Map(),previous=new Map();
 for(const r of records){
  const candidates=nearby(starts,r,r.end).filter(c=>canFollow(r,c));if(candidates.length!==1)continue;
  const c=candidates[0],incoming=nearby(ends,c,c.start).filter(p=>canFollow(p,c));
  if(incoming.length===1&&incoming[0]===r){next.set(r,c);previous.set(c,r);}
 }
 const visited=new Set(),output=[...untouched];
 for(const root of [...records.filter(r=>!previous.has(r)),...records]){
  if(visited.has(root))continue;
  const chain=[];let r=root;
  while(r&&!visited.has(r)){visited.add(r);chain.push(r);r=next.get(r);}
  const coordinates=[],spans=[];
  for(const part of chain){
   const start=Math.max(0,coordinates.length-1);
   if(!coordinates.length)coordinates.push(...part.coordinates.map(p=>p.slice(0,2)));
   else {const a=coordinates.at(-1),b=part.coordinates[0];coordinates[coordinates.length-1]=[(a[0]+b[0])/2,(a[1]+b[1])/2];coordinates.push(...part.coordinates.slice(1).map(p=>p.slice(0,2)));}
   spans.push([part,start,coordinates.length]);
  }
  const closed=coordinates.length>2&&(r===root||distance(xy(coordinates[0]),xy(coordinates.at(-1)))<.01);
  if(closed){const a=coordinates[0],b=coordinates.at(-1),join=[(a[0]+b[0])/2,(a[1]+b[1])/2];coordinates[0]=join;coordinates[coordinates.length-1]=join;}
  const lat=coordinates[0][1], mx=111195*Math.cos(lat*Math.PI/180),my=111195;
  const metresPerPixel=40075016.686*Math.cos(lat*Math.PI/180)/(512*2**zoom);
  // Stripe stays near the road's inner half, leaving pavement around it.
  const stops=[[14,1.5],[16,2.2],[18,4],[20,7]];
  let pixels=stops.at(-1)[1];for(let i=1;i<stops.length;i++)if(zoom<=stops[i][0]){const [a,b]=[stops[i-1],stops[i]];pixels=a[1]+(b[1]-a[1])*(zoom-a[0])/(b[0]-a[0]);break;}
  // CSS-pixel pavement widths calibrated from this Borbalo surface style at
  // z14..18. These are display constraints, not physical lane measurements.
  const surfaces={motorway:[5.58,8.15,12.05,16.826,21.16],major:[5.28,7.55,11.8,16.356,20.608],secondary:[4.38,6.12,8.85,13.35,16.75],minor:[2.65,4.1,6.45,10.85,13.75],service:[1.18,2.08,3.45,5.75,8.05]};
  function envelope(part){
   const c=part.feature.properties.class??'',group=c==='motorway'||c==='motorway_link'?'motorway':['primary','trunk','primary_link','trunk_link'].includes(c)?'major':['secondary','tertiary','secondary_link','tertiary_link'].includes(c)?'secondary':c==='service'?'service':'minor';
   const widths=surfaces[group],z=Math.max(14,Math.min(18,zoom)),i=Math.min(3,Math.floor(z)-14),surface=widths[i]+(widths[i+1]-widths[i])*(z-14-i);
   // Reserve two outlined stripes and a central .8px gap even on one-way
   // sections, maintaining a consistent stripe through one/two-way changes.
   const stripe=Math.max(.1,Math.min(3,(surface-.8-1.2)/2)),outer=stripe+.6;
   const side=Math.max(0,Math.min(Math.max(pixels,(outer+.8)/2),(surface-outer)/2));
   return {stripe,side,radius:Math.max(0,(surface-outer)/2)};
  }
  const offsets=coordinates.map(()=>Infinity),limits=coordinates.map(()=>Infinity),envelopes=new Map();
  for(const [part,start,end] of spans){const e=envelope(part);envelopes.set(part,e);for(let i=start;i<end;i++){offsets[i]=Math.min(offsets[i],e.side);limits[i]=Math.min(limits[i],e.radius);}}
  if(closed){offsets[0]=offsets[offsets.length-1]=Math.min(offsets[0],offsets.at(-1));limits[0]=limits[limits.length-1]=Math.min(limits[0],limits.at(-1));}
  const points=coordinates.map(p=>[p[0]*mx,p[1]*my]);
  const normal=(a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);return length?[dy/length,-dx/length]:[0,0];};
  const shifted=points.map((p,i)=>{
   const before=normal(points[i===0&&closed?points.length-2:Math.max(0,i-1)],p),after=normal(p,points[i===points.length-1&&closed?1:Math.min(points.length-1,i+1)]);
   let nx=before[0]+after[0],ny=before[1]+after[1],length=Math.hypot(nx,ny);if(!length){[nx,ny]=after;length=Math.hypot(nx,ny)||1;}nx/=length;ny/=length;
   const active=i===0&&!closed?after:before,gain=Math.min(1.5,limits[i]/Math.max(.001,offsets[i]),1/Math.max(.1,nx*active[0]+ny*active[1])),offset=offsets[i]*metresPerPixel*(drivingSide==='left'?-1:1);return [(p[0]+nx*offset*gain)/mx,(p[1]+ny*offset*gain)/my];
  });
  for(const [part,start,end] of spans){const e=envelopes.get(part);output.push({...part.feature,properties:{...part.feature.properties,traffic_path_rendered:true,traffic_path_segments:chain.length,traffic_stripe_width:e.stripe,traffic_side_offset:e.side,traffic_offset:0},geometry:{type:'LineString',coordinates:shifted.slice(start,end)}});}
 }
 return {...data,features:output};
}
