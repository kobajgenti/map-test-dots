import {buildTrafficIndex, aggregateTraffic, distanceMetres} from './traffic-aggregation.js';

const radians=Math.PI/180;
const finitePositive=value=>Number.isFinite(value)&&value>0;
const coordinateKey=point=>JSON.stringify(point);
const providerCongestion={0:'severe',1:'heavy',2:'moderate',3:'low'};

function elevation(properties) {
 for(const value of [properties.level,properties.layer])
  if(value!=null&&Number.isFinite(Number(value)))return Number(value);
 return 'unknown';
}

function continuationKey(properties) {
 // OSM-way IDs, per-way direction labels, and deck transitions along a selected
 // corridor do not partition an overview corridor at z < 14.
 const selected = properties.traffic_corridor_selected === true;
 return JSON.stringify([
  selected ? 'selected-corridor' : properties.traffic_rank??null,
  selected ? 'selected-corridor' : properties.class??'',
  selected ? 'corridor-grade' : elevation(properties),
  selected ? '' : (properties.brunnel??''),
  selected ? null : (properties.bridge??null),
  selected ? null : (properties.tunnel??null),
  properties.carriageway_id??'',properties.lane_id??'',properties.on_route===true,
  selected ? 'travel-order' : properties.traffic_layout??'',
  selected ? 0 : properties.direction_sign??0,
  properties.traffic_offset??null,
 ]);
}

function heading(coordinates,atStart,minLookaheadMetres=8) {
 const origin=atStart?coordinates[0]:coordinates.at(-1);
 const scale=Math.cos(origin[1]*radians);
 let other=origin;
 for(let offset=1;offset<coordinates.length;offset++){
  other=atStart?coordinates[offset]:coordinates[coordinates.length-1-offset];
  const dx=(other[0]-origin[0])*scale,dy=other[1]-origin[1];
  // Look through repeated vertices and quantised MVT grid geometry, where the
  // source supplies enough shape. Never extrapolate the endpoint itself.
  if(Math.hypot(dx,dy)*111195>=minLookaheadMetres)break;
 }
 const dx=(atStart?other[0]-origin[0]:origin[0]-other[0])*scale;
 const dy=atStart?other[1]-origin[1]:origin[1]-other[1];
 const length=Math.hypot(dx,dy);
 return length?[dx/length,dy/length]:null;
}

/** Overview-only topology for normalized, travel-ordered measured edges.
 * A continuation must touch within quantization tolerance, retain display priority,
 * and be the only near-straight candidate in BOTH directions of the decision. */
