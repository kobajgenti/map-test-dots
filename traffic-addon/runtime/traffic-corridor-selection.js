/** Select roads from an independent base-network reference, never from the
 * length/continuity/congestion of currently observed traffic. Selection changes
 * entire corridors; every supplied measurement on a selected OSM road survives. */
export const ROAD_CORRIDOR_POLICY={
 international:{minZoom:5,minPixels:0},motorway:{minZoom:5,minPixels:0},trunk:{minZoom:6.5,minPixels:0},
 national:{minZoom:6.5,minPixels:0},primary:{minZoom:9.5,minPixels:0},regional:{minZoom:9.5,minPixels:0},secondary:{minZoom:11.5,minPixels:0},
 tertiary:{minZoom:14,minPixels:16},local:{minZoom:14.5,minPixels:12},minor:{minZoom:14.5,minPixels:12},service:{minZoom:16,minPixels:10},link:{minZoom:11.5,minPixels:0},
};
const paths=g=>g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:[];
const roadIds=(f,decode)=>{const p=f.properties??{};if(p.osm_membership_complete===false)return new Set();const values=p.road_ids??p.osm_ids??p.osm??p.road_id??p.osm_id??(decode?decode(f):null);return new Set((Array.isArray(values)?values:[values]).filter(v=>v!=null&&String(v).trim()).map(v=>String(v).trim()).filter(v=>v!=='0'));};
const roadUnavailable=p=>p.traffic_road_unavailable===true||p.traffic_road_unavailable===1||p.highway==='construction'||p.class==='construction'||String(p.class??'').endsWith('_construction');
const point=p=>p[0].toFixed(7)+','+p[1].toFixed(7);
export function normalizeRoadReference(value){return String(value??'').trim().replace(/^(?:ს|Ს)\s*(?=\d)/u,'S').replace(/^(?:შ|Შ|Ш|ш)\s*(?=\d)/u,'SH').toUpperCase().replace(/[\s\-]+/g,'').replace(/^([A-Z]+)0+(?=\d)/,'$1');}
function references(p){
 const result=new Map(),add=(value,network)=>{if(value==null)return;for(const entry of Array.isArray(value)?value:String(value).split(/[;,]/)){if(entry&&typeof entry==='object'){add(entry.ref??entry.reference,entry.network??network);continue;}const ref=normalizeRoadReference(entry);if(!ref)continue;const n=/^E\d+$/.test(ref)?'e-road':String(network??'road').trim().toLowerCase();const ge=/^(?:ს|Ს|შ|Შ|Ш|ш)\s*\d/u.test(String(entry))||/^ge:/i.test(n),inferred=ge&&/^SH\d+$/.test(ref)?'regional':ge&&/^S\d+$/.test(ref)?'national':null;const previous=result.get(n+':'+ref);result.set(n+':'+ref,{ref,network:n,...(inferred||previous?.importance?{importance:inferred??previous.importance}:{})});}};
 add(p.corridor_ref,p.corridor_network);add(p.corridor_refs,p.corridor_network);add(p.ref,p.network);add(p.int_ref,'e-road');add(p.refs??p.route_refs,p.network);
 for(const key of Object.keys(p)){const match=key.match(/^route_(\d+)_ref$/);if(match)add(p[key],p['route_'+match[1]+'_network']);}
 return [...result.values()];
}
const effectiveClass=p=>String(p.traffic_display_class??(p.traffic_class_source==='provider-rank'?null:p.class)??p.highway??'');
const baseClass=c=>String(c??'').replace(/_link$/,'')==='motorway_detail'?'motorway':['street','residential','unclassified','living_street'].includes(c)?'minor':String(c??'').replace(/_link$/,'');
const grade=p=>{const raw=p.layer??p.level;return JSON.stringify([raw!=null&&Number.isFinite(Number(raw))?Number(raw):'unknown',p.brunnel??'']);};
const xy=p=>[p[0]/360*512,-Math.log(Math.tan(Math.PI/4+Math.max(-85.051129,Math.min(85.051129,p[1]))*Math.PI/360))*512/(2*Math.PI)];
function referenceLength(coordinates){let length=0;for(let i=1;i<coordinates.length;i++){const a=xy(coordinates[i-1]),b=xy(coordinates[i]);let dx=b[0]-a[0];dx-=Math.round(dx/512)*512;length+=Math.hypot(dx,b[1]-a[1]);}return length;}
function declaredRole(p){const role=String(p.traffic_corridor_role??p.corridor_role??'');return ['mainline','through-junction'].includes(role)?'mainline':['branch','ramp','link'].includes(role)?'branch':'';}
function branchRole(p){return declaredRole(p)==='branch';}
function classImportance(p){const c=effectiveClass(p);if(branchRole(p))return 'link';if(p.corridor_importance)return String(p.corridor_importance);return ['motorway','motorway_detail','trunk','primary','secondary','tertiary','service'].includes(baseClass(c))?baseClass(c):'local';}
function routeImportance(ref){if(ref.network==='street')return null;if(/^(?:E|AH)\d+$/.test(ref.ref)||/international|e-road|asianhighway/.test(ref.network))return 'international';if(/regional|provincial/.test(ref.network))return 'regional';if(/national/.test(ref.network))return 'national';return ref.importance??(/^SH\d+$/.test(ref.ref)?'regional':/^S\d+$/.test(ref.ref)?'national':null);}
function stableHash(value){let a=2166136261,b=2246822519;for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,3266489917);}return (a>>>0).toString(36)+(b>>>0).toString(36);}
function preserveReferenceThroughLinks(arcs){
 const routeKeys=new Set(arcs.filter(a=>a.isBranch).flatMap(a=>[...a.refs.keys()]));
 for(const key of routeKeys){
  const main=arcs.filter(a=>!a.isBranch&&!a.roadUnavailable&&a.ids.size&&a.refs.has(key)),links=arcs.filter(a=>a.isBranch&&!a.explicitBranchRole&&!a.roadUnavailable&&a.ids.size&&a.refs.has(key));
  if(!main.length||!links.length)continue;
  const parent=new Map(main.map(a=>[a.number,a.number])),mainNodes=new Map(),linkNodes=new Map(),ends=a=>[point(a.coordinates[0]),point(a.coordinates.at(-1))];
  const find=id=>{while(parent.get(id)!==id){parent.set(id,parent.get(parent.get(id)));id=parent.get(id);}return id;};
  for(const arc of main)for(const endpoint of ends(arc)){if(!mainNodes.has(endpoint))mainNodes.set(endpoint,[]);mainNodes.get(endpoint).push(arc);}
  for(const incident of mainNodes.values())for(const arc of incident.slice(1))parent.set(find(arc.number),find(incident[0].number));
  for(const arc of links)for(const endpoint of ends(arc)){if(!linkNodes.has(endpoint))linkNodes.set(endpoint,[]);linkNodes.get(endpoint).push(arc);}
  const seen=new Set();
  for(const root of links){
   if(seen.has(root))continue;
   const group=[],pending=[root],nodes=new Set();
   while(pending.length){const arc=pending.pop();if(seen.has(arc))continue;seen.add(arc);group.push(arc);for(const endpoint of ends(arc)){nodes.add(endpoint);for(const next of linkNodes.get(endpoint)??[])if(!seen.has(next))pending.push(next);}}
   const terminals=[...nodes].filter(endpoint=>linkNodes.get(endpoint).length===1);
   if(terminals.length!==2||[...nodes].some(endpoint=>linkNodes.get(endpoint).length>2))continue;
   const [a,b]=terminals.map(endpoint=>mainNodes.get(endpoint)??[]);
   if(!a.length||!b.length||a.length!==1&&b.length!==1)continue;
   const components=new Set(a.map(arc=>find(arc.number)));
   if(b.some(arc=>components.has(find(arc.number))))continue;
   for(const arc of group){arc.isBranch=false;arc.mainlineRole=true;arc.referenceThroughLink=true;}
  }
 }
}
export function buildRoadCorridorIndex(roadNetwork,{snapMetres=4.0,osmIdFromFeature}={}){
 const explicitIds=new Map();for(const f of roadNetwork?.features??[]){const p=f.properties??{};if(p.corridor_id&&p.corridor_ref)for(const ref of references(p))if(ref.ref===normalizeRoadReference(p.corridor_ref))explicitIds.set(ref.network+':'+ref.ref,String(p.corridor_id));}
 const arcs=[],shapeMap=new Map(),corridors=new Map(),roadToCorridors=new Map(),unavailableRoadIds=new Set(),snap=Number.isFinite(snapMetres)&&snapMetres>0?snapMetres:4.0;
 function makeCorridor(id,refs=[]){if(!corridors.has(id))corridors.set(id,{id,refs,arcs:new Set(),roadIds:new Set(),routeMembershipRoadIds:new Set(),classLengths:new Map(),referencePixelsAtZoom0:0});return corridors.get(id);}
 function attach(corridor,arc){if(corridor.arcs.has(arc))return;corridor.arcs.add(arc);for(const id of arc.ids)corridor.roadIds.add(id);if(!arc.roadUnavailable){corridor.referencePixelsAtZoom0+=arc.length;for(const [c,w] of arc.importance)corridor.classLengths.set(c,(corridor.classLengths.get(c)??0)+w);}}
 for(const f of roadNetwork?.features??[]){const p=f.properties??{},ids=roadIds(f,osmIdFromFeature),refs=references(p),unavailable=roadUnavailable(p);if(unavailable)for(const id of ids)unavailableRoadIds.add(id);for(const path of paths(f.geometry)){
  const coordinates=path.filter((p,i)=>!i||p[0]!==path[i-1][0]||p[1]!==path[i-1][1]);if(coordinates.length<2||coordinates.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1])))continue;
  const forward=coordinates.map(point).join(';'),backward=coordinates.toReversed().map(point).join(';'),shape=forward<backward?forward:backward,key=grade(p)+':'+(unavailable?'unavailable:':'')+shape;let arc=shapeMap.get(key);
  if(!arc){arc={number:arcs.length,key,grade:grade(p),coordinates:forward<backward?coordinates:coordinates.toReversed(),ids:new Set(),refs:new Map(),importance:new Map(),classes:new Set(),length:referenceLength(coordinates),roundabout:false,branchRole:false,explicitBranchRole:false,mainlineRole:false,roadUnavailable:unavailable,sourceZoom:null,level:null,brunnel:''};arcs.push(arc);shapeMap.set(key,arc);}
  const sourceZoom=Number(p.base_source_zoom??p.source_zoom);if(Number.isFinite(sourceZoom))arc.sourceZoom=Math.max(arc.sourceZoom??-Infinity,sourceZoom);const level=p.layer??p.level;if(level!=null&&Number.isFinite(Number(level)))arc.level=Number(level);arc.brunnel=String(p.brunnel??arc.brunnel);for(const id of ids)arc.ids.add(id);for(const ref of refs)arc.refs.set(ref.network+':'+ref.ref,ref);const importance=classImportance(p);arc.importance.set(importance,arc.length);arc.classes.add(baseClass(effectiveClass(p)));arc.roundabout||=p.junction==='roundabout'||p.roundabout===true||p.roundabout===1;arc.branchRole||=branchRole(p);arc.explicitBranchRole||=declaredRole(p)==='branch';arc.mainlineRole||=declaredRole(p)==='mainline';
 }}
 for(const arc of arcs)arc.isBranch=arc.branchRole&&!arc.mainlineRole&&!arc.roundabout;
 preserveReferenceThroughLinks(arcs);
 for(const f of roadNetwork?.features??[]){const p=f.properties??{};if(p.corridor_membership_complete===true){const completeRefs=p.corridor_ref||p.corridor_refs?references({corridor_ref:p.corridor_ref,corridor_refs:p.corridor_refs,corridor_network:p.corridor_network}):references(p);for(const ref of completeRefs)makeCorridor(explicitIds.get(ref.network+':'+ref.ref)??'ref:'+ref.network+':'+ref.ref,[ref]).membershipComplete=true;}}
 for(const arc of arcs)for(const ref of arc.refs.values()){const corridor=makeCorridor(explicitIds.get(ref.network+':'+ref.ref)??'ref:'+ref.network+':'+ref.ref,[ref]);for(const id of arc.ids)corridor.routeMembershipRoadIds.add(id);if(!arc.isBranch)attach(corridor,arc);}
 const namedByRoad=new Map();for(const corridor of corridors.values())for(const id of corridor.roadIds){if(!namedByRoad.has(id))namedByRoad.set(id,new Set());namedByRoad.get(id).add(corridor);}
 for(const arc of arcs)if(!arc.refs.size&&!arc.isBranch)for(const id of arc.ids)for(const c of namedByRoad.get(id)??[])attach(c,arc);
 const nodes=[],grid=new Map(),latitude=arcs[0]?.coordinates[0][1]??0,sx=111195*Math.cos(latitude*Math.PI/180),metres=p=>[p[0]*sx,p[1]*111195];
 function nodeFor(key,p){const x=Math.floor(p[0]/snap),y=Math.floor(p[1]/snap);let best,d=Infinity;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const n of grid.get(key+':'+(x+dx)+','+(y+dy))??[]){const gap=Math.hypot(n.point[0]-p[0],n.point[1]-p[1]);if(gap<=snap&&gap<d){best=n;d=gap;}}if(best)return best;const n={id:nodes.length,point:p,incidents:[]};nodes.push(n);const cell=key+':'+x+','+y;if(!grid.has(cell))grid.set(cell,[]);grid.get(cell).push(n);return n;}
 function heading(coordinates,start){const a=metres(start?coordinates[0]:coordinates.at(-1));let b;for(let i=1;i<coordinates.length;i++){b=metres(start?coordinates[i]:coordinates[coordinates.length-1-i]);if(Math.hypot(b[0]-a[0],b[1]-a[1])>=2)break;}const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);return [dx/length,dy/length];}
 const ends=arcs.flatMap(arc=>[{arc,end:0,point:metres(arc.coordinates[0]),heading:heading(arc.coordinates,true)},{arc,end:1,point:metres(arc.coordinates.at(-1)),heading:heading(arc.coordinates,false)}]).sort((a,b)=>a.arc.grade.localeCompare(b.arc.grade)||a.point[0]-b.point[0]||a.point[1]-b.point[1]||a.arc.key.localeCompare(b.arc.key));
 // Snap endpoints spatially so bridge/tunnel deck transitions share nodes with their approaches
 for(const e of ends){e.node=nodeFor('spatial',e.point);e.node.incidents.push(e);e.arc[e.end?'end':'start']=e;}
 const named=()=>new Set([...corridors.values()].flatMap(c=>[...c.arcs])),namedArcs=named(),parent=arcs.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
 const dot=(a,b)=>a.heading[0]*b.heading[0]+a.heading[1]*b.heading[1],compatible=(a,b)=>[...a.classes].some(c=>b.classes.has(c))||[...a.classes].some(c=>['motorway','trunk'].includes(c))&&[...b.classes].some(c=>['motorway','trunk'].includes(c));
 // Connect unnamed corridors across both simple 2-incident nodes and intersections where side streets/ramps branch off
 for(const node of nodes){
  const unnamedInc=node.incidents.filter(e=>!namedArcs.has(e.arc));
  const mainInc=unnamedInc.filter(e=>!e.arc.isBranch);
  if(mainInc.length===2){
   const [a,b]=mainInc;
   if(a.arc!==b.arc&&compatible(a.arc,b.arc)&&dot(a,b)<.25){const x=find(a.arc.number),y=find(b.arc.number);if(x!==y)parent[y]=x;}
  }else if(mainInc.length>2){
   for(const a of mainInc){
    const matches=mainInc.filter(b=>b.arc!==a.arc&&compatible(a.arc,b.arc)&&dot(a,b)<-.45).sort((u,v)=>dot(a,u)-dot(a,v));
    if(matches.length>=1){
     const b=matches[0];
     const revMatches=mainInc.filter(c=>c.arc!==b.arc&&compatible(b.arc,c.arc)&&dot(b,c)<-.45).sort((u,v)=>dot(b,u)-dot(b,v));
     if(revMatches[0]===a){const x=find(a.arc.number),y=find(b.arc.number);if(x!==y)parent[y]=x;}
    }
   }
  }
 }
 const unnamedGroups=new Map();for(const arc of arcs)if(!namedArcs.has(arc)){const root=find(arc.number);if(!unnamedGroups.has(root))unnamedGroups.set(root,[]);unnamedGroups.get(root).push(arc);}
 for(const group of unnamedGroups.values()){
  const parents=new Map(),interfaces=new Map(),parentArcs=new Map();let roundabout=false,provenThrough=true,allMainline=true;
  for(const arc of group){roundabout||=arc.roundabout;provenThrough&&=arc.mainlineRole;allMainline&&=!arc.isBranch;for(const e of [arc.start,arc.end])for(const incident of e.node.incidents)if(namedArcs.has(incident.arc)&&compatible(arc,incident.arc))for(const corridor of corridors.values())if(corridor.arcs.has(incident.arc)){parents.set(corridor.id,corridor);if(!interfaces.has(corridor.id)){interfaces.set(corridor.id,new Set());parentArcs.set(corridor.id,new Set());}interfaces.get(corridor.id).add(e.node.id);parentArcs.get(corridor.id).add(incident.arc.number);}}
  const groupLen=group.reduce((s,a)=>s+a.length,0),owners=[...parents.values()].filter(c=>roundabout||(group.length<=3&&groupLen<0.002&&(provenThrough||allMainline)&&(interfaces.get(c.id)?.size??0)>=2)),ownerKey=c=>[...(parentArcs.get(c.id)??[])].sort((a,b)=>a-b).join(',');
  if(owners.length&&owners.every(c=>ownerKey(c)===ownerKey(owners[0]))){for(const arc of group)for(const owner of owners)attach(owner,arc);continue;}
  const id='road:'+stableHash(group.map(a=>a.key+':'+[...a.ids].sort().join(',')).sort().join('|')),corridor=makeCorridor(id);if(group.every(arc=>arc.isBranch))corridor.role='branch';for(const arc of group)attach(corridor,arc);
 }
 for(const corridor of corridors.values()){
  const explicit=corridor.refs.map(routeImportance).filter(Boolean);corridor.importance=corridor.role==='branch'?'link':explicit.includes('international')?'international':explicit[0]??[...corridor.classLengths].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]??'local';
  for(const arc of corridor.arcs){arc.corridorIds??=new Set();arc.corridorIds.add(corridor.id);}for(const id of corridor.roadIds){if(!roadToCorridors.has(id))roadToCorridors.set(id,new Set());roadToCorridors.get(id).add(corridor.id);}
 }
 return {type:'RoadCorridorIndex',corridors,roadToCorridors,referenceFeatures:roadNetwork?.features?.length??0,arcs,latitude,unavailableRoadIds};
}
// Spatial association is a fallback for coarse merged base lines whose feature
// IDs enumerate only a seed way. It never changes reference importance or
// fills missing traffic. The nearest *unselected* base road competes too.
const importanceOrder={international:0,motorway:1,trunk:1,national:2,primary:2,regional:3,secondary:3,tertiary:4,link:4,local:5,minor:5,service:6};
const importanceScale={international:1.25,motorway:1.25,trunk:1.25,national:1,primary:1,regional:.85,secondary:.85,tertiary:.6,link:.8,local:.6,minor:.6,service:.6};
function spatialReference(index){
 if(index.spatialReference)return index.spatialReference;
 const cos=Math.max(.01,Math.cos(index.latitude*Math.PI/180)),sx=111195*cos,project=p=>[p[0]*sx,p[1]*111195],cell=128,grid=new Map();
 for(const arc of index.arcs)for(let i=1;i<arc.coordinates.length;i++){
  const a=project(arc.coordinates[i-1]),b=project(arc.coordinates[i]),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(!length)continue;
  const segment={a,b,dx,dy,length,arc},pieces=Math.max(1,Math.ceil(length/cell)),cells=new Set();
  // Subdivide only the indexing bounds; the original segment remains exact.
  for(let n=0;n<pieces;n++){const t=n/pieces,u=(n+1)/pieces,x1=a[0]+dx*t,y1=a[1]+dy*t,x2=a[0]+dx*u,y2=a[1]+dy*u;for(let x=Math.floor(Math.min(x1,x2)/cell);x<=Math.floor(Math.max(x1,x2)/cell);x++)for(let y=Math.floor(Math.min(y1,y2)/cell);y<=Math.floor(Math.max(y1,y2)/cell);y++)cells.add(x+','+y);}
  for(const key of cells){if(!grid.has(key))grid.set(key,[]);grid.get(key).push(segment);}
 }
 return index.spatialReference={cos,project,cell,grid};
}
function associateTraffic(feature,index,zoom,{maxAssociationMetres=120,minimumAssociationOverlap=.42,minimumHeadingCosine=.72,associationDistance}={}){
 const reference=spatialReference(index),p=feature.properties??{},trafficIds=roadIds(feature),support=new Map(),level=p.layer??p.level,knownLevel=level!=null&&Number.isFinite(Number(level)),brunnel=String(p.brunnel??''),trafficClass=String(p.traffic_display_class??p.class??''),trafficBase=baseClass(trafficClass),major=zoom<9.5?new Set(['motorway','trunk']):new Set(['motorway','trunk','primary']);
 const nativeZoom=Math.max(0,Math.min(15,Math.floor(zoom))),quantum=z=>40075016.686*reference.cos/(4096*2**z),trafficQuantum=quantum(nativeZoom),maximum=Math.max(1,Math.min(120,Number(maxAssociationMetres)||120));let total=0;
 const gradeCompatible=arc=>!(knownLevel&&arc.level!=null&&Number(level)!==arc.level)&&!(brunnel&&arc.brunnel&&brunnel!==arc.brunnel);
 const compatible=arc=>{
  if(trafficBase&&arc.classes.size&&!arc.classes.has(trafficBase)&&!(major.has(trafficBase)&&[...arc.classes].some(c=>major.has(c))))return false;
  return true;
 };
 function available(arc){return [...(arc.corridorIds??[])];}
 for(const coordinates of paths(feature.geometry))for(let i=1;i<coordinates.length;i++){
  const a=reference.project(coordinates[i-1]),b=reference.project(coordinates[i]),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(!Number.isFinite(length)||!length)continue;total+=length;
  const samples=Math.max(1,Math.ceil(length/24)),weight=length/samples;
  for(let n=0;n<samples;n++){
   const t=(n+.5)/samples,x=a[0]+dx*t,y=a[1]+dy*t,gx=Math.floor(x/reference.cell),gy=Math.floor(y/reference.cell),seen=new Set(),candidates=[];
   for(let cx=gx-1;cx<=gx+1;cx++)for(let cy=gy-1;cy<=gy+1;cy++)for(const segment of reference.grid.get(cx+','+cy)??[]){
    if(seen.has(segment))continue;seen.add(segment);const arc=segment.arc;if(!gradeCompatible(arc))continue;
    const cosine=Math.abs((dx*segment.dx+dy*segment.dy)/(length*segment.length));if(cosine<minimumHeadingCosine)continue;
    const q=Math.max(0,Math.min(1,((x-segment.a[0])*segment.dx+(y-segment.a[1])*segment.dy)/(segment.length**2))),distance=Math.hypot(x-segment.a[0]-segment.dx*q,y-segment.a[1]-segment.dy*q),allowed=Number.isFinite(associationDistance)?Math.min(maximum,Math.max(0,associationDistance)):Math.min(maximum,Math.max(32,2.4*(quantum(arc.sourceZoom??14)+trafficQuantum)));
    if(distance>allowed)continue;const ids=!arc.roadUnavailable&&compatible(arc)?available(arc):[];candidates.push({arc,ids,distance,uncertainty:quantum(arc.sourceZoom??14)});
   }
   candidates.sort((a,b)=>a.distance-b.distance||a.arc.key.localeCompare(b.arc.key));const nearest=candidates[0];if(!nearest?.ids.length)continue;
   for(const id of nearest.ids)support.set(id,(support.get(id)??0)+weight);
  }
 }
 const members=new Set([...support].filter(([,length])=>total>0&&length/total>=minimumAssociationOverlap).map(([id])=>id));return {members,overlap:members.size?Math.max(...[...members].map(id=>support.get(id)/total)):0,support,total};
}
export function selectTrafficCorridors(trafficData,roadNetwork,zoom,{policy=ROAD_CORRIDOR_POLICY,spatialFallback=true,keepUnmatched=false,...options}={}){
 const index=roadNetwork?.type==='RoadCorridorIndex'?roadNetwork:buildRoadCorridorIndex(roadNetwork,options),selected=new Set(),decisions=[],decisionsById=new Map();
 for(const corridor of index.corridors.values()){
  const rules=policy[corridor.importance]??policy.local??ROAD_CORRIDOR_POLICY.local,pixels=corridor.referencePixelsAtZoom0*2**zoom,minzoom=Math.max(rules.minZoom,Math.log2(rules.minPixels/corridor.referencePixelsAtZoom0)),eligible=Number.isFinite(zoom)&&zoom>=minzoom;
  const decision={id:corridor.id,refs:corridor.refs,importance:corridor.importance,pixels,minimum_pixels:rules.minPixels,minzoom,eligible,road_count:corridor.roadIds.size};decisions.push(decision);decisionsById.set(corridor.id,decision);if(eligible)selected.add(corridor.id);
 }
 // Prove spatial membership for a complete supplied OSM-way observation
 // group. Edge boundaries, colour, direction and tiny unsupported bends are
 // not independent visibility decisions. Known distinct grades stay separate.
 const records=[],wayGroups=new Map();let unmatched=0,spatiallyAssociated=0,unavailableFeatures=0;
 for(const [number,f] of (trafficData?.features??[]).entries()){
  const ids=roadIds(f);if([...ids].some(id=>index.unavailableRoadIds?.has(id))){unavailableFeatures++;continue;}const members=new Set([...ids].flatMap(id=>[...(index.roadToCorridors.get(id)??[])])),record={f,members,association:'osm',overlap:1};records.push(record);
  if(!members.size){unmatched++;if(spatialFallback&&Number.isFinite(zoom)){
   const key=(ids.size?[...ids].sort().join(','):'feature:'+number)+':'+grade(f.properties??{});
   if(!wayGroups.has(key))wayGroups.set(key,{records:[],support:new Map(),total:0});const group=wayGroups.get(key),evidence=associateTraffic(f,index,zoom,options);group.records.push(record);group.total+=evidence.total;
   for(const [id,length] of evidence.support)group.support.set(id,(group.support.get(id)??0)+length);
  }}
 }
 const minimumOverlap=options.minimumAssociationOverlap??.42;
 for(const group of wayGroups.values()){
  const members=new Set([...group.support].filter(([,length])=>group.total>0&&length/group.total>=minimumOverlap).map(([id])=>id)),overlap=members.size?Math.max(...[...members].map(id=>group.support.get(id)/group.total)):0;
  for(const record of group.records){record.members=members;record.overlap=overlap;record.association='geometry';if(members.size)spatiallyAssociated++;}
 }
 const features=[];
 for(const {f,members,association,overlap} of records){
  const kept=[...members].filter(id=>selected.has(id)).sort((a,b)=>(importanceOrder[index.corridors.get(a).importance]??5)-(importanceOrder[index.corridors.get(b).importance]??5)||a.localeCompare(b));
  if(!kept.length){if(keepUnmatched&&!members.size)features.push({...f,properties:{...f.properties,traffic_corridor_selected:false}});continue;}
  const chosen=index.corridors.get(kept[0]),decision=decisionsById.get(chosen.id),kind=chosen.importance;
  features.push({...f,properties:{...f.properties,traffic_corridor_selected:true,traffic_corridor_id:chosen.id,traffic_corridor_ids:[...kept].sort(),traffic_corridor_ref:chosen.refs[0]?.ref??'',traffic_corridor_kind:kind,traffic_corridor_importance:importanceOrder[kind]??5,traffic_corridor_minzoom:decision.minzoom,traffic_corridor_scale:importanceScale[kind]??.6,traffic_corridor_association:association,traffic_corridor_overlap:overlap}});
 }
 return {...trafficData,features,corridorSelection:{reference_features:index.referenceFeatures,total_corridors:index.corridors.size,selected_corridors:selected.size,unmatched_features:unmatched,spatially_associated_features:spatiallyAssociated,unavailable_features:unavailableFeatures,hidden_features:(trafficData?.features?.length??0)-features.length,corridors:decisions.sort((a,b)=>a.id.localeCompare(b.id))}};
}
