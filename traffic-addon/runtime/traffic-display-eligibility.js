/** Whole observed corridor eligibility, before colour averaging or offsets.
 * Physical reverse pairs share the whole-path decision; directional known
 * observation spans meet the continuous minimum independently. Disconnected
 * pieces never inherit a remote way's length. Only selected routes/backbones/explicit protection
 * bypass display minima; closure is a known traffic state, not importance.
 * No missing geometry is invented and no observed colour is used as a filter. */
export const TRAFFIC_PATH_THRESHOLDS=[
 {zoom:8,main:96,branch:160},{zoom:10,main:64,branch:100},
 {zoom:12,main:40,branch:64},{zoom:14,main:20,branch:32},
 {zoom:16,main:8,branch:12},{zoom:18,main:3,branch:6},
];
export function filterTrafficDisplay(data, zoom, {minimumPixels, minimumContinuousPixels, thresholds=TRAFFIC_PATH_THRESHOLDS, snapMetres=.75, observationVisible=()=>true}={}) {
 if(!Number.isFinite(zoom)||!data?.features?.length)return data;
 if(minimumPixels===0)return data;
 const snap=Number.isFinite(snapMetres)&&snapMetres>0?snapMetres:.75;
 const paths=g=>g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:[];
 const world=512*2**zoom,pixel=p=>[p[0]/360*world,-Math.log(Math.tan(Math.PI/4+Math.max(-85.051129,Math.min(85.051129,p[1]))*Math.PI/360))*world/(2*Math.PI)];
 const first=data.features.find(f=>paths(f.geometry).length),latitude=first?paths(first.geometry)[0][0]?.[1]??0:0;
 const sx=111195*Math.cos(latitude*Math.PI/180),sy=111195,xy=p=>[p[0]*sx,p[1]*sy],distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
 const point=p=>p[0].toFixed(7)+','+p[1].toFixed(7);
 const knownFeature=f=>['low','free','moderate','heavy','severe','jam'].includes(f.properties?.congestion??f.properties?.traffic)||f.properties?.closed===true||f.properties?.closed===1||f.properties?.closure===true;
 const protectedFeature=f=>{const p=f.properties??{};return p.on_route===true||p.traffic_backbone===true||p.traffic_display_protected===true;};
 const grade=p=>{const raw=p.level??p.layer;return JSON.stringify([raw!=null&&Number.isFinite(Number(raw))?Number(raw):'unknown',p.brunnel??'']);};
 const road=p=>{const id=p.road_id??p.osm??p.way_id;return id==null?'':String(id);};
 const displayClass=p=>p.traffic_display_class??p.class??p.highway??'';
 function multiplier(c){if(c==='motorway'||c==='motorway_detail')return .65;if(c==='trunk')return .85;if(c==='primary')return 1;if(c==='secondary')return 1.15;if(c==='tertiary')return 1.3;if(c.endsWith('_link'))return 1.35;if(['minor','street','residential','unclassified','living_street'].includes(c))return 1.6;if(c==='service')return 1.9;return 1.3;}
 function baseline(through){
  if(Number.isFinite(minimumPixels))return Math.max(0,minimumPixels);
  const key=through?'main':'branch',stops=thresholds;let a=stops[0];if(zoom<=a.zoom)return a[key];
  for(let i=1;i<stops.length;i++){const b=stops[i];if(zoom<=b.zoom)return a[key]+(b[key]-a[key])*(zoom-a.zoom)/(b.zoom-a.zoom);a=b;}return a[key];
 }
 function length(coordinates){let sum=0;for(let i=1;i<coordinates.length;i++){const a=pixel(coordinates[i-1]),b=pixel(coordinates[i]);let dx=b[0]-a[0];dx-=Math.round(dx/world)*world;sum+=Math.hypot(dx,b[1]-a[1]);}return sum;}
 function heading(coordinates,start){const a=xy(start?coordinates[0]:coordinates.at(-1));let b;for(let i=1;i<coordinates.length;i++){b=xy(start?coordinates[i]:coordinates[coordinates.length-1-i]);if(distance(a,b)>=2)break;}const dx=b[0]-a[0],dy=b[1]-a[1],size=Math.hypot(dx,dy);return [dx/size,dy/size];}
 // Stable compact IDs depend on observed geometry/grade, never input ordering.
 function hash(value){let result=2166136261;for(let i=0;i<value.length;i++){result^=value.charCodeAt(i);result=Math.imul(result,16777619);}return (result>>>0).toString(36);}
 const arcs=[],byShape=new Map(),preserve=new Set(),featureArcs=new Map();
 for(let index=0;index<data.features.length;index++){
  const f=data.features[index],p=f.properties??{},input=paths(f.geometry);if(!input.length){preserve.add(index);continue;}
  for(const path of input){
   const coordinates=path.filter((point,i)=>!i||point[0]!==path[i-1][0]||point[1]!==path[i-1][1]);
   if(!coordinates.length||coordinates.some(p=>!Number.isFinite(p[0])||!Number.isFinite(p[1]))){preserve.add(index);continue;}
   if(coordinates.length<2){if(protectedFeature(f))preserve.add(index);continue;}
   const forward=coordinates.map(point).join(';'),backward=coordinates.toReversed().map(point).join(';'),canonical=forward<backward?forward:backward,key=grade(p)+':'+canonical;
   let arc=byShape.get(key);
   if(!arc){arc={number:arcs.length,key,grade:grade(p),coordinates:forward===canonical?coordinates:coordinates.toReversed(),pixels:length(coordinates),observations:[],directions:new Map(),roads:new Set(),classes:new Set()};arcs.push(arc);byShape.set(key,arc);}
   arc.observations.push(index);arc.directions.set(index,(forward===canonical?1:-1)*(p.traffic_layout==='shared'&&p.direction_sign===-1?-1:1));if(road(p))arc.roads.add(road(p));arc.classes.add(displayClass(p));
   if(!featureArcs.has(index))featureArcs.set(index,[]);featureArcs.get(index).push(arc);
  }
 }
 const nodes=[],grid=new Map();
 // Importance/span topology only: native MVT rounding can give the same road's
 // adjacent endpoints different positions by one source-grid cell. Do not move
 // coordinates or relax a different road's ordinary endpoint tolerance.
 const nativeZoom=Math.min(15,Math.floor(zoom)),sourceGridMetres=40075016.686*Math.cos(latitude*Math.PI/180)/(4096*2**nativeZoom),sameRoadSnap=Math.max(snap,sourceGridMetres*1.1),cellSize=sameRoadSnap;
 function nodeFor(key,p,endpoint){
  const x=Math.floor(p[0]/cellSize),y=Math.floor(p[1]/cellSize);let best,d=Infinity;
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const n of grid.get(key+':'+(x+dx)+','+(y+dy))??[]){
   const gap=distance(n.point,p);if(gap>d||gap>sameRoadSnap)continue;
   const alias=gap>snap&&n.incidents.some(other=>other.arc!==endpoint.arc&&[...other.arc.roads].some(id=>endpoint.arc.roads.has(id))&&other.heading[0]*endpoint.heading[0]+other.heading[1]*endpoint.heading[1]<-.8);
   if(gap<=snap||alias){best=n;d=gap;}
  }
  if(best)return best;
  const node={number:nodes.length,point:p,incidents:[]};nodes.push(node);const cell=key+':'+x+','+y;if(!grid.has(cell))grid.set(cell,[]);grid.get(cell).push(node);return node;
 }
 // Deterministic endpoint insertion prevents input order from changing snaps.
 const ends=arcs.flatMap(a=>[{arc:a,end:0,point:xy(a.coordinates[0]),heading:heading(a.coordinates,true)},{arc:a,end:1,point:xy(a.coordinates.at(-1)),heading:heading(a.coordinates,false)}]).sort((a,b)=>a.arc.grade.localeCompare(b.arc.grade)||a.point[0]-b.point[0]||a.point[1]-b.point[1]||a.arc.key.localeCompare(b.arc.key)||a.end-b.end);
 for(const e of ends){e.node=nodeFor(e.arc.grade,e.point,e);e.node.incidents.push(e);e.arc[e.end?'end':'start']=e;}
 const parent=arcs.map((_,i)=>i),throughArcs=new Set(),connections=[];
 const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;},unite=(a,b)=>{const x=find(a.number),y=find(b.number);if(x!==y)parent[y]=x;};
 const connect=(a,b)=>{unite(a.arc,b.arc);connections.push([a,b]);};
 const sameRoad=(a,b)=>[...a.roads].some(id=>b.roads.has(id));
 const baseClass=c=>c.replace(/_link$/,'')==='motorway_detail'?'motorway':['street','residential','unclassified','living_street'].includes(c)?'minor':c.replace(/_link$/,'');
 const nonLinkClasses=arc=>[...arc.classes].filter(c=>c&&!c.endsWith('_link')).map(baseClass);
 const priorities={motorway:6,trunk:5,primary:4,secondary:3,tertiary:2,minor:1,service:0};
 const priority=arc=>Math.max(-1,...nonLinkClasses(arc).map(c=>priorities[c]??-1));
 const sameBase=(a,b)=>nonLinkClasses(a).some(c=>nonLinkClasses(b).includes(c));
 const compatibleBase=(a,b)=>nonLinkClasses(a).some(c=>nonLinkClasses(b).some(d=>['motorway','trunk','primary'].includes(c)&&['motorway','trunk','primary'].includes(d)||(priorities[c]>=2&&priorities[d]>=2&&Math.abs(priorities[c]-priorities[d])<=1)));
 const lowerBranch=(a,b,main)=>!nonLinkClasses(b).length||priority(b)<Math.min(priority(a),priority(main));
 const dot=(a,b)=>a.heading[0]*b.heading[0]+a.heading[1]*b.heading[1];
 for(const node of nodes){
  const incident=node.incidents;
  if(incident.length===2){const [a,b]=incident;if(a.arc!==b.arc&&dot(a,b)<.25)connect(a,b);continue;}
  if(incident.length<3)continue;
  const choice=new Map();
  for(const a of incident){
   const all=incident.filter(b=>a.arc!==b.arc&&dot(a,b)<-.5),exact=all.filter(b=>sameBase(a.arc,b.arc)),compatible=all.filter(b=>compatibleBase(a.arc,b.arc)),preferred=exact.length?exact:compatible,candidates=preferred.length?preferred:all,same=candidates.filter(b=>sameRoad(a.arc,b.arc));
   // A curving through road must not lose its path to a straight lower-class
   // exit. This resolves connectivity only; all lengths still meet the minima.
   if(preferred.length===1&&incident.some(b=>b.arc!==a.arc&&b!==preferred[0]&&lowerBranch(a.arc,b.arc,preferred[0].arc))){choice.set(a,preferred[0]);continue;}
   const ranked=candidates.map(b=>({b,angle:dot(a,b)})).sort((a,b)=>a.angle-b.angle);
   // Adjacent way continuity resolves nearly parallel exits, but cannot make
   // a visibly turning same-way branch steal a straighter through corridor.
   if(same.length===1&&(candidates.length===1||dot(a,same[0])-ranked[0].angle<=.03)){choice.set(a,same[0]);continue;}
   if(ranked[0]?.angle<=-.94&&(!ranked[1]||ranked[1].angle-ranked[0].angle>=.1))choice.set(a,ranked[0].b);
  }
  for(const [a,b] of choice)if(choice.get(b)===a&&a.arc.number<b.arc.number){connect(a,b);throughArcs.add(a.arc.number);throughArcs.add(b.arc.number);}
 }
 const groups=new Map();
 for(const arc of arcs){const root=find(arc.number);if(!groups.has(root))groups.set(root,{arcs:[],pixels:0,protected:false,through:false,multiplier:0,classes:new Set()});const group=groups.get(root);group.arcs.push(arc);group.pixels+=arc.pixels;group.protected||=arc.observations.some(index=>protectedFeature(data.features[index]));for(const c of arc.classes){group.classes.add(c);}group.multiplier+=arc.pixels*Math.min(...[...arc.classes].map(multiplier));if(throughArcs.has(arc.number))group.through=true;}
 // Distinct connected ends indicate a through connector, but only lower its
 // length threshold. A tiny connector or loop still has to earn visibility.
 for(const group of groups.values()){
  const outside=new Set();for(const arc of group.arcs)for(const e of [arc.start,arc.end])if(e.node.incidents.some(other=>find(other.arc.number)!==find(arc.number)))outside.add(e.node.number);
  if(outside.size>=2)group.through=true;
  group.threshold=baseline(group.through)*(group.pixels>0?group.multiplier/group.pixels:1);group.eligible=group.protected||group.pixels>=group.threshold;
  group.id='traffic-path:'+hash(group.arcs.map(a=>a.key).sort().join('|'));
 }
 // Continuous spans follow a single travel direction through the selected
 // physical path connections. Unknown traffic breaks the span; different
 // congestion colours and measurement boundaries never do.
 const states=[],stateByKey=new Map(),stateParent=[];
 for(const arc of arcs)for(const direction of [1,-1]){
  const observations=arc.observations.filter(index=>arc.directions.get(index)===direction&&observationVisible(data.features[index].properties??{},zoom)),known=observations.some(index=>knownFeature(data.features[index]));
  if(!known)continue;const state={number:states.length,arc,direction,observations,protected:observations.some(index=>protectedFeature(data.features[index]))};stateByKey.set(arc.number+':'+direction,state);stateParent.push(state.number);states.push(state);
 }
 const stateFind=i=>{while(stateParent[i]!==i){stateParent[i]=stateParent[stateParent[i]];i=stateParent[i];}return i;};
 const stateUnite=(a,b)=>{if(!a||!b)return;const x=stateFind(a.number),y=stateFind(b.number);if(x!==y)stateParent[y]=x;};
 for(const [a,b] of connections){const from=a.end?1:-1,to=b.end?-1:1;stateUnite(stateByKey.get(a.arc.number+':'+from),stateByKey.get(b.arc.number+':'+to));stateUnite(stateByKey.get(b.arc.number+':'+(-to)),stateByKey.get(a.arc.number+':'+(-from)));}
 const spans=new Map();
 for(const state of states){const root=stateFind(state.number);if(!spans.has(root))spans.set(root,{states:[],pixels:0,protected:false});const span=spans.get(root);span.states.push(state);span.pixels+=state.arc.pixels;span.protected||=state.protected;}
 for(const span of spans.values()){
  const path=groups.get(find(span.states[0].arc.number));span.path=path;span.threshold=Number.isFinite(minimumContinuousPixels)?Math.max(0,minimumContinuousPixels):path.threshold*.45;span.eligible=path.eligible&&(span.protected||span.pixels>=span.threshold);
  span.id='traffic-span:'+hash(span.states.map(state=>state.arc.key+':'+state.direction).sort().join('|'));
  for(const state of span.states){state.span=span;if(!state.arc.spans)state.arc.spans=[];state.arc.spans.push(span);}
 }
 const features=[],metrics=[];
 for(const group of groups.values())metrics.push({id:group.id,pixels:group.pixels,minimum_pixels:group.threshold,through:group.through,protected:group.protected,eligible:group.eligible,classes:[...group.classes].sort(),observation_ids:[...new Set(group.arcs.flatMap(a=>a.observations).map(index=>data.features[index].properties?.edge_id??data.features[index].properties?.vid??data.features[index].id).filter(id=>id!=null))]});
 for(let index=0;index<data.features.length;index++){
  const feature=data.features[index],members=featureArcs.get(index)??[],paths=[...new Set(members.map(arc=>groups.get(find(arc.number))))];
  if(!preserve.has(index)&&!members.some(arc=>{const path=groups.get(find(arc.number));if(!path.eligible)return false;if(protectedFeature(feature)||!knownFeature(feature))return true;return stateByKey.get(arc.number+':'+arc.directions.get(index))?.span?.eligible===true;}))continue;
  if(!paths.length){features.push(feature);continue;}
  // Raw single lines have one physical path; retain whole MultiLine features
  // conservatively if any constituent path is eligible, rather than cut them.
  const longest=[...paths].sort((a,b)=>b.pixels-a.pixels)[0],memberSpans=members.map(arc=>stateByKey.get(arc.number+':'+arc.directions.get(index))?.span).filter(Boolean),longestSpan=[...memberSpans].sort((a,b)=>b.pixels-a.pixels)[0];features.push({...feature,properties:{...feature.properties,traffic_display_path_id:longest.id,traffic_display_path_ids:paths.map(path=>path.id).sort(),traffic_display_path_pixels:longest.pixels,traffic_display_minimum_pixels:longest.threshold,traffic_display_through:longest.through,traffic_display_span_id:longestSpan?.id??null,traffic_display_continuous_pixels:longestSpan?.pixels??0,traffic_display_continuous_minimum_pixels:longestSpan?.threshold??(Number.isFinite(minimumContinuousPixels)?Math.max(0,minimumContinuousPixels):longest.threshold*.45)}});
 }
 return {...data,features,displayEligibility:{hiddenFeatures:data.features.length-features.length,hiddenComponents:metrics.filter(path=>!path.eligible).length,keptFeatures:features.length,paths:metrics.sort((a,b)=>a.id.localeCompare(b.id)),continuous_spans:[...spans.values()].map(span=>({id:span.id,path_id:span.path.id,pixels:span.pixels,minimum_pixels:span.threshold,eligible:span.eligible,protected:span.protected,observation_ids:[...new Set(span.states.flatMap(state=>state.observations).map(index=>data.features[index].properties?.edge_id??data.features[index].properties?.vid??data.features[index].id).filter(id=>id!=null))]})).sort((a,b)=>a.id.localeCompare(b.id))}};
}
