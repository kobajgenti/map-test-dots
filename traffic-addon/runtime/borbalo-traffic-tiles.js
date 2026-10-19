import {geometryLength} from './traffic-aggregation.js';
import {overviewTrafficPaths} from './traffic-overview-paths.js';
import {deduplicateTrafficTiles} from './traffic-tile-dedup.js';
export const TRAFFIC_SOURCE_LAYER='traffic';
export const TRAFFIC_SOURCE={type:'vector',tiles:['https://api.borbalo.ge/nav/traffic/tiles/traffic/{z}/{x}/{y}.pbf'],minzoom:5,maxzoom:15,bounds:[41.548452,41.145406,46.427618,43.029065],attribution:'Traffic: Borbalo'};
// Provisional field contract: higher cong is faster (verified from sampled ratios).
// Source coordinates follow travel order in sampled one-way and reversed pairs.
export const BORBALO_CONGESTION={0:'severe',1:'heavy',2:'moderate',3:'low'};
const point=p=>p.slice(0,2).map(v=>v.toFixed(7)).join(',');
export function adaptBorbaloTraffic(input,zoom,{aggregate=true}={}) {
 const unique=new Map();
 for(const f of deduplicateTrafficTiles(input,zoom)){const p=f.properties??{};if(!Number.isSafeInteger(p.vid)||!Number.isSafeInteger(p.osm))continue;
  const paths=f.geometry?.type==='LineString'?[f.geometry.coordinates]:f.geometry?.type==='MultiLineString'?f.geometry.coordinates:[];
  for(const coordinates of paths){if(coordinates.length<2||coordinates.some(c=>c.length<2||!c.slice(0,2).every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>85)||geometryLength(coordinates)<=0)continue;const shape=coordinates.map(point).join(';'),key=String(p.vid)+':'+shape;
   if(!unique.has(key))unique.set(key,{type:'Feature',properties:{...p},geometry:{type:'LineString',coordinates},shape});
  }
 }
 const records=[...unique.values()],shapes=new Map(records.map(f=>[String(f.properties.osm)+':'+f.shape,f]));
 const features=records.map((f,i)=>{const p=f.properties,coords=f.geometry.coordinates,reverse=coords.toReversed().map(point).join(';'),paired=shapes.has(String(p.osm)+':'+reverse),rank=Number(p.rank),closed=p.closed===1;
  const length=geometryLength(coords),known=p.cong in BORBALO_CONGESTION&&Number.isFinite(p.speed)&&p.speed>0&&Number.isFinite(p.maxspeed)&&p.maxspeed>0;
  return {type:'Feature',id:String(p.vid)+':'+f.shape,geometry:f.geometry,properties:{...p,edge_id:String(p.vid)+':'+f.shape,road_id:String(p.osm),from_node:point(coords[0]),to_node:point(coords.at(-1)),direction:'travel',class:rank===1?'trunk':rank===2?'primary':rank===3?'secondary':'tertiary',traffic_rank:rank,traffic_class_source:'provider-rank',traffic_visible:true,congestion:closed?'severe':BORBALO_CONGESTION[p.cong]??'unknown',closed,speed_kph:p.speed,traffic_direction_inferred:true,traffic_layout:paired?'shared':'separate',direction_sign:1,free_flow_time_s:known?length/(p.maxspeed/3.6):null,travel_time_s:known?length/(p.speed/3.6):null}};
 });
 if(!aggregate||zoom>=14||!features.length)return {type:'FeatureCollection',features};
 return overviewTrafficPaths({type:'FeatureCollection',features},zoom);
}
