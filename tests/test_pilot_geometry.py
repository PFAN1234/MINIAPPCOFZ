import importlib.util
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('pilot', Path(__file__).resolve().parents[1] / 'artifacts/validation/ifc/reproduce/build_pilot.py')
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


def test_clip_crossing_triangle_preserves_intersection_and_bounds():
    vertices = np.array([[-1., .5, .5], [2., .5, .5], [.5, 2., .5]])
    v, f = pilot.clip_mesh(vertices, np.array([[0, 1, 2]]), np.zeros(3), np.ones(3))
    assert len(f) > 0
    assert np.all(v >= -1e-9) and np.all(v <= 1 + 1e-9)
    assert np.isclose(v[:, 0].min(), 0) and np.isclose(v[:, 0].max(), 1)


def test_clip_excludes_disjoint_and_degenerate_triangles():
    v, f = pilot.clip_mesh(np.array([[2., 0, 0], [2., 1, 0], [2., 0, 1]]), np.array([[0, 1, 2]]), np.zeros(3), np.ones(3))
    assert len(v) == len(f) == 0


def test_candidate_inverse_and_glb_axis_scale():
    angle = .6
    r = np.array([[np.cos(angle), -np.sin(angle), 0], [np.sin(angle), np.cos(angle), 0], [0, 0, 1.]])
    t = np.array([500000., 9000000., 0.])
    point = np.array([[10., 20., 3.], [11., 20., 3.]])
    world = point @ r.T + t
    np.testing.assert_allclose(pilot.apply_matrix(world, pilot.candidate_inverse(r, t)), point, atol=1e-9)
    result = pilot.apply_matrix(point, pilot.glb_matrix(np.array([10., 20., 0.])))
    np.testing.assert_allclose(result, [[0, 3, 0], [1, 3, 0]], atol=1e-9)


def test_clipping_vertical_planes_preserves_area_and_winding():
    # On plane y=0, the intersection with z=0..1 is a trapezoid of area 1.5.
    vertices = np.array([[0., 0, -1], [2., 0, 1], [0., 0, 3]])
    v, f = pilot.clip_mesh(vertices, np.array([[0, 1, 2]]), np.array([-1., -1, 0]), np.array([3., 1, 1]))
    cross = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    assert np.all(v[:, 2] >= 0) and np.all(v[:, 2] <= 1)
    assert np.all(cross[:, 1] < 0)
    assert np.isclose(np.linalg.norm(cross, axis=1).sum() / 2, 1.5)


def test_pilot_margin_does_not_include_neighbor_bathroom():
    import json
    from shapely.geometry import box, shape
    data = json.loads((Path(__file__).resolve().parents[1] / 'artifacts/validation/ifc/CE01-14PE01-ARQ-R05-inspection.json').read_text())
    room = next(s for s in data['spaces'] if s['guid'] == pilot.GUID)
    bath = next(s for s in data['spaces'] if s['name'] == '14')
    x0, y0, x1, y1 = shape(room['footprint_world_xy_m']).bounds
    assert box(x0-.1, y0-.1, x1+.1, y1+.1).intersection(shape(bath['footprint_world_xy_m'])).area == 0
