import {adaptBorbaloTraffic} from './borbalo-traffic-tiles.js?v=corridors-11';
import {matchTrafficRoads} from './traffic-road-match.js?v=corridors-11';
import {directionalTrafficPaths} from './traffic-direction-paths.js?v=corridors-11';
import {overviewTrafficPaths,mergeShortStreetSegments} from './traffic-overview-paths.js?v=corridors-11';
import {classifyTrafficDisplay} from './traffic-display-class.js?v=corridors-11';
import {buildRoadCorridorIndex,selectTrafficCorridors} from './traffic-corridor-selection.js?v=corridors-11';
const json=path=>fetch(new URL(path,import.meta.url)).then(r=>r.ok?r.json():null).catch(()=>null);
const roadClasses=json('../examples/traffic/road-classes.json?v=corridors-11');
const inTbilisiBox=f=>{const c=f?.geometry?.type==='LineString'?f.geometry.coordinates:f?.geometry?.coordinates?.[0];if(!c||!c.length)return false;const pt=c[Math.floor(c.length/2)];return pt[0]>=44.58&&pt[0]<=44.95&&pt[1]>=41.60&&pt[1]<=41.86;};
const referenceRoads=Promise.all([json('../examples/traffic/road-corridors.json?v=corridors-11'),json('../examples/traffic/national-road-corridors.json?v=corridors-11')]).then(([rc,nrc])=>[...(rc?.features??[]),...(nrc?.features??[]).filter(f=>!inTbilisiBox(f))]);
let referenceKey='',referenceIndex;
function baseFeature(f,zoom,named=false){
 const p={...f.properties,base_source_zoom:zoom},id=Number(f.id);
 if(Number.isSafeInteger(id)&&id>0&&!named){p.osm=Math.floor(id/10);p.road_id=String(p.osm);p.osm_membership_complete=zoom>=12;}
 else if(Number.isSafeInteger(id)&&id>0){p.osm_seed_id=Math.floor(id/10);p.osm_membership_complete=false;}
 return {...f,properties:p};
}
function pruneOverviewIslands(collection,zoom){
 const feats=collection?.features??[];
 if(zoom>=14||feats.length<=1)return collection;
 const rad=Math.PI/180,lat=feats[0]?.geometry?.coordinates?.[0]?.[1]??41.72,cos=Math.cos(lat*rad);
 const sx=111195*cos,sy=111195,dist=(a,b)=>Math.hypot((a[0]-b[0])*sx,(a[1]-b[1])*sy);
 const mpp=156543.033928*cos/2**zoom,minLen=mpp*(zoom<9.5?36:24),minMajorLen=mpp*(zoom<9.5?14:10),cell=75;
 const parent=feats.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const grid=new Map();
 for(let i=0;i<feats.length;i++){
  const coords=feats[i].geometry?.coordinates??[];
  for(let k=0;k<coords.length;k++){
   const pt=coords[k],gx=Math.floor(pt[0]*sx/cell),gy=Math.floor(pt[1]*sy/cell);
   for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
    for(const entry of grid.get((gx+dx)+','+(gy+dy))??[]){
     if(entry.i!==i&&dist(pt,entry.pt)<=cell)parent[find(i)]=find(entry.i);
    }
   }
   const key=gx+','+gy;if(!grid.has(key))grid.set(key,[]);grid.get(key).push({i,pt});
  }
 }
 const compLen=new Map(),compMajor=new Set();
 for(let i=0;i<feats.length;i++){
  const r=find(i),f=feats[i],p=f.properties??{},coords=f.geometry?.coordinates??[];
  const len=Number(p.length_m)||coords.slice(1).reduce((s,c,k)=>s+dist(coords[k],c),0);
  const weight=p.traffic_layout==='shared'?len*0.5:len;
  compLen.set(r,(compLen.get(r)??0)+weight);
  if(['international','motorway','trunk','national','regional'].includes(p.traffic_corridor_kind)||p.traffic_corridor_ref)compMajor.add(r);
 }
 return {...collection,features:feats.filter((f,i)=>{
  const p=f.properties??{},coords=f.geometry?.coordinates??[];
  const segLen=Number(p.length_m)||coords.slice(1).reduce((s,c,k)=>s+dist(coords[k],c),0);
  if(segLen<mpp*8)return false;
  const r=find(i),len=compLen.get(r)??0;
  return (compMajor.has(r)&&len>=minMajorLen)||len>=minLen;
 })};
}
self.onmessage=async ({data:job})=>{
 try{
  const start=performance.now();let result=adaptBorbaloTraffic(job.features,job.zoom,{aggregate:false});
  const inputEdges=result.metadata?.input_edges??result.features.length;
  if(job.zoom>=14&&result.features.length&&job.roads.length)result=matchTrafficRoads(result,job.roads,job.bounds,{osmIdFromFeature:f=>Number.isSafeInteger(f.id)&&f.id>0?Math.floor(f.id/10):undefined});
  result=classifyTrafficDisplay(result,await roadClasses??{});
  const key=[job.roadEpoch,Math.floor(job.zoom),job.roads.length,job.roadNames?.length??0].join(':');
  if(!referenceIndex||key!==referenceKey){
   const namesByWay=new Map();
   for(const f of job.roadNames??[]){
    if(!Number.isSafeInteger(f.id)||f.id<=0)continue;
    const id=Math.floor(f.id/10),p=namesByWay.get(id)??{};
    for(const [k,v] of Object.entries(f.properties??{}))if(/^(ref|int_ref|network|name|name_en|route_\d+_(ref|network|name))$/.test(k))p[k]=v;
    namesByWay.set(id,p);
   }
   const extraRoads=job.zoom>=14?job.roads:job.roads.filter(f=>!inTbilisiBox(f)&&(job.zoom>=9.5||['motorway','trunk'].includes(f.properties?.class)));
   const extraNames=job.zoom>=14?(job.roadNames??[]):(job.roadNames??[]).filter(f=>!inTbilisiBox(f)&&(job.zoom>=9.5||['motorway','trunk'].includes(f.properties?.class)));
   const network={type:'FeatureCollection',features:[...await referenceRoads,
    ...extraRoads.map(f=>{const base=baseFeature(f,job.baseZoom??Math.min(14,Math.floor(job.zoom)));return {...base,properties:{...namesByWay.get(base.properties.osm),...base.properties}};}),
    ...extraNames.map(f=>baseFeature(f,job.baseZoom??Math.min(14,Math.floor(job.zoom)),true))]};
   referenceIndex=buildRoadCorridorIndex(network);referenceKey=key;
  }
  result=selectTrafficCorridors(result,referenceIndex,job.zoom);
  if(job.zoom<14){result=overviewTrafficPaths(result,job.zoom);result=pruneOverviewIslands(result,job.zoom);}
  else{result=mergeShortStreetSegments(result,job.zoom);}
  const selection=result.corridorSelection;
  if(selection)result.corridorSelection={reference_features:selection.reference_features,total_corridors:selection.total_corridors,selected_corridors:selection.selected_corridors,unmatched_features:selection.unmatched_features,spatially_associated_features:selection.spatially_associated_features,unavailable_features:selection.unavailable_features,hidden_features:selection.hidden_features};
  self.postMessage({id:job.id,data:result,inputEdges,stats:{corridors:result.corridorSelection,
   selected:result.features.filter(f=>f.properties.traffic_corridor_selected).length,
   refs:result.features.reduce((a,f)=>{const c=f.properties.traffic_corridor_ref??'unnamed';a[c]=(a[c]??0)+1;return a;},{}),
   levels:result.features.reduce((a,f)=>{const c=f.properties.level??'unknown';a[c]=(a[c]??0)+1;return a;},{}),
   classes:result.features.reduce((a,f)=>{const c=f.properties.class;a[c]=(a[c]??0)+1;return a;},{}),
   congestion:result.features.reduce((a,f)=>{const c=f.properties.congestion;a[c]=(a[c]??0)+1;return a;},{}),
   widths:result.features.filter(f=>f.properties.traffic_path_rendered).map(f=>f.properties.traffic_stripe_width).filter(Number.isFinite).slice(0,10)},elapsed:Math.round(performance.now()-start)});
 }catch(error){self.postMessage({id:job.id,error:error.message});}
};
