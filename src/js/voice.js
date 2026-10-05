// Voice between signed-in players near the pile, on Cloudflare Realtime SFU, ported from the OBL-Audio
// prototype. Two peer connections, as in Cloudflare's video-room example: one publishes the microphone
// (the browser offers, the SFU answers), one receives (the SFU offers, the browser answers), so each
// negotiates in one direction only. Every SFU call goes through the Worker (`/api/voice/*`); the page
// never holds credentials or another player's session. The room says whom to hear (`setPeers`, from its
// `voice` message) and this module makes it so one change at a time, since a session's changes must be
// serialised. Each remote voice plays on its own <audio> element at one volume: the room lets a player
// hear only those in the same place (out on the island, HQ, one cave), and within it everyone is equal.
// `enable` must run inside the click that asks for the microphone; `toggle` is the footer's button.
// Exports enable, toggle, restart, stop, setPeers, subscribe, dispose, inspect and stats.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const ICE = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], bundlePolicy: "max-bundle" };
  const ICE_GATHER_MS = 1500, CONNECT_MS = 10000, RETRY_MS = 2000;
  const subscribers = new Set();
  const subs = new Map();
  const stats = { enabled: false, muted: false, joining: false, peers: 0, hearing: 0, error: "" };
  let mic = null, pubPc = null, subPc = null, desired = [], queue = Promise.resolve();

  const emit = () => {
    for (const fn of subscribers) fn(stats);
  };

  const gathered = (pc) => new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const done = () => {
      window.clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = window.setTimeout(done, ICE_GATHER_MS);
    pc.addEventListener("icegatheringstatechange", onChange);
  });

  // Pulling a publication before its connection is up fails, so the mic is announced only once connected.
  const connected = (pc) => new Promise((resolve, reject) => {
    if (pc.connectionState === "connected") return resolve();
    const done = (ok) => {
      window.clearTimeout(timer);
      pc.removeEventListener("connectionstatechange", onChange);
      if (ok) resolve();
      else reject(new Error("voice connection failed"));
    };
    const onChange = () => {
      if (pc.connectionState === "connected") done(true);
      else if (pc.connectionState === "failed" || pc.connectionState === "closed") done(false);
    };
    const timer = window.setTimeout(() => done(false), CONNECT_MS);
    pc.addEventListener("connectionstatechange", onChange);
  });

  const api = async (op, body) => {
    const res = await fetch(`/api/voice/${op}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `voice ${op} ${res.status}`);
    return data;
  };

  const teardown = () => {
    window.clearTimeout(retryTimer);
    for (const s of subs.values()) {
      s.el.pause();
      s.el.srcObject = null;
    }
    subs.clear();
    if (pubPc) pubPc.close();
    if (subPc) subPc.close();
    pubPc = subPc = null;
    stats.enabled = false;
    stats.peers = stats.hearing = 0;
  };

  const enable = async () => {
    if (stats.enabled || stats.joining) return;
    stats.joining = true;
    stats.error = "";
    emit();
    try {
      mic = mic || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      await api("session", { kind: "pub" });
      pubPc = new RTCPeerConnection(ICE);
      const tx = pubPc.addTransceiver(mic.getAudioTracks()[0], { direction: "sendonly" });
      await pubPc.setLocalDescription(await pubPc.createOffer());
      await gathered(pubPc);
      const pub = await api("publish", { sdp: pubPc.localDescription.sdp, mid: tx.mid });
      await pubPc.setRemoteDescription(pub.sessionDescription);
      await connected(pubPc);
      await api("live");
      await openReceiver();
      stats.enabled = true;
      setMuted(false);
      schedule();
    } catch (err) {
      stats.error = err.name === "NotAllowedError" ? "microphone blocked" : "voice unavailable";
      teardown();
    }
    stats.joining = false;
    emit();
  };

  // The receiving side: a fresh session and connection, every remote voice pulled into it anew. Also the
  // recovery when the SFU refuses a pull on a receive session it calls disconnected.
  const openReceiver = async () => {
    for (const s of subs.values()) {
      s.el.pause();
      s.el.srcObject = null;
    }
    subs.clear();
    if (subPc) subPc.close();
    subPc = null;
    await api("session", { kind: "sub" });
    subPc = new RTCPeerConnection(ICE);
    subPc.addEventListener("track", (e) => {
      for (const s of subs.values()) {
        if (s.mid !== e.transceiver.mid) continue;
        s.el.srcObject = new MediaStream([e.track]);
        s.el.play().catch(() => {});
      }
      countHearing();
    });
  };

  const setMuted = (on) => {
    stats.muted = on;
    if (mic) for (const t of mic.getAudioTracks()) t.enabled = !on;
    emit();
  };

  // The footer's button: join, then mute and unmute.
  const toggle = () => {
    if (!stats.enabled) enable();
    else setMuted(!stats.muted);
  };

  // Leaving voice for good (sign-out, another tab took over): the microphone is released too.
  const stop = () => {
    const was = stats.enabled;
    teardown();
    if (mic) for (const t of mic.getTracks()) t.stop();
    mic = null;
    desired = [];
    if (was) api("leave").catch(() => {});
    emit();
  };

  // After a reconnect the room has forgotten this page's sessions: start over, keeping the microphone.
  const restart = async () => {
    if (!stats.enabled) return;
    teardown();
    await api("leave").catch(() => {});
    await enable();
  };

  const setPeers = (ids) => {
    desired = ids.slice();
    for (const [id, s] of subs) s.el.muted = !desired.includes(id);
    schedule();
  };

  // A failed change is tried once more after RETRY_MS on a fresh receive session (the SFU can call a new
  // one disconnected) before the button says voice is unavailable; the room's next change tries again.
  let retried = false, retryTimer = 0;
  const schedule = () => {
    queue = queue.then(apply).then(() => {
      retried = false;
      if (!stats.error) return;
      stats.error = "";
      emit();
    }, () => {
      if (!stats.enabled) return;
      if (!retried) {
        retried = true;
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          queue = queue.then(openReceiver).catch(() => {});
          schedule();
        }, RETRY_MS);
        return;
      }
      stats.error = "voice unavailable";
      emit();
    });
  };

  // Close whom the room no longer wants heard, pull whom it newly does, renegotiate when the SFU asks.
  const apply = async () => {
    if (!stats.enabled || !subPc) return;
    const want = new Set(desired);
    const mids = [];
    for (const [id, s] of subs) {
      if (want.has(id)) continue;
      s.el.pause();
      s.el.srcObject = null;
      const tx = subPc.getTransceivers().find((t) => t.mid === s.mid);
      try {
        if (tx) tx.stop();
      } catch {
        // Already stopped.
      }
      mids.push(s.mid);
      subs.delete(id);
    }
    if (mids.length) await api("close", { mids });
    const add = desired.filter((id) => !subs.has(id));
    if (add.length) {
      const res = await api("pull", { ids: add });
      for (const t of res.tracks) {
        if (t.errorCode || t.id === null) continue;
        const el = new Audio();
        el.autoplay = true;
        el.muted = !desired.includes(t.id);
        subs.set(t.id, { mid: t.mid, el });
      }
      if (res.requiresImmediateRenegotiation && res.sessionDescription) {
        await subPc.setRemoteDescription(res.sessionDescription);
        await subPc.setLocalDescription(await subPc.createAnswer());
        await gathered(subPc);
        await api("renegotiate", { sdp: subPc.localDescription.sdp });
      }
    }
    if (stats.peers !== subs.size) {
      stats.peers = subs.size;
      emit();
    }
    countHearing();
  };

  // How many remote voices have media arriving: pulled is not heard until the track lands.
  const countHearing = () => {
    let n = 0;
    for (const s of subs.values()) if (s.el.srcObject) n++;
    if (n === stats.hearing) return;
    stats.hearing = n;
    emit();
  };

  const subscribe = (fn) => {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  };

  const dispose = () => {
    stop();
    subscribers.clear();
  };

  // For the feed panel and debugging: whom the room wants heard, whom this page pulled, and both connections.
  const inspect = () => ({ desired: desired.slice(), pulled: [...subs.keys()], publish: pubPc ? pubPc.connectionState : "none", receive: subPc ? subPc.connectionState : "none" });

  BL.voice = { enable, toggle, restart, stop, setPeers, subscribe, dispose, inspect, stats };
})();
