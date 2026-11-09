import pathlib,json,numpy as np
from shapely.geometry import shape,Point
O=pathlib.Path(__file__).resolve().parents[1]
a=json.loads((O/'CE01-14PE01-ARQ-R05-inspection.json').read_text()); panels=json.loads((O/'ANT-element-geometry.json').read_text());spaces=[(s,shape(s['footprint_world_xy_m'])) for s in a['spaces'] if abs(s['bbox_world_m'][0][2])<.1];matches=[]
for p in panels:
 if 'PLACA RETANGULAR' not in p['name']:continue
 b=np.array(p['bbox_in_arq_candidate_m']);c=b.mean(0)
 if not 0<c[2]<3.5:continue
 edge_midpoints=[[b[0,0],c[1]],[b[1,0],c[1]],[c[0],b[0,1]],[c[0],b[1,1]]]
 for s,poly in spaces:
  ds=[poly.boundary.distance(Point(x)) for x in edge_midpoints];idx=int(np.argmin(ds));dist=ds[idx]
  if dist<.001:
   matches.append({'ant_guid':p['guid'],'ant_name':p['name'],'space_guid':s['guid'],'space_name':s['name'],'space_long_name':s['long_name'],'point_in_arq_m':edge_midpoints[idx]+[float(c[2])],'distance_panel_face_midpoint_to_space_boundary_m':dist,'panel_bbox_in_arq_m':b.tolist()})
selected=[]
for m in matches:
 p=np.array(m['point_in_arq_m'])
 if not selected or all(np.linalg.norm(p[:2]-np.array(x['point_in_arq_m'])[:2])>15 for x in selected):selected.append(m)
report={'method':'ARQ local engineering geometry to ANT/TLD engineering coordinates: XY rotation from ARQ TrueNorth, translation from ARQ WCS. Validate independently by transformed ANT face midpoint coinciding with actual IfcSpace boundary. No fitted translation or rotation and no manual offsets used.','test_tolerance_m':.001,'matches_count':len(matches),'spatially_separated_matches':selected,'all_matches':matches,'interpretation':'Supports candidate horizontal registration over sampled locations. It is not a complete clash check, surveyed control-point validation, CRS proof or engineering signoff. Vertical floor metadata differs by 0.035m at first floor.','formal_map_conversion_present':False}
(O/'alignment-evidence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({'count':len(matches),'selected':selected},ensure_ascii=False,indent=2))