export function buildOverviewTrafficIndex(collection,{maxTurnDegrees=48,snapMetres=6,zoom=12}={}) {
 if(!Number.isFinite(maxTurnDegrees)||maxTurnDegrees<0||maxTurnDegrees>=90)
  throw Error('maxTurnDegrees must be between 0 and 90 degrees');
 const validated=buildTrafficIndex(collection);
 const edges=validated.chains.flat().sort((a,b)=>a.p.edge_id.localeCompare(b.p.edge_id));
 const incoming=new Map(),outgoing=new Map(),recordKey=new Map();
 const lat=validated.latitude||41.72,sx=111195*Math.cos(lat*radians),snap=Math.max(.5,Number(snapMetres)||6);
 const lookahead=zoom<9.5?85:zoom<11.5?30:8;
 const nodes=[],grid=new Map();
 function nodeIdFor(key,pt){
  const mx=pt[0]*sx,my=pt[1]*111195,gx=Math.floor(mx/snap),gy=Math.floor(my/snap);
  let best=null,bestD=Infinity;
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
   for(const n of grid.get(`${key}:${gx+dx},${gy+dy}`)??[]){
    const d=Math.hypot(n.mx-mx,n.my-my);
    if(d<=snap&&d<bestD){best=n;bestD=d;}
   }
  }
  if(best)return best.id;
  const n={id:`${key}:n${nodes.length}`,mx,my};nodes.push(n);
  const cell=`${key}:${gx},${gy}`;if(!grid.has(cell))grid.set(cell,[]);grid.get(cell).push(n);
  return n.id;
 }
 for(const edge of edges){
  const key=continuationKey(edge.p);recordKey.set(edge,key);
  edge.overviewStartHeading=heading(edge.coords,true,lookahead);
  edge.overviewEndHeading=heading(edge.coords,false,lookahead);
  const a=edge.coords[0],b=edge.coords.at(-1),dx=(b[0]-a[0])*sx,dy=(b[1]-a[1])*111195,len=Math.hypot(dx,dy)||1;
  edge.overallHeading=[dx/len,dy/len];
  edge.startNodeKey=nodeIdFor(key,edge.coords[0]);
  edge.endNodeKey=nodeIdFor(key,edge.coords.at(-1));
  if(!outgoing.has(edge.startNodeKey))outgoing.set(edge.startNodeKey,[]);
  outgoing.get(edge.startNodeKey).push(edge);
  if(!incoming.has(edge.endNodeKey))incoming.set(edge.endNodeKey,[]);
  incoming.get(edge.endNodeKey).push(edge);
 }
 const threshold=Math.cos(maxTurnDegrees*radians);
 function canFollow(a,b) {
  if(a===b||recordKey.get(a)!==recordKey.get(b)||!a.overviewEndHeading||!b.overviewStartHeading)return false;
  if(a.p.traffic_corridor_ref&&b.p.traffic_corridor_ref&&a.p.traffic_corridor_ref!==b.p.traffic_corridor_ref)return false;
  const dot=a.overviewEndHeading[0]*b.overviewStartHeading[0]+a.overviewEndHeading[1]*b.overviewStartHeading[1];
  const minDot=a.p.traffic_corridor_selected===true&&zoom<9.5&&(a.length<120||b.length<120)?-0.05:threshold-1e-12;
  return dot>=minDot;
 }
 const next=new Map(),previous=new Map();
 for(const edge of edges){
  const successors=(outgoing.get(edge.endNodeKey)??[]).filter(candidate=>canFollow(edge,candidate)).sort((u,v)=>{
   const du=edge.overviewEndHeading[0]*u.overviewStartHeading[0]+edge.overviewEndHeading[1]*u.overviewStartHeading[1];
   const dv=edge.overviewEndHeading[0]*v.overviewStartHeading[0]+edge.overviewEndHeading[1]*v.overviewStartHeading[1];
   return dv-du;
  });
  if(!successors.length)continue;
  const candidate=successors[0];
  const predecessors=(incoming.get(candidate.startNodeKey)??[]).filter(prior=>canFollow(prior,candidate)).sort((u,v)=>{
   const du=u.overviewEndHeading[0]*candidate.overviewStartHeading[0]+u.overviewEndHeading[1]*candidate.overviewStartHeading[1];
   const dv=v.overviewEndHeading[0]*candidate.overviewStartHeading[0]+v.overviewEndHeading[1]*candidate.overviewStartHeading[1];
   return dv-du;
  });
  if(!predecessors.length||predecessors[0]!==edge)continue;
  next.set(edge,candidate);previous.set(candidate,edge);
 }
 // Bridge MVT integer-grid quantization gaps along selected corridors
 if(zoom<14){
  const gapSnap=zoom<9.5?65:zoom<11.5?28:16;
  const byKey=new Map();
  for(const e of edges){if(e.p.traffic_corridor_selected===true){const k=recordKey.get(e);if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(e);}}
  for(const group of byKey.values()){
   for(const e of group){
    if(next.has(e))continue;
    const endPt=e.coords.at(-1);
    const cands=group.filter(c=>{
     if(c===e||previous.has(c))return false;
     if(e.p.traffic_corridor_ref&&c.p.traffic_corridor_ref&&e.p.traffic_corridor_ref!==c.p.traffic_corridor_ref)return false;
     const d=distanceMetres(endPt,c.coords[0]);
     if(d>gapSnap)return false;
     const dot=e.overallHeading[0]*c.overallHeading[0]+e.overallHeading[1]*c.overallHeading[1];
     const minDot=zoom<9.5&&(e.length<120||c.length<120)?-0.05:Math.min(threshold,0.35);
     if(dot<minDot)return false;
     if(d>4){
      const gx=(c.coords[0][0]-endPt[0])*sx,gy=(c.coords[0][1]-endPt[1])*111195;
      const proj=gx*e.overallHeading[0]+gy*e.overallHeading[1];
      const perp=Math.abs(-gx*e.overallHeading[1]+gy*e.overallHeading[0]);
      if(proj<-4||perp>22)return false;
     }
     return true;
    }).sort((u,v)=>{
     const du=distanceMetres(endPt,u.coords[0])-15*(e.overallHeading[0]*u.overallHeading[0]+e.overallHeading[1]*u.overallHeading[1]);
     const dv=distanceMetres(endPt,v.coords[0])-15*(e.overallHeading[0]*v.overallHeading[0]+e.overallHeading[1]*v.overallHeading[1]);
     return du-dv;
    });
    for(const cand of cands){
     let cur=cand,cycled=false;
     while(cur){if(cur===e){cycled=true;break;}cur=next.get(cur);}
     if(!cycled){next.set(e,cand);previous.set(cand,e);break;}
    }
   }
  }
 }
 const seen=new Set();let chains=[];
 for(const root of [...edges.filter(edge=>!previous.has(edge)),...edges]){
  if(seen.has(root))continue;
  const chain=[];let edge=root;
  while(edge&&!seen.has(edge)){seen.add(edge);chain.push(edge);edge=next.get(edge);}
  chains.push(chain);
 }
 if(zoom<9.5&&chains.some(c=>c.reduce((s,e)=>s+e.length,0)>=1100)){
  chains=chains.filter(c=>c.reduce((s,e)=>s+e.length,0)>=1100);
 }
 return {chains,edgeCount:validated.edgeCount,latitude:validated.latitude};
}

