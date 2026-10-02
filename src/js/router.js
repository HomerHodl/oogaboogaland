// The address follows the visitor, so a shared link, a reload and Back and Forward all land where they
// point. Routes come from `routes.js`; a route to a `place` reaches its scene as `ctx.place` on arrival.
// Every scene change is its own history entry carrying the scene, so Back and Forward return to the last
// scene even when two share an address. Served at a directory (oogabooga.land/oogarally, `npm run serve`)
// the address is a path; from disk or as a named file, where a path would name a missing file, it is a
// hash (oogaboogaland.html#/oogarally).
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const SERVED = location.protocol !== "file:" && !/\.[^/]*$/.test(location.pathname);
  // `scenes` is read after the director has dropped the closed `wip` games, so their routes land home.
  const create = (scenes, routes, go) => {
    const byPath = new Map();
    for (const entry of routes.list) {
      if (byPath.has(entry.path)) throw new Error(`Route "${entry.path}" is listed twice`);
      if (scenes[entry.scene]) byPath.set(entry.path, { place: null, ...entry });
    }
    const HOME = byPath.get("");
    const routeOf = (scene, place) => {
      for (const entry of byPath.values()) if (entry.scene === scene && entry.place === place) return entry;
      return place ? routeOf(scene, null) : { ...HOME, scene };
    };
    // The route the address asks for, or null at the bare address so `?scene=` still decides; `#/` is home,
    // so a hash left by a trip home outranks the `?scene=` a disk page cannot drop. An unknown path or a
    // closed game lands home.
    const current = () => {
      const raw = SERVED ? location.pathname : location.hash;
      const path = raw.replace(/^[#/]+|\/+$/g, "").toLowerCase();
      return path || (!SERVED && raw) ? byPath.get(path) || HOME : null;
    };
    // A served route replaces `?scene=` in the address, or a reload after leaving a game would open it again.
    const urlOf = (entry) => {
      if (!SERVED) return `#/${entry.path}`;
      const params = new URLSearchParams(location.search);
      params.delete("scene");
      const query = params.toString();
      return `/${entry.path}${query ? `?${query}` : ""}`;
    };
    let at = HOME, popped = false;
    // Called by the director on every arrival. Boot tidies the address in place, leaving a bare landing
    // (`/?scene=dsb`) as it came; a Back or Forward arrival finds its entry already there; any other
    // arrival pushes a new one.
    const arrive = (scene, place, boot) => {
      const entry = at = routeOf(scene, place);
      document.title = routes.title(entry);
      const state = { scene, place: entry.place };
      if (popped) popped = false;
      else if (boot) history.replaceState(state, "", entry.path || current() ? urlOf(entry) : location.href);
      else history.pushState(state, "", urlOf(entry));
    };
    // Back and Forward travel through `go`, so they fade and keep the leave contract like any other trip.
    // Our entries always change scene; a hash edited by hand to another place in the same scene (only from
    // disk, where a changed path would load a new page anyway) boots again there.
    const onPop = (e) => {
      const want = e.state || current() || HOME;
      if (want.scene !== at.scene) popped = go(want.scene, want.place);
      else if (want.place !== at.place) location.reload();
    };
    window.addEventListener("popstate", onPop);
    const dispose = () => window.removeEventListener("popstate", onPop);
    return { current, arrive, dispose };
  };
  BL.router = { create };
})();
