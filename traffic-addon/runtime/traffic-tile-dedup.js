import {geometryLength} from './traffic-aggregation.js';

const rad=Math.PI/180,pointKey=p=>JSON.stringify(p),shapeKey=coordinates=>JSON.stringify(coordinates);
const stateKey=properties=>JSON.stringify(Object.keys(properties).sort().map(key=>[key,properties[key]]));

function tolerance(coordinates,zoom) {
 const latitude=coordinates.reduce((sum,p)=>sum+p[1],0)/coordinates.length;
 // Two representations can each round a source coordinate independently.
 // Use one diagonal MVT grid cell, not a zoom-dependent cartographic snap.
 return Math.SQRT2*40075016.686*Math.cos(latitude*rad)/(2**Math.min(15,Math.max(0,Math.floor(zoom)))*4096);
}

function nearContained(shorter,longer,metres) {
 const latitude=longer[0][1],sx=111195*Math.cos(latitude*rad),sy=111195;
 const origin=longer[0],xy=p=>[(p[0]-origin[0])*sx,(p[1]-origin[1])*sy];
 const long=longer.map(xy),short=shorter.map(xy),segments=[];let length=0;
 for(let i=1;i<long.length;i++){
  const a=long[i-1],b=long[i],dx=b[0]-a[0],dy=b[1]-a[1],size=Math.hypot(dx,dy);
  if(size){segments.push({a,dx,dy,size,along:length});length+=size;}
 }
 if(!length)return false;
 function project(p) {
  let best;
  for(const s of segments){
   const t=Math.max(0,Math.min(1,((p[0]-s.a[0])*s.dx+(p[1]-s.a[1])*s.dy)/(s.size*s.size)));
   const distance=Math.hypot(p[0]-s.a[0]-t*s.dx,p[1]-s.a[1]-t*s.dy);
   if(!best||distance<best.distance)best={distance,along:s.along+t*s.size};
  }
  return best;
 }
 const projections=short.map(project);
 if(projections.some(p=>p.distance>metres))return false;
 // Reject opposite travel order, touching/disjoint fragments, and shapes
 // that turn back along an otherwise overlapping observation.
 const progress=projections.at(-1).along-projections[0].along;
 if(progress<=0)return false;
 let shortLength=0;
 for(let i=1;i<short.length;i++){
  shortLength+=Math.hypot(short[i][0]-short[i-1][0],short[i][1]-short[i-1][1]);
  if(projections[i].along<projections[i-1].along-Math.min(metres*.25,.5))return false;
 }
 // Checking only the short shape's vertices would wrongly accept a straight
 // chord whose endpoints match a substantially curving alternative shape.
 let travelled=0;
 for(let i=0;i<long.length;i++){
  if(i)travelled+=Math.hypot(long[i][0]-long[i-1][0],long[i][1]-long[i-1][1]);
  if(travelled<projections[0].along||travelled>projections.at(-1).along)continue;
  let nearest=Infinity;
  for(let j=1;j<short.length;j++){
   const a=short[j-1],b=short[j],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
   const t=den?Math.max(0,Math.min(1,((long[i][0]-a[0])*dx+(long[i][1]-a[1])*dy)/den)):0;
   nearest=Math.min(nearest,Math.hypot(long[i][0]-a[0]-t*dx,long[i][1]-a[1]-t*dy));
  }
  if(nearest>metres)return false;
 }
 return progress>=shortLength*.8;
}

/** Collapse redundant tiled representations of the SAME measured graph edge.
 * Retain an existing supplied shape; never splice/extrapolate geometry or
 * average copied measurements. Disjoint/partially overlapping fragments with
 * independent coverage, opposite direction, and conflicting metrics survive.
 * All raw properties participate in identity, conservatively retaining any
 * future measurement state not yet understood by this adapter. */
export function deduplicateTrafficTiles(input,zoom) {
 if(!Number.isFinite(zoom))throw Error('Invalid traffic tile zoom');
 const groups=new Map(),untouched=[];
 for(const [index,feature] of input.entries()){
  const p=feature.properties??{},paths=feature.geometry?.type==='LineString'?[feature.geometry.coordinates]:feature.geometry?.type==='MultiLineString'?feature.geometry.coordinates:[];
  if(!Number.isSafeInteger(p.vid)||!Number.isSafeInteger(p.osm)||!paths.length){untouched.push({feature,index});continue;}
  const key=stateKey(p),records=groups.get(key)??[];
  for(const coordinates of paths){
   if(coordinates.length<2||coordinates.some(c=>c.length<2||!c.slice(0,2).every(Number.isFinite))){untouched.push({feature,index});continue;}
   const length=geometryLength(coordinates);
   if(!Number.isFinite(length)||length<=0){untouched.push({feature,index});continue;}
   const raw=feature.geometry.type==='LineString'?feature:{...feature,geometry:{type:'LineString',coordinates}};
   records.push({feature:raw,index,coordinates,length,shape:shapeKey(coordinates),tolerance:tolerance(coordinates,zoom)});
  }
  groups.set(key,records);
 }
 const selected=[...untouched];
 for(const records of groups.values()){
  records.sort((a,b)=>b.length-a.length||a.shape.localeCompare(b.shape));
  const clusters=[];
  for(const record of records){
   const cluster=clusters.find(c=>nearContained(record.coordinates,c[0].coordinates,Math.max(record.tolerance,c[0].tolerance)));
   if(cluster)cluster.push(record);else clusters.push([record]);
  }
  for(const cluster of clusters){
   const full=cluster[0],gridTolerance=full.tolerance;
   // Differences smaller than the source grid's uncertainty do not prove
   // more coverage. A stable coordinate tie-break keeps adjacent endpoints
   // coherent instead of independently choosing two differently rounded ends.
   const candidates=cluster.filter(record=>full.length-record.length<=gridTolerance&&cluster.every(other=>nearContained(other.coordinates,record.coordinates,Math.max(record.tolerance,other.tolerance))));
   const chosen=candidates.sort((a,b)=>a.shape.localeCompare(b.shape))[0]??full;
   selected.push({...chosen,index:Math.min(...cluster.map(record=>record.index))});
  }
 }
 return selected.sort((a,b)=>a.index-b.index||pointKey(a.feature.geometry?.coordinates).localeCompare(pointKey(b.feature.geometry?.coordinates))).map(record=>record.feature);
}
