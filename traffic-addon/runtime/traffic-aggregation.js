// Prototype input is normalized directed edges, not a particular Valhalla API response.
// IDs must be strings: 64-bit graph IDs must never be rounded through JS numbers.
const R = 6371008.8, rad = Math.PI / 180;
export const distanceMetres = (a, b) => {
  const dy=(b[1]-a[1])*rad, dx=(b[0]-a[0])*rad;
  const h=Math.sin(dy/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dx/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
};
export const geometryLength = points => points.slice(1).reduce((sum,p,i)=>sum+distanceMetres(points[i],p),0);
export const congestionFromRatio = ratio => ratio == null ? 'unknown' : ratio <= 1.15 ? 'low' : ratio <= 1.6 ? 'moderate' : ratio <= 2.5 ? 'heavy' : 'severe';
const pointKey = p => p.join(',');
const positive = v => Number.isFinite(v) && v > 0;

function simplify(points, tolerance) {
  if(points.length<3 || tolerance<=0)return points;
  // A closed directed path has no distinct endpoint chord. Retain its supplied
  // shape: ordinary endpoint-based simplification can collapse a small loop to
  // one point or replace its support with a triangle across the loop's interior.
  if(pointKey(points[0])===pointKey(points.at(-1)))return points;
  const cos=Math.cos(points[0][1]*rad);
  const xy=points.map(p=>[R*p[0]*rad*cos,R*p[1]*rad]);
  const keep=new Set([0,points.length-1]), stack=[[0,points.length-1]];
  while(stack.length){
    const [a,b]=stack.pop(),[x,y]=xy[a],[ex,ey]=xy[b],dx=ex-x,dy=ey-y,den=dx*dx+dy*dy;
    let far=-1,max=tolerance*tolerance;
    for(let i=a+1;i<b;i++){
      const [px,py]=xy[i],t=den?Math.max(0,Math.min(1,((px-x)*dx+(py-y)*dy)/den)):0;
      const d=(px-x-t*dx)**2+(py-y-t*dy)**2;
      if(d>max){max=d;far=i;}
    }
    if(far>=0){keep.add(far);stack.push([a,far],[far,b]);}
  }
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}

/** Build topology once per geometry revision. Traffic refreshes rebuild metrics.
 * road_id is a stable corridor/OSM-way identity supplied by the adapter, not a name.
 * Coordinates are ordered from from_node to to_node, in travel direction. */
export function buildTrafficIndex(collection, { endpointToleranceMetres=.5 }={}) {
  if(collection?.type!=='FeatureCollection')throw Error('Expected a FeatureCollection');
  const seen=new Set(), edges=[], adjacency=new Map();
  for(const f of collection.features){
    const p=f.properties??{},coords=f.geometry?.coordinates;
    for(const key of ['edge_id','from_node','to_node','road_id','direction'])if(typeof p[key]!=='string'||!p[key])throw Error(`Edge needs string ${key}`);
    if(seen.has(p.edge_id))throw Error(`Duplicate edge_id ${p.edge_id}`);seen.add(p.edge_id);
    if(f.geometry?.type!=='LineString'||coords.length<2||coords.some(c=>c.length<2||!c.slice(0,2).every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>85))throw Error(`Invalid geometry ${p.edge_id}`);
    const length=geometryLength(coords);if(length<=0)throw Error(`Zero-length edge ${p.edge_id}`);
    const known=positive(p.travel_time_s)&&positive(p.free_flow_time_s);
    // Never merge different carriageways, lanes, hierarchy, route membership or levels.
    const key=JSON.stringify([p.road_id,p.direction,p.class??'',p.level??0,p.carriageway_id??'',p.lane_id??'',p.on_route===true,p.traffic_layout??'',p.direction_sign??0,p.traffic_offset??null]);
    edges.push({f,p,coords,length,known,key});
    // Distinct neighbours identify forks even when the branch belongs to another road.
    for(const [a,b] of [[p.from_node,p.to_node],[p.to_node,p.from_node]]){
      const k=JSON.stringify([a,p.level??0]);if(!adjacency.has(k))adjacency.set(k,new Set());adjacency.get(k).add(b);
    }
  }
  edges.sort((a,b)=>a.p.edge_id.localeCompare(b.p.edge_id));
  const groups=new Map();for(const e of edges){if(!groups.has(e.key))groups.set(e.key,[]);groups.get(e.key).push(e);}
  const chains=[];
  for(const group of groups.values()){
    const incoming=new Map(),outgoing=new Map();
    for(const e of group){for(const [map,node] of [[incoming,e.p.to_node],[outgoing,e.p.from_node]]){if(!map.has(node))map.set(node,[]);map.get(node).push(e);}}
    const next=e=>{
      const n=e.p.to_node;
      if(e.p.junction_end===true||(adjacency.get(JSON.stringify([n,e.p.level??0]))?.size??0)>2)return null;
      if(incoming.get(n)?.length!==1||outgoing.get(n)?.length!==1)return null;
      const candidate=outgoing.get(n)[0];
      if(candidate.p.junction_start===true||distanceMetres(e.coords.at(-1),candidate.coords[0])>endpointToleranceMetres)return null;
      return candidate;
    };
    const predecessors=new Set(group.map(next).filter(Boolean)),visited=new Set();
    const walk=start=>{const chain=[];let e=start;while(e&&!visited.has(e)){visited.add(e);chain.push(e);e=next(e);}if(chain.length)chains.push(chain);};
    group.filter(e=>!predecessors.has(e)).forEach(walk);
    group.filter(e=>!visited.has(e)).forEach(walk); // Canonical smallest-ID anchor for cycles.
  }
  return {chains,edgeCount:edges.length,latitude:edges[0]?.coords[0][1]??0};
}

/** Stable two-zoom windows, anchored at each band's midpoint. Average travel
 * times, not RGB. Readability and simplification use actual CSS screen pixels;
 * closures, unknown gaps and significant slow runs remain separate. */
export function aggregateTraffic(index, zoom, { targetPixels=32, simplificationPixels=.6, bottleneckMetres=80, bottleneckDelaySeconds=45, bottleneckMinPixels=8 }={}) {
  if(!Number.isFinite(zoom)||!positive(targetPixels)||!Number.isFinite(simplificationPixels)||simplificationPixels<0||!positive(bottleneckMetres)||!positive(bottleneckDelaySeconds)||!positive(bottleneckMinPixels))throw Error('Invalid aggregation options');
  const band=Math.min(18,Math.max(0,2*Math.floor(zoom/2)));
  // MapLibre's zoom-zero world is 512 CSS pixels. Keep the metric window and
  // its chain phase fixed within a two-zoom band, while the simplification and
  // bottleneck tests follow the actual (including fractional) camera zoom.
  const metresPerZoomZeroPixel=156543.033928*Math.cos(index.latitude*rad)/2;
  const mpp=metresPerZoomZeroPixel/2**zoom,windowAnchorZoom=band+1;
  // No extra power-of-two rounding: it can enlarge a nominal window by almost
  // another half before the band itself magnifies it at fractional zooms.
  const windowMetres=band>=18?0:metresPerZoomZeroPixel/2**windowAnchorZoom*targetPixels;
  const features=[];
  for(const chain of index.chains){
    // A loop may be split into several traffic windows. Retain its native
    // support in every window, rather than simplifying each arc into chords.
    const closedChain=pointKey(chain[0].coords[0])===pointKey(chain.at(-1).coords.at(-1));
    const protectedEdges=new Set();
    let run=[];
    const flush=()=>{
      const length=run.reduce((s,e)=>s+e.length,0),delay=run.reduce((s,e)=>s+Math.max(0,e.p.travel_time_s-e.p.free_flow_time_s),0);
      // Once a slow run becomes visually unreadable, include its delay in the
      // surrounding window instead of keeping a tiny separate coloured sliver.
      if(length/mpp>=bottleneckMinPixels&&(length>=bottleneckMetres||delay>=bottleneckDelaySeconds))run.forEach(e=>protectedEdges.add(e));
      run=[];
    };
    for(const e of chain){if(e.known&&e.p.closed!==true&&e.p.travel_time_s/e.p.free_flow_time_s>=3)run.push(e);else flush();}flush();
    let travelled=0,current=[],key;
    const emit=()=>{
      if(!current.length)return;
      const first=current[0],last=current.at(-1),known=current.every(e=>e.known),closed=first.p.closed===true;
      const actual=known?current.reduce((s,e)=>s+e.p.travel_time_s,0):null,free=known?current.reduce((s,e)=>s+e.p.free_flow_time_s,0):null;
      const points=[...first.coords];
      for(const e of current.slice(1))points.push(...e.coords.slice(pointKey(points.at(-1))===pointKey(e.coords[0])||distanceMetres(points.at(-1),e.coords[0])<=12?1:0));
      const ratio=known?actual/free:null;
      features.push({type:'Feature',id:JSON.stringify([band,first.p.edge_id,last.p.edge_id]),properties:{...first.p,
        to_node:last.p.to_node,edge_ids:current.map(e=>e.p.edge_id),edge_count:current.length,
        length_m:current.reduce((s,e)=>s+e.length,0),travel_time_s:actual,free_flow_time_s:free,
        congestion_ratio:ratio,congestion:closed?'severe':congestionFromRatio(ratio),closed,
        preserved_bottleneck:protectedEdges.has(first),aggregation_band:band,
      },geometry:{type:'LineString',coordinates:closedChain?points:simplify(points,band>=18?0:mpp*simplificationPixels)}});
      current=[];
    };
    for(const e of chain){
      const bucket=windowMetres?Math.floor((travelled+e.length/2)/windowMetres):e.p.edge_id;
      const state=e.p.closed===true?'closed':!e.known?'unknown':protectedEdges.has(e)?'bottleneck':'normal';
      // Keep a readable protected run whole, rather than clipping its ends into
      // small pieces at unrelated averaging-window boundaries.
      const nextKey=JSON.stringify([band<18&&state==='bottleneck'?'run':bucket,state]);
      if(current.length&&nextKey!==key)emit();key=nextKey;current.push(e);travelled+=e.length;
    }
    emit();
  }
  return {type:'FeatureCollection',features,metadata:{band,window_metres:windowMetres,window_anchor_zoom:windowAnchorZoom,metres_per_pixel:mpp,simplification_metres:band>=18?0:mpp*simplificationPixels,input_edges:index.edgeCount,output_segments:features.length,input_vertices:index.chains.flat().reduce((s,e)=>s+e.coords.length,0),output_vertices:features.reduce((s,f)=>s+f.geometry.coordinates.length,0)}};
}

/** Synthetic fixture only: split the existing real road geometry into small edges.
 * No claim that these IDs or measurements came from a Valhalla graph. */
export function makeAggregationFixture(collection, { edgeMetres=20 }={}) {
  if(!positive(edgeMetres))throw Error('edgeMetres must be positive');
  const features=[];
  collection.features.forEach((f,fi)=>{
    const paths=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.type==='MultiLineString'?f.geometry.coordinates:[];
    paths.forEach((path,pi)=>{
      if(path.length<2)return;
      const root=`demo:${fi}:${pi}`,chunks=[];let points=[path[0]],remaining=edgeMetres;
      for(let i=1;i<path.length;i++){
        let a=points.at(-1),b=path[i],length=distanceMetres(a,b);
        while(length>=remaining&&length>0){const t=remaining/length,c=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];points.push(c);chunks.push(points);points=[c];a=c;length=distanceMetres(a,b);remaining=edgeMetres;}
        if(length>1e-6){points.push(b);remaining-=length;}
      }
      if(points.length>=2&&geometryLength(points)>1e-3)chunks.push(points);
      const directions=f.properties.oneway===1?['forward']:f.properties.oneway===-1?['reverse']:['forward','reverse'];
      directions.forEach(direction=>chunks.forEach((coords,ci)=>{
        const reverse=direction==='reverse',length=geometryLength(coords),hash=(fi*17+ci*37+pi*11+(reverse?23:0))%100;
        // Small alternating noise plus a deliberate continuous bottleneck on long paths.
        const ratio=chunks.length>35&&ci>=Math.floor(chunks.length*.45)&&ci<Math.floor(chunks.length*.45)+8?3.8:hash<52?1.05:hash<76?1.4:hash<92?1.9:2.7;
        const free=length/(50/3.6),start=`${root}:n${ci}`,end=`${root}:n${ci+1}`;
        features.push({type:'Feature',properties:{...f.properties,edge_id:`${root}:${direction}:${ci}`,road_id:root,direction,
          from_node:reverse?end:start,to_node:reverse?start:end,free_flow_time_s:free,travel_time_s:free*ratio,
          traffic_layout:directions.length===2?'shared':'separate',direction_sign:1,sample:true,
        },geometry:{type:'LineString',coordinates:reverse?[...coords].reverse():coords}});
      }));
    });
  });
  return {type:'FeatureCollection',features};
}
