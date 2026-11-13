"""Compose all previews into one labelled-order grid: docs/model-previews.png
blender --background --factory-startup --python models-src/contact_sheet.py"""
import bpy, os, glob, numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = sorted(glob.glob(os.path.join(ROOT, "public/models/previews/*.png")))
cols, tw, th = 4, 450, 300
rows = (len(files) + cols - 1) // cols
sheet = np.ones((rows * th, cols * tw, 4), np.float32)
for i, f in enumerate(files):
    im = bpy.data.images.load(f)
    w, h = im.size
    px = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
    ys = (np.arange(th) * h // th); xs = (np.arange(tw) * w // tw)
    small = px[ys][:, xs]
    a = small[..., 3:4]
    small = small[..., :3] * a + (1 - a) * 0.96
    r, c = rows - 1 - i // cols, i % cols
    sheet[r*th:(r+1)*th, c*tw:(c+1)*tw, :3] = small
out = bpy.data.images.new("sheet", cols * tw, rows * th)
out.pixels.foreach_set(sheet.ravel())
out.filepath_raw = os.path.join(ROOT, "docs", "model-previews.png"); out.file_format = "PNG"; out.save()
print("SHEET", [os.path.basename(f) for f in files])
