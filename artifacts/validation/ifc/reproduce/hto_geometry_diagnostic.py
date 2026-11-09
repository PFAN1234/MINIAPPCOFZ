import pathlib,json,time,collections
import ifcopenshell,ifcopenshell.geom
import numpy as np
import trimesh
from shapely.geometry import shape,Point
ROOT=pathlib.Path(__file__).resolve().parents[4];OUT=ROOT/'artifacts/validation/ifc'
a=json.loads((OUT/'CE01-14PE01-ARQ-R05-inspection.json').read_text())
spaces=a['spaces'];room=next(s for s in spaces if s['name']=='23');bounds=np.array(room['bbox_world_m']); margin=np.array([.25,.25,.3]);lo=bounds[0]-margin;hi=bounds[1]+margin;hi[2]=3.9
ant=json.loads((OUT/'CE01-14PE01-ANT-R01-inspection.json').read_text());R=np.array(ant['spatial'][0]['matrix'])[:3,:3];t=np.array(a['contexts'][0]['world_coordinate_system'])[:3,3]
# Candidate transform inferred from ARQ true north and WCS; not formal map conversion.
T=np.eye(4);T[:3,:3]=R;T[:3,3]=t
scene=trimesh.Scene();records={};all_bounds={}
settings=ifcopenshell.geom.settings();settings.set('use-world-coords',True)
origin=np.array([194.0316869938767,296.0942746757137,0.])
colors={'ARQ':[185,190,195,255],'ANT':[240,130,30,255],'TLD':[40,100,220,255]}
for code in ('ANT','TLD','ARQ'):
 p=next((ROOT/'DOCS HTO/IFC').glob('*'+code+'*.ifc'));f=ifcopenshell.open(str(p));els=f.by_type('IfcElement');print('GEOM',code,len(els),flush=True)
 iterator=ifcopenshell.geom.iterator(settings,f,4,include=els)
 rec=[];selected=[];count=0;fail=[];minall=np.array([np.inf]*3);maxall=-minall
 if iterator.initialize():
  while True:
   s=iterator.get();v=np.array(s.geometry.verts).reshape(-1,3);faces=np.array(s.geometry.faces).reshape(-1,3)
   if len(v):
    if code!='ARQ':v=(v-t)@R
    mn=v.min(0);mx=v.max(0);minall=np.minimum(minall,mn);maxall=np.maximum(maxall,mx);count+=1
    obj=f.by_id(s.id);r={'id':s.id,'guid':obj.GlobalId,'type':obj.is_a(),'name':obj.Name,'bbox_in_arq_candidate_m':[mn.tolist(),mx.tolist()],'vertices':len(v),'triangles':len(faces)};rec.append(r)
    if np.all(mx>=lo) and np.all(mn<=hi) and not obj.is_a('IfcOpeningElement'):
     r['selected_by']='AABB intersection expanded APTO101; entire elements, no boolean clipping';selected.append(r)
     # Keep complete objects only if they do not dwarf the room; manifest lists all.
     if np.all(mx-mn < [15,15,8]):
      # GLB Y-up: (x,y,z) IFC -> (x,z,-y), after local origin reduction.
      vv=v-origin;vv=vv[:,[0,2,1]];vv[:,2]*=-1
      m=trimesh.Trimesh(vertices=vv,faces=faces,process=False);m.visual.face_colors=colors[code];scene.add_geometry(m,node_name=code+':'+obj.GlobalId);r['in_glb']=True
   if not iterator.next():break
 records[code]={'physical_element_count':len(els),'meshes_generated':count,'bbox_in_arq_candidate_m':[minall.tolist(),maxall.tolist()],'selected':selected}
 all_bounds[code]=rec
 print('DONE',code,'meshes',count,'selected',len(selected),'scene',len(scene.geometry),flush=True)
 (OUT/(code+'-element-geometry.json')).write_text(json.dumps(rec,ensure_ascii=False,indent=2))
(OUT/'federation-candidate.json').write_text(json.dumps({'status':'CANDIDATE inferred transform; review anchor correspondences before production','arq_to_mep_candidate_matrix':T.tolist(),'arq_to_glb':{'origin_subtracted':origin.tolist(),'axis_mapping':'GLB X=IFC X; GLB Y=IFC Z; GLB Z=-IFC Y (after origin reduction)'},'room':room,'selection_bbox_arq_m':[lo.tolist(),hi.tolist()],'disciplines':records,'limitations':['Raw IfcSpace GLB files are Z-up and absolute coordinates; diagnostic physical scene GLB is Y-up and recentred.','Entire nearby physical objects selected by AABB, not exact clipped room. Objects exceeding 15m XY or 8m Z omitted from GLB but retained in manifest.','Opening elements excluded from render. Colors represent discipline, not source material.','ARQ→MEP inferred from WCS and TrueNorth, no explicit map conversion.']},ensure_ascii=False,indent=2))
scene.export(OUT/'apto101-physical-candidate.glb')
# Geometric occupancy evidence for MEP centres in ARQ spaces, by candidate transform.
occupied=[]
for s in spaces:
 p=shape(s['footprint_world_xy_m']);b=np.array(s['bbox_world_m']);cnt={};hits={}
 for code in ('ANT','TLD'):
  items=[]
  for e in all_bounds[code]:
   bb=np.array(e['bbox_in_arq_candidate_m']);c=bb.mean(0)
   if p.buffer(.2).covers(Point(c[:2])) and bb[1,2]>=b[0,2] and bb[0,2]<=b[1,2]+.4:items.append(e['guid'])
  cnt[code]=len(items);hits[code]=items
 occupied.append({'name':s['name'],'guid':s['guid'],'long_name':s['long_name'],'bbox_arq_m':s['bbox_world_m'],'counts':cnt,'guids':hits})
(OUT/'space-mep-candidate-occupancy.json').write_text(json.dumps(occupied,ensure_ascii=False,indent=2))
# SVG plan with spaces and transformed MEP centroids, for visual review only.
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1100" viewBox="140 250 110 110">','<rect x="140" y="250" width="110" height="110" fill="white"/>']
for s in spaces:
 if abs(s['bbox_world_m'][0][2])>0.1:continue
 p=shape(s['footprint_world_xy_m']);polys=list(p.geoms) if hasattr(p,'geoms') else [p]
 for poly in polys:
  pts=' '.join(f'{x},{610-y}' for x,y in poly.exterior.coords);svg.append(f'<polygon points="{pts}" fill="#edf2f7" stroke="#555" stroke-width=".06"/>')
 c=p.centroid;svg.append(f'<text x="{c.x}" y="{610-c.y}" font-size=".8" text-anchor="middle">{s["name"]}</text>')
for code,color in [('ANT','#ed7300'),('TLD','#0055dd')]:
 for e in all_bounds[code]:
  bb=np.array(e['bbox_in_arq_candidate_m']);c=bb.mean(0)
  if c[2]<3.95:svg.append(f'<circle cx="{c[0]}" cy="{610-c[1]}" r=".10" fill="{color}"/>')
svg.append('</svg>');(OUT/'ground-floor-candidate-overlay.svg').write_text('\n'.join(svg))
print('EXPORTED',OUT/'apto101-physical-candidate.glb',flush=True)
