# Writes tests/fixtures/pavilion-ifc4.ifc with IfcOpenShell (pip install ifcopenshell):
#   python scripts/make_pavilion_fixture.py tests/fixtures/pavilion-ifc4.ifc
"""Write an IFC4 test model exercising geometry the Duplex does not: mm units, georeferenced
offset, indexed poly curves with arcs, profile voids, face sets, I/circle profiles, slab and
wall openings, a curtain wall, a half-space clip and a mirrored mapped item."""
import sys, numpy as np, ifcopenshell, ifcopenshell.api as api, ifcopenshell.guid

out = sys.argv[1]
f = api.run("project.create_file", version="IFC4")
project = api.run("root.create_entity", f, ifc_class="IfcProject", name="Test Pavilion")
api.run("unit.assign_unit", f)  # millimetres by default
ctx = api.run("context.add_context", f, context_type="Model")
body = api.run("context.add_context", f, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=ctx)
site = api.run("root.create_entity", f, ifc_class="IfcSite", name="Site")
bldg = api.run("root.create_entity", f, ifc_class="IfcBuilding", name="Test Pavilion")
s0 = api.run("root.create_entity", f, ifc_class="IfcBuildingStorey", name="Ground")
s1 = api.run("root.create_entity", f, ifc_class="IfcBuildingStorey", name="First")
api.run("aggregate.assign_object", f, products=[site], relating_object=project)
api.run("aggregate.assign_object", f, products=[bldg], relating_object=site)
api.run("aggregate.assign_object", f, products=[s0, s1], relating_object=bldg)
OFF = np.array([250_000_000.0, 6_100_000_000.0, 0.0])  # 250 km / 6100 km, in mm
def M(x=0, y=0, z=0, rotz=0.0):
    # inputs in mm; the placement API takes SI metres and converts to the file's mm
    m = np.eye(4); c, s = np.cos(rotz), np.sin(rotz)
    m[:3, :3] = [[c, -s, 0], [s, c, 0], [0, 0, 1]]
    m[:3, 3] = [x / 1000.0, y / 1000.0, z / 1000.0]; return m
api.run("geometry.edit_object_placement", f, product=site, matrix=M(*OFF))
api.run("geometry.edit_object_placement", f, product=bldg, matrix=M(*OFF))
api.run("geometry.edit_object_placement", f, product=s0, matrix=M(*OFF))
api.run("geometry.edit_object_placement", f, product=s1, matrix=M(*(OFF + [0, 0, 3200])))
s0.Elevation = 0.0; s1.Elevation = 3200.0

def element(cls, name, storey, matrix, rep):
    e = api.run("root.create_entity", f, ifc_class=cls, name=name)
    api.run("geometry.edit_object_placement", f, product=e, matrix=matrix)
    if rep is not None: api.run("geometry.assign_representation", f, product=e, representation=rep)
    api.run("spatial.assign_container", f, products=[e], relating_structure=storey)
    return e

def shape(items, rtype):
    return f.create_entity("IfcShapeRepresentation", ContextOfItems=body, RepresentationIdentifier="Body", RepresentationType=rtype, Items=items)

def a2p(x=0, y=0, z=0, axis=None, ref=None):
    return f.create_entity("IfcAxis2Placement3D", f.create_entity("IfcCartesianPoint", (float(x), float(y), float(z))),
        f.create_entity("IfcDirection", axis) if axis else None, f.create_entity("IfcDirection", ref) if ref else None)

def extrude(profile, depth, pos=None, d=(0.0, 0.0, 1.0)):
    return f.create_entity("IfcExtrudedAreaSolid", profile, pos or a2p(), f.create_entity("IfcDirection", d), float(depth))

def mat(e, name):
    m = f.create_entity("IfcMaterial", name)
    f.create_entity("IfcRelAssociatesMaterial", ifcopenshell.guid.new(), None, None, None, [e], m)

