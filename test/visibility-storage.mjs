import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
// Inspect private query storage only in the test VM; the shipped API stays unchanged.
export const visibilityStorageProof = async ({ compact = false, deferred = false } = {}) => {
  const context = { window: {}, performance };
  for (const name of ["math", "scene", "models", "object-guides"]) {
    let source = await readFile(new URL(`../src/js/${name}.js`, import.meta.url), "utf8");
    if (name === "object-guides") source = source.replace("return { collect, clear,", "return { geometryRecords: () => geometries, entryRecords: () => registered, collect, clear,");
    runInNewContext(source, context);
  }
  return runInNewContext(`(() => {
    const B = window.BL, S = B.scene, M = B.models, root = S.createNode(), owner = S.createNode(), actor = { root: S.createNode() };
    S.addChild(root, owner, actor.root);
    const precise = { verts: [-0, -0, 0, 1 + Number.EPSILON, -0, 0, 0, 1 + Number.EPSILON, 0], faces: [{ i: [0, 1, 2], color: [1, 1, 1] }], lines: [] };
    const geos = [precise, M.merge(...Array.from({ length: 6 }, (_, i) => M.box({ w: 0.4, h: 0.7, d: 0.3, offset: { x: i * 0.6 }, color: "#fff" })))];
    geos.push({ verts: [0, 0, 0, 1, 0, 0, 2, 0, 0], faces: [{ i: [0, 1, 2], color: [1, 1, 1] }], lines: [] });
    const original = geos.map(g => g.verts.slice());
    for (let i = 0; i < geos.length; i++) S.addChild(owner, S.createNode({ geometry: geos[i], position: { x: i, y: 0, z: 8 }, rotation: { x: 0.17, y: 0.31, z: 0 }, scale: { x: 1.2, y: 0.8, z: 1.1 } }));
    const guides = B.objectGuides.create({ roots: [owner], crew: { cavemen: new Map() } });
    const initiallyUnbaked = guides.stats.triangles === 0 && guides.stats.samples === 0;
    const camera = S.createCamera({ near: 0.1, far: 100 }); Object.assign(camera.position, { x: 0, y: 0, z: 0 }); Object.assign(camera.target, { x: 0, y: 0, z: 8 });
    S.updateWorld(root); guides.collect(actor, 0, 0, 8, camera, 1.6);
    guides.ownerBoundaryAt(owner, 0, 0.2, 8, 1, 0, 0);
    let values = 0, exact = true, bytes = 0, count = 0;
    for (const [source, geometry] of guides.geometryRecords()) {
      const v = source.verts, expected = [];
      for (const face of source.faces) {
        const a = face.i[0] * 3, b = face.i[1] * 3, c = face.i[2] * 3;
        const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], vx = v[c] - v[a], vy = v[c + 1] - v[a + 1], vz = v[c + 2] - v[a + 2];
        if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-6) continue;
        for (let j = 1; j < face.i.length - 1; j++) {
          const b = face.i[j] * 3, c = face.i[j + 1] * 3;
          expected.push(v[a], v[a + 1], v[a + 2], v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2], v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]);
        }
      }
      const actual = [];
      if (geometry.triangleIndices) {
        const ids = geometry.triangleIndices;
        bytes += ids.byteLength;
        for (let i = 0; i < ids.length; i += 3) {
          const a = ids[i], b = ids[i + 1], c = ids[i + 2];
          actual.push(v[a], v[a + 1], v[a + 2], v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2], v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]);
        }
      } else { actual.push(...geometry.triangles); bytes += geometry.triangles.byteLength; }
      exact &&= actual.length === expected.length && actual.every((value, i) => Object.is(value, expected[i]));
      count += expected.length / 9; values += actual.length;
    }
    const unchanged = geos.every((g, i) => g.verts.length === original[i].length && g.verts.every((value, j) => Object.is(value, original[i][j])));
    const bounded = guides.entryRecords().length === 2 && guides.stats.boundaryBuilds > 0 && guides.entryRecords().filter(entry => entry.visible).every(entry => entry.boundaryNodes.length >= entry.geometry.counts.length * 4);
    const storage = ${compact} ? bytes === count * 12 && guides.stats.triangleBytes === bytes : true;
    const demand = ${deferred} ? initiallyUnbaked && guides.stats.triangles > 0 : true;
    guides.dispose();
    return { exact, unchanged, bounded, storage, demand, values, count, bytes, disposed: guides.stats.registered === 0 };
  })()`, context);
};