const congToCode={low:3,free:3,moderate:2,heavy:1,severe:0};
function computeWeightedCongestion(p,edges) {
 if(p.closed)return {congestion:'severe',cong:0};
 if(!finitePositive(p.travel_time_s)||!finitePositive(p.free_flow_time_s)){
  const raw=edges?.[0]?.p?.cong;
  return {congestion:providerCongestion[raw]??edges?.[0]?.p?.congestion??'unknown',cong:raw??3};
 }
 const ratio=p.free_flow_time_s/p.travel_time_s;
 const congestion=ratio>=.85?'low':ratio>=.6?'moderate':ratio>=.3?'heavy':'severe';
 return {congestion,cong:congToCode[congestion]??3};
}

function foldTerminalChunks(features,index,zoom,minPixels) {
 if(minPixels===0)return features;
 const maxGap=zoom<9.5?75:zoom<11.5?38:22;
 const chainByEdge=new Map();
 index.chains.forEach((chain,i)=>chain.forEach(edge=>chainByEdge.set(edge.p.edge_id,i)));
 const groups=new Map();
 for(const feature of features){
  const chain=chainByEdge.get(feature.properties.edge_ids[0]);
  if(!groups.has(chain))groups.set(chain,[]);groups.get(chain).push(feature);
 }
 const normal=feature=>!feature.properties.closed&&
  finitePositive(feature.properties.travel_time_s)&&finitePositive(feature.properties.free_flow_time_s);
 const mppFor=feature=>156543.033928*Math.cos(feature.geometry.coordinates[0][1]*radians)/2**zoom;
 const short=feature=>feature.properties.length_m/mppFor(feature)<minPixels;
 function merge(a,b) {
  const pa=a.properties,pb=b.properties;
  if(distanceMetres(a.geometry.coordinates.at(-1),b.geometry.coordinates[0])>maxGap)return null;
  const edge_ids=[...pa.edge_ids,...pb.edge_ids],actual=pa.travel_time_s+pb.travel_time_s,free=pa.free_flow_time_s+pb.free_flow_time_s;
  const sameEnd=coordinateKey(a.geometry.coordinates.at(-1))===coordinateKey(b.geometry.coordinates[0])||distanceMetres(a.geometry.coordinates.at(-1),b.geometry.coordinates[0])<=12;
  const ratio=actual/free;
  const {congestion,cong}=computeWeightedCongestion({travel_time_s:actual,free_flow_time_s:free,closed:pa.closed||pb.closed});
  return {...a,id:JSON.stringify([pa.aggregation_band,edge_ids[0],edge_ids.at(-1)]),properties:{
   ...pa,to_node:pb.to_node,edge_ids,edge_count:edge_ids.length,
   length_m:pa.length_m+pb.length_m,travel_time_s:actual,free_flow_time_s:free,
   congestion_ratio:ratio,congestion,cong,overview_terminal_folded:true,
  },geometry:{type:'LineString',coordinates:[...a.geometry.coordinates,...(sameEnd?b.geometry.coordinates.slice(1):b.geometry.coordinates)]}};
 }
 const output=[];
 for(const group of groups.values()){
  let changed=true;
  while(changed&&group.length>1){
   changed=false;
   if(normal(group[0])&&normal(group[1])&&short(group[0])){
    const joined=merge(group[0],group[1]);if(joined){group.splice(0,2,joined);changed=true;continue;}
   }
   if(group.length>1&&normal(group.at(-1))&&normal(group.at(-2))&&short(group.at(-1))){
    const joined=merge(group.at(-2),group.at(-1));if(joined){group.splice(-2,2,joined);changed=true;continue;}
   }
   for(let i=1;i<group.length-1;i++){
    if(!normal(group[i])||!short(group[i]))continue;
    if(normal(group[i-1])){
     const joined=merge(group[i-1],group[i]);if(joined){group.splice(i-1,2,joined);changed=true;break;}
    }
    if(normal(group[i+1])){
     const joined=merge(group[i],group[i+1]);if(joined){group.splice(i,2,joined);changed=true;break;}
    }
   }
   // Coalesce adjacent chunks in the same chain that resolved to the exact same weighted congestion color
   for(let i=0;i<group.length-1;i++){
    if(!normal(group[i])||!normal(group[i+1]))continue;
    const ca=computeWeightedCongestion(group[i].properties).cong;
    const cb=computeWeightedCongestion(group[i+1].properties).cong;
    if(ca===cb){
     const joined=merge(group[i],group[i+1]);
     if(joined){group.splice(i,2,joined);changed=true;break;}
    }
   }
  }
  output.push(...group);
 }
 // Cross-chain endpoint folding for remaining short features (< minPixels)
 const crossGap=zoom<9.5?110:zoom<11.5?65:42;
 let crossChanged=true;
 while(crossChanged&&output.length>1){
  crossChanged=false;
  for(let i=0;i<output.length;i++){
   const f=output[i];
   if(!normal(f)||!short(f))continue;
   const fStart=f.geometry.coordinates[0],fEnd=f.geometry.coordinates.at(-1);
   const fh=heading(f.geometry.coordinates,false,8)||[1,0];
   let bestIdx=-1,bestMode=null,bestDist=crossGap;
   for(let j=0;j<output.length;j++){
    if(i===j||!normal(output[j]))continue;
    const g=output[j];
    if(f.properties.traffic_corridor_ref&&g.properties.traffic_corridor_ref&&f.properties.traffic_corridor_ref!==g.properties.traffic_corridor_ref)continue;
    const gStart=g.geometry.coordinates[0],gEnd=g.geometry.coordinates.at(-1);
    const gh=heading(g.geometry.coordinates,true,8)||[1,0];
    if(fh[0]*gh[0]+fh[1]*gh[1]<0.25)continue;
    const dAfter=distanceMetres(fEnd,gStart);
    if(dAfter<bestDist){bestDist=dAfter;bestIdx=j;bestMode='before';}
    const dBefore=distanceMetres(gEnd,fStart);
    if(dBefore<bestDist){bestDist=dBefore;bestIdx=j;bestMode='after';}
   }
   if(bestIdx>=0){
    const pa=bestMode==='before'?f:output[bestIdx],pb=bestMode==='before'?output[bestIdx]:f;
    const edge_ids=[...pa.properties.edge_ids,...pb.properties.edge_ids],actual=pa.properties.travel_time_s+pb.properties.travel_time_s,free=pa.properties.free_flow_time_s+pb.properties.free_flow_time_s;
    const sameEnd=coordinateKey(pa.geometry.coordinates.at(-1))===coordinateKey(pb.geometry.coordinates[0])||distanceMetres(pa.geometry.coordinates.at(-1),pb.geometry.coordinates[0])<=12;
    const {congestion,cong}=computeWeightedCongestion({travel_time_s:actual,free_flow_time_s:free,closed:pa.properties.closed||pb.properties.closed});
    output[bestIdx]={...pa,id:JSON.stringify([pa.properties.aggregation_band,edge_ids[0],edge_ids.at(-1)]),properties:{
     ...pa.properties,to_node:pb.properties.to_node,edge_ids,edge_count:edge_ids.length,
     length_m:pa.properties.length_m+pb.properties.length_m,travel_time_s:actual,free_flow_time_s:free,
     congestion_ratio:actual/free,congestion,cong,overview_terminal_folded:true,
    },geometry:{type:'LineString',coordinates:[...pa.geometry.coordinates,...(sameEnd?pb.geometry.coordinates.slice(1):pb.geometry.coordinates)]}};
    output.splice(i,1);
    crossChanged=true;
    break;
   }
  }
 }
 const minKeepPixels=Math.min(10,minPixels*0.6);
 if(output.some(f=>f.properties.length_m/mppFor(f)>=minKeepPixels)){
  return output.filter(f=>f.properties.closed||f.properties.length_m/mppFor(f)>=minKeepPixels);
 }
 return output;
}

