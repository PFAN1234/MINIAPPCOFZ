from pathlib import Path
import json,math,fitz
root=Path(__file__).resolve().parents[4]
out=root/'artifacts/validation/pdf'
source=json.loads((root/'artifacts/validation/ifc/CE01-14PE01-ARQ-R05-inspection.json').read_text())
spaces=source['spaces']
room=next(s for s in spaces if s['guid']=='0vfo$Cu9vBkhdNguKiGtzT')
bmin,bmax=room['bbox_world_m']
pairs=[{'ifc_xy_m':bmin[:2],'pdf_xy_pt':[869.4,718.7]},{'ifc_xy_m':bmax[:2],'pdf_xy_pt':[959.2,855.45]}]
u1,v1=pairs[0]['ifc_xy_m'][::-1];u2,v2=pairs[1]['ifc_xy_m'][::-1]
x1,y1=pairs[0]['pdf_xy_pt'];x2,y2=pairs[1]['pdf_xy_pt']
s=((u2-u1)*(x2-x1)+(v2-v1)*(y2-y1))/((u2-u1)**2+(v2-v1)**2)
tx=(x1+x2-s*(u1+u2))/2;ty=(y1+y2-s*(v1+v2))/2
def transform(p):return [s*p[1]+tx,s*p[0]+ty]
vest=next(r for r in spaces if r['long_name']=='Vestiário Masc.')
control={'room':vest['guid'],'description':'Vestiário Masc.: junction of left interior room boundary and lower horizontal partition','ifc_xy_m':[vest['bbox_world_m'][1][0],vest['bbox_world_m'][0][1]],'pdf_xy_pt':[445.4,212.2]}
control['predicted_pdf_xy_pt']=transform(control['ifc_xy_m'])
control['residual_pt']=math.dist(control['predicted_pdf_xy_pt'],control['pdf_xy_pt'])
for p in pairs:
 p['predicted_pdf_xy_pt']=transform(p['ifc_xy_m']);p['residual_pt']=math.dist(p['predicted_pdf_xy_pt'],p['pdf_xy_pt'])
record={'pdf':'DOCS HTO/PDF/CE01-14PE01-ARQ-DE017-R05.pdf','page':1,'ifc':'DOCS HTO/IFC/CE01-14PE01-ARQ-R05.ifc','ifc_coordinate_frame':'bbox_world_m/footprint_world_xy_m from inspection JSON; excludes IfcGeometricRepresentationContext georeferencing offset','method':'axis swap + uniform scale + translation fitted to two visually measured opposite APTO101 interior corners; independent Vestiário Masc corner control','equations':{'pdf_x':'scale*ifc_y + tx','pdf_y':'scale*ifc_x + ty'},'scale_pt_per_m':s,'tx_pt':tx,'ty_pt':ty,'expected_scale_1_to_125_pt_per_m':72/0.0254/125,'calibration_points':pairs,'independent_control':control,'measurement_uncertainty_pt':0.5,'status':'Exploratory manually measured similarity, visually checked overlay. Not survey-grade or automatically inferred.','pilot_room':{'pdf_label':'APTO. 101','ifc_name':room['name'],'ifc_guid':room['guid'],'area_ifc_m2':room['footprint_area_m2'],'area_pdf_m2':23.88,'pdf_polygon_from_ifc':[transform(p) for p in room['footprint_world_xy_m']['coordinates'][0]],'identity_evidence':['matching 23.88m2 area','rectangle 6.03m x3.96m','next room along IFC+Y Name24=23.6979m2 matches PDF APTO102=23.70m2','neighbors along IFC-Y Name22=5.4464m2 and Name14=5.244m2 match PDF DESPENSA=5.45m2 and BHO101=5.24m2']}}
(out/'registration-ground.json').write_text(json.dumps(record,ensure_ascii=False,indent=2))
doc=fitz.open(root/record['pdf']);page=doc[0]
for r in spaces:
 if r['parent']['name']!='TÉRREO' or not r.get('footprint_world_xy_m'):continue
 fp=r['footprint_world_xy_m'];rings=fp['coordinates'] if fp['type']=='Polygon' else [p for poly in fp['coordinates'] for p in poly]
 for ring in rings:
  pts=[transform(p) for p in ring]
  shape=page.new_shape();shape.draw_polyline(pts);shape.finish(color=(0,0.6,0.9),width=.65,closePath=True,stroke_opacity=.85);shape.commit()
 for ispilot in [r['guid']==room['guid']]:
  if ispilot:
   points=record['pilot_room']['pdf_polygon_from_ifc'];shape=page.new_shape();shape.draw_polyline(points);shape.finish(color=(1,0,0),fill=(1,0,0),fill_opacity=.12,width=1.5,closePath=True);shape.commit()
page.get_pixmap(matrix=fitz.Matrix(2400/page.rect.width,2400/page.rect.width),alpha=False).save(out/'ground-ifc-overlay.png')
page.get_pixmap(matrix=fitz.Matrix(4,4),clip=fitz.Rect(810,700,1050,870),alpha=False).save(out/'ground-apto101-ifc-overlay.png')
page.get_pixmap(matrix=fitz.Matrix(3,3),clip=fitz.Rect(355,70,730,345),alpha=False).save(out/'ground-vestiarios-ifc-overlay.png')
print(json.dumps(record,ensure_ascii=False,indent=2))
