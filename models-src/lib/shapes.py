"""2D eyewear geometry (pure Python + shapely). All values in millimetres.

Glasses space ("g-space"): +x = wearer's left, +y = up, +z = forward (toward camera).
Lens outlines are built for the wearer's LEFT lens (centre at +x) with local
+x pointing outward (temporal side); the right lens is the mirror image.
"""
import math
from shapely.geometry import Polygon, box, Point
from shapely.ops import unary_union
from shapely import affinity

SAMPLES = 220


def _se(t, n):
    """signed superellipse component"""
    c, s = math.cos(t), math.sin(t)
    e = 2.0 / n
    return math.copysign(abs(c) ** e, c), math.copysign(abs(s) ** e, s)


def lens_outline(shape, width, height, samples=SAMPLES):
    """Return list of (x, y) points (CCW) for the left lens, boxed to width x height,
    centred on the box centre. local +x = temporal side."""
    p = dict(shape)
    kind = p.get("kind", "superellipse")
    pts = []
    if kind == "polygon":
        sides = p.get("sides", 6)
        rot = math.radians(p.get("rotate", 0))
        poly = Polygon([(math.cos(rot + 2 * math.pi * i / sides),
                         math.sin(rot + 2 * math.pi * i / sides)) for i in range(sides)])
        r = p.get("corner", 0.18)
        poly = poly.buffer(-r, join_style=1).buffer(r, join_style=1, quad_segs=24)
        pts = list(poly.exterior.coords)[:-1]
        # resample evenly
        ring = poly.exterior
        pts = [ring.interpolate(i / samples, normalized=True).coords[0] for i in range(samples)]
    else:
        n_top = p.get("n_top", p.get("n", 2.0))
        n_bot = p.get("n_bottom", p.get("n", 2.0))
        n_out = p.get("n_outer", None)
        upsweep = p.get("upsweep", 0.0)     # cat-eye: raise outer-top corner
        droop = p.get("droop", 0.0)         # aviator: deep nasal-bottom
        top_tilt = p.get("top_tilt", 0.0)   # linear slope of top edge (outer up > 0)
        flat_top = p.get("flat_top", 0.0)   # 0..1 push top toward straight line
        for i in range(samples):
            t = 2 * math.pi * i / samples
            n = n_top if math.sin(t) >= 0 else n_bot
            if n_out and math.cos(t) > 0:
                n = n * (1 - math.cos(t) ** 2) + n_out * math.cos(t) ** 2
            x, y = _se(t, n)
            if y > 0:
                ax = min(1.0, max(0.0, (abs(x) - 0.55) / 0.45))
                fall = 1 - ax * ax * (3 - 2 * ax)          # 1 in the middle, 0 at sides
                y = y + flat_top * (1 - y) * fall
                y += top_tilt * x * y
                ux = max(0.0, x)
                y += upsweep * (ux ** 2.2) * (y ** 1.5)
                x += upsweep * 0.25 * (ux ** 2) * y
            else:
                w = (1 - x) / 2.0  # 1 at nasal side, 0 at temporal
                y -= droop * (w ** 1.6) * (abs(y) ** 1.2)
            pts.append((x, y))
    # box-normalise to exact boxed dimensions (ISO 8624 boxing system)
    xs = [q[0] for q in pts]
    ys = [q[1] for q in pts]
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    sx, sy = width / (max(xs) - min(xs)), height / (max(ys) - min(ys))
    out = [((x - cx) * sx, (y - cy) * sy) for x, y in pts]
    poly = Polygon(out)
    if not poly.exterior.is_ccw:
        out.reverse()
    return out


def mirror_x(pts):
    return [(-x, y) for x, y in reversed(pts)]


def placed_lenses(cfg):
    """Return (left_pts, right_pts, centre_x) in g-space (mm)."""
    d = cfg["dims"]
    base = lens_outline(cfg["shape"], d["lens_width"], d["lens_height"])
    cx = (d["lens_width"] + d["bridge"]) / 2.0
    left = [(cx + x, y) for x, y in base]
    right = mirror_x(left)
    return left, right, cx


