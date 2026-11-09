"""Independent arithmetic checks for the candidate registration diagnostic."""
import importlib.util
from pathlib import Path

import numpy as np
import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'artifacts/validation/ifc/reproduce/validate_registration.py'
spec = importlib.util.spec_from_file_location('registration', SCRIPT)
registration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registration)


def test_segment_distance_clamps_to_endpoints_and_handles_zero_length():
    assert registration.segment_distance([1, 3], [0, 0], [2, 0]) == 3
    assert registration.segment_distance([5, 4], [0, 0], [2, 0]) == 5
    assert registration.segment_distance([3, 4], [0, 0], [0, 0]) == 5


def test_polygon_boundary_distance_includes_holes_and_multipolygons():
    outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
    polygon = {'type': 'Polygon', 'coordinates': [outer, hole]}
    assert registration.boundary_distance([5, 5], polygon) == 1
    assert registration.boundary_distance([2, 2], polygon) == 2
    assert registration.boundary_distance([10, 3], polygon) == 0
    multi = {'type': 'MultiPolygon', 'coordinates': [[outer], [[[20, 0], [21, 0], [21, 1], [20, 0]]]]}
    assert registration.boundary_distance([21, 0], multi) == 0
    with pytest.raises(ValueError):
        registration.boundary_distance([0, 0], {'type': 'Point', 'coordinates': [0, 0]})


def test_known_transform_round_trip_and_determinant():
    matrix = np.array([[0, -1, 0, 500000], [1, 0, 0, 9000000], [0, 0, 1, 0], [0, 0, 0, 1.]])
    points = np.array([[10, 20, 4], [-2, 3, 0.]])
    world = registration.transform_points(points, matrix)
    np.testing.assert_allclose(world[0], [499980, 9000010, 4])
    np.testing.assert_allclose(registration.transform_points(world, np.linalg.inv(matrix)), points)
    assert registration.roundtrip_error(points, matrix) < 1e-9
    assert np.linalg.det(matrix[:3, :3]) == 1


def test_floor_level_uses_composed_placements_instead_of_raw_elevation():
    def translation(z):
        result = np.eye(4)
        result[2, 3] = z
        return result.tolist()
    arq = {'elevation': -6, 'placement_chain': [{'relative': translation(-6)}, {'relative': translation(10)}]}
    mep = {'elevation': 3.605, 'placement_chain': [{'relative': translation(3.605)}, {'relative': translation(.36)}]}
    arq_z = registration.compose_placement(arq)[2, 3]
    mep_z = registration.compose_placement(mep)[2, 3]
    assert arq_z == 4
    assert mep_z == pytest.approx(3.965)
    assert arq_z - mep_z == pytest.approx(.035)


def test_missing_independent_tld_xy_or_z_controls_blocks_validation():
    assert registration.validation_status({'tld_xy_control': False, 'tld_z_control': True}) == 'not_validated'
    assert registration.validation_status({'tld_xy_control': True, 'tld_z_control': False}) == 'not_validated'
    assert registration.validation_status({}) == 'not_validated'


def test_panel_audit_retains_misses_in_the_denominator():
    def panel(guid, x):
        return {'guid': guid, 'name': 'PLACA RETANGULAR', 'bbox_in_arq_candidate_m': [[x, 1, 1], [x + .1, 1.1, 1.1]]}
    elements = [panel('hit', 0), panel('miss', 50)]
    space = {'guid': 'room', 'name': '1', 'bbox_world_m': [[0, 0, 0], [3, 3, 3]],
             'footprint_world_xy_m': {'type': 'Polygon', 'coordinates': [[[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]]}}
    audit = registration.panel_diagnostic(elements, [space], {'test_tolerance_m': .001, 'all_matches': []},
                                          {'element_placements': elements})
    assert audit['eligible_panel_count'] == 2
    assert audit['hit_panel_count'] == audit['miss_panel_count'] == 1
    assert {p['guid'] for p in audit['panels']} == {'hit', 'miss'}
    assert audit['panels'][1]['nearest_ground_space']['distance_m'] == pytest.approx(47)


def test_real_json_evidence_stays_unvalidated_and_preserves_audit_totals():
    report = registration.build_report()
    assert report['status'] == 'not_validated'
    assert report['publish_as_validated_federation'] is False
    assert report['tld_diagnostic']['independent_xy_control_count'] == 0
    assert report['tld_diagnostic']['independent_z_control_count'] == 0
    audit = report['ant_boundary_audit']
    assert audit['eligible_panel_count'] == audit['hit_panel_count'] + audit['miss_panel_count']
    assert len(audit['panels']) == audit['eligible_panel_count']
    assert audit['previous_pairs_missing'] == []
    assert report['floor_metadata']['comparison']['ARQ']['first_floor_z_m'] == 4
    assert report['floor_metadata']['comparison']['TLD']['first_floor_z_m'] == pytest.approx(3.965)
    assert report['pdf_apto101']['computed_footprint_area_m2'] == pytest.approx(23.8788)
