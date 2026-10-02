(() => {
  "use strict";
  const BL = window.BL;
  BL.characters.add({
    handle: "portlandhodl",
    joined: 1788800915,
    lastCommit: 1788159681,
    look: { bald: true, cleanShaven: true, skin: "#dfa27c", hair: "#b98b5e", eyeColor: "#6fd3ff", eyeGlow: 1, noPupils: true },
    dress: {
      crown(_k, v) {
        for (const x of [0, 6]) for (const z of [0, 5]) v.del(x, 5, z);
      },
      mark(k, v) {
        v.fill(2, 4, 0, 0, 5, 5, k.P.skin);
      }
    }
  });
})();
