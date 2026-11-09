import json, pathlib, collections, time
import ifcopenshell, ifcopenshell.geom
from ifcopenshell.util import placement, unit, element, geolocation
import numpy as np
from shapely.geometry import Polygon, mapping
from shapely.ops import unary_union
import trimesh
ROOT=pathlib.Path(__file__).resolve().parents[4]; OUT=ROOT/'artifacts/validation/ifc'
settings=ifcopenshell.geom.settings(); settings.set('use-world-coords',True)
def matrix(obj):
    p=getattr(obj,'ObjectPlacement',None)
    return placement.get_local_placement(p).tolist() if p else None
def identity(obj):
    return dict(id=obj.id(),type=obj.is_a(),guid=getattr(obj,'GlobalId',None),name=getattr(obj,'Name',None),long_name=getattr(obj,'LongName',None))
def mesh(obj):
    s=ifcopenshell.geom.create_shape(settings,obj)
    return np.array(s.geometry.verts).reshape(-1,3),np.array(s.geometry.faces).reshape(-1,3)
def bounds(v):return [v.min(axis=0).tolist(),v.max(axis=0).tolist()]
def dump(name,data): (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2,default=str))
for path in sorted((ROOT/'DOCS HTO/IFC').glob('*.ifc')):
    start=time.time(); print('OPEN',path.name,flush=True); f=ifcopenshell.open(str(path)); scale=unit.calculate_unit_scale(f)
    report={'file':path.name,'bytes':path.stat().st_size,'schema':f.schema,'ifcopenshell':ifcopenshell.version,'length_unit_to_m':scale,'units':[x.get_info() for x in f.by_type('IfcUnitAssignment')[0].Units],'entities_count':len(list(f)),'products_count':len(f.by_type('IfcProduct')),'element_counts':dict(collections.Counter(x.is_a() for x in f.by_type('IfcElement'))),'contexts':[],'spatial':[],'spaces':[],'geolocation':{}}
    for c in f.by_type('IfcGeometricRepresentationContext',include_subtypes=False):
        report['contexts'].append({'id':c.id(),'identifier':c.ContextIdentifier,'type':c.ContextType,'world_coordinate_system':placement.get_axis2placement(c.WorldCoordinateSystem).tolist(),'true_north':c.TrueNorth.DirectionRatios if c.TrueNorth else None})
    report['geolocation']['helmert_parameters']=str(geolocation.get_helmert_transformation_parameters(f)); report['geolocation']['wcs']=geolocation.get_wcs(f).tolist() if geolocation.get_wcs(f) is not None else None
    for typ in ('IfcSite','IfcBuilding','IfcBuildingStorey'):
        for x in f.by_type(typ):
            rec=identity(x); rec.update(matrix=matrix(x),elevation=getattr(x,'Elevation',None),placement_chain=[])
            p=x.ObjectPlacement
            while p:
                rec['placement_chain'].append({'id':p.id(),'relative':placement.get_axis2placement(p.RelativePlacement).tolist()}); p=p.PlacementRelTo
            report['spatial'].append(rec)
    for x in f.by_type('IfcSpace'):
        rec=identity(x); parent=element.get_aggregate(x); rec.update(parent=identity(parent) if parent else None,matrix=matrix(x),psets=element.get_psets(x))
        try:
            v,faces=mesh(x);rec['bbox_world_m']=bounds(v);rec['vertices']=len(v);rec['triangles']=len(faces)
            bottom=v[:,2].min(); polygons=[]
            for tri in faces:
                if np.all(np.abs(v[tri,2]-bottom)<1e-5):
                    p=Polygon(v[tri,:2]);
                    if p.area>1e-10:polygons.append(p)
            footprint=unary_union(polygons); rec['footprint_world_xy_m']=mapping(footprint);rec['footprint_area_m2']=footprint.area
            if 'vest' in str(x.LongName).lower() or 'vest' in str(x.Name).lower():
                m=trimesh.Trimesh(vertices=v,faces=faces,process=False);m.export(OUT/(str(x.GlobalId)+'-space.obj'));m.export(OUT/(str(x.GlobalId)+'-space.glb'));rec['geometry_export']='Space volume only, not physical room construction'
        except Exception as e:rec['geometry_error']=str(e)
        report['spaces'].append(rec)
    # Scan all physical-element placements: inexpensive, non-geometric and explicitly labeled.
    placement_records=[]
    for x in f.by_type('IfcElement'):
        if x.ObjectPlacement:
            a=np.array(matrix(x)); placement_records.append({'guid':x.GlobalId,'id':x.id(),'type':x.is_a(),'name':x.Name,'origin_world_m':(a[:3,3]*scale).tolist(),'storey':getattr(element.get_container(x),'Name',None)})
    report['element_placements']=placement_records
    report['elapsed_s']=time.time()-start
    dump(path.stem+'-inspection.json',report)
    print('DONE',path.stem,'spaces',len(report['spaces']),'storeys',[(x['name'],x['elevation'],np.array(x['matrix'])[:3,3].tolist()) for x in report['spatial'] if x['type']=='IfcBuildingStorey'],'seconds',round(report['elapsed_s'],1),flush=True)
