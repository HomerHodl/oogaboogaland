// The visitor's account and the island room, when the page is served by the Cloudflare Worker. One look
// at /api/me on start; a signed-in visitor then holds one socket to /room for the page life. A page with
// no backend behind it (GitHub Pages, a file, `npm run serve`) gets no JSON from /api/me and stays as it
// always was: `backend` false, nothing shown, no socket. Like the live feeds it stays off under nosim and
// can be disabled with net=0; the director starts it.
//
// The room answers who else is on the island: `remotes` (id → { login, display, body, zone, voice, muted, x, y, z, yaw }),
// updated in place from its snapshots (up to 15 a second while anyone moves). A scene reports the Ooga the visitor drives with `setBody`
// (null when none) and its feet and heading with `sendPose`, which throttles itself. A newer tab of the
// same account kicks this one with `replaced`: it stops reconnecting until `rejoin`. `setZone` reports
// the place the driven Ooga is in (out on the island, HQ, a cave), which decides who hears whom.
//
// Who drives which Ooga, on the page served by the Worker (`mayDrive`; the room enforces the same
// ownership through its own copy of the cast): a signed-in contributor drives only their own Ooga, and
// nobody else drives it while they are here; everyone else, signed in or not, drives an Ooga only while
// its owner is away, nobody else holds it, and it is not working. Ownership keys on the GitHub login
// alone (`github`, else the handle). A claim the room refuses, or an owner arriving, lands as `released`.
// The NPC host: the room elects one page showing the island (`setHub`, which also counts a hidden tab
// out) to run the Oogas for everyone. `state.hostId` names it; the host sends its binary pose frames with
// `sendNpc`, and every other page reads the latest one from `npcFrame` (with `state.npcVersion` counting).
// `state.followers` is how many pages follow the host; with none, the host sends nothing.
// A tab hidden for HIDDEN_PAUSE_MS leaves the room (`paused`, voice stopped) and comes back when it is
// looked at again, so a forgotten tab does not hold the room, the host role or voice.
// The room's clock: `serverNow()` estimates it from the timestamps on `welcome` and `state`, keeping the
// sample that arrived fastest (the least delayed), and `state.loopEpoch` is when the pile's shared
// sound loop started, so every page can play the same moment of it.
// The roster's marks (who is in voice, muted, the host) follow `subscribeRoster`, which also fires on a
// body or voice change; `subscribe` stays for the account and the room. `setMuted` tells the room this
// page muted its microphone, and `state.body` is the Ooga this page reports driving.
// Exports start, subscribe, subscribeRoster, dispose, login, logout, rejoin, setBody, setZone, setHub, setMuted, sendNpc, npcFrame, sendPose,
// mayDrive, ownCharacter, characterOf, serverNow, remotes and state.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const POSE_MS = 1000 / 10;
  const PING_MS = 10000;
  const HIDDEN_PAUSE_MS = 5 * 60000;
  const BACKOFF_MS = 500, BACKOFF_MAX_MS = 15000;
  const subscribers = new Set();
  const rosterSubscribers = new Set();
  const remotes = new Map();
  // room: "off" (signed out or no backend), "connecting", "live", "paused" (hidden a while), or a kick that
