"""Build an explicitly unvalidated, clipped HTO apartment geometry candidate.

IfcOpenShell iterator API: https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html
The clipper retains source surface triangles; it does not invent cap faces.
"""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform

import ifcopenshell
import ifcopenshell.geom
import numpy as np
import trimesh
from shapely.geometry import shape, box

ROOT = Path(__file__).resolve().parents[4]
IFC = ROOT / 'artifacts/validation/ifc'
OUT = ROOT / 'artifacts/validation/pilot'
GUID = '0vfo$Cu9vBkhdNguKiGtzT'
COLORS = {'ARQ': [185, 190, 195, 255], 'ANT': [240, 130, 30, 255], 'TLD': [40, 100, 220, 255]}


def candidate_inverse(rotation, translation):
    matrix = np.eye(4)
    matrix[:3, :3] = rotation.T
    matrix[:3, 3] = -rotation.T @ translation
    return matrix


def glb_matrix(origin):
    matrix = np.eye(4)
    matrix[:3, :3] = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
    matrix[:3, 3] = -matrix[:3, :3] @ origin
    return matrix


def apply_matrix(vertices, matrix):
    return vertices @ matrix[:3, :3].T + matrix[:3, 3]


def clip_mesh(vertices, faces, lo, hi):
    """Clip triangles to six half-spaces, triangulating each surviving polygon."""
    out_v, out_f = [], []
    for face in faces:
        poly = [vertices[i] for i in face]
        for axis in range(3):
            for bound, sign in ((lo[axis], 1), (hi[axis], -1)):
                if not poly:
                    break
                clipped = []
                prev = poly[-1]
                dp = sign * (prev[axis] - bound)
                for cur in poly:
                    dc = sign * (cur[axis] - bound)
                    if (dc >= 0) != (dp >= 0):
                        clipped.append(prev + (cur - prev) * (dp / (dp - dc)))
                    if dc >= 0:
                        clipped.append(cur)
                    prev, dp = cur, dc
                poly = clipped
        if len(poly) >= 3:
            for i in range(1, len(poly) - 1):
                a, b, c = poly[0], poly[i], poly[i + 1]
                if np.linalg.norm(np.cross(b - a, c - a)) > 1e-12:
                    n = len(out_v)
                    out_v.extend((a, b, c))
                    out_f.append((n, n + 1, n + 2))
    return np.asarray(out_v, dtype=float).reshape(-1, 3), np.asarray(out_f, dtype=int).reshape(-1, 3)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    arq = json.loads((IFC / 'CE01-14PE01-ARQ-R05-inspection.json').read_text())
    ant = json.loads((IFC / 'CE01-14PE01-ANT-R01-inspection.json').read_text())
    room = next(s for s in arq['spaces'] if s['guid'] == GUID)
    neighbor = next(s for s in arq['spaces'] if s['name'] == '14')
    footprint = shape(room['footprint_world_xy_m'])
    bbox = np.asarray(room['bbox_world_m'])
    # Refuse a rectangle approximation for a future non-rectangular room.
    assert footprint.equals_exact(box(*footprint.bounds), 1e-7) or footprint.symmetric_difference(box(*footprint.bounds)).area < 1e-8
    lo = bbox[0] - [.1, .1, .2]
    hi = bbox[1] + [.1, .1, .2]
    bathroom_overlap = box(lo[0], lo[1], hi[0], hi[1]).intersection(shape(neighbor['footprint_world_xy_m'])).area
    assert bathroom_overlap < 1e-8
    origin = np.array([(bbox[0, 0] + bbox[1, 0]) / 2, (bbox[0, 1] + bbox[1, 1]) / 2, 0.])
    rotation = np.asarray(ant['spatial'][0]['matrix'])[:3, :3]
    translation = np.asarray(arq['contexts'][0]['world_coordinate_system'])[:3, 3]
    assert np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-8)
    transforms = {'ARQ': np.eye(4), 'ANT': candidate_inverse(rotation, translation), 'TLD': candidate_inverse(rotation, translation)}
    to_glb = glb_matrix(origin)
    settings = ifcopenshell.geom.settings()
    settings.set('use-world-coords', True)
    scene = trimesh.Scene()
    disciplines = {}
    for code in ('ANT', 'TLD', 'ARQ'):
        path = next((ROOT / 'DOCS HTO/IFC').glob('*-' + code + '-*.ifc'))
        model = ifcopenshell.open(str(path))
        elements = [e for e in model.by_type('IfcElement') if not e.is_a('IfcOpeningElement')]
        by_id = {e.id(): e for e in elements}
        returned = set()
        failures, selected = [], []
        counts = {'eligible_elements': len(elements), 'iterator_returned': 0, 'converted_meshes': 0, 'intersecting_bbox': 0, 'clipped_elements': 0, 'empty_after_clipping': 0}
        print(code, 'eligible', len(elements), flush=True)
        iterator = ifcopenshell.geom.iterator(settings, model, 4, include=elements)
        if iterator.initialize():
            while True:
                item = iterator.get()
                obj = by_id[item.id]
                returned.add(item.id)
                counts['iterator_returned'] += 1
                if counts['iterator_returned'] % 250 == 0:
                    print(code, 'processed', counts['iterator_returned'], '/', len(elements), flush=True)
                try:
                    v = np.asarray(item.geometry.verts, dtype=float).reshape(-1, 3)
                    f = np.asarray(item.geometry.faces, dtype=int).reshape(-1, 3)
                    if not len(v) or not len(f):
                        raise ValueError('empty vertices or triangle faces')
                    v = apply_matrix(v, transforms[code])
                    if not np.isfinite(v).all():
                        raise ValueError('non-finite vertices')
                    counts['converted_meshes'] += 1
                    if np.all(v.max(axis=0) >= lo) and np.all(v.min(axis=0) <= hi):
                        counts['intersecting_bbox'] += 1
                        cv, cf = clip_mesh(v, f, lo, hi)
                        if len(cf):
                            assert np.all(cv >= lo - 1e-8) and np.all(cv <= hi + 1e-8)
                            mesh = trimesh.Trimesh(vertices=apply_matrix(cv, to_glb), faces=cf, process=False)
                            mesh.visual.face_colors = COLORS[code]
                            scene.add_geometry(mesh, node_name=code + ':' + obj.GlobalId, geom_name=code + ':' + obj.GlobalId)
                            selected.append({'guid': obj.GlobalId, 'id': obj.id(), 'type': obj.is_a(), 'name': obj.Name, 'vertices': len(cv), 'triangles': len(cf), 'source_bounds_arq_m': [v.min(axis=0).tolist(), v.max(axis=0).tolist()], 'bounds_arq_m': [cv.min(axis=0).tolist(), cv.max(axis=0).tolist()], 'touches_vertical_clip': {'lower': bool(np.any(np.isclose(cv[:, 2], lo[2], atol=1e-7))), 'upper': bool(np.any(np.isclose(cv[:, 2], hi[2], atol=1e-7)))}, 'source_crosses_vertical_clip': {'lower': bool(v[:, 2].min() < lo[2]), 'upper': bool(v[:, 2].max() > hi[2])}})
                            counts['clipped_elements'] += 1
                        else:
                            counts['empty_after_clipping'] += 1
                except Exception as exc:
                    failures.append({'id': obj.id(), 'guid': obj.GlobalId, 'type': obj.is_a(), 'reason': 'returned_invalid_or_processing_error', 'detail': str(exc)})
                if not iterator.next():
                    break
        for item_id in sorted(set(by_id) - returned):
            obj = by_id[item_id]
            failures.append({'id': item_id, 'guid': obj.GlobalId, 'type': obj.is_a(), 'reason': 'not_returned_by_iterator', 'has_representation': bool(obj.Representation)})
        disciplines[code] = {'source': str(path.relative_to(ROOT)), 'sha256': sha256(path), 'revision': path.stem.split('-')[-1], 'input_to_arq_matrix': transforms[code].tolist(), 'alignment_status': 'reference' if code == 'ARQ' else 'candidate_not_validated_XY_and_Z', 'counts': counts, 'absence': 'no clipped surface triangles' if not selected else None, 'selected': selected, 'failures': failures}
        print(code, counts, 'failures', len(failures), flush=True)
    if not scene.geometry:
        raise RuntimeError('No physical geometry was generated')
    glb = OUT / 'apto101-candidate.glb'
    staged = OUT / 'apto101-candidate.staged.glb'
    scene.export(staged)
    reopened = trimesh.load(staged, force='scene', process=False)
    assert len(reopened.geometry) == sum(d['counts']['clipped_elements'] for d in disciplines.values())
    tested_vertices = 0
    for node in reopened.graph.nodes_geometry:
        matrix, geometry = reopened.graph[node]
        vertices_glb = apply_matrix(np.asarray(reopened.geometry[geometry].vertices), matrix)
        restored = apply_matrix(vertices_glb, np.linalg.inv(to_glb))
        assert np.all(restored >= lo - 3e-5) and np.all(restored <= hi + 3e-5)
        tested_vertices += len(restored)
    staged.replace(glb)
    report = {'status': 'candidate_not_validated', 'room_guid': GUID, 'room_name': '23', 'business_label': 'APTO. 101 candidate', 'room_bbox_arq_m': bbox.tolist(), 'clip_bbox_arq_m': [lo.tolist(), hi.tolist()], 'clip_margin_m': {'xy': .1, 'z_below': .2, 'z_above': .2}, 'vertical_extent_basis': 'IfcSpace geometry 0 to 3.5 m with 0.2 m extensions; engineering confirmation and independent federation Z validation pending', 'bathroom_neighbor_guid': neighbor['guid'], 'bathroom_footprint_overlap_m2': bathroom_overlap, 'local_origin_arq_m': origin.tolist(), 'arq_to_glb_matrix': to_glb.tolist(), 'axis_convention': 'GLB Y-up; X=ARQ X, Y=ARQ Z, Z=-ARQ Y; metres', 'method': 'Six plane clipping of source triangulated surface geometry; no generated cap faces. Colors identify discipline.', 'limitations': ['Candidate registration is not validated independently in XY and Z for ANT or TLD. No artificial Z correction.', 'Boundary margin includes up to 0.1 m beyond the room; no area of space 14 is included in XY.', 'Surfaces are clipped without cap faces; closed volumes are not guaranteed.', 'Iterator omissions are reported individually; their spatial relevance is unknown.'], 'versions': {'python': platform.python_version(), **{x: importlib.metadata.version(x) for x in ('ifcopenshell', 'numpy', 'shapely', 'trimesh')}}, 'glb': {'path': str(glb.relative_to(ROOT)), 'size_bytes': glb.stat().st_size, 'sha256': sha256(glb), 'reopened_geometry_count': len(reopened.geometry), 'reopened_vertices_checked': tested_vertices, 'clip_tolerance_m': 3e-5}, 'disciplines': disciplines}
    staged_report = OUT / 'apto101-candidate.staged.json'
    staged_report.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    staged_report.replace(OUT / 'apto101-candidate.json')
    print('WROTE', glb, glb.stat().st_size, flush=True)


if __name__ == '__main__':
    main()
