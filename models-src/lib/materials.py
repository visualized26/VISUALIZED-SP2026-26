"""PBR materials that survive glTF export (Principled BSDF only + image textures)."""
import math
import os
import bpy
import numpy as np


def _hex(c):
    c = c.lstrip("#")
    srgb = [int(c[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in srgb]
    return (*lin, 1.0)


def _set(bsdf, key, val):
    if key in bsdf.inputs:
        bsdf.inputs[key].default_value = val


def principled(name, color="#222222", metallic=0.0, roughness=0.4, coat=0.0,
               coat_roughness=0.05, transmission=0.0, ior=1.5, alpha=1.0, texture=None,
               specular=0.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    _set(bsdf, "Base Color", _hex(color) if isinstance(color, str) else color)
    _set(bsdf, "Metallic", metallic)
    _set(bsdf, "Roughness", roughness)
    _set(bsdf, "Coat Weight", coat)
    _set(bsdf, "Coat Roughness", coat_roughness)
    _set(bsdf, "Transmission Weight", transmission)
    _set(bsdf, "IOR", ior)
    _set(bsdf, "Specular IOR Level", specular)
    _set(bsdf, "Alpha", alpha)
    if alpha < 1.0:
        try:
            mat.surface_render_method = "BLENDED"
        except Exception:
            pass
    if texture is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = texture
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


# ------------------------------------------------------------ procedural textures
def _value_noise(size, cells, rng):
    g = rng.random((cells + 1, cells + 1)).astype(np.float32)
    lin = np.linspace(0, cells, size, endpoint=False, dtype=np.float32)
    i = lin.astype(np.int32)
    f = lin - i
    f = f * f * (3 - 2 * f)
    a = g[np.ix_(i, i)]
    b = g[np.ix_(i, i + 1)]
    c = g[np.ix_(i + 1, i)]
    d = g[np.ix_(i + 1, i + 1)]
    fx, fy = f[None, :], f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def _fbm(size, base, octaves, rng, stretch=1.0):
    acc = np.zeros((size, size), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        cells = int(base * (2 ** o))
        acc += amp * _value_noise(size, cells, rng)
        tot += amp
        amp *= 0.5
    return acc / tot


def tortoise_image(name, palette, seed=7, size=1024, cache_dir=None):
    """Tortoiseshell acetate: dark blotches warped over amber, stretched along x."""
    rng = np.random.default_rng(seed)
    n1 = _fbm(size, 4, 5, rng)
    n2 = _fbm(size, 8, 4, rng)
    # domain-ish warp: mix two scales and stretch horizontally like real acetate
    w = 0.65 * n1 + 0.35 * np.roll(n2, size // 7, axis=1)
    w = np.clip((w - 0.38) * 3.2, 0, 1)
    spots = np.clip((n2 - 0.55) * 6.0, 0, 1)
    t = np.clip(w * 0.85 + spots * 0.4, 0, 1)
    cols = [np.array(_hex(c)[:3], np.float32) for c in palette]  # light -> dark
    out = np.zeros((size, size, 3), np.float32)
    stops = np.linspace(0, 1, len(cols))
    for k in range(len(cols) - 1):
        m = (t >= stops[k]) & (t <= stops[k + 1])
        u = ((t - stops[k]) / (stops[k + 1] - stops[k]))[..., None]
        out = np.where(m[..., None], cols[k] * (1 - u) + cols[k + 1] * u, out)
    # fine speckle
    out *= (0.92 + 0.08 * _fbm(size, 64, 2, rng))[..., None]
    img = bpy.data.images.new(name, size, size, alpha=False)
    rgba = np.concatenate([out, np.ones((size, size, 1), np.float32)], axis=2)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        img.filepath_raw = os.path.join(cache_dir, name + ".jpg")
        img.file_format = "JPEG"
        bpy.context.scene.render.image_settings.quality = 88
        img.save()
    img.pack()
    return img


# ------------------------------------------------------------ finishes library
FINISHES = {
    # acetates
    "onyx":        dict(kind="acetate", color="#0c0c0e", roughness=0.28, coat=1.0),
    "matte-black": dict(kind="acetate", color="#141416", roughness=0.62, coat=0.0),
    "navy":        dict(kind="acetate", color="#1b2536", roughness=0.3, coat=1.0),
    "wine":        dict(kind="acetate", color="#4a1420", roughness=0.3, coat=1.0),
    "olive":       dict(kind="acetate", color="#3c4128", roughness=0.32, coat=1.0),
    "ivory":       dict(kind="acetate", color="#e9e1cf", roughness=0.3, coat=1.0),
    "crystal":     dict(kind="clear", color="#f2f4f5", roughness=0.08, transmission=0.92),
    "smoke":       dict(kind="clear", color="#6b6e73", roughness=0.1, transmission=0.85),
    "champagne-clear": dict(kind="clear", color="#e8c99a", roughness=0.1, transmission=0.88),
    "tortoise":    dict(kind="tortoise", palette=["#c98a3a", "#8a4d1c", "#4a2410", "#1e0d06"]),
    "blonde-tortoise": dict(kind="tortoise", palette=["#e0b36b", "#b57a35", "#7a4718", "#3e1f0a"]),
    "dark-tortoise": dict(kind="tortoise", palette=["#7a4a1e", "#4a2a12", "#24120a", "#0e0806"]),
    # metals
    "gold":        dict(kind="metal", color="#e3c07a", roughness=0.22),
    "silver":      dict(kind="metal", color="#d6d8db", roughness=0.18),
    "gunmetal":    dict(kind="metal", color="#55585e", roughness=0.3),
    "rose-gold":   dict(kind="metal", color="#e2a990", roughness=0.22),
    "black-metal": dict(kind="metal", color="#1c1c1e", roughness=0.4),
}

LENSES = {
    "clear":  dict(color="#ffffff", transmission=1.0, roughness=0.02),
    "blue-shield": dict(color="#eef3ff", transmission=1.0, roughness=0.02),
    "grey":   dict(color="#3a3d42", transmission=0.85, roughness=0.03),
    "green":  dict(color="#2f4030", transmission=0.85, roughness=0.03),
    "brown":  dict(color="#5a3a22", transmission=0.85, roughness=0.03),
}


class Library:
    def __init__(self, tex_cache=None):
        self.cache = {}
        self.tex_cache = tex_cache

    def finish(self, slot, key):
        ck = (slot, key)
        if ck in self.cache:
            return self.cache[ck]
        f = FINISHES[key]
        k = f["kind"]
        if k == "acetate":
            m = principled(slot, f["color"], roughness=f["roughness"], coat=f["coat"])
        elif k == "clear":
            m = principled(slot, f["color"], roughness=f["roughness"],
                           transmission=f["transmission"], ior=1.49, coat=1.0)
        elif k == "tortoise":
            img = tortoise_image("tex_" + key, f["palette"], seed=sum(map(ord, key)),
                                 cache_dir=self.tex_cache)
            m = principled(slot, "#ffffff", roughness=0.26, coat=1.0, texture=img)
        else:
            m = principled(slot, f["color"], metallic=1.0, roughness=f["roughness"])
        m.name = slot
        self.cache[ck] = m
        return m

    def metal(self, key="silver"):
        return self.finish("metal", key)

    def lens(self, key="clear"):
        ck = ("lens", key)
        if ck not in self.cache:
            f = LENSES[key]
            m = principled("lens", f["color"], roughness=f["roughness"],
                           transmission=f["transmission"], ior=1.5, specular=0.6)
            m.name = "lens"
            self.cache[ck] = m
        return self.cache[ck]

    def pad(self):
        if "pad" not in self.cache:
            m = principled("pad", "#e8eef0", roughness=0.2, transmission=0.8, ior=1.42)
            m.name = "pad"
            self.cache["pad"] = m
        return self.cache["pad"]
