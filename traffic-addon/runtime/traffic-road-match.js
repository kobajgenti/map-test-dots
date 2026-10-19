/** Display-only alignment to loaded base-map roads. Never changes observations,
 * direction or routing IDs. Tangents disambiguate crossing roads; ambiguous
 * elevations are left unknown. Production should supply graph-derived levels. */
export function matchTrafficRoads(data, roads, bounds, {maxDistance=10, step=8, osmIdFromFeature}={}) {
 const latitude=(bounds[1]+bounds[3])/2, sx=111195*Math.cos(latitude*Math.PI/180),sy=111195,cell=25;
 const xy=p=>[p[0]*sx,p[1]*sy], ll=p=>[p[0]/sx,p[1]/sy], grid=new Map();
 const paths=g=>g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:[];
 const inside=p=>p[0]>=bounds[0]&&p[0]<=bounds[2]&&p[1]>=bounds[1]&&p[1]<=bounds[3];
 const crosses=(a,b)=>Math.max(a[0],b[0])>=bounds[0]&&Math.min(a[0],b[0])<=bounds[2]&&Math.max(a[1],b[1])>=bounds[1]&&Math.min(a[1],b[1])<=bounds[3];
 const segments=[];
 for(const road of roads){
  const p=road.properties??{};
  if(!['motorway','trunk','primary','secondary','tertiary','minor','street','service'].includes(p.class))continue;
  const level=Number(p.layer??p.level??(p.brunnel==='bridge'?1:p.brunnel==='tunnel'?-1:0));
  // Source-specific ID decoding is opt-in. Generic vector feature IDs are not
  // OSM IDs; the caller must provide a verified convention for its base tiles.
  const decodedOsm=typeof osmIdFromFeature==='function'?osmIdFromFeature(road):undefined,osm=Number.isSafeInteger(decodedOsm)&&decodedOsm>0?decodedOsm:undefined;
  for(const path of paths(road.geometry)){const pathSegments=[];for(let i=1;i<path.length;i++){
   const a=xy(path[i-1]),b=xy(path[i]),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(!length)continue;
   const segment={a,b,dx,dy,length,level,osm,brunnel:p.brunnel??'',class:p.class,ramp:p.ramp,oneway:Math.abs(Number(p.oneway))===1}; const id=segments.push(segment)-1;pathSegments.push(segment);
   for(let x=Math.floor((Math.min(a[0],b[0])-maxDistance)/cell);x<=Math.floor((Math.max(a[0],b[0])+maxDistance)/cell);x++)
    for(let y=Math.floor((Math.min(a[1],b[1])-maxDistance)/cell);y<=Math.floor((Math.max(a[1],b[1])+maxDistance)/cell);y++){
     const key=x+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(id);
    }
  }for(let i=0;i<pathSegments.length;i++){pathSegments[i].before=pathSegments[i-1];pathSegments[i].after=pathSegments[i+1];}
  }
 }
 function match(mid,dx,dy,expectedLevel,expectedBrunnel,expectedOsm){
  const candidates=[];const length=Math.hypot(dx,dy);
  for(const id of grid.get(Math.floor(mid[0]/cell)+','+Math.floor(mid[1]/cell))??[]){
   const s=segments[id];if(Number.isFinite(expectedLevel)&&s.level!==expectedLevel)continue;if(expectedBrunnel&&s.brunnel!==expectedBrunnel)continue;
   const cos=Math.abs((dx*s.dx+dy*s.dy)/(length*s.length));if(cos<.9)continue;
   const t=Math.max(0,Math.min(1,((mid[0]-s.a[0])*s.dx+(mid[1]-s.a[1])*s.dy)/(s.length*s.length)));
   const distance=Math.hypot(mid[0]-s.a[0]-t*s.dx,mid[1]-s.a[1]-t*s.dy);if(distance>maxDistance)continue;
   const score=distance+(1-cos)*20; candidates.push({s,score,point:[s.a[0]+t*s.dx,s.a[1]+t*s.dy]});
  }
  // Prefer a known shared OSM way only after all geometry/elevation checks.
  // Missing or ineligible exact candidates retain the ordinary spatial match.
  const exact=Number.isSafeInteger(expectedOsm)?candidates.filter(c=>c.s.osm===expectedOsm):[],choices=exact.length?exact:candidates;
  choices.sort((a,b)=>a.score-b.score);const best=choices[0];if(!best)return null;
  // Buffered copies and adjoining segments can tie; they describe the same
  // road. Equal-scoring parallel carriageways or elevations cannot be guessed.
  const ambiguous=choices.some(c=>c!==best&&c.score-best.score<=1&&(c.s.level!==best.s.level||c.s.brunnel!==best.s.brunnel||c.s.oneway!==best.s.oneway||Math.hypot(c.point[0]-best.point[0],c.point[1]-best.point[1])>1.5));
  return ambiguous?null:best.s;
 }
 function project(p,s){
  let closest,distance=Infinity;
  // Midpoint matching may select either side of a curved polyline vertex. Let
  // endpoints use its adjacent segments too, avoiding clamped/dropped bends.
  for(const segment of [s.before,s,s.after]){if(!segment)continue;const t=Math.max(0,Math.min(1,((p[0]-segment.a[0])*segment.dx+(p[1]-segment.a[1])*segment.dy)/(segment.length*segment.length))),point=[segment.a[0]+t*segment.dx,segment.a[1]+t*segment.dy],d=Math.hypot(p[0]-point[0],p[1]-point[1]);if(d<distance){distance=d;closest=point;}}
  return ll(closest);
 }
 const output=[];let matched=0;
 for(const feature of data.features){
  const input=paths(feature.geometry);
  if(!input.some(path=>path.some(inside)||path.some((p,i)=>i&&crosses(path[i-1],p)))){output.push(feature);continue;}
  for(const path of input){
   let run,previous;
   const flush=()=>{if(run?.coordinates.length>1)output.push({...feature,id:undefined,properties:run.properties,geometry:{type:'LineString',coordinates:run.coordinates}});run=null;};
   for(let i=1;i<path.length;i++){
    const a=xy(path[i-1]),b=xy(path[i]),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(!length)continue;
    const count=crosses(path[i-1],path[i])?Math.max(1,Math.ceil(length/step)):1;
    for(let k=0;k<count;k++){
     const start=[a[0]+dx*k/count,a[1]+dy*k/count],end=[a[0]+dx*(k+1)/count,a[1]+dy*(k+1)/count],mid=[(start[0]+end[0])/2,(start[1]+end[1])/2];
     const s=inside(ll(mid))?match(mid,dx,dy,Number(feature.properties?.level??feature.properties?.layer),feature.properties?.brunnel,feature.properties?.osm):null;
     const props=s?{...feature.properties,level:s.level,brunnel:s.brunnel,traffic_matched:true,traffic_road_oneway:s.oneway,class:s.ramp===1?s.class+'_link':s.class}:feature.properties;
     const key=[props.level??'unknown',props.brunnel??'',props.class,props.traffic_road_oneway,!!s].join(':');
     const first=s?project(start,s):ll(start),last=s?project(end,s):ll(end);
     if(!run||key!==previous){flush();run={properties:props,coordinates:[first,last]};}else run.coordinates.push(last);
     previous=key;if(s)matched++;
    }
   }
   flush();
  }
 }
 return {...data,features:output,displayMatchedSegments:matched};
}
