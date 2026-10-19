/** Display hierarchy from the same bundled basemap. Exact OSM IDs are used;
 * ambiguous/missing classes fall back to provider priority. Geometry and
 * observations remain untouched. Street-level matched classes take precedence. */
const supported=new Set(['motorway','trunk','primary','secondary','tertiary','minor','street','service','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link','minor_link','service_link']);
export function classifyTrafficDisplay(data,metadata={}) {
 const lookup=metadata.classes??{};
 return {...data,features:data.features.map(feature=>{
  const p=feature.properties??{};
  const matched=p.traffic_matched&&supported.has(p.class),cached=Number.isSafeInteger(p.osm)&&p.osm>0?lookup[String(p.osm)]:undefined;
  const roadClass=matched?p.class:supported.has(cached)?cached:undefined;
  if(!roadClass)return feature;
  return {...feature,properties:{...p,class:roadClass,traffic_display_class:roadClass,traffic_class_origin:matched?'matched-basemap':'bundled-basemap'}};
 })};
}
