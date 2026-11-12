"""Gera `TESTE-01-EST-R01.ifc`: IFC4 mínimo (quatro paredes e uma laje num pavimento).

Usado pelo teste Playwright do site de administração (`e2e/admin-modelo.spec.ts`), que
converte este arquivo em `.frag` no navegador. Uso, a partir da raiz do repositório:
    .venv/bin/python app/e2e/fixtures/gerar_ifc_teste.py app/e2e/fixtures/TESTE-01-EST-R01.ifc
"""
import sys
import ifcopenshell, ifcopenshell.api as api
import numpy as np
f = api.run("project.create_file", version="IFC4")
proj = api.run("root.create_entity", f, ifc_class="IfcProject", name="Teste")
api.run("unit.assign_unit", f)
ctx = api.run("context.add_context", f, context_type="Model")
body = api.run("context.add_context", f, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=ctx)
site = api.run("root.create_entity", f, ifc_class="IfcSite", name="Terreno")
bld = api.run("root.create_entity", f, ifc_class="IfcBuilding", name="Edifício")
st = api.run("root.create_entity", f, ifc_class="IfcBuildingStorey", name="Térreo")
api.run("aggregate.assign_object", f, relating_object=proj, products=[site])
api.run("aggregate.assign_object", f, relating_object=site, products=[bld])
api.run("aggregate.assign_object", f, relating_object=bld, products=[st])
for i, (x, y, rot) in enumerate([(0, 0, 0), (5, 0, 90), (5, 4, 180), (0, 4, 270)]):
    w = api.run("root.create_entity", f, ifc_class="IfcWall", name=f"Parede {i+1}")
    rep = api.run("geometry.add_wall_representation", f, context=body, length=5 if i % 2 == 0 else 4, height=3, thickness=0.2)
    api.run("geometry.assign_representation", f, product=w, representation=rep)
    m = np.eye(4); a = np.radians(rot)
    m[:3, :3] = [[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]]; m[0, 3] = x; m[1, 3] = y
    api.run("geometry.edit_object_placement", f, product=w, matrix=m)
    api.run("spatial.assign_container", f, relating_structure=st, products=[w])
laje = api.run("root.create_entity", f, ifc_class="IfcSlab", name="Laje")
rep = api.run("geometry.add_slab_representation", f, context=body, depth=0.2, polyline=[(0, 0), (5, 0), (5, 4), (0, 4)])
api.run("geometry.assign_representation", f, product=laje, representation=rep)
api.run("geometry.edit_object_placement", f, product=laje, matrix=np.eye(4))
api.run("spatial.assign_container", f, relating_structure=st, products=[laje])
f.write(sys.argv[1])