# 1 ground slab: indexed poly curve outline with one arc, plus a rectangular void
pts = f.create_entity("IfcCartesianPointList2D", [(0., 0.), (12000., 0.), (12000., 8000.), (6000., 11000.), (0., 8000.)])
outer = f.create_entity("IfcIndexedPolyCurve", pts, [f.create_entity("IfcLineIndex", (1, 2, 3)), f.create_entity("IfcArcIndex", (3, 4, 5)), f.create_entity("IfcLineIndex", (5, 1))], False)
void = f.create_entity("IfcPolyline", [f.create_entity("IfcCartesianPoint", p) for p in [(8000., 2000.), (10000., 2000.), (10000., 4000.), (8000., 4000.), (8000., 2000.)]])
prof = f.create_entity("IfcArbitraryProfileDefWithVoids", "AREA", None, outer, [void])
slab = element("IfcSlab", "Ground slab", s0, M(*OFF), shape([extrude(prof, 250, a2p(0, 0, -250))], "SweptSolid"))
mat(slab, "Concrete C30/37")
# 2 first floor slab with a shaft opening (opening element through the slab)
prof2 = f.create_entity("IfcRectangleProfileDef", "AREA", None, f.create_entity("IfcAxis2Placement2D", f.create_entity("IfcCartesianPoint", (6000., 4000.)), None), 12000., 8000.)
slab1 = element("IfcSlab", "First floor slab", s1, M(*(OFF + [0, 0, 3200])), shape([extrude(prof2, 200, a2p(0, 0, -200))], "SweptSolid"))
mat(slab1, "CLT 5-ply")
shaft = api.run("root.create_entity", f, ifc_class="IfcOpeningElement", name="Shaft")
api.run("geometry.edit_object_placement", f, product=shaft, matrix=M(*(OFF + [2000, 2000, 3200 - 400])))
shaft_prof = f.create_entity("IfcRectangleProfileDef", "AREA", None, f.create_entity("IfcAxis2Placement2D", f.create_entity("IfcCartesianPoint", (750., 750.)), None), 1500., 1500.)
api.run("geometry.assign_representation", f, product=shaft, representation=shape([extrude(shaft_prof, 800)], "SweptSolid"))
api.run("feature.add_feature", f, feature=shaft, element=slab1)
# 3 wall with a window opening + mirrored mapped window
wrep = api.run("geometry.add_wall_representation", f, context=body, length=12.0, height=3.0, thickness=0.3)
wall = element("IfcWall", "South wall", s0, M(*OFF), wrep)
mat(wall, "Brick masonry")
op = api.run("root.create_entity", f, ifc_class="IfcOpeningElement", name="Window opening")
api.run("geometry.edit_object_placement", f, product=op, matrix=M(*(OFF + [4000, -100, 900])))
op_prof = f.create_entity("IfcRectangleProfileDef", "AREA", None, f.create_entity("IfcAxis2Placement2D", f.create_entity("IfcCartesianPoint", (900., 750.)), None), 1800., 1500.)
api.run("geometry.assign_representation", f, product=op, representation=shape([extrude(op_prof, 500, a2p(0, 0, 0, (0., 1., 0.), (1., 0., 0.)), (0., 0., 1.))], "SweptSolid"))
api.run("feature.add_feature", f, feature=op, element=wall)
# window body: a polygonal face set (a 1800×1500×60 frame block), mapped twice (second mirrored)
coords = f.create_entity("IfcCartesianPointList3D", [(0., 0., 0.), (1800., 0., 0.), (1800., 60., 0.), (0., 60., 0.), (0., 0., 1500.), (1800., 0., 1500.), (1800., 60., 1500.), (0., 60., 1500.)])
faces = [f.create_entity("IfcIndexedPolygonalFace", idx) for idx in [(1, 4, 3, 2), (5, 6, 7, 8), (1, 2, 6, 5), (2, 3, 7, 6), (3, 4, 8, 7), (4, 1, 5, 8)]]
fs = f.create_entity("IfcPolygonalFaceSet", coords, True, faces, None)
rmap = f.create_entity("IfcRepresentationMap", a2p(), shape([fs], "Tessellation"))
def mapped(op3d):
    return shape([f.create_entity("IfcMappedItem", rmap, op3d)], "MappedRepresentation")
