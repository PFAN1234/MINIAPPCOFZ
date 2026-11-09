"""Recompute registration diagnostics from JSON only; never approve federation.

Run from any directory with Python 3 and NumPy. Original IFC/PDF files and
existing evidence stay untouched. Output is deterministic, including input hashes.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np

VALIDATION = Path(__file__).resolve().parents[2]


def segment_distance(point, start, end):
    px, py = point[:2]
    ax, ay = start[:2]
    dx, dy = end[0] - ax, end[1] - ay
    length_squared = dx * dx + dy * dy
    fraction = max(0., min(1., ((px - ax) * dx + (py - ay) * dy) / length_squared)) if length_squared else 0.
    return math.hypot(px - ax - fraction * dx, py - ay - fraction * dy)


def polygons(geometry):
    if geometry['type'] == 'Polygon':
        return [geometry['coordinates']]
    if geometry['type'] == 'MultiPolygon':
        return geometry['coordinates']
    raise ValueError('Expected Polygon or MultiPolygon footprint')


def boundary_distance(point, geometry):
    return min(segment_distance(point, ring[i - 1], ring[i])
               for polygon in polygons(geometry) for ring in polygon for i in range(len(ring)))


def footprint_area(geometry):
    def ring_area(ring):
        # Subtract an origin before the shoelace sum to reduce cancellation.
        points = np.array(ring, dtype=float)[:, :2]
        points -= points[0]
        return abs(float(np.sum(points[:, 0] * np.roll(points[:, 1], -1)
                                - points[:, 1] * np.roll(points[:, 0], -1)))) / 2
    return sum(ring_area(polygon[0]) - sum(ring_area(hole) for hole in polygon[1:])
               for polygon in polygons(geometry))


def transform_points(points, matrix):
    points = np.asarray(points, dtype=float)
    homogeneous = np.column_stack([points, np.ones(len(points))])
    return (homogeneous @ np.asarray(matrix).T)[:, :3]


def roundtrip_error(points, matrix):
    points = np.asarray(points, dtype=float)
    recovered = transform_points(transform_points(points, matrix), np.linalg.inv(matrix))
    return float(np.max(np.linalg.norm(recovered - points, axis=1)))


def compose_placement(record):
    matrix = np.eye(4)
    # Inspection records list child first, root last.
    for placement in record['placement_chain']:
        matrix = np.array(placement['relative']) @ matrix
    return matrix


def validation_status(gates):
    return 'candidate' if gates and all(gates.values()) else 'not_validated'


def floor_metadata(inspections):
    result = {}
    levels = {}
    for code, inspection in inspections.items():
        rows = []
        for storey in inspection['spatial']:
            if storey['type'] != 'IfcBuildingStorey':
                continue
            matrix = compose_placement(storey)
            rows.append({'guid': storey['guid'], 'name': storey['name'],
                         'composed_matrix': matrix.tolist(), 'composed_z_m': float(matrix[2, 3]),
                         'exported_matrix_max_error': float(np.max(np.abs(matrix - storey['matrix'])))})
        result[code] = rows
        ground = next(r for r in rows if r['name'] == 'TÉRREO')
        upper = next(r for r in rows if r['name'] in ('1º PAV.', '1° PAVIMENTO'))
        levels[code] = {'ground_z_m': ground['composed_z_m'], 'first_floor_z_m': upper['composed_z_m']}
    return {'method': 'Root-to-child product of placement_chain relative matrices; Elevation not used.',
            'storeys': result, 'comparison': levels,
            'first_floor_arq_minus_ant_m': levels['ARQ']['first_floor_z_m'] - levels['ANT']['first_floor_z_m'],
            'first_floor_arq_minus_tld_m': levels['ARQ']['first_floor_z_m'] - levels['TLD']['first_floor_z_m'],
            'limitation': 'Metadata agreement is not physical Z validation. No global Z correction is justified; first-floor difference requires discipline-specific controls.'}


def panel_diagnostic(elements, spaces, previous, inspection):
    ground = [s for s in spaces if 'bbox_world_m' in s and abs(s['bbox_world_m'][0][2]) < .1]
    tolerance = previous['test_tolerance_m']
    rows, excluded = [], []
    for panel in elements:
        if 'PLACA RETANGULAR' not in panel['name']:
            continue
        bbox = np.array(panel['bbox_in_arq_candidate_m'])
        center = bbox.mean(axis=0)
        if not 0 < center[2] < 3.5:
            excluded.append({'guid': panel['guid'], 'center_z_m': float(center[2]), 'reason': 'Outside original open Z eligibility interval (0, 3.5)m'})
            continue
        midpoints = [[bbox[0, 0], center[1]], [bbox[1, 0], center[1]],
                     [center[0], bbox[0, 1]], [center[0], bbox[1, 1]]]
        distances = []
        for space in ground:
            candidates = [boundary_distance(point, space['footprint_world_xy_m']) for point in midpoints]
            index = int(np.argmin(candidates))
            distances.append({'space_guid': space['guid'], 'space_name': space['name'],
                              'distance_m': candidates[index], 'face_midpoint_arq_m': midpoints[index] + [float(center[2])]})
        nearest = min(distances, key=lambda item: item['distance_m'])
        hits = [item for item in distances if item['distance_m'] < tolerance]
        rows.append({'guid': panel['guid'], 'name': panel['name'], 'bbox_arq_candidate_m': bbox.tolist(),
                     'nearest_ground_space': nearest, 'hit': bool(hits), 'matches_below_tolerance': hits})
    inspection_panels = {p['guid'] for p in inspection['element_placements'] if 'PLACA RETANGULAR' in p['name']}
    geometry_panels = {p['guid'] for p in elements if 'PLACA RETANGULAR' in p['name']}
    previous_pairs = {(m['ant_guid'], m['space_guid']) for m in previous['all_matches']}
    actual_pairs = {(p['guid'], m['space_guid']) for p in rows for m in p['matches_below_tolerance']}
    return {'status': 'candidate', 'eligibility': 'All ANT names containing PLACA RETANGULAR with candidate bbox center 0 < Z < 3.5m; no XY filtering.',
            'measurement': 'Minimum of four XY AABB face midpoints to every ground IfcSpace footprint boundary (including holes). This is a bbox-derived proxy, not an exact physical-face or surveyed correspondence.',
            'ground_space_count': len(ground), 'inspection_panel_count': len(inspection_panels),
            'geometry_panel_count': len(geometry_panels), 'missing_geometry_guids': sorted(inspection_panels - geometry_panels),
            'eligible_panel_count': len(rows), 'hit_panel_count': sum(p['hit'] for p in rows),
            'miss_panel_count': sum(not p['hit'] for p in rows),
            'panel_space_pair_hits': len(actual_pairs), 'tolerance_m': tolerance,
            'previous_pair_hits': len(previous_pairs), 'previous_pairs_missing': sorted(previous_pairs - actual_pairs),
            'new_pair_hits': sorted(actual_pairs - previous_pairs), 'excluded_panels': excluded, 'panels': rows,
            'limitation': 'Full denominator audits the prior selective evidence. Nearest boundary and small residual alone do not establish semantic correspondence or an independent control dataset.'}


def pdf_diagnostic(registration, candidate, spaces):
    scale = registration['scale_pt_per_m']
    matrix = np.array([[0., scale, registration['tx_pt']], [scale, 0., registration['ty_pt']], [0., 0., 1.]])
    def control(record):
        predicted = (matrix @ [*record['ifc_xy_m'], 1])[:2]
        residual = float(np.linalg.norm(predicted - record['pdf_xy_pt']))
        return {'ifc_xy_m': record['ifc_xy_m'], 'measured_pdf_xy_pt': record['pdf_xy_pt'],
                'predicted_pdf_xy_pt': predicted.tolist(), 'residual_pt': residual,
                'residual_in_model_m': residual / scale,
                'within_reported_measurement_uncertainty': residual <= registration['measurement_uncertainty_pt']}
    pilot = registration['pilot_room']
    room = next(s for s in spaces if s['guid'] == pilot['ifc_guid'])
    area = footprint_area(room['footprint_world_xy_m'])
    return {'status': 'candidate', 'ifc_guid': room['guid'], 'pdf_label': candidate['pdf_label'],
            'arq_xy_m_to_pdf_pt': matrix.tolist(), 'pdf_pt_to_arq_xy_m': np.linalg.inv(matrix).tolist(),
            'fitted_controls': [control(c) for c in registration['calibration_points']],
            'held_out_control': control(registration['independent_control']),
            'measurement_uncertainty_pt': registration['measurement_uncertainty_pt'],
            'scale_pt_per_m': scale, 'expected_scale_pt_per_m': registration['expected_scale_1_to_125_pt_per_m'],
            'computed_footprint_area_m2': area, 'reported_pdf_area_m2': candidate['pdf_reported_area_m2'],
            'area_difference_m2': area - candidate['pdf_reported_area_m2'],
            'limitation': 'Recomputes existing manually measured controls; no new observation. Area and scale support APTO101 candidate identity but do not approve it or prove exact clickable boundaries.'}


def build_report():
    inputs = {}
    def read(relative):
        raw = (VALIDATION / relative).read_bytes()
        inputs[relative] = hashlib.sha256(raw).hexdigest()
        return json.loads(raw)
    inspections = {code: read(f'ifc/CE01-14PE01-{code}-{revision}-inspection.json')
                   for code, revision in [('ARQ', 'R05'), ('ANT', 'R01'), ('TLD', 'R00')]}
    ant_elements = read('ifc/ANT-element-geometry.json')
    tld_elements = read('ifc/TLD-element-geometry.json')
    previous = read('ifc/alignment-evidence.json')
    registration = read('pdf/registration-ground.json')
    pilot = read('pdf/pilot-candidate.json')
    arq = inspections['ARQ']
    north = arq['contexts'][0]['true_north']
    matrix = np.eye(4)
    matrix[:2, :2] = [[north[1], -north[0]], [north[0], north[1]]]
    matrix[:3, 3] = np.array(arq['contexts'][0]['world_coordinate_system'])[:3, 3]
    inverse = np.linalg.inv(matrix)
    points = np.array([s['bbox_world_m'][0] for s in arq['spaces'] if 'bbox_world_m' in s])
    transforms = {'status': 'candidate', 'convention': 'Column homogeneous vectors; units metres. ARQ frame is inspection mesh engineering coordinates without WCS offset. MEP frame is ANT/TLD engineering world coordinates.',
                  'derivation': 'XY rotation from ARQ TrueNorth, translation from ARQ context WCS; Z remains unchanged. Not a formal CRS/map conversion.',
                  'arq_to_ant': matrix.tolist(), 'ant_to_arq': inverse.tolist(),
                  'arq_to_tld': matrix.tolist(), 'tld_to_arq': inverse.tolist(),
                  'determinant_rotation': float(np.linalg.det(matrix[:3, :3])),
                  'roundtrip_max_error_m': roundtrip_error(points, matrix), 'roundtrip_point_count': len(points),
                  'mep_rotation_max_difference': {code: float(np.max(np.abs(matrix[:3, :3] - np.array(inspections[code]['spatial'][0]['matrix'])[:3, :3]))) for code in ('ANT', 'TLD')},
                  'limitation': 'Inverse/round-trip proves arithmetic only; does not independently validate XY or Z. Existing element bboxes already use this candidate.'}
    panels = panel_diagnostic(ant_elements, arq['spaces'], previous, inspections['ANT'])
    room = next(s for s in arq['spaces'] if s['guid'] == registration['pilot_room']['ifc_guid'])
    bbox = np.array(room['bbox_world_m'])
    presence = [e['guid'] for e in tld_elements if np.all(np.array(e['bbox_in_arq_candidate_m'])[1] >= bbox[0]) and np.all(np.array(e['bbox_in_arq_candidate_m'])[0] <= bbox[1])]
    gates = {'human_pdf_room_identity_and_boundary_approval': False,
             'distributed_semantic_ant_xy_controls_including_held_out_point': False,
             'tld_independent_xy_control': False, 'tld_independent_z_control': False,
             'physical_z_controls_and_first_floor_difference_resolution': False}
    return {'schema_version': 1, 'length_unit_to_m': {code: item['length_unit_to_m'] for code, item in inspections.items()},
            'status': validation_status(gates), 'publish_as_validated_federation': False,
            'input_sha256': inputs, 'candidate_transform': transforms,
            'pdf_apto101': pdf_diagnostic(registration, pilot, arq['spaces']),
            'floor_metadata': floor_metadata(inspections), 'ant_boundary_audit': panels,
            'tld_diagnostic': {'status': 'not_validated', 'existing_candidate_geometry_count': len(tld_elements),
                               'pilot_bbox_arq_m': bbox.tolist(), 'candidate_bbox_overlap_count': len(presence), 'candidate_bbox_overlap_guids': presence,
                               'independent_xy_control_count': 0, 'independent_z_control_count': 0,
                               'limitation': 'AABB overlap documents candidate presence only. Shared metadata, bbox transforms, round-trip and occupancy are not independent TLD XY/Z proof.'},
            'gates': gates, 'pending_gates': [gate for gate, passed in gates.items() if not passed]}


if __name__ == '__main__':
    report = build_report()
    output = VALIDATION / 'ifc/registration-review.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'output': str(output), 'status': report['status'],
                      'ant_eligible': report['ant_boundary_audit']['eligible_panel_count'],
                      'ant_hits': report['ant_boundary_audit']['hit_panel_count'],
                      'ant_misses': report['ant_boundary_audit']['miss_panel_count'],
                      'tld_candidate_overlaps': report['tld_diagnostic']['candidate_bbox_overlap_count']}, ensure_ascii=False))
