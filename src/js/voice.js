// Voice between signed-in players near the pile, on Cloudflare Realtime SFU, ported from the OBL-Audio
// prototype. Two peer connections, as in Cloudflare's video-room example: one publishes the microphone
// (the browser offers, the SFU answers), one receives (the SFU offers, the browser answers), so each
// negotiates in one direction only. Every SFU call goes through the Worker (`/api/voice/*`); the page
// never holds credentials or another player's session. The room says whom to hear (`setPeers`, from its
// `voice` message) and this module makes it so one change at a time, since a session's changes must be
// serialised. Each remote voice plays on its own <audio> element at one volume: the room lets a player
// hear only those in the same place (out on the island, HQ, one cave), and within it everyone is equal.
// `enable` must run inside the click that asks for the microphone; `toggle` is the footer's button.
// Who is speaking is measured here, for the roster: an analyser on the microphone and on each voice
// received, read every SPEAK_MS while voice is on (`stats.speaking` for this page, `speaking(id)` for
// others). A player muted for this page alone (`muteLocal`, by GitHub login, kept in localStorage) is still
// pulled and measured, only not played.
// Exports enable, toggle, restart, stop, setPeers, subscribe, dispose, inspect, speaking, muteLocal, mutedLocally and stats.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const ICE = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], bundlePolicy: "max-bundle" };
  const ICE_GATHER_MS = 1500, CONNECT_MS = 10000, RETRY_MS = 2000;
  // Speaking: RMS over SPEAK_ON starts it at once; SPEAK_HOLD quiet reads in a row end it, so words do not flicker.
  const SPEAK_MS = 150, SPEAK_ON = 0.02, SPEAK_HOLD = 4, SAMPLES = 1024;
  const MUTED_KEY = "oogaboogaland.voice-muted", MUTED_MAX = 512;
  const subscribers = new Set();
  const subs = new Map();
  const stats = { enabled: false, muted: false, speaking: false, joining: false, peers: 0, hearing: 0, error: "" };
  const samples = new Float32Array(SAMPLES);
  const mutedLogins = new Set();
  let mic = null, pubPc = null, subPc = null, desired = [], queue = Promise.resolve();
  let audio = null, micMeter = null, speakTimer = 0, changed = false;
  try {
    const saved = JSON.parse(localStorage.getItem(MUTED_KEY));
    if (Array.isArray(saved)) for (const login of saved.slice(0, MUTED_MAX)) if (typeof login === "string" && login.length <= 39) mutedLogins.add(login.toLowerCase());
  } catch {
    // No list, or storage is off: nobody is muted.
  }

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

  const meter = (stream) => {
    if (!audio) return null;
    const source = audio.createMediaStreamSource(stream), analyser = audio.createAnalyser();
    analyser.fftSize = SAMPLES;
    source.connect(analyser);
    return { source, analyser, quiet: 0, speaking: false };
  };

  // One read of a meter; true when its speaking flag changed.
  const listen = (m) => {
    if (!m) return false;
    m.analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < SAMPLES; i++) sum += samples[i] * samples[i];
    const loud = Math.sqrt(sum / SAMPLES) > SPEAK_ON;
    m.quiet = loud ? 0 : m.quiet + 1;
    const speaking = loud || m.speaking && m.quiet < SPEAK_HOLD;
    if (speaking === m.speaking) return false;
    m.speaking = speaking;
    return true;
  };
  const listenSub = (s) => {
    if (listen(s.meter)) changed = true;
  };
  const poll = () => {
    changed = false;
    listen(micMeter);
    subs.forEach(listenSub);
    const self = !!(micMeter && micMeter.speaking) && !stats.muted;
    if (self !== stats.speaking) {
      stats.speaking = self;
      changed = true;
    }
    if (changed) emit();
  };

  const silence = (s) => {
    s.el.pause();
    s.el.srcObject = null;
    if (s.meter) s.meter.source.disconnect();
    s.meter = null;
  };

  // Whether this page plays a remote voice: the room wants it heard and this visitor has not muted them.
  const heard = (id) => {
    if (!desired.includes(id)) return false;
    const rec = BL.net.remotes.get(id);
    return !rec || !mutedLogins.has(rec.login.toLowerCase());
  };

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
    window.clearInterval(speakTimer);
    speakTimer = 0;
    for (const s of subs.values()) silence(s);
    subs.clear();
    if (pubPc) pubPc.close();
    if (subPc) subPc.close();
    pubPc = subPc = null;
    stats.enabled = false;
    stats.speaking = false;
    stats.peers = stats.hearing = 0;
  };

  const enable = async () => {
    if (stats.enabled || stats.joining) return;
    // Made inside the Join click and kept through a restart, which has no gesture; closed in `stop`.
    if (!audio && window.AudioContext) audio = new AudioContext();
    if (audio) audio.resume().catch(() => {});
    stats.joining = true;
    stats.error = "";
    emit();
    try {
      mic = mic || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      micMeter = micMeter || meter(mic);
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
      // A restart after a reconnect keeps the visitor's mute.
      setMuted(stats.muted);
      window.clearInterval(speakTimer);
      speakTimer = window.setInterval(poll, SPEAK_MS);
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
    for (const s of subs.values()) silence(s);
    subs.clear();
    if (subPc) subPc.close();
    subPc = null;
    await api("session", { kind: "sub" });
    subPc = new RTCPeerConnection(ICE);
    subPc.addEventListener("track", (e) => {
      for (const s of subs.values()) {
        if (s.mid !== e.transceiver.mid) continue;
        s.el.srcObject = new MediaStream([e.track]);
        s.meter = meter(s.el.srcObject);
        s.el.play().catch(() => {});
      }
      countHearing();
    });
  };

  const setMuted = (on) => {
    stats.muted = on;
    if (mic) for (const t of mic.getAudioTracks()) t.enabled = !on;
    BL.net.setMuted(on);
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
    if (micMeter) micMeter.source.disconnect();
    micMeter = null;
    if (audio) audio.close().catch(() => {});
    audio = null;
    stats.muted = false;
    BL.net.setMuted(false);
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
    for (const [id, s] of subs) s.el.muted = !heard(id);
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
      silence(s);
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
        el.muted = !heard(t.id);
        subs.set(t.id, { mid: t.mid, el, meter: null });
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

  // Whether a voice this page receives is speaking now; false for anyone not received.
  const speaking = (id) => {
    const s = subs.get(id);
    return !!(s && s.meter && s.meter.speaking);
  };

  // Silences one player for this visitor alone, on every visit, until unmuted.
  const muteLocal = (login, on) => {
    const key = String(login).toLowerCase();
    if (on === mutedLogins.has(key)) return;
    if (on) {
      if (mutedLogins.size >= MUTED_MAX) return;
      mutedLogins.add(key);
    } else {
      mutedLogins.delete(key);
    }
    try {
      localStorage.setItem(MUTED_KEY, JSON.stringify([...mutedLogins]));
    } catch {
      // Storage off: the mute lasts this page.
    }
    for (const [id, s] of subs) s.el.muted = !heard(id);
    emit();
  };
  const mutedLocally = (login) => mutedLogins.has(String(login).toLowerCase());

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

  BL.voice = { enable, toggle, restart, stop, setPeers, subscribe, dispose, inspect, speaking, muteLocal, mutedLocally, stats };
})();