def smooth(geom, r):
    """morphological closing + opening to round inner and outer corners"""
    if r <= 0:
        return geom
    return geom.buffer(r, quad_segs=16).buffer(-2 * r, quad_segs=16).buffer(r, quad_segs=16)


def acetate_front(cfg):
    """Front profile for acetate/plastic frames. Returns (front_polygon, lens_L, lens_R, info)."""
    d = cfg["dims"]
    f = cfg.get("front", {})
    left, right, cx = placed_lenses(cfg)
    lens_L, lens_R = Polygon(left), Polygon(right)
    rim = f.get("rim", 5.0)
    rim_top = f.get("rim_top", rim)
    rim_bottom = f.get("rim_bottom", rim)
    hh = d["lens_height"] / 2.0

    parts = []
    for lp in (lens_L, lens_R):
        parts.append(lp.buffer(rim_bottom, quad_segs=24))
        if rim_top > rim_bottom:
            band = lp.buffer(rim_top, quad_segs=24).intersection(box(-500, -hh * 0.15, 500, 500))
            parts.append(band)
    # bridge: a band across the top half between the lenses
    b_top = hh + rim_top * 0.55 + f.get("bridge_raise", 0.0)
    b_h = f.get("bridge_height", 7.0)
    bx = d["bridge"] / 2.0 + rim + 2
    bridge = box(-bx, b_top - b_h, bx, b_top)
    if f.get("keyhole", False):
        kr = d["bridge"] * 0.36
        keep = f.get("keyhole_top", 3.6)  # bridge material left above the arch
        bridge = bridge.difference(Point(0, b_top - keep - kr).buffer(kr, quad_segs=24))
    else:
        # saddle bridge: the lower edge arches over the nose instead of a flat block
        keep = f.get("saddle_top", 3.8)
        rx, ry = d["bridge"] / 2 + rim * 0.35, b_h * 1.2 + 6
        arch = affinity.scale(Point(0, 0).buffer(1.0, quad_segs=32), rx, ry)
        arch = affinity.translate(arch, 0, b_top - keep - ry)
        bridge = bridge.difference(arch)
        # keep the rims' inner edges joined below the band
        parts.append(box(-bx, b_top - keep - 1.0, bx, b_top))
    parts.append(bridge)
    # end pieces (lugs) carry the hinges
    xs_out = max(x for x, _ in left)
    y_h = hh * f.get("hinge_y", 0.55)
    ep_len = f.get("endpiece", 3.5)
    ep_h = f.get("endpiece_height", 8.0)
    for s in (1, -1):
        x0 = xs_out + rim * 0.2
        parts.append(box(min(s * x0, s * (x0 + ep_len)), y_h - ep_h / 2,
                         max(s * x0, s * (x0 + ep_len)), y_h + ep_h / 2))
    front = smooth(unary_union(parts), f.get("smooth", 1.6))
    holes = unary_union([lens_L, lens_R])
    front = front.difference(holes)
    total_width = front.bounds[2] - front.bounds[0]
    info = {"centre_x": cx, "hinge_x": front.bounds[2], "hinge_y": y_h,
            "total_width": total_width, "front_top": front.bounds[3],
            "front_bottom": front.bounds[1], "bridge_bottom": b_top - b_h,
            "endpiece_height": ep_h}
    return front, lens_L, lens_R, info


def polygon_rings(poly):
    """[(exterior_pts), [hole_pts...]] for shapely Polygon/MultiPolygon"""
    geoms = list(poly.geoms) if poly.geom_type == "MultiPolygon" else [poly]
    out = []
    for g in geoms:
        ext = list(g.exterior.coords)[:-1]
        holes = [list(h.coords)[:-1] for h in g.interiors]
        out.append((ext, holes))
    return out


def resample(pts, n):
    ring = Polygon(pts).exterior
    return [ring.interpolate(i / n, normalized=True).coords[0] for i in range(n)]
