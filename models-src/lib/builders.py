"""Blender mesh builders. Geometry is computed in g-space millimetres and mapped to
Blender metres with g2b(): Blender is Z-up, the glTF exporter converts to Y-up so
g-space (+x wearer-left, +y up, +z forward) maps to Blender (x, -z, y)."""
import math
import bpy
import bmesh
from mathutils import Vector

MM = 0.001


def g2b(x, y, z):
    return Vector((x * MM, -z * MM, y * MM))


class Wrap:
    """face-form wrap: bend the front around a vertical axis (radius in mm)."""

    def __init__(self, radius_mm):
        self.r = radius_mm

    def dz(self, x):
        if not self.r:
            return 0.0
        return -(x * x) / (2.0 * self.r)


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def finish_mesh(obj, smooth_angle=35):
    me = obj.data
    me.validate()
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    except Exception:
        pass
    return obj


def add_planar_uv(me, scale_mm=70.0):
    uv = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        v = me.vertices[loop.vertex_index].co
        gx, gy = v.x / MM, v.z / MM
        uv.data[loop.index].uv = (gx / scale_mm + 0.5, gy / scale_mm + 0.5)


# ---------------------------------------------------------------- front (2D extrude)
def extrude_rings(name, rings, depth, edge_r, wrap, z_back=0.0, bevel_res=4):
    """rings = [(exterior_pts, [holes]), ...] in g-space mm (x, y).
    Builds a filled, extruded, round-edged solid with back face at z_back."""
    cu = bpy.data.curves.new(name + "_curve", "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    r = min(edge_r, depth / 2 - 0.05)
    cu.extrude = max(depth / 2 - r, 0.01)
    cu.bevel_mode = "ROUND"
    cu.bevel_depth = r
    cu.bevel_resolution = bevel_res
    cu.offset = -r
    for ext, holes in rings:
        for loop in [ext] + holes:
            sp = cu.splines.new("POLY")
            sp.points.add(len(loop) - 1)
            for i, (x, y) in enumerate(loop):
                sp.points[i].co = (x, y, 0.0, 1.0)
            sp.use_cyclic_u = True
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    zoff = z_back + depth / 2.0
    for v in me.vertices:
        x, y, z = v.co
        v.co = g2b(x, y, z + zoff + wrap.dz(x))
    me.name = name
    obj = bpy.data.objects.new(name, me)
    link(obj)
    add_planar_uv(me)
    return finish_mesh(obj)


# ---------------------------------------------------------------- lenses
def lens_mesh(name, pts, centre, z_mid, base_r, thickness, wrap, rings=14):
    """Meniscus lens with constant thickness. pts: boundary (g-space mm, CCW).
    centre: (cx, cy). z_mid: z of the lens edge centre plane (groove)."""
    cx, cy = centre
    n = len(pts)
    r2_mean = sum((x - cx) ** 2 + (y - cy) ** 2 for x, y in pts) / n
    zc = z_mid + r2_mean / (2 * base_r)  # apex so that edge sits ~ in groove

    def surf(x, y, off):
        r2 = (x - cx) ** 2 + (y - cy) ** 2
        z = zc - r2 / (2 * base_r) + off
        return g2b(x, y, z + wrap.dz(x))

    bm = bmesh.new()
    layers = []
    for off in (thickness / 2, -thickness / 2):
        apex = bm.verts.new(surf(cx, cy, off))
        ring_verts = []
        for k in range(1, rings + 1):
            f = (k / rings) ** 0.85
            ring_verts.append([bm.verts.new(surf(cx + (x - cx) * f, cy + (y - cy) * f, off))
                               for x, y in pts])
        layers.append((apex, ring_verts))
    for side, (apex, rv) in enumerate(layers):
        flip = side == 1
        for i in range(n):
            j = (i + 1) % n
            f = [apex, rv[0][i], rv[0][j]]
            bm.faces.new(f[::-1] if flip else f)
            for k in range(rings - 1):
                q = [rv[k][i], rv[k + 1][i], rv[k + 1][j], rv[k][j]]
                bm.faces.new(q[::-1] if flip else q)
    fr, bk = layers[0][1][-1], layers[1][1][-1]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([fr[i], bk[i], bk[j], fr[j]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    return finish_mesh(obj, smooth_angle=60)


# ---------------------------------------------------------------- sweeps (temples, wires)
def _profile(theta, n):
    c, s = math.cos(theta), math.sin(theta)
    e = 2.0 / n
    return math.copysign(abs(c) ** e, c), math.copysign(abs(s) ** e, s)


def sweep(name, path, width_fn, height_fn, outward, segs=20, exp_fn=None,
          mat_fn=None, cap_start=True, round_end=True, origin=None, closed=False,
          round_start=False):
    """Sweep a superellipse section along `path` (list of g-space mm points).
    width_fn/height_fn(s, L) -> mm; outward: g-space vector used to orient width
    (a callable(p) -> vector is also accepted).
    mat_fn(s, L) -> material index. origin: g-space point used as object origin."""
    P = [Vector(p) for p in path]
    S = [0.0]
    for i in range(1, len(P)):
        S.append(S[-1] + (P[i] - P[i - 1]).length)
    L = S[-1]
    org = Vector(origin) if origin is not None else Vector((0, 0, 0))
    bm = bmesh.new()
    rings = []
    N = len(P)
    for i, p in enumerate(P):
        if closed:
            t = P[(i + 1) % N] - P[i - 1]
        elif i == 0:
            t = P[1] - P[0]
        elif i == N - 1:
            t = P[-1] - P[-2]
        else:
            t = P[i + 1] - P[i - 1]
        t.normalize()
        out = Vector(outward(p) if callable(outward) else outward).normalized()
        u = (out - out.dot(t) * t).normalized()
        v = t.cross(u).normalized()
        s = S[i]
        w, h = width_fn(s, L), height_fn(s, L)
        if round_start and not closed and s < 1.2:
            k = math.sqrt(max(0.0, s / 1.2)) * 0.7 + 0.3
            w, h = w * k, h * k
        if round_end and not closed and L - s < 3.0:
            k = math.sqrt(max(0.0, (L - s) / 3.0))
            w, h = max(w * k, 0.05), max(h * k, 0.05)
        n = exp_fn(s, L) if exp_fn else 2.0
        ring = []
        for j in range(segs):
            a, b = _profile(2 * math.pi * j / segs, n)
            q = p + u * (a * w / 2) + v * (b * h / 2) - org
            ring.append(bm.verts.new(g2b(q.x, q.y, q.z)))
        rings.append((ring, s))
    nr = len(rings) if closed else len(rings) - 1
    for i in range(nr):
        r0, s0 = rings[i]
        r1, _ = rings[(i + 1) % len(rings)]
        mi = mat_fn(s0, L) if mat_fn else 0
        for j in range(segs):
            k = (j + 1) % segs
            f = bm.faces.new([r0[j], r0[k], r1[k], r1[j]])
            f.material_index = mi
    if not closed:
        if cap_start:
            f = bm.faces.new(list(reversed(rings[0][0])))
            f.material_index = mat_fn(0, L) if mat_fn else 0
        f = bm.faces.new(rings[-1][0])
        f.material_index = mat_fn(L, L) if mat_fn else 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    uv = me.uv_layers.new(name="UVMap")  # side projection (g z, g y)
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (-co.y / MM / 60.0, co.z / MM / 60.0)
    obj = link(bpy.data.objects.new(name, me))
    obj.location = g2b(org.x, org.y, org.z)
    return finish_mesh(obj, smooth_angle=50)


def temple_path(hinge, length, panto_deg, splay_deg, side, drop=36.0,
                bend_r=16.0, bend_deg=52.0, step=2.0):
    """g-space path for a temple starting at the hinge, heading backward (-z)."""
    hx, hy, hz = hinge
    tp, sp = math.radians(panto_deg), math.radians(splay_deg)
    d = Vector((side * math.sin(sp), -math.sin(tp), -math.cos(tp) * math.cos(sp))).normalized()
    straight = length - drop
    pts = []
    s = 0.0
    while s < straight:
        pts.append(Vector(hinge) + d * s)
        s += step
    p0 = Vector(hinge) + d * straight
    pts.append(p0)
    # bend downward in the vertical plane containing d
    down = Vector((0, -1, 0))
    nrm = (down - down.dot(d) * d).normalized()
    arc = math.radians(bend_deg)
    arc_len = bend_r * arc
    nseg = max(4, int(arc_len / step))
    for i in range(1, nseg + 1):
        a = arc * i / nseg
        pts.append(p0 + d * (bend_r * math.sin(a)) + nrm * (bend_r * (1 - math.cos(a))))
    # straight drop to the tip
    last = pts[-1]
    dd = (d * math.cos(arc) + nrm * math.sin(arc)).normalized()
    rest = drop - arc_len
    k = 1
    while k * step < rest:
        pts.append(last + dd * k * step)
        k += 1
    pts.append(last + dd * rest)
    return [tuple(p) for p in pts]


def ellipsoid(name, centre, radii, rot_deg=(0, 0, 0), segs=24, rings=12):
    """ellipsoid in g-space mm; radii (rx, ry, rz) along g axes; rot in g-space degrees."""
    from mathutils import Euler
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    R = Euler([math.radians(a) for a in rot_deg], "XYZ").to_matrix()
    for v in bm.verts:
        g = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
        g = R @ g + Vector(centre)
        v.co = g2b(g.x, g.y, g.z)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    return finish_mesh(obj, smooth_angle=80)


def tube(name, path, radius, closed=False, segs=14, flat=1.0, outward=(0, 0, 1)):
    """round (or flattened) wire along a g-space path."""
    return sweep(name, path, lambda s, L: radius * 2 * flat, lambda s, L: radius * 2,
                 outward, segs=segs, closed=closed, round_end=False, cap_start=True)


def cylinder(name, centre, radius, height, axis="y", segs=24):
    """small metal cylinder in g-space mm (axis along g y or g z)."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=radius * MM,
                          radius2=radius * MM, depth=height * MM)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    c = g2b(*centre)
    obj.location = c
    if axis == "z":  # g z -> blender -y
        obj.rotation_euler = (math.radians(90), 0, 0)
    bpy.context.view_layer.update()
    obj.data.transform(obj.matrix_basis)
    obj.matrix_basis.identity()
    # bevel the edges a touch for highlights
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    edges = [e for e in bm.edges if not e.smooth or len(e.link_faces) == 2 and
             e.calc_face_angle(0) > math.radians(60)]
    if edges:
        bmesh.ops.bevel(bm, geom=edges, offset=radius * MM * 0.18, segments=2,
                        affect="EDGES", profile=0.5)
    bm.to_mesh(obj.data)
    bm.free()
    return finish_mesh(obj, smooth_angle=40)


def join(objs, name):
    objs = [o for o in objs if o]
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    with bpy.context.temp_override(active_object=objs[0], object=objs[0],
                                   selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def assign_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)
