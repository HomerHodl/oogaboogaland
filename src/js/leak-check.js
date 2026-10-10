// The Leak Check kiosk's board: what the visitor's own browser tells any page that asks, read when the board opens
// and shown in Ooga-speak through the shared board dialog (`hud.openBoard`). The findings are grouped into chapters,
// one page each: the screen shows a chapter's table (label on the left, value on the right, in the jumbotron's 5x7
// font) and the note under it says each finding in full. Nothing is stored or sent: every value stays in this module's
// `seen` until the next open, and the page makes no request.
//
// The chapters run from who you are through your screen, machine, gear and prints, the add-ons that show themselves,
// your trail and choices, three hands-on demos, Ooga's verdict (one name made of every clue and a leak meter of what
// the browser told), what this site itself calls and keeps, how to leak less, and the leaks the site's rules keep the
// kiosk from showing. Some answers come back as promises or after a short wait; a row shows "..." until its answer
// lands, and an answer from an earlier opening is dropped.
//
// The demos share one `panel`, `#leak-try` in the board dialog: hidden autofill (a name box the visitor sees and
// address boxes kept off screen; the board counts which the browser filled and how many letters, never the text),
// typing rhythm (how long keys are held and the gaps between them, never which keys) and mouse rhythm (the pointer's
// sample rate, speed and turning). All of it is emptied on Forget, `onClose` and `dispose`. Wallets are only seen,
// never called: nothing here asks one to connect.
//
// `create(panel)` returns the board, plus `open()` (read and draw), `onClose()` and `dispose()`. The GPU is asked
// through one throwaway WebGL context once a page, since every context counts against the browser's limit.
(() => {
  "use strict";
  const BL = window.BL;
  const W = 160, H = 80, BG = "#0f110f", DIM = "#9b8f7a", INK = "#7ff5e6", WAIT = "...", HIDDEN_VALUE = "HIDDEN";
  const text = BL.jumbotron.text;
  const HIDDEN = { email: "email", tel: "phone", street: "street", postal: "postcode", org: "workplace" };
  const BROWSERS = [["Edg/", "Edge"], ["OPR/", "Opera"], ["Firefox/", "Firefox"], ["FxiOS/", "Firefox"], ["CriOS/", "Chrome"], ["Chrome/", "Chrome"], ["Version/", "Safari"]];
  // Fonts that say something: what each system ships, what office, design and coding apps add, and language packs.
  const FONTS = [
    "Segoe UI", "Calibri", "Cambria", "Consolas", "Candara", "Constantia", "Corbel", "Bahnschrift", "Ink Free", "Gabriola",
    "Segoe Print", "Segoe Script", "Sylfaen", "Franklin Gothic Medium", "Leelawadee UI", "Javanese Text", "Malgun Gothic",
    "Microsoft YaHei", "MS Gothic", "Yu Gothic", "Helvetica Neue", "Avenir", "Menlo", "Monaco", "Futura", "Gill Sans",
    "Optima", "Baskerville", "Didot", "Hoefler Text", "Apple Chancery", "Marker Felt", "PingFang SC", "Hiragino Sans",
    "DejaVu Sans", "Liberation Sans", "Ubuntu", "Cantarell", "Noto Sans", "Droid Sans", "Arial Narrow", "Century Gothic",
    "Garamond", "Book Antiqua", "Bookman Old Style", "Lucida Bright", "Myriad Pro", "Minion Pro", "Source Code Pro",
    "Fira Code", "JetBrains Mono", "Cascadia Code", "Roboto", "Open Sans", "Lato", "Montserrat", "Comic Sans MS", "Impact"
  ];
  const PERMISSIONS = [["geolocation", "location"], ["notifications", "notifications"], ["camera", "camera"], ["microphone", "microphone"],
    ["clipboard-read", "clipboard reading"], ["persistent-storage", "keeping storage"], ["midi", "MIDI music gear"]];
  const STATES = { granted: "yes", denied: "no", prompt: "not asked yet" };
  const PREFS = [["dark mode", "(prefers-color-scheme: dark)"], ["less motion", "(prefers-reduced-motion: reduce)"],
    ["more contrast", "(prefers-contrast: more)"], ["less contrast", "(prefers-contrast: less)"], ["forced colours", "(forced-colors: active)"],
    ["wide colour (P3)", "(color-gamut: p3)"], ["HDR", "(dynamic-range: high)"], ["inverted colours", "(inverted-colors: inverted)"],
    ["less transparency", "(prefers-reduced-transparency: reduce)"], ["less data", "(prefers-reduced-data: reduce)"],
    ["no hover (touch first)", "(hover: none)"], ["monochrome", "(monochrome)"]];
  // Wallets that put themselves on every page so sites can offer to connect. Only their presence is read.
  const WALLETS = [["alby", "Alby"], ["webln", "a Lightning wallet (WebLN)"], ["nostr", "a Nostr signer (NIP-07)"], ["unisat", "UniSat"],
    ["XverseProviders", "Xverse"], ["LeatherProvider", "Leather"], ["okxwallet", "OKX Wallet"], ["phantom", "Phantom"], ["magicEden", "Magic Eden"]];
  const ETHEREUM = [["isMetaMask", "MetaMask"], ["isCoinbaseWallet", "Coinbase Wallet"], ["isBraveWallet", "Brave Wallet"], ["isRabby", "Rabby"], ["isTrust", "Trust Wallet"]];
  const DEVTOOLS = [["__REACT_DEVTOOLS_GLOBAL_HOOK__", "React DevTools"], ["__VUE_DEVTOOLS_GLOBAL_HOOK__", "Vue DevTools"], ["__REDUX_DEVTOOLS_EXTENSION__", "Redux DevTools"]];
  // Marks helper add-ons leave in the page: the add-on, then what gives it away.
  const MARKS = [
    ["Dark Reader", 'meta[name="darkreader"], style.darkreader, html[data-darkreader-mode], html[data-darkreader-scheme]'],
    ["Grammarly", "body[data-gr-ext-installed], body[data-new-gr-c-s-check-loaded], grammarly-desktop-integration, grammarly-extension, [data-gramm]"],
    ["1Password", "com-1password-button, com-1password-menu, [data-com-onepassword-filled]"],
    ["LastPass", "[data-lastpass-icon-root], [data-lastpass-root], [data-lastpass-infield]"],
    ["Dashlane", "[data-dashlane-rid], [data-dashlanecreated]"],
    ["Google Translate", "html.translated-ltr, html.translated-rtl"]
  ];
  // Questions a browser may refuse, for the leak meter: told when the answer is real, null while still asking.
  const METER = [
    ["exact build", (s) => s.hints], ["CPU cores", (s) => s.cores > 0], ["memory", (s) => s.memory > 0], ["graphics card", (s) => !!s.gpu.name],
    ["graphics detail", (s) => !!s.gpu.hash], ["keyboard layout", (s) => s.layout === null ? null : !!(s.layout && s.layout.name)],
    ["cameras and mics", (s) => s.devices], ["permissions", (s) => s.permissions], ["storage size", (s) => s.storage], ["network", (s) => !!s.net],
    ["battery", (s) => s.battery], ["a true canvas", (s) => !s.canvasNoise], ["audio print", (s) => s.audio], ["fonts", (s) => s.fonts.length > 0],
    ["voices", (s) => s.voices === null ? null : !!(s.voices && s.voices.length)], ["a true time zone", (s) => !s.shield]
  ];
  const hex = (hash) => (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
  const hashBytes = (bytes) => {
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
    return hex(hash);
  };
  const hashText = (words) => hex(BL.math.fnv1a(words));
  // An API call as a promise, so a throw and a rejection both land in the same place.
  const ask = (fn) => new Promise((resolve) => resolve(fn()));
  const osOf = (ua) => /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /CrOS/.test(ua) ? "ChromeOS" : /Macintosh|Mac OS X/.test(ua) ? (navigator.maxTouchPoints > 1 ? "iPadOS" : "macOS")
    : /Linux/.test(ua) ? "Linux" : "a mystery rock";
  const browserOf = (ua) => {
    for (const [mark, name] of BROWSERS) {
      const at = ua.indexOf(mark);
      if (at >= 0) return `${name} ${parseInt(ua.slice(at + mark.length), 10) || ""}`.trim();
    }
    return "a mystery browser";
  };
  // The engine the browser really runs, from features no user agent string can change.
  const engineOf = () => CSS.supports("-moz-appearance", "none") ? "Gecko" : window.chrome ? "Blink" : "WebKit";
  const claimedEngineOf = (os, browser) => os === "iOS" || os === "iPadOS" || /^Safari/.test(browser) ? "WebKit" : /^Firefox/.test(browser) ? "Gecko" : /^(Chrome|Edge|Opera)/.test(browser) ? "Blink" : "";
  const PLATFORMS = { Windows: /^Win/, macOS: /^Mac/, iPadOS: /^(Mac|iPad)/, iOS: /^iP/, Android: /Linux|Android|^$/, Linux: /Linux/, ChromeOS: /CrOS|Linux/ };
  let gpu = null;
  const readGpu = () => {
    if (gpu !== null) return gpu;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext("webgl");
    if (!gl) return gpu = { name: "", extensions: 0, maxTexture: 0, precision: 0, hash: "" };
    // Chrome masks RENDERER and answers on the debug extension; Firefox answers RENDERER and warns on the extension.
    let name = gl.getParameter(gl.RENDERER);
    if (!name || /^WebKit/.test(name)) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      if (info) name = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    }
    const extensions = gl.getSupportedExtensions() || [], high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    const limits = [gl.MAX_TEXTURE_SIZE, gl.MAX_RENDERBUFFER_SIZE, gl.MAX_VERTEX_ATTRIBS, gl.MAX_VERTEX_UNIFORM_VECTORS,
      gl.MAX_FRAGMENT_UNIFORM_VECTORS, gl.MAX_VARYING_VECTORS, gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS].map((p) => gl.getParameter(p));
    const answers = [name, extensions.join(","), limits.join(","), Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)).join("x"),
      Array.from(gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE)).join("-"), high ? `${high.rangeMin},${high.rangeMax},${high.precision}` : ""];
    return gpu = { name: String(name || ""), extensions: extensions.length, maxTexture: limits[0], precision: high ? high.precision : 0, hash: hashText(answers.join("|")) };
  };
  // "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "NVIDIA GeForce RTX 4070".
  const shortGpu = (name) => {
    const angle = /^ANGLE \((.*)\)$/.exec(name);
    return (angle ? angle[1].split(", ")[1] || angle[1] : name).replace(/^ANGLE Metal Renderer: /, "")
      .replace(/\s*\(0x[0-9a-f]+\)/i, "").replace(/\s+(Direct3D|vs_\d|OpenGL ES|OpenGL).*$/, "").trim();
  };
  // The same picture painted on every visit; the browser's fonts, smoothing and GPU decide its exact pixels.
  const canvasPrint = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 60;
    const c2 = canvas.getContext("2d", { willReadFrequently: true });
    c2.textBaseline = "top";
    c2.fillStyle = "#f60";
    c2.fillRect(100, 1, 62, 20);
    c2.font = "16px Arial";
    c2.fillStyle = "#069";
    c2.fillText("Ooga Booga \u{1F34C} <leak>", 2, 15);
    c2.font = "18px serif";
    c2.fillStyle = "rgba(102, 204, 0, 0.7)";
    c2.fillText("Ooga Booga \u{1F34C} <leak>", 4, 37);
    c2.strokeStyle = "#c08cff";
    c2.beginPath();
    c2.arc(210, 30, 20, 0, Math.PI * 2);
    c2.stroke();
    return hashBytes(c2.getImageData(0, 0, canvas.width, canvas.height).data);
  };
  // One flat colour painted and read back: any pixel off it means something adds noise to canvas reads on purpose.
  const canvasNoise = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const c2 = canvas.getContext("2d", { willReadFrequently: true });
    c2.fillStyle = "rgb(10, 20, 30)";
    c2.fillRect(0, 0, 8, 8);
    const px = c2.getImageData(0, 0, 8, 8).data;
    for (let i = 0; i < px.length; i += 4) if (px[i] !== 10 || px[i + 1] !== 20 || px[i + 2] !== 30 || px[i + 3] !== 255) return true;
    return false;
  };
  // A tone rendered offline through a compressor, never played: the audio stack's rounding decides its samples.
  const audioPrint = () => ask(() => {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) return "";
    const audio = new Offline(1, 5000, 44100), tone = audio.createOscillator(), squeeze = audio.createDynamicsCompressor();
    tone.type = "triangle";
    tone.frequency.value = 10000;
    squeeze.threshold.value = -50;
    squeeze.knee.value = 40;
    squeeze.ratio.value = 12;
    squeeze.attack.value = 0;
    squeeze.release.value = 0.25;
    tone.connect(squeeze);
    squeeze.connect(audio.destination);
    tone.start(0);
    return audio.startRendering().then((buffer) => hashBytes(new Uint8Array(buffer.getChannelData(0).buffer)));
  });
  // A font is there when text set in it measures differently from every generic family it would fall back to.
  const readFonts = () => {
    const c2 = document.createElement("canvas").getContext("2d"), sample = "mmmmmmmmmmlli1WOQ@#", bases = ["monospace", "sans-serif", "serif"];
    const width = (family) => {
      c2.font = `72px ${family}`;
      return c2.measureText(sample).width;
    };
    const plain = bases.map(width);
    return FONTS.filter((font) => bases.some((base, i) => width(`"${font}", ${base}`) !== plain[i]));
  };
  const layoutOf = (map) => {
    const q = map.get("KeyQ"), w = map.get("KeyW"), e = map.get("KeyE"), r = map.get("KeyR"), y = map.get("KeyY");
    if (!q) return { name: "", keys: "" };
    const keys = `${q}${w || ""}${e || ""}${r || ""}${map.get("KeyT") || ""}${y || ""}`;
    const name = q === "a" && w === "z" ? "AZERTY" : q === "'" ? "Dvorak" : y === "z" ? "QWERTZ" : e === "f" && r === "p" ? "Colemak"
      : q === "q" && w === "w" ? "QWERTY" : /[Ѐ-ӿ]/.test(q) ? "Cyrillic" : /[Ͱ-Ͽ]/.test(q) ? "Greek" : "unusual";
    return { name, keys };
  };
  // Wallets on the page right now, from their own announcements. Reading a flag never asks a wallet anything.
  const walletsOf = () => {
    const found = [];
    for (const [key, name] of WALLETS) if (window[key] !== undefined && window[key] !== null) found.push(name);
    const eth = window.ethereum;
    if (eth) {
      const named = ETHEREUM.filter(([flag]) => eth[flag] === true).map(([, name]) => name);
      found.push(...(named.length ? named : ["an Ethereum wallet"]));
    }
    if (window.solana && !window.phantom) found.push("a Solana wallet");
    return found;
  };
  const marksOf = () => {
    const found = MARKS.filter(([, marks]) => document.querySelector(marks)).map(([name]) => name);
    for (const [key, name] of DEVTOOLS) if (window[key]) found.push(name);
    // Elements with dashed names are custom ones; this page defines none, so each is something an add-on put here.
    const strange = new Set();
    for (const el of document.body.querySelectorAll("*")) {
      const tag = el.localName;
      if (tag.includes("-") && !tag.startsWith("com-1password") && !tag.startsWith("grammarly")) strange.add(tag);
    }
    return { found, strange: [...strange] };
  };
  const windowsOf = (version) => {
    const major = parseInt(version, 10);
    return major >= 13 ? "11" : major > 0 ? "10" : "7 or 8";
  };
  const utcOf = (minutes) => {
    const a = Math.abs(minutes);
    return `UTC${minutes < 0 ? "-" : "+"}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
  };
  const bytesOf = (n) => n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const listOf = (items) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  // A row's value, or "..." while the answer is still on its way and HIDDEN when the browser keeps it to itself.
  const or = (answer, value) => answer === null ? WAIT : !answer ? HIDDEN_VALUE : value(answer);
  const NOT_YET = "Ooga still asking. Answer come in a blink.";
  // A chapter's table: the title centred at the top, then each row's label on the left and value on the right. A value
  // too long for its row carries on, right-aligned, on the rows under it rather than being cut.
  const table = (c2, title, rows) => {
    text.drawText(c2, title, Math.round((W - text.measureText(title, 1)) / 2), 2, DIM, 1);
    c2.fillStyle = "#2a2724";
    c2.fillRect(2, 11, W - 4, 1);
    const full = Math.floor((W - 2) / 6);
    let y = 14;
    for (const [label, raw] of rows) {
      if (y > H - 7) break;
      text.drawText(c2, label, 2, y, DIM, 1);
      let rest = String(raw).toUpperCase(), room = Math.floor((W - 6 - text.measureText(label, 1)) / 6) - 1;
      while (rest.length && y <= H - 7) {
        let cut = rest.length <= room ? rest.length : rest.lastIndexOf(" ", room);
        if (cut <= 0) cut = Math.min(room, rest.length);
        const line = rest.slice(0, cut);
        text.drawText(c2, line, W - 2 - text.measureText(line, 1), y, INK, 1);
        rest = rest.slice(cut).trimStart();
        room = full;
        y += 8;
      }
    }
  };
  const meterOf = (s) => {
    let told = 0, asked = 0, waiting = 0;
    const hidden = [];
    for (const [name, check] of METER) {
      const answer = check(s);
      if (answer === null) { waiting++; continue; }
      asked++;
      if (answer) told++;
      else hidden.push(name);
    }
    return { told, asked, waiting, hidden };
  };
  const CHAPTERS = [
    {
      caption: "Who you are", title: "OOGA SEE WHO YOU ARE",
      rows: (s) => [
        ["SYSTEM", s.os], ["BROWSER", s.browser],
        ["BUILD", or(s.hints, (h) => h.platform === "Windows" ? `Windows ${windowsOf(h.platformVersion)}` : `${h.platform} ${h.platformVersion}`)],
        ["CHIP", or(s.hints, (h) => `${h.architecture || "?"} ${h.bitness || "?"}-bit`)],
        ["SPEAKS", s.languages[0]], ["TIME ZONE", s.zone], ["CLOCK", `${s.utc} ${s.hourCycle === "h23" || s.hourCycle === "h24" ? "24H" : "12H"}`]
      ],
      notes: (s) => [
        `Who: Ooga see you ride ${s.browser} on ${s.os}. Your browser shout this to every cave it visit, before anyone ask. Whole shout: ${s.ua}`,
        s.hints === null ? `Exact build: ${NOT_YET}` : !s.hints
          ? "Exact build: your browser not answer Ooga's polite ask. Only Chromium browsers (Chrome, Edge, Brave, Opera) hand out exact system build and chip this way."
          : `Exact build: Ooga ask politely and browser hand over ${s.hints.platform} build ${s.hints.platformVersion}${s.hints.platform === "Windows" ? ` (that Windows ${windowsOf(s.hints.platformVersion)})` : ""}, ${s.hints.architecture || "unknown"} chip, ${s.hints.bitness || "?"}-bit${s.hints.model ? `, model ${s.hints.model}` : ""}${s.hints.wow64 ? ", 32-bit browser on 64-bit system" : ""}. Exact browser: ${(s.hints.fullVersionList || []).map((b) => `${b.brand} ${b.version}`).join(", ") || "not said"}. No prompt, no permission.`,
        `Talk and time: Ooga hear you speak ${s.languages.join(", ")}. Your sun-clock say ${s.zone} (${s.utc}). Your numbers look like ${s.number}, your days like ${s.date}, ${s.calendar} calendar. Talk and sun-clock together tell any cave roughly where in world you sleep.`
      ]
    },
    {
      caption: "Your screen", title: "OOGA SEE YOUR SCREEN",
      rows: (s) => [
        ["SCREEN", `${s.screenW}x${s.screenH}`], ["PIXELS", `x${s.ratio} ${s.depth}-bit`], ["WINDOW", `${s.windowW}x${s.windowH}`],
        ["TASKBAR", s.bar], ["SCREENS", s.extended === true ? "more than one" : s.extended === false ? "one" : "not said"],
        ["TOUCH", s.touch ? `${s.touch} fingers` : "none"], ["SETTINGS", `${s.prefs.length} set`]
      ],
      notes: (s) => [
        `Cave wall: your screen is ${s.screenW} by ${s.screenH}, each dot ${s.ratio} pixels thick and ${s.depth} colour-bits deep. This window ${s.windowW} by ${s.windowH}. Not many Ooga have exact same wall.`,
        `Taskbar: usable wall is ${s.availW} by ${s.availH}, so taskbar or dock take ${s.bar}. Your window sit at ${s.screenX}, ${s.screenY}, and browser tabs and buttons take ${s.chromeW} by ${s.chromeH} pixels round the page.${s.extended === true ? " Browser also say you have more than one screen." : s.extended === false ? " Browser also say you have one screen." : ""}`,
        s.touch ? `Touch: your screen feel ${plural(s.touch, "finger", "fingers")} at once${s.coarse ? ", and you poke with your hand." : ", but you mostly poke with mouse-stick: touch laptop."}` : "Touch: no touch. You poke with mouse-stick, so cave know you sit at big computer.",
        s.prefs.length ? `Settings: Ooga see ${listOf(s.prefs)}. Each switch you flip split the crowd in two, so the rarer the switch, the easier you stand out.` : "Settings: every look setting at default. That is most common, so you blend in."
      ]
    },
    {
      caption: "Your machine", title: "OOGA SEE YOUR MACHINE",
      rows: (s) => [
        ["CORES", s.cores || HIDDEN_VALUE], ["MEMORY", s.memory ? `${s.memory} GB` : HIDDEN_VALUE],
        ["GRAPHICS", s.gpu.name ? shortGpu(s.gpu.name) : HIDDEN_VALUE], ["GPU PRINT", s.gpu.hash || HIDDEN_VALUE],
        ["STORAGE", or(s.storage, (st) => bytesOf(st.quota))], ["NETWORK", s.net ? `${s.net.type} ${s.net.rtt} ms` : HIDDEN_VALUE],
        ["BATTERY", or(s.battery, (b) => `${Math.round(b.level * 100)}% ${b.charging ? "charging" : "draining"}`)]
      ],
      notes: (s) => [
        (s.cores ? `Brain-rocks: Ooga see you have ${plural(s.cores, "brain-rock", "brain-rocks")} thinking at once` : "Brain-rocks: your browser hide how many brain-rocks you have")
          + (s.memory ? ` and about ${s.memory} GB of remember-sand. Browser round it so Ooga not count exact.` : ". It not tell your remember-sand either. Sneaky browser, good browser."),
        s.gpu.name ? `Picture rock: Ooga ask WebGL and it say ${s.gpu.name}. Then Ooga ask many small questions: which extras it do (${s.gpu.extensions}), biggest picture it hold (${s.gpu.maxTexture} pixels), how fine its maths (${s.gpu.precision} bits). Answers mashed together make ${s.gpu.hash}. Same card and driver give same answers, so this sort you into small pile even when the name is hidden.` : "Picture rock: WebGL not answer Ooga. Your graphics card stay secret.",
        s.storage === null ? `Stash: ${NOT_YET}` : !s.storage ? "Stash: your browser not tell how much it let sites keep." : `Stash: your browser let this cave keep up to ${bytesOf(s.storage.quota)} (Ooga use ${bytesOf(s.storage.usage)}). In Chromium browsers quota grow with your disk, so big number mean big disk. Private windows get a small quota, and that is how sites guess you browse private.`,
        (s.net ? `Pipe: look like ${s.net.type}, about ${s.net.downlink} Mbit a second and ${s.net.rtt} ms there and back${s.net.saveData ? ", data saver on" : ""}. ` : "Pipe: your browser hide what pipe you are on. ")
          + (s.battery === null ? `Battery: ${NOT_YET}` : !s.battery ? "Battery stay secret too: Firefox and Safari took it away from pages because level and countdown change slowly, so they could tie two sites you have open together."
          : s.battery.charging && s.battery.level === 1 ? "Battery say full and charging: plugged in, or no battery at all." : `Battery ${Math.round(s.battery.level * 100)}% and ${s.battery.charging ? "charging" : "draining"}. Level and countdown change slowly, so for a while they can tie two sites you have open together.`)
      ]
    },
    {
      caption: "Your gear", title: "OOGA COUNT YOUR GEAR",
      rows: (s) => [
        ["KEYBOARD", s.layout === null ? WAIT : s.layout && s.layout.name ? s.layout.name : HIDDEN_VALUE],
        ["CAMERAS", or(s.devices, (d) => d.video)], ["MICS", or(s.devices, (d) => d.audio)], ["SPEAKERS", or(s.devices, (d) => d.speaker)],
        ["PERMITS", or(s.permissions, (p) => `${p.filter((x) => x[1] === "granted").length} yes ${p.filter((x) => x[1] === "denied").length} no`)]
      ],
      notes: (s) => [
        s.layout === null ? `Keyboard: ${NOT_YET}` : !s.layout || !s.layout.name ? "Keyboard: your browser not tell Ooga your layout. Only Chromium browsers answer this one."
          : `Keyboard: Ooga ask which letter sit on each key and your top row start "${s.layout.keys}". That ${s.layout.name} keyboard. Layout tell cave which country you learn typing in, and no permission needed.`,
        s.devices === null ? `Eyes and ears: ${NOT_YET}` : !s.devices ? "Eyes and ears: your browser not let Ooga count cameras and mics here."
          : `Eyes and ears: without asking, Ooga count ${plural(s.devices.video, "camera", "cameras")}, ${plural(s.devices.audio, "microphone", "microphones")} and ${plural(s.devices.speaker, "speaker", "speakers")}. Names stay hidden until you say yes to camera or mic, but the count alone tell cave if you have webcam or headset. Some browsers show only one of each kind until you say yes.`,
        s.permissions === null ? `Permissions: ${NOT_YET}` : !s.permissions ? "Permissions: your browser not let Ooga ask what you allowed."
          : `Permissions: Ooga ask, without any prompt, what you already told this site: ${s.permissions.map(([name, state]) => `${name}: ${STATES[state] || "browser won't say"}`).join(", ")}. Every site can ask about itself.`
      ]
    },
    {
      caption: "Your prints", title: "OOGA TAKE YOUR PRINTS",
      rows: (s) => [
        ["CANVAS", s.print], ["AUDIO", or(s.audio, (a) => a)], ["FONTS", `${s.fonts.length} of ${FONTS.length}`],
        ["VOICES", s.voices === null ? WAIT : s.voices ? s.voices.length : HIDDEN_VALUE]
      ],
      notes: (s) => [
        `Canvas print: Ooga paint same secret picture every cave can paint. Your fonts, smoothing and picture rock paint it tiny bit different, so its hash ${s.print} follow you cave to cave, no cookie needed.${s.canvasNoise ? " But your browser sprinkle noise on canvas reads, so this one change: browser fib on purpose. Good browser." : ""}`,
        s.audio === null ? `Audio print: ${NOT_YET}` : !s.audio ? "Audio print: your browser not let Ooga hum." : `Audio print: Ooga hum a tune inside your browser, never out loud, squash it, and hash what come out: ${s.audio}. Different chips and browsers round the sums different, so this follow you like the canvas print.`,
        s.fonts.length ? `Fonts: Ooga measure letters in ${FONTS.length} fonts and find ${listOf(s.fonts)}. Fonts tell which system you run, which office, design and coding apps you put on, and which languages. Some browsers now hide every font the system did not ship.` : "Fonts: Ooga find none of the fonts it ask about. Your browser hide them, or your system very plain.",
        s.voices === null ? `Voices: ${NOT_YET}` : !s.voices || !s.voices.length ? "Voices: no reading-aloud voices. Nothing to tell there."
          : `Voices: your browser can read aloud in ${plural(s.voices.length, "voice", "voices")}: ${listOf(s.voices.slice(0, 12).map((v) => `${v.name} (${v.lang})`))}${s.voices.length > 12 ? ", and more" : ""}. Voices come with your system and language packs, so the list say a lot about both.`
      ]
    },
    {
      caption: "Your add-ons", title: "OOGA SPOT YOUR ADD-ONS",
      rows: (s) => [
        ["WALLETS", s.allWallets === null ? WAIT : s.allWallets.length || "none seen"], ["HELPERS", s.marks.found.length + s.marks.strange.length || "none seen"],
        ["AD BLOCK", s.blocker === null ? WAIT : s.blocker === "yes" ? "yes" : "none seen"], ["DISGUISES", s.tells.length || "none seen"]
      ],
      notes: (s) => [
        s.allWallets === null ? `Wallets: ${NOT_YET}` : s.allWallets.length
          ? `Wallets: Ooga see ${listOf(s.allWallets)}. Wallets put themselves on every page so sites can offer to connect, which also tell every site you hold coins. Ooga only look; Ooga never ask a wallet anything.`
          : "Wallets: Ooga see no wallet on this page. You may have one that hides until you click it, which is the safer way.",
        s.marks.found.length || s.marks.strange.length
          ? `Helpers: Ooga see marks of ${listOf(s.marks.found.concat(s.marks.strange.map((t) => `something adding <${t}> tags`)))}. Helpers that change pages leave tracks in them, and any site can read the tracks. Password managers and spell checkers often show only after you click in a box, so try the boxes in Try it, then come back.`
          : "Helpers: Ooga see no marks from helper add-ons. Some show only after you click in a box, so try the boxes in Try it, then come back.",
        s.blocker === null ? `Ad block: ${NOT_YET}` : s.blocker === "yes" ? "Ad block: Ooga hide a pretend ad where you no see, and something hide it again. You run an ad blocker. Good for you, but sites can tell, and some nag you for it." : "Ad block: Ooga's pretend ad stay put, so Ooga see no ad blocker. Some blockers skip small sites like this one, so no sure.",
        s.tells.length ? `Disguises: ${s.tells.join(" ")}` : "Disguises: everything your browser say about itself agree. No disguise Ooga can see.",
        "Ooga not see every add-on: most hide their own workings from pages and only their tracks show, and some not run on this site at all. None seen not mean none there."
      ]
    },
    {
      caption: "Your trail and flags", title: "OOGA FOLLOW YOUR TRAIL",
      rows: (s) => [
        ["CAME FROM", s.referrer ? s.referrerHost : "straight in"], ["TAB STEPS", s.historyLength], ["ARRIVED", s.arrivalShort],
        ["DNT", s.dnt ? "on" : "off"], ["GPC", s.gpc ? "on" : "off"], ["COOKIES", s.cookies ? "allowed" : "blocked"]
      ],
      notes: (s) => [
        (s.referrer ? `Trail: you came from ${s.referrer}. The page that send you tell the new one, unless it ask not to.` : "Trail: no page sent you, or it ask browser not to say. Ooga not know where you came from.")
          + ` This tab hold ${plural(s.historyLength, "step", "steps")} of back-and-forth (Ooga see only the count, not where). You came in by ${s.arrival} and been on island ${s.stay}.`,
        `Flags: Do Not Track ${s.dnt ? "on" : "off"}, Global Privacy Control ${s.gpc ? "on" : "off"}, cookies ${s.cookies ? "allowed" : "blocked"}, PDF viewer ${s.pdf ? "built in" : "missing"}${s.robot ? ", and browser say a robot drive it" : ""}. Funny thing: few people ask not to be tracked, so the flag itself make you easier to spot. Do Not Track is only a wish; Global Privacy Control has law behind it in some places.`
      ]
    },
    {
      caption: "Try it", title: "OOGA TRY TRICKS ON YOU", panel: true,
      rows: (s) => [
        ["AUTOFILL", `${s.caught.length} caught`], ["TYPING", s.typing.holds < 8 ? "type below" : `${s.typing.hold}/${s.typing.gap} ms`],
        ["MOUSE", s.mouse.rate ? `${s.mouse.rate} hz` : "wiggle below"]
      ],
      notes: (s) => [
        s.caught.length ? `Hidden autofill: Ooga catch ${s.caught.join(", ")} from boxes you never see. Bad cave take them same way. Ooga only count letters, never read them.`
          : "Hidden autofill: put your name in Ooga name box and pick your browser's fill-in. Ooga hide email, phone, street, postcode and workplace boxes where you no see. If browser fill them too, Ooga tell you here, counting letters only.",
        s.typing.holds < 8 ? "Typing rhythm: type the line in the typing box. Ooga time how long you hold each key and the gap before the next one."
          : `Typing rhythm: you hold each key about ${s.typing.hold} ms and leave about ${s.typing.gap} ms before the next, give or take ${s.typing.wobble} ms. That rhythm stay the same day to day, like your voice. Sites use it to tell people from bots, and to know you again when you log in as someone else. Ooga time only, never which keys.`,
        !s.mouse.rate ? "Mouse rhythm: wiggle mouse-stick, pen or finger round the pad. Ooga count how often your pointer report and how your hand move."
          : `Mouse rhythm: your ${s.mouse.kind} report about ${s.mouse.rate} times a second${s.mouse.rate >= 700 ? ": gamer mouse" : s.mouse.rate >= 350 ? ": fast mouse" : ""}. Your hand move about ${s.mouse.speed} pixels a second and turn about ${s.mouse.wobble} degrees between reports${s.mouse.pressure ? `, pen pressing ${Math.round(s.mouse.pressure * 100)}%` : ""}. How a hand speed up, slow down and wobble is like handwriting: bot catchers and fraud checkers watch it.`,
        "Ooga forget all of it when board close, or now with Forget."
      ]
    },
    {
      caption: "Ooga's verdict", title: "OOGA'S VERDICT",
      rows: (s) => {
        const m = meterOf(s);
        return [["YOUR NAME", s.name], ["CLUES", s.clues], ["TOLD OOGA", m.waiting ? WAIT : `${m.told} of ${m.asked}`], ["REFUSED", m.waiting ? WAIT : m.asked - m.told]];
      },
      notes: (s) => {
        const m = meterOf(s);
        return [
          `Ooga name for you: Ooga mash ${s.clues} clues from these pages into one name, ${s.name}. No cookie, no login, nothing stored, yet next time you come in this browser Ooga could work out the same name. Real trackers do exactly this, then hold it up against millions of other visitors to see how rare you are. Ooga have no server and no list, so Ooga cannot say how rare.`,
          m.waiting ? `Leak meter: ${NOT_YET}` : `Leak meter: Ooga ask ${m.asked} things a browser may refuse, and yours tell ${m.told}.${m.hidden.length ? ` It keep back ${listOf(m.hidden)}.` : " It keep back nothing!"} Try a stricter browser or setting and watch the number drop.`
        ];
      }
    },
    {
      caption: "Ooga's own honesty", title: "WHAT OOGA CALL AND KEEP",
      rows: (s) => [
        ["CALLED", plural(s.hosts.length, "site", "sites")], ["KEPT", s.stash ? plural(s.stash.length, "thing", "things") : HIDDEN_VALUE],
        ["COOKIES", s.cookieCount ? s.cookieCount : "none"], ["ABOUT YOU", "nothing sent"]
      ],
      notes: (s) => [
        `Calls: your browser keep a list of what this page loaded, and Ooga read it out: ${s.hosts.length ? listOf(s.hosts) : "nothing from other sites yet"}. That is the Bitcoin feeds and the island's stats board, asking for public data; none of it carry anything about you. Live connections are not on that list: the mempool.space and Coinbase price sockets when they are on.`,
        !s.stash ? "Kept: your browser not let Ooga read this site's storage." : s.stash.length
          ? `Kept: in your browser only, this address keep ${listOf(s.stash.map(([key, size, ours]) => `${key} (${bytesOf(size)}${ours ? "" : ", another app on this address"})`))}. Ooga's own are your banana handle and message, game saves, settings and a copy of the chain feed. Clear site data in your browser to wipe them.`
          : "Kept: this address keep nothing in your browser yet.",
        `Cookies: ${s.cookieCount ? `this address hold ${plural(s.cookieCount, "cookie", "cookies")}.` : "Ooga set no cookies."} Signing in on the Cloudflare site is the only time Ooga keep anything on a server, and you can delete it.`
      ]
    },
    {
      caption: "How to leak less", title: "OOGA TIPS TO LEAK LESS",
      rows: () => [["BROWSER", "Brave, Tor, Firefox"], ["BLOCKER", "uBlock Origin"], ["COOKIES", "block third-party"], ["ADD-ONS", "few, on click"], ["ALLOWED", "check often"], ["AUTOFILL", "on click only"]],
      notes: () => [
        "Browser: Tor Browser make everyone look the same. Brave sprinkle noise on prints by default. Firefox has strict tracking protection, and a fingerprint shield (privacy.resistFingerprinting) for the brave of heart.",
        "Blocker: uBlock Origin block trackers before they load. It work in Firefox fully; Chrome's newer rules limit it to uBlock Origin Lite.",
        "Cookies: block third-party cookies in settings, so a tracker on one site cannot follow you to the next.",
        "Add-ons: keep few, and set the rest to run only when you click them (in Chrome: site access, on click). That stop wallets and helpers announcing themselves to every site.",
        "Allowed: look over site settings now and then, and take back location, camera, mic and notifications from sites you no longer use.",
        "Autofill: let your password manager fill only when you click, and only into boxes you can see.",
        "Updates: keep your browser updated. Old tricks keep coming back, and updates close them."
      ]
    },
    {
      caption: "What Ooga won't do", title: "OOGA WON'T PEEK AT",
      rows: () => [["NETWORK", "6 leaks"], ["ASK FIRST", "5 leaks"], ["OLD TRICKS", "4 leaks"], ["WATCHING", "4 leaks"]],
      notes: () => [
        "Need the network: Ooga make no calls about you, so Ooga skip your public IP and the town and internet company it point to; WebRTC, which can show your home network address; how your browser talk to servers (TLS and header order), which servers fingerprint from their side; your name server (DNS leak) and timing to servers round the world; supercookies hidden in cache tags, HSTS and favicons; and poking ports on your home network to find your router and running programs.",
        "Ask first: these pop up a question before a page get them, and Ooga not ask: exact location from GPS or Wi-Fi; your clipboard; your camera, microphone and screen; Bluetooth, USB, serial and game-controller gear; and notifications, which also prove you came back. Say yes only to sites you trust.",
        "Old tricks: reading your history by colouring visited links (patched); spotting add-ons by loading their files (blocked by this site's own rules); timing your cache to see which sites you visited; and third-party cookies that follow you between sites, now split per site or blocked in most browsers.",
        "Watching: Ooga read only when you open this board. Plenty of sites watch all the time: when you switch tabs or go idle, how far you scroll, session replay of every move and keypress, and typing and mouse rhythm on every page, quietly. Privacy add-ons and strict browser modes block many of these."
      ]
    }
  ];
  // The clues the name is made from: what stays put between visits, not the window, the battery or the trail.
  const CLUES = [(s) => s.ua, (s) => s.languages.join(","), (s) => s.zone, (s) => `${s.screenW}x${s.screenH}@${s.ratio}/${s.depth}`,
    (s) => `${s.availW}x${s.availH}`, (s) => s.cores, (s) => s.memory, (s) => s.gpu.name, (s) => s.gpu.hash, (s) => s.touch,
    (s) => s.hints && `${s.hints.platformVersion}/${s.hints.architecture}`, (s) => s.layout && s.layout.name,
    (s) => s.devices && `${s.devices.video}/${s.devices.audio}/${s.devices.speaker}`, (s) => s.prefs.join(","), (s) => s.print,
    (s) => s.audio, (s) => s.fonts.join(","), (s) => s.voices && s.voices.length, (s) => s.number + s.date,
    (s) => `${s.dnt}/${s.gpc}/${s.pdf}`, (s) => s.allWallets && s.allWallets.join(","), (s) => s.marks.found.join(","), (s) => s.blocker === "yes"];
  const create = (panel) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const c2 = canvas.getContext("2d", { alpha: false });
    const form = panel.querySelector("form"), typed = panel.querySelector(".leak-typing input"), pad = panel.querySelector(".leak-pad");
    const seen = { gpu: readGpu(), marks: { found: [], strange: [] }, caught: [], typing: { holds: 0, hold: 0, gap: 0, wobble: 0 }, mouse: { rate: 0, kind: "", speed: 0, wobble: 0, pressure: 0 } };
    // Raw rhythm sums, kept apart from what the pages show.
    const keys = { down: new Map(), lastUp: 0, holds: 0, holdSum: 0, gaps: 0, gapSum: 0, gapSq: 0 };
    const GAPS = 256, pointer = { gaps: new Float64Array(GAPS), sorted: new Float64Array(GAPS), count: 0, last: 0, x: 0, y: 0, angle: NaN, dist: 0, time: 0, turn: 0, turns: 0, shown: 0 };
    // What an opening left waiting (timers, listeners, the pretend ad), undone by the next opening and by dispose.
    const undo = [];
    let opening = 0;
    const stop = () => {
      while (undo.length) undo.pop()();
    };
    const wait = (ms) => new Promise((resolve) => {
      const id = setTimeout(resolve, ms);
      undo.push(() => clearTimeout(id));
    });
    const forget = () => {
      form.reset();
      typed.value = "";
      seen.caught.length = 0;
      keys.down.clear();
      keys.lastUp = keys.holds = keys.holdSum = keys.gaps = keys.gapSum = keys.gapSq = 0;
      seen.typing.holds = seen.typing.hold = seen.typing.gap = seen.typing.wobble = 0;
      pointer.count = pointer.last = pointer.dist = pointer.time = pointer.turn = pointer.turns = pointer.shown = 0;
      pointer.angle = NaN;
      seen.mouse.rate = seen.mouse.speed = seen.mouse.wobble = seen.mouse.pressure = 0;
      seen.mouse.kind = "";
    };
    const name = () => {
      let clues = 0, all = "";
      for (const clue of CLUES) {
        const value = clue(seen);
        if (value === null || value === undefined || value === false || value === "" || value === 0) continue;
        clues++;
        all += `${value}|`;
      }
      seen.clues = clues;
      seen.name = hashText(all);
    };
    const chapter = () => CHAPTERS[board.index];
    const board = {
      title: "Leak Check", help: "Ooga look only in your browser. Nothing stored, nothing sent.",
      canvas, count: CHAPTERS.length, index: 0, version: 0, caption: "", note: "",
      get panel() { return chapter().panel ? panel : null; },
      go(i) {
        board.index = i;
        board.draw();
      },
      draw() {
        const page = chapter();
        // Helpers often mark the page only once a box is clicked, so their tracks are looked for again on the way back.
        if (page.caption === "Your add-ons") seen.marks = marksOf();
        name();
        c2.fillStyle = BG;
        c2.fillRect(0, 0, W, H);
        table(c2, page.title, page.rows(seen));
        board.caption = `${page.caption} · ${board.index + 1} of ${CHAPTERS.length}`;
        board.note = page.notes(seen).join("\n\n");
        board.version++;
      },
      // Everything is read here, once an opening, and never in a frame. Late answers redraw the page they land on.
      open() {
        stop();
        const ticket = ++opening;
        const later = (key, promise) => {
          seen[key] = null;
          promise.then((value) => {
            if (ticket !== opening) return;
            seen[key] = value || false;
            board.draw();
          }, () => {
            if (ticket !== opening) return;
            seen[key] = false;
            board.draw();
          });
        };
        const ua = navigator.userAgent, zone = Intl.DateTimeFormat().resolvedOptions();
        seen.ua = ua;
        seen.os = osOf(ua);
        seen.browser = browserOf(ua);
        seen.languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "unknown"];
        seen.zone = zone.timeZone || "unknown";
        seen.calendar = zone.calendar;
        seen.hourCycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
        seen.number = (1234567.89).toLocaleString();
        seen.date = new Date(2026, 0, 31).toLocaleDateString();
        seen.utc = utcOf(-new Date().getTimezoneOffset());
        seen.screenW = screen.width;
        seen.screenH = screen.height;
        seen.availW = screen.availWidth;
        seen.availH = screen.availHeight;
        const barH = screen.height - screen.availHeight, barW = screen.width - screen.availWidth;
        seen.bar = barH > 0 ? `${barH} px ${screen.availTop > 0 ? "top" : "bottom"}` : barW > 0 ? `${barW} px ${screen.availLeft > 0 ? "left" : "right"}` : "none";
        seen.extended = typeof screen.isExtended === "boolean" ? screen.isExtended : null;
        seen.screenX = window.screenX;
        seen.screenY = window.screenY;
        seen.chromeW = window.outerWidth - window.innerWidth;
        seen.chromeH = window.outerHeight - window.innerHeight;
        seen.ratio = Math.round(window.devicePixelRatio * 100) / 100;
        seen.depth = screen.colorDepth;
        seen.windowW = window.innerWidth;
        seen.windowH = window.innerHeight;
        seen.cores = navigator.hardwareConcurrency || 0;
        seen.memory = navigator.deviceMemory || 0;
        seen.touch = navigator.maxTouchPoints || 0;
        seen.coarse = window.matchMedia("(pointer: coarse)").matches;
        seen.prefs = PREFS.filter((p) => window.matchMedia(p[1]).matches).map((p) => p[0]);
        seen.dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1";
        seen.gpc = navigator.globalPrivacyControl === true;
        seen.cookies = navigator.cookieEnabled;
        seen.pdf = navigator.pdfViewerEnabled === true;
        seen.robot = navigator.webdriver === true;
        const connection = navigator.connection;
        seen.net = connection && connection.effectiveType ? { type: connection.effectiveType, downlink: connection.downlink, rtt: connection.rtt, saveData: connection.saveData } : null;
        seen.referrer = document.referrer;
        try { seen.referrerHost = new URL(document.referrer).host; } catch { seen.referrerHost = document.referrer; }
        seen.historyLength = history.length;
        const entry = performance.getEntriesByType("navigation")[0], minutes = Math.floor(performance.now() / 60000);
        seen.arrivalShort = !entry ? "unknown" : entry.type === "reload" ? "reload" : entry.type === "back_forward" ? "back/forward" : "link or typed";
        seen.arrival = !entry ? "a way Ooga not see" : entry.type === "reload" ? "reloading" : entry.type === "back_forward" ? "going back or forward" : "following a link or typing the address";
        seen.stay = minutes < 1 ? "less than a minute" : plural(minutes, "minute", "minutes");
        seen.print = canvasPrint();
        seen.canvasNoise = canvasNoise();
        seen.fonts = readFonts();
        seen.marks = marksOf();
        // What this page itself called and keeps: the browser's own list of loads, and this address's storage.
        const hosts = new Set();
        for (const load of performance.getEntriesByType("resource")) {
          try {
            const url = new URL(load.name);
            if (/^https?:$/.test(url.protocol) && url.host !== location.host) hosts.add(url.host);
          } catch { /* a load the browser named without an address */ }
        }
        seen.hosts = [...hosts];
        try {
          seen.stash = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            seen.stash.push([key, (localStorage.getItem(key) || "").length, /^ooga/.test(key)]);
          }
        } catch { seen.stash = false; }
        seen.cookieCount = document.cookie ? document.cookie.split(";").length : 0;
        // Disguises: what the browser says about itself against what it is.
        const engine = engineOf(), claimed = claimedEngineOf(seen.os, seen.browser), platform = navigator.platform || "", fits = PLATFORMS[seen.os];
        seen.shield = engine === "Gecko" && /^(UTC|Etc\/UTC)$/.test(seen.zone) && seen.screenW === seen.windowW && seen.screenH === seen.windowH;
        seen.tells = [];
        if (navigator.brave) seen.tells.push("You ride Brave, which wear Chrome's name on purpose to hide in the crowd.");
        if (claimed && claimed !== engine) seen.tells.push(`Your browser say it is ${seen.browser}, but under the fur it run the ${engine} engine: something change its name tag.`);
        if (fits && !fits.test(platform)) seen.tells.push(`Your browser say ${seen.os}, but another part of it say ${platform || "nothing"}: something change its story.`);
        if (seen.canvasNoise) seen.tells.push("Canvas reads come back sprinkled with noise, so something fib about your prints on purpose.");
        if (seen.shield) seen.tells.push("Time zone say UTC and screen exactly match window: look like Firefox's fingerprint shield.");
        later("hints", navigator.userAgentData && navigator.userAgentData.getHighEntropyValues
          ? ask(() => navigator.userAgentData.getHighEntropyValues(["platformVersion", "architecture", "bitness", "model", "fullVersionList", "wow64"])) : Promise.resolve(false));
        later("layout", navigator.keyboard && navigator.keyboard.getLayoutMap ? ask(() => navigator.keyboard.getLayoutMap()).then(layoutOf) : Promise.resolve(false));
        later("devices", navigator.mediaDevices && navigator.mediaDevices.enumerateDevices ? ask(() => navigator.mediaDevices.enumerateDevices()).then((list) => ({
          video: list.filter((d) => d.kind === "videoinput").length, audio: list.filter((d) => d.kind === "audioinput").length, speaker: list.filter((d) => d.kind === "audiooutput").length
        })) : Promise.resolve(false));
        later("permissions", navigator.permissions ? Promise.all(PERMISSIONS.map(([id, label]) => ask(() => navigator.permissions.query({ name: id }))
          .then((status) => [label, status.state], () => [label, "unknown"]))) : Promise.resolve(false));
        later("storage", navigator.storage && navigator.storage.estimate ? ask(() => navigator.storage.estimate()) : Promise.resolve(false));
        later("battery", navigator.getBattery ? ask(() => navigator.getBattery()).then((b) => ({ level: b.level, charging: b.charging })) : Promise.resolve(false));
        later("audio", audioPrint());
        // Chromium fills its voice list a moment after the first ask.
        later("voices", !window.speechSynthesis ? Promise.resolve(false) : new Promise((resolve) => {
          const now = speechSynthesis.getVoices();
          if (now.length) return resolve(now);
          const heard = () => resolve(speechSynthesis.getVoices());
          speechSynthesis.addEventListener("voiceschanged", heard);
          undo.push(() => speechSynthesis.removeEventListener("voiceschanged", heard));
          wait(1500).then(heard);
        }).then((list) => list.map((v) => ({ name: v.name, lang: v.lang }))));
        // Ethereum wallets answer a shared call (EIP-6963) with their name; the answers come within a moment.
        const announced = new Map(), hear = (e) => {
          const info = e.detail && e.detail.info;
          if (info && info.name) announced.set(info.rdns || info.name, info.name);
        };
        window.addEventListener("eip6963:announceProvider", hear);
        undo.push(() => window.removeEventListener("eip6963:announceProvider", hear));
        window.dispatchEvent(new Event("eip6963:requestProvider"));
        later("allWallets", wait(400).then(() => {
          window.removeEventListener("eip6963:announceProvider", hear);
          const all = walletsOf();
          for (const wallet of announced.values()) if (!all.some((w) => w.toLowerCase() === wallet.toLowerCase())) all.push(wallet);
          return all;
        }));
        // A pretend ad off screen: a blocker's hiding rules hide it within a moment.
        const bait = document.createElement("div");
        bait.className = "adsbox ad-banner textads banner-ads leak-bait";
        document.body.append(bait);
        undo.push(() => bait.remove());
        later("blocker", wait(250).then(() => {
          const style = getComputedStyle(bait), hidden = bait.offsetHeight === 0 || style.display === "none" || style.visibility === "hidden";
          bait.remove();
          return hidden ? "yes" : "no";
        }));
        forget();
        board.draw();
      },
      onClose() {
        stop();
        opening++;
        forget();
      },
      dispose() {
        board.onClose();
        form.removeEventListener("input", onInput);
        form.removeEventListener("submit", onSubmit);
        panel.removeEventListener("click", onForget);
        typed.removeEventListener("keydown", onKeyDown);
        typed.removeEventListener("keyup", onKeyUp);
        pad.removeEventListener("pointermove", onPointerMove);
      }
    };
    const onInput = () => {
      seen.caught.length = 0;
      for (const field in HIDDEN) {
        const n = form.elements[field].value.length;
        if (n) seen.caught.push(`${HIDDEN[field]} (${plural(n, "letter", "letters")})`);
      }
      if (chapter().panel) board.draw();
    };
    const onSubmit = (e) => e.preventDefault();
    const onForget = (e) => {
      if (!e.target.closest(".leak-forget")) return;
      e.target.blur();
      forget();
      board.draw();
    };
    // Typing: the hold is keydown to keyup of one key, the gap is the last keyup to the next keydown.
    const onKeyDown = (e) => {
      if (e.repeat) return;
      const gap = e.timeStamp - keys.lastUp;
      if (keys.lastUp && gap < 1500) {
        keys.gaps++;
        keys.gapSum += gap;
        keys.gapSq += gap * gap;
      }
      keys.down.set(e.code, e.timeStamp);
    };
    const onKeyUp = (e) => {
      const at = keys.down.get(e.code);
      if (at === undefined) return;
      keys.down.delete(e.code);
      const hold = e.timeStamp - at;
      if (hold < 1000) {
        keys.holds++;
        keys.holdSum += hold;
      }
      keys.lastUp = e.timeStamp;
      const t = seen.typing, mean = keys.gaps ? keys.gapSum / keys.gaps : 0;
      t.holds = keys.holds;
      t.hold = Math.round(keys.holdSum / keys.holds);
      t.gap = Math.round(mean);
      t.wobble = keys.gaps ? Math.round(Math.sqrt(Math.max(0, keys.gapSq / keys.gaps - mean * mean))) : 0;
      if (chapter().panel) board.draw();
    };
    // The pointer: every raw sample the browser coalesced, its interval (pauses left out), distance and turning.
    const sample = (p) => {
      const t = p.timeStamp, dt = t - pointer.last;
      if (pointer.last && dt > 0 && dt < 40) {
        pointer.gaps[pointer.count++ % GAPS] = dt;
        const dx = p.clientX - pointer.x, dy = p.clientY - pointer.y, d = Math.hypot(dx, dy);
        pointer.dist += d;
        pointer.time += dt;
        if (d > 0.5) {
          const angle = Math.atan2(dy, dx);
          if (!Number.isNaN(pointer.angle)) {
            let turn = Math.abs(angle - pointer.angle);
            if (turn > Math.PI) turn = Math.PI * 2 - turn;
            pointer.turn += turn;
            pointer.turns++;
          }
          pointer.angle = angle;
        }
      }
      pointer.last = t;
      pointer.x = p.clientX;
      pointer.y = p.clientY;
    };
    const onPointerMove = (e) => {
      const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      if (coalesced && coalesced.length) for (let i = 0; i < coalesced.length; i++) sample(coalesced[i]);
      else sample(e);
      const m = seen.mouse, n = Math.min(pointer.count, GAPS);
      m.kind = e.pointerType || "pointer";
      if (e.pointerType === "pen") m.pressure = e.pressure;
      if (n < 20 || e.timeStamp - pointer.shown < 200) return;
      pointer.shown = e.timeStamp;
      const sorted = pointer.sorted.subarray(0, n);
      sorted.set(pointer.gaps.subarray(0, n));
      sorted.sort();
      m.rate = Math.round(1000 / sorted[n >> 1]);
      m.speed = Math.round(pointer.dist / pointer.time * 1000);
      m.wobble = pointer.turns ? Math.round(pointer.turn / pointer.turns * 180 / Math.PI) : 0;
      if (chapter().panel) board.draw();
    };
    form.addEventListener("input", onInput);
    form.addEventListener("submit", onSubmit);
    panel.addEventListener("click", onForget);
    typed.addEventListener("keydown", onKeyDown);
    typed.addEventListener("keyup", onKeyUp);
    pad.addEventListener("pointermove", onPointerMove);
    return board;
  };
  BL.leakCheck = { create };
})();