/** Average actual/baseline travel times along connected overview sections.
 * Existing aggregation preserves unknown gaps, closures and readable slow
 * runs. Individual provider codes remain authoritative for a single edge. */
export function overviewTrafficPaths(collection,zoom,{maxTurnDegrees=48,terminalChunkMinPixels=14,...aggregationOptions}={}) {
 if(!Number.isFinite(zoom))throw Error('Invalid zoom');
 if(!Number.isFinite(terminalChunkMinPixels)||terminalChunkMinPixels<0)throw Error('Invalid terminal chunk pixel threshold');
 if(zoom>=14||!collection.features.length)return collection;
 const snapMetres=zoom<9.5?36:zoom<11.5?14:8;
 const index=buildOverviewTrafficIndex(collection,{maxTurnDegrees,snapMetres,zoom});
 const source=new Map(index.chains.flat().map(edge=>[edge.p.edge_id,edge]));
 const aggOpts={
  targetPixels:zoom<9.5?56:zoom<11.5?42:32,
  simplificationPixels:zoom<9.5?1.35:zoom<11.5?0.85:0.6,
  bottleneckMinPixels:zoom<9.5?20:14,
  bottleneckMetres:zoom<9.5?1400:220,
  ...aggregationOptions,
 };
 const effectiveMinPixels=zoom<9.5?Math.max(terminalChunkMinPixels,22):zoom<11.5?Math.max(terminalChunkMinPixels,16):Math.max(terminalChunkMinPixels,14);
 const result=aggregateTraffic(index,zoom,aggOpts);
 const beforeFold=result.features.length;
 result.features=foldTerminalChunks(result.features,index,zoom,effectiveMinPixels);
 for(const feature of result.features){
  const p=feature.properties,edges=p.edge_ids.map(id=>source.get(id)).filter(Boolean);
  p.traffic_overview_path=true;
  p.traffic_overview_averaged=edges.length>1&&finitePositive(p.travel_time_s)&&finitePositive(p.free_flow_time_s);
  p.overview_road_ids=[...new Set(edges.map(edge=>edge.p.road_id))];
  p.overview_congestion_codes=[...new Set(edges.map(edge=>edge.p.cong).filter(Number.isFinite))];
  if(edges.length===1){
   const c=p.closed?'severe':providerCongestion[edges[0].p.cong]??edges[0].p.congestion??'unknown';
   p.congestion=c;
   p.cong=congToCode[c]??edges[0].p.cong??3;
   continue;
  }
  const {congestion,cong}=computeWeightedCongestion(p,edges);
  p.congestion=congestion;
  p.cong=cong;
  if(finitePositive(p.travel_time_s)&&finitePositive(p.free_flow_time_s)){
   p.speed=Number((p.length_m/p.travel_time_s*3.6).toFixed(1));
   p.speed_kph=p.speed;
   p.overview_baseline_speed=Number((p.length_m/p.free_flow_time_s*3.6).toFixed(1));
  }
 }
 result.metadata={...collection.metadata,...result.metadata,
  output_segments:result.features.length,output_vertices:result.features.reduce((sum,f)=>sum+f.geometry.coordinates.length,0),
  overview_terminal_chunks_folded:beforeFold-result.features.length,
  overview_paths:index.chains.length,overview_join_rule:'exact-touch-reciprocal-straight'};
 return {...collection,...result};
}

