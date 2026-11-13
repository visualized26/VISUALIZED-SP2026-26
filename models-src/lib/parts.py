"""Shared parts: temples (acetate & wire)."""
from . import builders as B


def acetate_temples(cfg, lib, hx, hy, hz, ep_h):
    d, t = cfg["dims"], cfg.get("temple", {})
    mat = lib.finish("temple", cfg.get("temple_finish", cfg["finish"]))
    tw0, tw1 = t.get("width", [4.2, 3.0])
    th0 = t.get("height_hinge", ep_h * 0.82)
    th1 = t.get("height", 4.2)
    out = []
    for name, s in (("Temple_L", 1), ("Temple_R", -1)):
        hinge = (s * (hx - tw0 / 2 - 0.2), hy, hz)
        path = B.temple_path(hinge, d["temple_length"], cfg["angles"]["pantoscopic"],
                             t.get("splay", 2.0), s, drop=t.get("drop", 36))

        def wf(sv, L):
            return tw0 + (tw1 - tw0) * min(sv / 35.0, 1.0)

        def hf(sv, L):
            k = min(sv / 45.0, 1.0)
            k = k * k * (3 - 2 * k)
            return th0 + (th1 - th0) * k

        o = B.sweep(name, path, wf, hf, (s, 0, 0), segs=24,
                    exp_fn=lambda sv, L: 3.2 if sv < L - 40 else 2.4, origin=hinge)
        B.assign_material(o, mat)
        out.append(o)
    return out


def wire_temples(cfg, lib, hinges):
    """hinges: {+1: (x,y,z), -1: (x,y,z)} hinge points in g-space mm."""
    d, t = cfg["dims"], cfg.get("temple", {})
    mat = lib.finish("temple", cfg.get("temple_finish", cfg["finish"]))
    tip = lib.finish("tip", cfg.get("tip_finish", "dark-tortoise"))
    w_wire, h_wire = t.get("wire", [1.5, 2.4])
    w_tip, h_tip = t.get("tip", [2.8, 3.8])
    tip_len = t.get("tip_length", 48)
    out = []
    for name, s in (("Temple_L", 1), ("Temple_R", -1)):
        hinge = hinges[s]
        path = B.temple_path(hinge, d["temple_length"], cfg["angles"]["pantoscopic"],
                             t.get("splay", 2.5), s, drop=t.get("drop", 38), step=1.5)

        def ramp(sv, L):
            a = L - tip_len
            return min(max((sv - a) / 4.0, 0.0), 1.0)

        def wf(sv, L):
            k = ramp(sv, L)
            return w_wire + (w_tip - w_wire) * k

        def hf(sv, L):
            k = ramp(sv, L)
            return h_wire + (h_tip - h_wire) * k

        o = B.sweep(name, path, wf, hf, (s, 0, 0), segs=16, round_start=True,
                    exp_fn=lambda sv, L: 2.2, origin=hinge,
                    mat_fn=lambda sv, L: 1 if sv >= L - tip_len + 1.5 else 0)
        o.data.materials.append(mat)
        o.data.materials.append(tip)
        out.append(o)
    return out