win = element("IfcWindow", "Window A", s0, M(*(OFF + [4000, 0, 900])), mapped(f.create_entity("IfcCartesianTransformationOperator3D", None, None, f.create_entity("IfcCartesianPoint", (0., 120., 0.)), 1.0, None)))
api.run("feature.add_filling", f, opening=op, element=win)
mir = f.create_entity("IfcCartesianTransformationOperator3DnonUniform", f.create_entity("IfcDirection", (-1., 0., 0.)), None, f.create_entity("IfcCartesianPoint", (0., 120., 0.)), 1.0, None, 1.0, 1.0)
win2 = element("IfcWindow", "Window B (mirrored)", s1, M(*(OFF + [10000, 0, 3200 + 900])), mapped(mir))
# 4 circular column and an I-section beam
col = element("IfcColumn", "Column C1", s0, M(*(OFF + [6000, 4000, 0])), shape([extrude(f.create_entity("IfcCircleProfileDef", "AREA", None, None, 200.), 3000)], "SweptSolid"))
mat(col, "Concrete C40/50")
ipro = f.create_entity("IfcIShapeProfileDef", "AREA", "IPE 400", None, 180., 400., 8.6, 13.5, None)
beam = element("IfcBeam", "Beam B1", s0, M(*(OFF + [0, 4000, 3000 - 200])), shape([extrude(ipro, 12000, a2p(0, 0, 0, (1., 0., 0.), (0., 1., 0.)))], "SweptSolid"))
mat(beam, "Steel S355")
# 5 triangulated face set: a tetrahedral proxy, on the first floor
tri = f.create_entity("IfcTriangulatedFaceSet", f.create_entity("IfcCartesianPointList3D", [(0., 0., 0.), (1000., 0., 0.), (0., 1000., 0.), (0., 0., 1000.)]), None, True, [(1, 3, 2), (1, 2, 4), (2, 3, 4), (3, 1, 4)], None)
proxy = element("IfcBuildingElementProxy", "Sculpture", s1, M(*(OFF + [9000, 6000, 3200])), shape([tri], "Tessellation"))
# 6 wall clipped by a sloping half-space (gable)
w2rep = api.run("geometry.add_wall_representation", f, context=body, length=8.0, height=6.0, thickness=0.3)
w2 = element("IfcWall", "West gable wall", s0, M(*(OFF + [0, 0, 0]), rotz=np.pi / 2), w2rep)
inner = w2rep.Items[0]
plane = f.create_entity("IfcPlane", a2p(0, 0, 4500, (0.0, -0.3, 0.954), (1., 0., 0.)))
clip = f.create_entity("IfcBooleanClippingResult", "DIFFERENCE", inner, f.create_entity("IfcHalfSpaceSolid", plane, False))
w2rep.Items = [clip]; w2rep.RepresentationType = "Clipping"
mat(w2, "Brick masonry")
# 7 curtain wall: container + panels and mullions as parts
cw = api.run("root.create_entity", f, ifc_class="IfcCurtainWall", name="East curtain wall")
api.run("geometry.edit_object_placement", f, product=cw, matrix=M(*(OFF + [12000, 0, 0]), rotz=np.pi / 2))
api.run("spatial.assign_container", f, products=[cw], relating_structure=s0)
parts = []
for i in range(4):
    pl = element("IfcPlate", f"Panel {i + 1}", s0, M(*(OFF + [12000, 0, 0]), rotz=np.pi / 2), shape([extrude(f.create_entity("IfcRectangleProfileDef", "AREA", None, f.create_entity("IfcAxis2Placement2D", f.create_entity("IfcCartesianPoint", (1000. + 2000. * i, 12.)), None), 1900., 24.), 2900, a2p(0, 0, 50))], "SweptSolid"))
    mat(pl, "Glass"); parts.append(pl)
for i in range(5):
    mu = element("IfcMember", f"Mullion {i + 1}", s0, M(*(OFF + [12000, 0, 0]), rotz=np.pi / 2), shape([extrude(f.create_entity("IfcRectangleProfileDef", "AREA", None, f.create_entity("IfcAxis2Placement2D", f.create_entity("IfcCartesianPoint", (2000. * i, 50.)), None), 60., 150.), 3000)], "SweptSolid"))
    mat(mu, "Aluminium"); parts.append(mu)
api.run("aggregate.assign_object", f, products=parts, relating_object=cw)
f.write(out)
print("wrote", out, len(list(f)), "entities")