// stopped it ("replaced", "full").
  const state = { backend: false, me: null, started: false, room: "off", selfId: 0, online: 0, released: null, loopEpoch: 0, zone: "outside", body: null, hostId: 0, followers: 0, npcVersion: 0 };
  let ws = null, retry = 0, retryTimer = 0, pingTimer = 0, hiddenTimer = 0, stopped = false;
  let npcFrame = null, inHub = false, hubSent = null;
  let zone = "outside", body = null, muted = false, poseAt = 0, px = NaN, py = NaN, pz = NaN, pyaw = NaN;
  let clockOffset = 0, clockKnown = false;
  // A server timestamp minus the arrival time is the true offset less the trip; the largest such
  // sample is the one that travelled fastest, so it is the best estimate yet.
  const clockSample = (serverMs) => {
    if (typeof serverMs !== "number") return;
    const sample = serverMs - Date.now();
    if (!clockKnown || sample > clockOffset) clockOffset = sample;
    clockKnown = true;
  };
  const serverNow = () => Date.now() + clockOffset;

  const rosterChanged = () => {
    for (const fn of rosterSubscribers) fn();
  };
  const emit = () => {
    for (const fn of subscribers) fn(state);
    rosterChanged();
  };

  // Only the fields the page uses; anything else /api/me grows later stays out.
  const accept = (player) => {
    if (!player || !Number.isSafeInteger(player.id) || typeof player.login !== "string") return null;
    return { id: player.id, login: player.login, display: typeof player.display === "string" ? player.display : player.login };
  };

  const setRoom = (room) => {
    state.room = room;
    state.online = room === "live" ? remotes.size + 1 : 0;
    emit();
  };

  const send = (text) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(text);
  };

  const sendBody = () => send(JSON.stringify({ t: "body", name: body }));
  const sendZone = () => send(JSON.stringify({ t: "zone", name: zone }));
  const sendMute = () => send(muted ? '{"t":"mute","on":true}' : '{"t":"mute","on":false}');
  // What the room hears is "showing the island now": the hub scene, in a visible tab.
  const sendHub = () => {
    const on = inHub && !document.hidden;
    if (on === hubSent || !ws || ws.readyState !== WebSocket.OPEN) return;
    hubSent = on;
    send(on ? '{"t":"hub","on":true}' : '{"t":"hub","on":false}');
  };

  const upsert = (p) => {
    if (!p || !Number.isSafeInteger(p.id) || p.id === state.selfId) return;
    const rec = remotes.get(p.id) || { id: p.id, login: "", display: "", body: null, zone: "outside", voice: false, muted: false, x: 0, y: 0, z: 0, yaw: 0 };
    rec.login = String(p.login);
    rec.display = String(p.display || p.login);
    rec.body = typeof p.body === "string" ? p.body : null;
    rec.zone = typeof p.zone === "string" ? p.zone : "outside";
    rec.voice = p.voice === true;
    rec.muted = p.muted === true;
    rec.x = +p.x || 0; rec.y = +p.y || 0; rec.z = +p.z || 0; rec.yaw = +p.yaw || 0;
    remotes.set(p.id, rec);
  };

  const onMessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      npcFrame = e.data;
      state.npcVersion++;
      return;
    }
    if (e.data === "pong" || typeof e.data !== "string") return;
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.t === "state") {
      clockSample(msg.now);
      const ps = msg.ps;
      for (let i = 0; i + 4 < ps.length; i += 5) {
        const rec = remotes.get(ps[i]);
        if (!rec) continue;
        rec.x = ps[i + 1]; rec.y = ps[i + 2]; rec.z = ps[i + 3]; rec.yaw = ps[i + 4];
      }
    } else if (msg.t === "welcome") {
      retry = 0;
      clockKnown = false;
      clockSample(msg.now);
      state.loopEpoch = typeof msg.loopEpoch === "number" ? msg.loopEpoch : 0;
      state.hostId = Number.isSafeInteger(msg.host) ? msg.host : 0;
      state.followers = Number.isSafeInteger(msg.followers) ? msg.followers : 0;
      state.selfId = msg.you.id;
      remotes.clear();
      for (const p of msg.players) upsert(p);
      setRoom("live");
      // A reconnect picks up where the page is: the Ooga still driven and where it stands, and voice,
      // whose sessions the room forgot with the old socket.
      sendZone();
      sendBody();
      if (muted) sendMute();
      hubSent = null;
      sendHub();
      BL.voice.restart();
      poseAt = 0;
      px = NaN;
    } else if (msg.t === "join") {
      upsert(msg.p);
      setRoom("live");
    } else if (msg.t === "leave") {
      remotes.delete(msg.id);
      setRoom("live");
    } else if (msg.t === "body") {
      const rec = remotes.get(msg.id);
      if (rec) rec.body = typeof msg.name === "string" ? msg.name : null;
      rosterChanged();
    } else if (msg.t === "vstate") {
      const rec = remotes.get(msg.id);
      if (!rec) return;
      rec.voice = msg.voice === true;
      rec.muted = msg.muted === true;
      rosterChanged();
    } else if (msg.t === "zone") {
      const rec = remotes.get(msg.id);
      if (rec && typeof msg.name === "string") rec.zone = msg.name;
    } else if (msg.t === "host") {
      state.hostId = Number.isSafeInteger(msg.id) ? msg.id : 0;
      state.followers = Number.isSafeInteger(msg.followers) ? msg.followers : 0;
      emit();
    } else if (msg.t === "voice") {
      if (Array.isArray(msg.peers)) BL.voice.setPeers(msg.peers);
    } else if (msg.t === "release") {
      state.released = { name: String(msg.name), reason: String(msg.reason) };
      emit();
    } else if (msg.t === "kick") {
      // replaced and full stop here; stale reconnects like any drop.
      if (msg.reason !== "stale") stopped = true;
      close(msg.reason === "stale" ? "connecting" : msg.reason);
    }
  };

  const close = (room) => {
    window.clearInterval(pingTimer);
    pingTimer = 0;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      if (ws.readyState <= WebSocket.OPEN) ws.close(1000);
      ws = null;
    }
    remotes.clear();
    state.hostId = 0;
    state.followers = 0;
    npcFrame = null;
    hubSent = null;
    // Out of the room for good (signed out, another tab, full): voice goes with it.
    if (room !== "connecting") BL.voice.stop();
    setRoom(room);
    if (!stopped && room === "connecting") schedule();
  };

  // Backoff as the prototype tuned it: ×1.7 from half a second, capped at 15 s, ±25% jitter.
  const schedule = () => {
    window.clearTimeout(retryTimer);
    const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_MS * 1.7 ** retry++) * (0.75 + Math.random() * 0.5);
    retryTimer = window.setTimeout(connect, wait);
  };

  const connect = () => {
    retryTimer = 0;
    if (stopped || ws || !state.me) return;
    setRoom("connecting");
    ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/room`);
    ws.binaryType = "arraybuffer";
    ws.onmessage = onMessage;
    ws.onopen = () => {
      pingTimer = window.setInterval(() => send("ping"), PING_MS);
    };
    ws.onclose = () => close("connecting");
  };

  const start = async () => {
    if (state.started) return;
    state.started = true;
    if (location.protocol !== "https:" && location.protocol !== "http:") return;
    try {
      const res = await fetch("/api/me", { credentials: "same-origin", headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000) });
      if (!res.ok || !(res.headers.get("content-type") || "").startsWith("application/json")) return;
      const data = await res.json();
      if (!data || !("player" in data)) return;
      state.backend = true;
      state.me = accept(data.player);
      if (state.me) BL.contributors.addTemporary(data.character, state.me.login);
    } catch {
      return;
    }
    emit();
    connect();
  };

  // Sign-in is a full navigation through GitHub; the Worker brings the visitor back to this path.
  const login = () => {
    if (!state.backend) return;
    location.assign(`/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  };

  const logout = async () => {
    if (!state.backend || !state.me) return;
    try {
      const res = await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!res.ok) return;
    } catch {
      return;
    }
    stopped = true;
    window.clearTimeout(retryTimer);
    state.me = null;
    close("off");
  };

  // After a `replaced` or `full` kick, the visitor chooses to play here again.
  const rejoin = () => {
    if (!state.me || ws) return;
    stopped = false;
    retry = 0;
    connect();
  };

  // Where the driven Ooga is ("outside", "hq", "cave-<id>"): voice is shared within one place.
  const setZone = (name) => {
    if (name === zone) return;
    zone = state.zone = name;
    poseAt = 0; px = NaN;
    BL.voice.setPeers([]);
    sendZone();
  };

  // The hub says when it shows the island; a hidden tab stops counting until it is looked at again.
  const setHub = (on) => {
    inHub = on;
    sendHub();
  };
  // Hidden long enough, the tab leaves the room; shown again, it rejoins as a fresh connection.
  const onVisibility = () => {
    sendHub();
    window.clearTimeout(hiddenTimer);
    hiddenTimer = 0;
    if (document.hidden) {
      if (state.me && !stopped) hiddenTimer = window.setTimeout(pause, HIDDEN_PAUSE_MS);
    } else if (state.room === "paused") {
      rejoin();
    }
  };
  const pause = () => {
    hiddenTimer = 0;
    if (!document.hidden || stopped || !state.me) return;
    stopped = true;
    window.clearTimeout(retryTimer);
    close("paused");
  };
  document.addEventListener("visibilitychange", onVisibility);

  // The host's frame of Oogas, sent as bytes (a typed array view is sent as just its own bytes).
  const sendNpc = (view) => {
    if (ws && ws.readyState === WebSocket.OPEN && state.hostId === state.selfId) ws.send(view);
  };

  const setBody = (name) => {
    if (name === body) return;
    body = state.body = name;
    sendBody();
    rosterChanged();
  };

  // This page's own microphone muted or not, for every other page's roster.
  const setMuted = (on) => {
    if (on === muted) return;
    muted = on;
    sendMute();
  };

  // Throttled to POSE_MS and skipped while nothing moved, so a standing Ooga costs nothing.
  const sendPose = (x, y, z, yaw) => {
    if (state.room !== "live") return;
    const now = performance.now();
    if (now - poseAt < POSE_MS) return;
    if (Math.abs(x - px) < 0.005 && Math.abs(y - py) < 0.005 && Math.abs(z - pz) < 0.005 && Math.abs(yaw - pyaw) < 0.01) return;
    poseAt = now;
    px = x; py = y; pz = z; pyaw = yaw;
    send(`{"t":"pose","x":${x.toFixed(3)},"y":${y.toFixed(3)},"z":${z.toFixed(3)},"yaw":${yaw.toFixed(3)}}`);
  };

  const loginOf = (character) => (character.github || character.handle).toLowerCase();
  // The character whose GitHub login this is; a handle that only looks like the login does not count.
  const characterOf = (login) => {
    const character = BL.characters.get(login);
    return character && loginOf(character) === String(login).toLowerCase() ? character : null;
  };
  const ownCharacter = () => state.me && characterOf(state.me.login);

  /** null when this visitor may drive the Ooga named `name`; otherwise the words that say why not. */
  const mayDrive = (name, working) => {
    if (!state.backend) return null;
    const owner = BL.characters.get(name);
    if (!owner || owner.handle.toLowerCase() !== String(name).toLowerCase()) return null;
    const who = owner.display || owner.handle;
    if (owner.temporary && (!state.me || state.me.login.toLowerCase() !== owner.handle)) return "Sign in to drive your Ooga";
    const mine = ownCharacter();
    if (mine) return mine === owner ? null : "Contributors drive only their own Ooga";
    const ownerLogin = loginOf(owner), wanted = owner.handle.toLowerCase();
    for (const rec of remotes.values()) {
      if (rec.login.toLowerCase() === ownerLogin) return `${who} is here and drives this Ooga`;
      if (rec.body && rec.body.toLowerCase() === wanted) return `Someone is already driving ${who}`;
    }
    return working ? `${who} is working: pick a resting or sleeping Ooga` : null;
  };

  const subscribe = (fn) => {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  };
  const subscribeRoster = (fn) => {
    rosterSubscribers.add(fn);
    return () => rosterSubscribers.delete(fn);
  };

  const dispose = () => {
    document.removeEventListener("visibilitychange", onVisibility);
    stopped = true;
    window.clearTimeout(retryTimer);
    window.clearTimeout(hiddenTimer);
    subscribers.clear();
    rosterSubscribers.clear();
    close("off");
  };

  BL.net = { start, subscribe, subscribeRoster, dispose, login, logout, rejoin, setBody, setZone, setHub, setMuted, sendNpc, sendPose, mayDrive, ownCharacter, characterOf, serverNow, remotes, state, get npcFrame() { return npcFrame; } };
})();
