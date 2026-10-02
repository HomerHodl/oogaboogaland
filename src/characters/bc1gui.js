(() => {
  "use strict";
  const BL = window.BL;
  const { box, merge } = BL.models;
  const { createNode, addChild } = BL.scene;
  const skateboardGeometry = (h) => merge(
    box({ w: 0.22 * h, h: 0.8 * h, d: 0.03 * h, color: "#7cc242" }),
    box({ w: 0.2 * h, h: 0.08 * h, d: 0.03 * h, color: "#f7931a", offset: { z: -0.006 * h } }),
    ...[-0.28, 0.28].map((y) => box({ w: 0.2 * h, h: 0.03 * h, d: 0.045 * h, color: "#8a8a8a", offset: { y: y * h, z: -0.03 * h } })),
    ...[-0.28, 0.28].flatMap((y) => [-0.085, 0.085].map((x) => box({ w: 0.06 * h, h: 0.06 * h, d: 0.05 * h, color: "#1a1a1a", offset: { x: x * h, y: y * h, z: -0.07 * h } })))
  );
  BL.characters.add({
    handle: "bc1gui",
    // GitHub login behind the handle, for activity and the jumbotron
    github: "ottoz0r",
    joined: 1788800918,
    lastCommit: 1788190400,
    // skater also moves the drawn gun to the side in crew.js (the board takes the back)
    look: { portrait: { min: [-3, -2, -1], max: [7, 13, 8] }, skater: true, hairless: true, noBrow: true, face: "smirk", hatY: 13, skin: "#f2a33c", hair: "#e4561f", fur: "#8f4f17" },
    dress: {
      // A slouched green beanie over dreads, shades in front of the eyes
      crown(k, v) {
        const P = k.P, knit = k.color("#8cc63f"), knitDk = k.color("#6faa2f"), pom = k.color("#a9d94c"), btc = k.color("#f7931a"), lens = k.color("#3f9c96");
        const rib = (x, y, z) => (x + z) % 2 ? knitDk : knit;
        v.fill(-1, 7, 4, 8, -1, 6, rib);
        v.fill(-1, 5, 9, 9, 0, 5, rib);
        v.fill(-2, 3, 10, 10, 1, 4, rib);
        v.fill(-3, 0, 11, 12, 1, 3, k.jit(pom, knit, 0.2));
        v.fill(-2, -1, 13, 13, 2, 2, pom);
        for (const [bx, by] of [[3, 8], [4, 8], [3, 7], [5, 7], [3, 6], [4, 6], [3, 5], [5, 5], [3, 4], [4, 4]]) v.set(bx, by, 6, btc);
        for (const z of [-1, 1, 3]) {
          v.fill(-1, -1, -2, 3, z, z, k.hairJ);
          v.fill(7, 7, -2, 3, z, z, k.hairJ);
        }
        for (const x of [0, 2, 4, 6]) v.fill(x, x, -3, 3, -1, -1, k.hairJ);
        v.fill(0, 6, 3, 3, 6, 6, P.black);
        v.fill(0, 1, 2, 3, 6, 6, lens);
        v.fill(5, 6, 2, 3, 6, 6, lens);
        v.fill(-1, -1, 3, 3, 4, 6, P.black);
        v.fill(7, 7, 3, 3, 4, 6, P.black);
      },
      // The board on its back, a named part so a scene can take it off (the arcade's rides do)
      extras(k) {
        const h = k.h;
        k.parts.board = createNode({ position: { x: 0, y: 0.28 * h, z: -0.35 * h }, rotation: { x: 0, y: 0, z: 0.4 }, geometry: skateboardGeometry(h) });
        addChild(k.root, k.parts.board);
      }
    }
  });
})();
