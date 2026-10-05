(() => {
  "use strict";
  const BL = window.BL;
  BL.characters.add({
    handle: "SaniExp",
    display: "Sani",
    joined: 1790294400,
    // Historical activity from the bundled Oogatron snapshot; live stats refresh it.
    lastCommit: 1788367622,
    look: { bald: true, face: "beard" },
    dress: {
      gear(k) {
        const v = BL.models.makeVox(), ink = k.color("#252b2b"), faded = k.color("#414947");
        // Keep the standard arm and hand shape; ink stops above the bare forearms.
        v.fill(0, 2, 2, 7, 0, 2, k.skinJ);
        v.fill(-1, 3, 8, 10, -1, 3, k.skinJ);
        v.fill(-1, 3, 0, 1, -1, 3, k.skinJ);
        for (let y = 6; y <= 10; y++) {
          const lo = y >= 8 ? -1 : 0, hi = y >= 8 ? 3 : 2;
          for (let t = lo; t <= hi; t++) {
            // Broken bands and diagonal marks wrap all four faces of each upper arm.
            if (y === 6 || (t + y + 12) % 3 === 0) {
              v.set(t, y, lo, ink); v.set(hi, y, t, ink);
            }
            if (y === 6 || (t - y + 12) % 3 === 0) {
              v.set(t, y, hi, faded); v.set(lo, y, t, faded);
            }
          }
        }
        const arm = k.vg(v, { x: -1.5 * k.u, y: -11 * k.u, z: -1.5 * k.u });
        k.parts.armR.geometry = k.parts.armL.geometry = arm;
      }
    }
  });
})();
