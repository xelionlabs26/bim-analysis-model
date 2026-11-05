# Reference geometry for tests: python scripts/ifc_reference.py model.ifc out.json
"""Reference geometry from IfcOpenShell: per-element world bounds (IFC metres, Z up) and volume."""
import json, sys, multiprocessing
import numpy as np
import ifcopenshell, ifcopenshell.geom

path, out = sys.argv[1], sys.argv[2]
model = ifcopenshell.open(path)
settings = ifcopenshell.geom.settings()
settings.set("use-world-coords", True)
it = ifcopenshell.geom.iterator(settings, model, max(1, multiprocessing.cpu_count()))
res = {}
skip = {"IfcOpeningElement", "IfcSpace", "IfcOpeningStandardCase", "IfcAnnotation", "IfcGrid", "IfcVirtualElement"}
if it.initialize():
    while True:
        s = it.get()
        el = model.by_id(s.id)
        if el.is_a() not in skip:
            v = np.array(s.geometry.verts, dtype=float).reshape(-1, 3)
            f = np.array(s.geometry.faces, dtype=int).reshape(-1, 3)
            if len(v) and len(f):
                a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
                vol = float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6.0)
                # a signed volume only means something for a closed, consistently wound mesh:
                # weld vertices, then every directed edge must appear exactly once and be matched by its reverse
                key = {tuple(p): i for i, p in enumerate(v.round(5).tolist())}
                w = np.array([key[tuple(p)] for p in v.round(5).tolist()])
                directed = {}
                for t in f:
                    for x, y in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
                        e = (w[x], w[y])
                        directed[e] = directed.get(e, 0) + 1
                oriented = all(n == 1 and directed.get((e[1], e[0]), 0) == 1 for e, n in directed.items())
                res[el.GlobalId] = {"type": el.is_a(), "name": el.Name, "min": v.min(0).round(4).tolist(), "max": v.max(0).round(4).tolist(), "volume": round(abs(vol), 5), "oriented": oriented, "tris": int(len(f))}
        if not it.next():
            break
json.dump({"schema": model.schema, "count": len(res), "elements": res}, open(out, "w"), indent=0)
print("schema", model.schema, "elements with geometry", len(res))
from collections import Counter
print(Counter(r["type"] for r in res.values()).most_common())
