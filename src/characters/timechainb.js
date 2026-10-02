(() => {
  "use strict";
  const BL = window.BL;
  const { makeVox, voxelGeometry } = BL.models;
  const { createNode, addChild } = BL.scene;
  const { hexToRgb } = BL.math;
  const staffVoxels = (rand) => {
    const v = makeVox();
    const woodJ = () => rand() < 0.2 ? 1 : 0;
    v.fill(0, 0, -2, 15, 0, 0, woodJ);
    for (const y of [3, 8, 12]) v.set(rand() < 0.5 ? -1 : 1, y, 0, 1);
    for (const [y, z] of [[16, 0], [17, 1], [17, 2], [16, 3], [15, 3]]) v.set(0, y, z, woodJ());
    return v;
  };
  const LION_PALETTE = [hexToRgb("#d4a04a"), hexToRgb("#bd8b38"), hexToRgb("#a5602a"), hexToRgb("#7d4520"), hexToRgb("#ecc98a"), hexToRgb("#141414")];
  const lionVoxels = (rand) => {
    const v = makeVox();
    const L = { fur: 0, furDk: 1, mane: 2, maneDk: 3, belly: 4, black: 5 };
    const fur = () => rand() < 0.15 ? L.furDk : L.fur;
    const mane = () => rand() < 0.35 ? L.maneDk : L.mane;
    v.fill(0, 3, 0, 5, 0, 3, fur);
    v.fill(1, 2, 0, 4, 3, 3, L.belly);
    v.fill(-1, 4, 6, 10, 1, 5, (x, y, z) => (x === -1 || x === 4) && (y === 6 || y === 10) ? null : x === -1 || x === 4 || y === 6 || y === 10 || z === 1 ? mane() : null);
    v.fill(0, 3, 7, 9, 2, 5, fur);
    v.fill(1, 2, 7, 7, 5, 6, L.belly);
    v.fill(1, 2, 8, 8, 5, 5, L.maneDk);
    v.set(0, 9, 5, L.black);
    v.set(3, 9, 5, L.black);
    v.set(0, 11, 2, L.fur);
    v.set(3, 11, 2, L.fur);
    for (const x of [0, 3]) {
      v.fill(x, x, 3, 4, 4, 6, fur);
      v.fill(x, x, 1, 2, 6, 6, fur);
      v.fill(x, x, -3, -1, 1, 2, fur);
      v.fill(x, x, -3, -3, 3, 3, fur);
    }
    v.fill(2, 2, -5, -1, -1, -1, fur);
    v.set(2, -6, -1, L.maneDk);
    return v;
  };
  BL.characters.add({
    handle: "timechainb",
    joined: 1788800921,
    lastCommit: 1788171200,
    look: { portrait: { min: [-1, -2, 0], max: [7, 11, 8] }, hairless: true, hatY: 12, skin: "#b8703c", hair: "#33200f" },
    dress: {
      // The staff stands upright in the grip.
      club: (k) => ({ voxels: staffVoxels(k.rand), rest: { x: 0.2, z: 0 } }),
      // The Anunnaki: a gold banded cap over the brow, hair curling down the back and sides, a full beard to the chest
      crown(k, v) {
        const P = k.P, gold = k.color("#d4a83a"), goldDk = k.color("#9c7a22");
        const curl = (x, y, z) => (x + y + z) % 2 ? P.hairDk : P.hair;
        v.fill(-1, 7, -4, 5, -2, -1, curl);
        v.fill(-1, -1, -4, 5, 0, 2, curl);
        v.fill(7, 7, -4, 5, 0, 2, curl);
        v.fill(0, 6, 0, 1, 5, 7, curl);
        v.fill(0, 6, -2, -1, 5, 8, curl);
        v.fill(1, 5, -5, -3, 6, 8, curl);
        v.fill(2, 4, -7, -6, 7, 8, curl);
        v.set(3, -8, 8, P.hairDk);
        v.fill(-1, 7, 6, 8, -1, 6, (x, y) => y === 7 ? gold : goldDk);
        v.fill(0, 6, 9, 9, 0, 5, gold);
        v.fill(1, 5, 10, 10, 1, 4, goldDk);
        v.fill(2, 4, 11, 11, 2, 3, gold);
      },
      // A lion cub carried on the right arm
      extras(k) {
        const u = k.u;
        k.parts.lion = createNode({ geometry: voxelGeometry(lionVoxels(k.rand), { unit: u, palette: LION_PALETTE, origin: { x: k.armX + 1.5 * u, y: -1 * u, z: -2 * u } }) });
        addChild(k.root, k.parts.lion);
      }
    }
  });
})();
