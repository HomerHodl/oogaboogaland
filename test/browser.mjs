// Minimal headless-Chrome driver over the DevTools protocol.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// driverError means the check could not run, not that it failed; the runner retries those once.
export const driverError = (message) => Object.assign(new Error(message), { driver: true });
const COMMAND_MS = 90000;
// PROBE_MS 2000: a pooled Chrome is probed before reuse so a wedged one is replaced in seconds, not 90 s.
const PROBE_MS = 2000;
// SETUP_MS 10000: fresh Chrome answers setup in ms; no reply in 10 s means wedged (seen as 90 s lane stalls),
// so the runner retries the session on a new Chrome.
const SETUP_MS = 10000;
// Each idle Chrome holds a WebGL context and a few hundred MB, so the pool keeps only a lane's worth.
const MAX_IDLE = Number(process.env.POOL_IDLE) || 6;

// Flags every launch gets; the tail only removes Chrome's first-run work and touches neither rendering nor
// timing.
const BASE_FLAGS = [
  "--headless=new",
  "--hide-scrollbars",
  "--mute-audio",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--enable-precise-memory-info",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-search-engine-choice-screen",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-client-side-phishing-detection",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--disable-breakpad",
  "--metrics-recording-only",
  "--no-pings",
  "--password-store=basic",
  "--use-mock-keychain"
];
// Speed mode (default) vsync-locks the page at 60 fps; unlocking the compositor measured 418 fps, a 7x suite
// speedup. launch({ perf: true }) drops both flags so frame-rate blocks assert a real ~60 fps floor.
const SPEED_FLAGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit"];

// Chrome may still hold profile files after unlink (EACCES/ENOTEMPTY on macOS); cleanup is best effort and
// must never fail a run.
const removeProfile = (profile, attempt = 0) => {
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    if (attempt === 4) return;
    setTimeout(() => removeProfile(profile, attempt + 1), 250 * (attempt + 1)).unref();
  }
};

// Pool bookkeeping lives outside the browser object so the public surface stays unchanged.
const internals = new WeakMap();
const live = new Set();
const idle = [];
const keyOf = ({ w = 1440, h = 900, mobile = false, perf = false, motion = false } = {}) => `${w}x${h}:${mobile ? "mobile" : "desktop"}:${perf ? "perf" : "fast"}:${motion ? "motion" : "still"}`;