export function mergeShortStreetSegments(collection,zoom=15,{minPixels=18}={}) {
 if(!collection?.features?.length)return collection;
 const mpp=156543.033928*Math.cos(41.72*radians)/2**zoom;
 const minLen=Math.max(65,mpp*minPixels);
 const index=buildTrafficIndex(collection,{endpointToleranceMetres:3.5});
 const agg=aggregateTraffic(index,Math.min(16,zoom),{targetPixels:28,simplificationPixels:0,bottleneckMinPixels:16,bottleneckMetres:160});
 const folded=foldTerminalChunks(agg.features,index,zoom,minPixels);
 for(const f of folded){
  const p=f.properties;
  const len=p.length_m||0;
  if(len<minLen&&finitePositive(p.travel_time_s)&&finitePositive(p.free_flow_time_s)){
   const fStart=f.geometry.coordinates[0],fEnd=f.geometry.coordinates.at(-1);
   const hStart=heading(f.geometry.coordinates,true,8)||[1,0],hEnd=heading(f.geometry.coordinates,false,8)||[1,0];
   let tActual=p.travel_time_s,tFree=p.free_flow_time_s,tLen=len;
   for(const g of folded){
    if(g===f||!finitePositive(g.properties.travel_time_s)||!finitePositive(g.properties.free_flow_time_s))continue;
    const gStart=g.geometry.coordinates[0],gEnd=g.geometry.coordinates.at(-1);
    if(distanceMetres(gStart,fEnd)<5&&distanceMetres(gEnd,fStart)<5)continue;
    if(distanceMetres(gEnd,fStart)<=10){
     const gh=heading(g.geometry.coordinates,false,8)||[1,0];
     if(gh[0]*hStart[0]+gh[1]*hStart[1]>=0.42){tActual+=g.properties.travel_time_s;tFree+=g.properties.free_flow_time_s;tLen+=g.properties.length_m||0;}
    }else if(distanceMetres(fEnd,gStart)<=10){
     const gh=heading(g.geometry.coordinates,true,8)||[1,0];
     if(hEnd[0]*gh[0]+hEnd[1]*gh[1]>=0.42){tActual+=g.properties.travel_time_s;tFree+=g.properties.free_flow_time_s;tLen+=g.properties.length_m||0;}
    }
   }
   p.travel_time_s=tActual;
   p.free_flow_time_s=tFree;
   const {congestion,cong}=computeWeightedCongestion(p);
   p.congestion=congestion;
   p.cong=cong;
   p.speed=Number((tLen/tActual*3.6).toFixed(1));
   p.speed_kph=p.speed;
  }else if(finitePositive(p.travel_time_s)&&finitePositive(p.free_flow_time_s)){
   const {congestion,cong}=computeWeightedCongestion(p);
   p.congestion=congestion;
   p.cong=cong;
   p.speed=Number((p.length_m/p.travel_time_s*3.6).toFixed(1));
   p.speed_kph=p.speed;
  }
 }
 return {...collection,features:folded.filter(f=>(f.properties.length_m||0)>=Math.min(28,minLen*0.35))};
}