export const launch = async ({ w = 1440, h = 900, mobile = false, perf = false, motion = false } = {}) => {
  // Fresh profile per launch, so storage never leaks between runs.
  const profile = mkdtempSync(join(tmpdir(), "ooga-test-"));
  // Chrome picks a free port and writes it into the profile, so concurrent launches never collide.
  const args = [
    ...BASE_FLAGS,
    `--window-size=${w},${h}`,
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    ...(perf ? [] : SPEED_FLAGS),
    "about:blank"
  ];
  const chrome = spawn(CHROME, args, { stdio: "ignore" });
  const state = { alive: true, pooled: false, key: keyOf({ w, h, mobile, perf, motion }) };
  chrome.on("exit", () => {
    state.alive = false;
  });
  const logs = [];
  let targets = null;
  for (let i = 0; i < 500 && !targets; i++) {
    await sleep(20);
    try {
      const port = parseInt(readFileSync(join(profile, "DevToolsActivePort"), "utf8"), 10);
      if (port) targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      targets = null;
    }
  }
  if (!targets) {
    chrome.kill("SIGKILL");
    removeProfile(profile);
    throw driverError(`Chrome did not start at ${CHROME}`);
  }
  const page = targets.find((t) => t.type === "page");
  // Chrome can refuse or drop the first socket while starting: retry, and never wait on a failed socket.
  // CONNECT_MS bounds every attempt; an unbounded one once sat 26 minutes as the run's critical path.
  const CONNECT_MS = 5000;
  const connect = () => new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
      }
      reject(driverError("DevTools socket did not open"));
    }, CONNECT_MS);
    const settle = (fn, value) => {
      clearTimeout(timer);
      fn(value);
    };
    socket.onopen = () => settle(resolve, socket);
    socket.onerror = () => settle(reject, driverError("DevTools socket failed"));
    socket.onclose = () => settle(reject, driverError("DevTools socket closed before opening"));
  });
  let ws = null;
  for (let attempt = 0; !ws; attempt++) {
    try {
      ws = await connect();
    } catch (err) {
      if (attempt === 4) {
        chrome.kill("SIGKILL");
        removeProfile(profile);
        throw err;
      }
      await sleep(250);
    }
  }
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const reply = pending.get(m.id);
      pending.delete(m.id);
      reply.ok(m);
      return;
    }
    listeners.get(m.method)?.(m.params);
    if (m.method === "Runtime.consoleAPICalled") logs.push(`[console.${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
    if (m.method === "Runtime.exceptionThrown") {
      const detail = m.params.exceptionDetails;
      const frames = detail.stackTrace?.callFrames.map(f => `${f.functionName || "anonymous"} (${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1})`).join(" <- ") || "";
      logs.push(`[exception] ${detail.text} ${detail.exception?.description ?? ""} ${frames}`);
    }
    if (m.method === "Log.entryAdded") logs.push(`[log.${m.params.entry.level}] ${m.params.entry.text}`);
  };
  // A crashed Chrome takes its socket with it: fail waiting commands on close instead of at the timeout.
  ws.onclose = () => {
    state.alive = false;
    for (const reply of pending.values()) reply.fail(driverError("DevTools socket closed: Chrome is gone"));
    pending.clear();
  };
  // A reply that never comes (DevTools channel can die silently) fails the case instead of freezing the run.
  const send = (method, params = {}, timeoutMs = COMMAND_MS) => new Promise((resolve, reject) => {
    if (!state.alive) return reject(driverError(`${method} cannot run: Chrome is gone`));
    const i = ++id;
    const timer = setTimeout(() => {
      pending.delete(i);
      reject(driverError(`${method} got no reply in ${timeoutMs / 1000} s: Chrome hung`));
    }, timeoutMs);
    pending.set(i, {
      ok: (m) => {
        clearTimeout(timer);
        resolve(m);
      },
      fail: (err) => {
        clearTimeout(timer);
        reject(err);
      }
    });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  // Raw protocol events; pass null to stop listening.
  const on = (method, fn) => listeners.set(method, fn);
  // The only overrides the driver owns, so a pooled reset restores exactly what a fresh launch has.
  const applyOverrides = async () => {
    if (!mobile) return;
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  };
  // Reduced motion cuts the 0.9 s leaf curtain untilReady waits on (937 ms of a 2955 ms hub boot) to 0.2 s;
  // it also drops toast, hint and meter-fill transitions, so checks on those pass { motion: true }.
  const applyMedia = async () => {
    if (motion) return;
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  };
  try {
    await send("Runtime.enable", {}, SETUP_MS);
    await send("Log.enable", {}, SETUP_MS);
    await send("Page.enable", {}, SETUP_MS);
    await applyOverrides();
    await applyMedia();
  } catch (err) {
    // This Chrome is not in `live` yet, so nothing else would ever reap it.
    state.alive = false;
    ws.close();
    chrome.kill("SIGKILL");
    removeProfile(profile);
    throw err;
  }
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
  const drag = async (from, to, steps = 12) => {
    await mouse("mouseMoved", from.x, from.y, { button: "none" });
    await mouse("mousePressed", from.x, from.y, { buttons: 1 });
    for (let i = 1; i <= steps; i++) {
      await mouse("mouseMoved", from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps, { buttons: 1 });
      await sleep(30);
    }
    await mouse("mouseReleased", to.x, to.y);
  };
  const click = async (x, y) => {
    await mouse("mouseMoved", x, y, { button: "none" });
    // Queue both physical events on time, even while the page is painting a slow frame.
    const pressed = mouse("mousePressed", x, y, { buttons: 1, timestamp: Date.now() / 1000 });
    await sleep(40);
    const released = mouse("mouseReleased", x, y, { timestamp: Date.now() / 1000 });
    await Promise.all([pressed, released]);
  };
  const key = async (k, modifiers = 0) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, text: k.length === 1 ? k : undefined, modifiers });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, modifiers });
  };
  const focus = (enabled) => send("Emulation.setFocusEmulationEnabled", { enabled });
  const screenshot = async (path) => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(shot.result.data, "base64"));
  };
  const open = async (url) => {
    await send("Page.navigate", { url });
    await send("Page.bringToFront");
  };
  const destroy = (now = false) => {
    state.alive = false;
    live.delete(entry);
    try {
      ws.close();
    } catch {
    }
    // A wedged Chrome ignores SIGTERM and a survivor steals CPU from later tasks: one leak made a frame-rate
    // lane read 20 fps.
    chrome.kill();
    chrome.kill("SIGKILL");
    if (now) removeProfile(profile);
    else setTimeout(() => removeProfile(profile), 500).unref();
  };
  // reset() must undo everything a task leaves behind: leaked focus emulation silently throttles the next task
  // to 30 fps and leaked device metrics render it at the wrong viewport.
  const reset = async () => {
    // Storage first, while the task's own document and its file:// origin are still loaded.
    await evaluate("(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} })()").catch(() => {});
    await send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
    await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await send("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => {});
    await send("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {});
    await send("HeapProfiler.disable").catch(() => {});
    // about:blank drops the old page's timers, animation loop and WebGL context, so an idle Chrome costs nothing
    // and no leftover frame callback can touch the next task.
    await send("Page.navigate", { url: "about:blank" });
    for (let i = 0; i < 40; i++) {
      if (await evaluate("location.href === 'about:blank' && document.readyState === 'complete'").catch(() => false)) break;
      await sleep(25);
    }
    // Clear log buffers last: late console and log events from the old document have landed by now.
    await send("Log.clear").catch(() => {});
    await send("Runtime.discardConsoleEntries").catch(() => {});
    await applyOverrides();
    await applyMedia();
    listeners.clear();
    logs.length = 0; // Clear in place: the runner holds this same array.
  };
  const close = (force = false) => {
    if (state.pooled && !force) release(api);
    else destroy();
  };
  const api = { send, on, evaluate, mouse, drag, click, key, focus, screenshot, open, close, sleep, logs };
  const entry = { api, state, reset, destroy, resetting: null };
  internals.set(api, entry);
  live.add(entry);
  return api;
};

// A pooled Chrome must look unused: reset() cleared storage, console buffers and overrides and the page is on
// about:blank; only tasks of the same shape (size, mobile, perf) ever reuse it.
const usable = async (entry) => {
  try {
    await entry.resetting;
    if (!entry.state.alive) return false;
    const r = await entry.api.send("Runtime.evaluate", { expression: "1", returnByValue: true }, PROBE_MS);
    return r.result?.result?.value === 1;
  } catch {
    return false;
  }
};

// One Chrome per launch shape, handed task to task, so a lane pays the 0.8 s launch once; same surface as
// launch(), and close() releases it back to the pool.
export const acquire = async (opts = {}) => {
  const key = keyOf(opts);
  for (let i = idle.length - 1; i >= 0; i--) {
    // Another lane can evict while this loop awaits, so re-check the slot every iteration.
    if (!idle[i] || idle[i].state.key !== key) continue;
    // Spliced out of the pool synchronously, so two lanes can never claim the same Chrome.
    const entry = idle.splice(i, 1)[0];
    if (await usable(entry)) {
      entry.resetting = null;
      return entry.api;
    }
    entry.destroy();
  }
  const api = await launch(opts);
  internals.get(api).state.pooled = true;
  return api;
};

export const release = (browser) => {
  const entry = internals.get(browser);
  if (!entry) return;
  if (!entry.state.pooled || !entry.state.alive) return entry.destroy();
  // The runner does not await close(), so the reset runs on its own and acquire() waits on entry.resetting.
  entry.resetting = entry.reset().catch(() => {
    entry.state.alive = false;
  });
  idle.push(entry);
  while (idle.length > MAX_IDLE) idle.shift().destroy();
};

export const dispose = async () => {
  for (const entry of idle.splice(0)) entry.destroy();
};
export const closeAll = dispose;

// process.exit() does not reap spawned children: kill survivors here, removing profiles synchronously since
// deferred timers never run during exit.
process.once("exit", () => {
  idle.length = 0;
  for (const entry of [...live]) entry.destroy(true);
});
