// The Leak Check kiosk's board: what the visitor's own browser tells any page that asks, read when the board opens
// and shown in Ooga-speak through the shared board dialog (`hud.openBoard`). Each page is a reading in the jumbotron's
// 5x7 font on the board's small canvas, a caption and a note, as the Mempool island's boards draw theirs. Nothing is
// stored or sent: every value stays in this module's `seen` until the next open, and the page makes no request.
//
// The pages run from the plain readings through the strong fingerprints (canvas, audio, fonts, WebGL detail) to three
// hands-on demos, one name made of every clue, and the leaks the kiosk will not show because they break the site's
// rules. Some answers come back as promises; a page shows LOOKING until its answer lands, and an answer from an
// earlier opening is dropped.
//
// The demos are `panel`s in the board dialog's `#board-panel`: `#leak-form` (hidden autofill: a name box the visitor
// sees and address boxes kept off screen; the board counts which the browser filled and how many letters, never the
// text), `#leak-typing` (how long keys are held and the gaps between them, never which keys) and `#leak-mouse` (the
// pointer's sample rate, speed and wobble). All of it is emptied on Forget, `onClose` and `dispose`.
//
// `create({ form, typing, mouse })` returns the board, plus `open()` (read and draw), `onClose()` and `dispose()`. The
// GPU is asked through one throwaway WebGL context once a page, since every context counts against the browser's limit.
(() => {
  "use strict";
  const BL = window.BL;
  const W = 128, H = 48, BG = "#0f110f", DIM = "#9b8f7a", INK = "#7ff5e6";
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
  const windowsOf = (version) => {
    const major = parseInt(version, 10);
    return major >= 13 ? "11" : major > 0 ? "10" : "7 or 8";
  };
  const utcOf = (minutes) => {
    const a = Math.abs(minutes);
    return `UTC${minutes < 0 ? "-" : "+"}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
  };
  const bytesOf = (n) => n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const listOf = (items) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  // Centred lines of the 5x7 font, wrapped at spaces (or mid-word when a word outruns the board) rather than cut.
  // Without a context it only counts the lines.
  const lines = (c2, words, y, ink, scale) => {
    const per = Math.floor((W - 2 + scale) / (6 * scale));
    let rest = words, row = 0;
    while (rest.length) {
      let cut = rest.length <= per ? rest.length : rest.lastIndexOf(" ", per);
      if (cut <= 0) cut = Math.min(per, rest.length);
      const line = rest.slice(0, cut);
      if (c2) text.drawText(c2, line, Math.round((W - text.measureText(line, scale)) / 2), y + row * 8 * scale, ink, scale);
      rest = rest.slice(cut).trimStart();
      row++;
    }
    return row;
  };
  // A reading: its label small at the top, the value as large as fits in the middle, a line under it at the foot.
  const reading = (c2, label, value, under) => {
    const top = lines(c2, label, 2, DIM, 1) * 8 + 3;
    const scale = text.measureText(value, 2) <= W - 8 ? 2 : 1;
    const foot = H - 1 - lines(null, under, 0, DIM, 1) * 8;
    const tall = lines(null, value, 0, INK, scale) * 8 * scale - scale;
    lines(c2, value, Math.max(top, Math.round((top + foot - 2 - tall) / 2)), INK, scale);
    lines(c2, under, foot, DIM, 1);
  };
  // An answer still on its way (null) or one the browser keeps to itself (false).
  const LOOKING = "LOOKING...", QUIET = "NOT TELLING";
  const waiting = (c2, label, answer) => reading(c2, label, answer === null ? LOOKING : QUIET, answer === null ? "" : "BROWSER KEEP QUIET");
  const NOT_YET = "Ooga still asking. Answer come in a blink.";
  const PAGES = [
    {
      caption: "Who you are",
      draw: (c2, s) => reading(c2, "OOGA SEE YOU ON", s.os.toUpperCase(), s.browser.toUpperCase()),
      note: (s) => `Ooga see you ride ${s.browser} on ${s.os}. Your browser shout this to every cave it visit, before anyone ask.\nWhole shout: ${s.ua}`
    },
    {
      caption: "Exact build",
      draw: (c2, s) => !s.hints ? waiting(c2, "OOGA ASK FOR DETAIL", s.hints)
        : reading(c2, "OOGA ASK FOR DETAIL", (s.hints.platform === "Windows" ? `WINDOWS ${windowsOf(s.hints.platformVersion)}` : `${s.hints.platform} ${s.hints.platformVersion}`).toUpperCase(),
          `${s.hints.architecture || "?"} ${s.hints.bitness || "?"}-BIT`.toUpperCase()),
      note: (s) => s.hints === null ? NOT_YET : !s.hints
        ? "Your browser not answer Ooga's polite ask. Only Chromium browsers (Chrome, Edge, Brave, Opera) hand out exact system build and chip this way."
        : `Ooga ask politely and browser hand over: ${s.hints.platform} build ${s.hints.platformVersion}${s.hints.platform === "Windows" ? ` (that Windows ${windowsOf(s.hints.platformVersion)})` : ""}, ${s.hints.architecture || "unknown"} chip, ${s.hints.bitness || "?"}-bit${s.hints.model ? `, model ${s.hints.model}` : ""}${s.hints.wow64 ? ", 32-bit browser on 64-bit system" : ""}. Exact browser: ${(s.hints.fullVersionList || []).map((b) => `${b.brand} ${b.version}`).join(", ") || "not said"}. No prompt, no permission. The normal shout only say rough version; this say exact build.`
    },
    {
      caption: "Talk and time",
      draw: (c2, s) => reading(c2, "OOGA HEAR YOU SPEAK", s.languages[0].toUpperCase(), s.zone.toUpperCase()),
      note: (s) => `Ooga hear you speak ${s.languages.join(", ")}. Your sun-clock say ${s.zone} (${s.utc}). Your numbers look like ${s.number}, your days like ${s.date}, ${s.calendar} calendar, ${s.hourCycle === "h23" || s.hourCycle === "h24" ? "24-hour" : "12-hour"} clock. Talk and sun-clock together tell any cave roughly where in world you sleep.`
    },
    {
      caption: "Screen",
      draw: (c2, s) => reading(c2, "OOGA SEE CAVE WALL", `${s.screenW}X${s.screenH}`, `PIXEL RATIO ${s.ratio}`),
      note: (s) => `Ooga see your cave wall is ${s.screenW} by ${s.screenH}, each dot ${s.ratio} pixels thick and ${s.depth} colour-bits deep. This window ${s.windowW} by ${s.windowH}. Not many Ooga have exact same wall.`
    },
    {
      caption: "Window and taskbar",
      draw: (c2, s) => reading(c2, "OOGA SEE TASKBAR", s.bar.toUpperCase(), s.extended === true ? "MORE THAN ONE SCREEN" : s.extended === false ? "ONE SCREEN" : `WINDOW AT ${s.screenX},${s.screenY}`),
      note: (s) => `Usable wall is ${s.availW} by ${s.availH}, so taskbar or dock take ${s.bar}. Your window sit at ${s.screenX}, ${s.screenY} on it, and browser tabs and buttons take ${s.chromeW} by ${s.chromeH} pixels round the page.`
        + (s.extended === true ? " Browser also say you have more than one screen." : s.extended === false ? " Browser also say you have one screen." : "")
        + " Taskbar size and side are a setting few Ooga share."
    },
    {
      caption: "CPU and memory",
      draw: (c2, s) => reading(c2, "BRAIN-ROCKS", s.cores ? `${s.cores} CORES` : "HIDDEN", s.memory ? `${s.memory} GB MEMORY` : "MEMORY HIDDEN"),
      note: (s) => (s.cores ? `Ooga see you have ${plural(s.cores, "brain-rock", "brain-rocks")} thinking at once` : "Your browser hide how many brain-rocks you have")
        + (s.memory ? ` and about ${s.memory} GB of remember-sand. Browser round it so Ooga not count exact.` : ". It not tell Ooga your remember-sand either. Sneaky browser, good browser.")
    },
    {
      caption: "GPU",
      draw: (c2, s) => reading(c2, "OOGA SEE PICTURE ROCK", s.gpu.name ? shortGpu(s.gpu.name).toUpperCase() : "SECRET", "ASKED THROUGH WEBGL"),
      note: (s) => s.gpu.name ? `Ooga ask WebGL and it say: ${s.gpu.name}. Picture-rock name narrow you down a lot, and any cave can ask it.` : "WebGL not answer Ooga. Your picture rock stay secret."
    },
    {
      caption: "GPU detail",
      draw: (c2, s) => reading(c2, "OOGA POKE PICTURE ROCK", s.gpu.hash || "SECRET", s.gpu.hash ? `${s.gpu.extensions} EXTRAS ${s.gpu.maxTexture} TEX` : "WEBGL QUIET"),
      note: (s) => s.gpu.hash ? `Ooga ask picture rock many small questions: which extras it do (${s.gpu.extensions}), biggest picture it hold (${s.gpu.maxTexture} pixels), how fine its maths (${s.gpu.precision} bits), and more. Answers mashed together make ${s.gpu.hash}. Same card and same driver give same answers, so this sort you into small pile even when the name is hidden.` : "WebGL not answer Ooga, so no detail to mash."
    },
    {
      caption: "Touch",
      draw: (c2, s) => reading(c2, "OOGA FEEL FOR FINGERS", s.touch ? `${s.touch} FINGERS` : "NO TOUCH", s.coarse ? "POINTER COARSE" : "POINTER FINE"),
      note: (s) => s.touch ? `Ooga see your screen feel ${plural(s.touch, "finger", "fingers")} at once${s.coarse ? ". Cave know you poke with your hand." : ", but you mostly poke with mouse-stick. Cave know you have touch laptop."}`
        : "Ooga see no touch. You poke with mouse-stick. Cave know you sit at big computer."
    },
    {
      caption: "Keyboard layout",
      draw: (c2, s) => !s.layout || !s.layout.name ? waiting(c2, "OOGA PEEK AT KEYBOARD", s.layout === null ? null : false) : reading(c2, "OOGA PEEK AT KEYBOARD", s.layout.name.toUpperCase(), "KEYBOARD LAYOUT"),
      note: (s) => s.layout === null ? NOT_YET : !s.layout || !s.layout.name ? "Your browser not tell Ooga keyboard layout. Only Chromium browsers answer this one."
        : `Ooga ask which letter sit on each key and your top row start "${s.layout.keys}". That ${s.layout.name} keyboard. Layout tell cave which country you learn typing in, and no permission needed.`
    },
    {
      caption: "Cameras and mics",
      draw: (c2, s) => !s.devices ? waiting(c2, "OOGA COUNT EYES EARS", s.devices) : reading(c2, "OOGA COUNT EYES EARS", `${s.devices.video} CAM ${s.devices.audio} MIC`, plural(s.devices.speaker, "SPEAKER", "SPEAKERS").toUpperCase()),
      note: (s) => s.devices === null ? NOT_YET : !s.devices ? "Your browser not let Ooga count cameras and mics here."
        : `Without asking, Ooga count ${plural(s.devices.video, "camera", "cameras")}, ${plural(s.devices.audio, "microphone", "microphones")} and ${plural(s.devices.speaker, "speaker", "speakers")}. Names stay hidden until you say yes to camera or mic, but the count alone tell cave if you have webcam or headset. Some browsers show only one of each kind until you say yes.`
    },
    {
      caption: "Permissions",
      draw: (c2, s) => !s.permissions ? waiting(c2, "OOGA ASK WHAT YOU ALLOW", s.permissions)
        : reading(c2, "OOGA ASK WHAT YOU ALLOW", `${s.permissions.filter((p) => p[1] === "granted").length} SAID YES`, `${s.permissions.filter((p) => p[1] === "denied").length} SAID NO`),
      note: (s) => s.permissions === null ? NOT_YET : !s.permissions ? "Your browser not let Ooga ask what you allowed."
        : `Ooga ask, without any prompt, what you already told this site: ${s.permissions.map(([name, state]) => `${name}: ${STATES[state] || "browser won't say"}`).join(", ")}. Every site can ask about itself. What you once allowed or blocked is one more clue.`
    },
    {
      caption: "Storage",
      draw: (c2, s) => !s.storage ? waiting(c2, "OOGA MEASURE STASH", s.storage) : reading(c2, "OOGA MEASURE STASH", bytesOf(s.storage.quota), "STORAGE QUOTA"),
      note: (s) => s.storage === null ? NOT_YET : !s.storage ? "Your browser not tell Ooga how much it let sites keep."
        : `Your browser let this cave keep up to ${bytesOf(s.storage.quota)} (Ooga use ${bytesOf(s.storage.usage)}). In Chromium browsers quota grow with your disk, so big number mean big disk. Private windows get a small quota, and that is how sites guess you browse private.`
    },
    {
      caption: "Network and battery",
      draw: (c2, s) => !s.battery && !s.net ? waiting(c2, "OOGA SEE PIPE AND POWER", s.battery)
        : reading(c2, "OOGA SEE PIPE AND POWER", s.battery ? `${Math.round(s.battery.level * 100)}%` : s.battery === null ? LOOKING : "NO BATTERY", s.net ? `${s.net.type} ${s.net.rtt} MS`.toUpperCase() : "PIPE HIDDEN"),
      note: (s) => (s.net ? `Your pipe look like ${s.net.type}, about ${s.net.downlink} Mbit a second and ${s.net.rtt} ms there and back${s.net.saveData ? ", data saver on" : ""}. ` : "Your browser hide what pipe you are on. ")
        + (s.battery === null ? NOT_YET : !s.battery ? "It keep battery secret too. Firefox and Safari took battery away from pages because level and countdown change slowly, so for a while they could tie two sites you have open together."
          : s.battery.charging && s.battery.level === 1 ? "Battery say full and charging: plugged in, or no battery at all."
          : `Battery ${Math.round(s.battery.level * 100)}% and ${s.battery.charging ? "charging" : "draining"}. Level and countdown change slowly, so for a while they can tie two sites you have open together.`)
    },
    {
      caption: "Settings",
      draw: (c2, s) => reading(c2, "OOGA SEE YOUR SETTINGS", `${s.prefs.length} SET`, "OUT OF THE ORDINARY"),
      note: (s) => s.prefs.length ? `Ooga see: ${listOf(s.prefs)}. Each switch you flip split the crowd in two, so the rarer the switch, the easier you stand out.` : "Ooga see every look setting at default. That is most common, so you blend in."
    },
    {
      caption: "Privacy flags",
      draw: (c2, s) => reading(c2, "OOGA SEE YOUR FLAGS", s.dnt || s.gpc ? "FLAGS ON" : "FLAGS OFF", `DNT ${s.dnt ? "ON" : "OFF"} GPC ${s.gpc ? "ON" : "OFF"}`),
      note: (s) => `Do Not Track ${s.dnt ? "on" : "off"}, Global Privacy Control ${s.gpc ? "on" : "off"}. Cookies ${s.cookies ? "allowed" : "blocked"}, PDF viewer ${s.pdf ? "built in" : "missing"}${s.robot ? ", and browser say a robot drive it" : ""}. Funny thing: few people ask not to be tracked, so the flag itself make you easier to spot. Do Not Track is only a wish; Global Privacy Control has law behind it in some places.`
    },
    {
      caption: "Where you came from",
      draw: (c2, s) => reading(c2, "OOGA SEE YOUR TRAIL", s.referrer ? s.referrerHost.toUpperCase() : "STRAIGHT IN", plural(s.historyLength, "STEP IN TAB", "STEPS IN TAB")),
      note: (s) => (s.referrer ? `Ooga see you came from ${s.referrer}. The page that send you tell the new one, unless it ask not to.` : "No page sent you, or it ask browser not to say. Ooga not know where you came from.")
        + ` This tab hold ${plural(s.historyLength, "step", "steps")} of back-and-forth (Ooga see only the count, not where). You came in by ${s.arrival} and been on island ${s.stay}.`
    },
    {
      caption: "Canvas print",
      draw: (c2, s) => reading(c2, "OOGA PAINT PICTURE", s.print, "YOUR CANVAS PRINT"),
      note: (s) => `Ooga paint same secret picture every cave can paint. Your fonts, smoothing and picture rock paint it tiny bit different, so its hash ${s.print} follow you cave to cave, no cookie needed. If hash change every time you open this, your browser fib to Ooga on purpose. Good browser.`
    },
    {
      caption: "Audio print",
      draw: (c2, s) => !s.audio ? waiting(c2, "OOGA HUM QUIET TUNE", s.audio === null ? null : false) : reading(c2, "OOGA HUM QUIET TUNE", s.audio, "YOUR SOUND PRINT"),
      note: (s) => s.audio === null ? NOT_YET : !s.audio ? "Your browser not let Ooga hum." : `Ooga hum a tune inside your browser, never out loud, squash it, and hash what come out: ${s.audio}. Different chips and browsers round the sums different, so this follow you like the canvas print. If it change every time, your browser fib on purpose.`
    },
    {
      caption: "Fonts",
      draw: (c2, s) => reading(c2, "OOGA SNIFF FONTS", `${s.fonts.length} FONTS`, `OF ${FONTS.length} OOGA ASKED`),
      note: (s) => s.fonts.length ? `Ooga measure letters in ${FONTS.length} fonts and find you have ${listOf(s.fonts)}. Fonts tell which system you run, which office, design and coding apps you put on, and which languages. Some browsers now hide every font the system did not ship.` : "Ooga find none of the fonts it ask about. Your browser hide them, or your system very plain."
    },
    {
      caption: "Voices",
      draw: (c2, s) => !s.voices ? waiting(c2, "OOGA HEAR TALKING ROCKS", s.voices)
        : reading(c2, "OOGA HEAR TALKING ROCKS", plural(s.voices.length, "VOICE", "VOICES"), plural(new Set(s.voices.map((v) => v.lang)).size, "LANGUAGE", "LANGUAGES")),
      note: (s) => s.voices === null ? NOT_YET : !s.voices || !s.voices.length ? "Ooga hear no reading-aloud voices. Nothing to tell there."
        : `Your browser can read aloud in ${plural(s.voices.length, "voice", "voices")}: ${listOf(s.voices.slice(0, 12).map((v) => `${v.name} (${v.lang})`))}${s.voices.length > 12 ? ", and more" : ""}. Voices come with your system and language packs, so the list say a lot about both.`
    },
    {
      caption: "Hidden autofill", panel: "form",
      draw: (c2, s) => reading(c2, "OOGA HIDE BOXES", `${s.caught.length} CAUGHT`, "HIDDEN BOXES FILLED"),
      note: (s) => s.caught.length
        ? `Ooga catch ${s.caught.join(", ")} from boxes you never see. Bad cave take them same way. Ooga only count letters, never read them, and forget all when board close. Press Forget to clear now.`
        : "Put your name in Ooga box and pick your browser's fill-in. Ooga hide email, phone, street, postcode and workplace boxes where you no see. If browser fill them too, Ooga tell you here. Ooga only count letters, never read them."
    },
    {
      caption: "Typing rhythm", panel: "typing",
      draw: (c2, s) => s.typing.holds < 8 ? reading(c2, "OOGA HEAR FINGERS", "TYPE...", "IN OOGA BOX")
        : reading(c2, "OOGA HEAR FINGERS", `${s.typing.hold}/${s.typing.gap} MS`, "HOLD / GAP"),
      note: (s) => s.typing.holds < 8
        ? "Type the line in Ooga box. Ooga time how long you hold each key down and the gap before the next one."
        : `You hold each key about ${s.typing.hold} ms and leave about ${s.typing.gap} ms before the next, give or take ${s.typing.wobble} ms. That rhythm stay the same day to day, like your voice. Sites use it to tell people from bots, and to know you again when you log in as someone else. Ooga time only, never which keys, and forget when board close.`
    },
    {
      caption: "Mouse rhythm", panel: "mouse",
      draw: (c2, s) => !s.mouse.rate ? reading(c2, "OOGA FEEL MOUSE-STICK", "WIGGLE...", "IN OOGA PAD")
        : reading(c2, "OOGA FEEL MOUSE-STICK", `${s.mouse.rate} HZ`, `${s.mouse.kind} ${s.mouse.speed} PX/S`.toUpperCase()),
      note: (s) => !s.mouse.rate ? "Wiggle mouse-stick, pen or finger round Ooga pad. Ooga count how often your pointer report and how your hand move."
        : `Your ${s.mouse.kind} report about ${s.mouse.rate} times a second${s.mouse.rate >= 700 ? ": gamer mouse" : s.mouse.rate >= 350 ? ": fast mouse" : ""}. Your hand move about ${s.mouse.speed} pixels a second and turn about ${s.mouse.wobble} degrees between reports${s.mouse.pressure ? `, pen pressing ${Math.round(s.mouse.pressure * 100)}%` : ""}. How a hand speed up, slow down and wobble is like handwriting: bot catchers and fraud checkers watch it on every page. Ooga forget when board close.`
    },
    {
      caption: "Ooga name for you",
      draw: (c2, s) => reading(c2, "OOGA NAME FOR YOU", s.name, `FROM ${s.clues} CLUES`),
      note: (s) => `Ooga mash ${s.clues} clues from these pages into one name: ${s.name}. No cookie, no login, nothing stored, yet next time you come in this browser Ooga could work out the same name. Real trackers do exactly this, then hold it up against millions of other visitors to see how rare you are. Ooga have no server and no list, so Ooga cannot say how rare. Ooga forget it now.`
    },
    {
      caption: "Ooga won't: the network",
      draw: (c2) => reading(c2, "OOGA WON'T PEEK", "YOUR IP", "NEEDS THE NETWORK"),
      note: () => "Ooga cave make no calls about you, so Ooga skip leaks that need one:\n- Your public IP, and the town and internet company it point to.\n- WebRTC, which can show your home network address (it announce itself on your network to find it).\n- How your browser talk to servers: TLS and header order, which servers fingerprint from their side.\n- Which name server you use (DNS leak), and timing to servers round the world to guess where you are.\n- Supercookies hidden in cache tags, HSTS and favicons.\n- Poking ports on your home network and own computer to find your router and running programs."
    },
    {
      caption: "Ooga won't: ask you",
      draw: (c2) => reading(c2, "OOGA WON'T PEEK", "ASK FIRST", "NEEDS YOUR YES"),
      note: () => "These pop up a question before a page get them, and Ooga not ask:\n- Exact location from GPS or Wi-Fi.\n- What is on your clipboard.\n- Your camera picture and microphone sound, and your screen.\n- Bluetooth, USB, serial and game-controller gear, and MIDI instruments.\n- Notifications, which also prove you came back.\nSay yes only to sites you trust, and check what you allowed in site settings."
    },
    {
      caption: "Ooga won't: old tricks",
      draw: (c2) => reading(c2, "OOGA WON'T PEEK", "OLD TRICKS", "BLOCKED OR PATCHED"),
      note: () => "Some leaks browsers fixed, or Ooga's own rules block:\n- Reading your history by colouring visited links (patched).\n- Spotting your browser add-ons by loading their files.\n- Timing what is in your cache to see which sites you visited.\n- Third-party cookies that follow you between sites, now split per site or blocked in most browsers.\nOld tricks keep coming back in new shapes, so keep your browser updated."
    },
    {
      caption: "Ooga won't: watch you",
      draw: (c2) => reading(c2, "OOGA WON'T PEEK", "NO SPYING", "ONLY WHEN YOU LOOK"),
      note: () => "Ooga read only when you open this board. Plenty of sites watch all the time:\n- When you switch tabs, go idle or leave the window.\n- How far you scroll and where your pointer rest.\n- Session replay: every move and keypress recorded and played back later.\n- Typing and mouse rhythm on every page, quietly, not just in a box like Ooga's.\nPrivacy add-ons and strict browser modes block many of these."
    }
  ];
  // The clues the name is made from: what stays put between visits, not the window, the battery or the trail.
  const CLUES = [(s) => s.ua, (s) => s.languages.join(","), (s) => s.zone, (s) => `${s.screenW}x${s.screenH}@${s.ratio}/${s.depth}`,
    (s) => `${s.availW}x${s.availH}`, (s) => s.cores, (s) => s.memory, (s) => s.gpu.name, (s) => s.gpu.hash, (s) => s.touch,
    (s) => s.hints && `${s.hints.platformVersion}/${s.hints.architecture}`, (s) => s.layout && s.layout.name,
    (s) => s.devices && `${s.devices.video}/${s.devices.audio}/${s.devices.speaker}`, (s) => s.prefs.join(","), (s) => s.print,
    (s) => s.audio, (s) => s.fonts.join(","), (s) => s.voices && s.voices.length, (s) => s.number + s.date,
    (s) => `${s.dnt}/${s.gpc}/${s.pdf}`];
  const create = ({ form, typing, mouse }) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const c2 = canvas.getContext("2d", { alpha: false });
    const typed = typing.querySelector("input"), pad = mouse.querySelector(".leak-pad");
    const seen = { gpu: readGpu(), caught: [], typing: { holds: 0, hold: 0, gap: 0, wobble: 0 }, mouse: { rate: 0, kind: "", speed: 0, wobble: 0, pressure: 0 } };
    // Raw rhythm sums, kept apart from what the pages show.
    const keys = { down: new Map(), lastUp: 0, holds: 0, holdSum: 0, gaps: 0, gapSum: 0, gapSq: 0 };
    const GAPS = 256, pointer = { gaps: new Float64Array(GAPS), sorted: new Float64Array(GAPS), count: 0, last: 0, x: 0, y: 0, angle: NaN, dist: 0, time: 0, turn: 0, turns: 0, shown: 0 };
    let opening = 0, voiceWait = 0, voiceHeard = null;
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
    const stopVoices = () => {
      clearTimeout(voiceWait);
      if (voiceHeard) speechSynthesis.removeEventListener("voiceschanged", voiceHeard);
      voiceWait = 0;
      voiceHeard = null;
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
    const board = {
      title: "Leak Check", help: "Ooga look only in your browser. Nothing stored, nothing sent.",
      canvas, count: PAGES.length, index: 0, version: 0, caption: "", note: "",
      get panel() {
        const panel = PAGES[board.index].panel;
        return panel === "form" ? form : panel === "typing" ? typing : panel === "mouse" ? mouse : null;
      },
      go(i) {
        board.index = i;
        board.draw();
      },
      draw() {
        const page = PAGES[board.index];
        name();
        c2.fillStyle = BG;
        c2.fillRect(0, 0, W, H);
        page.draw(c2, seen);
        board.caption = page.caption;
        board.note = page.note(seen);
        board.version++;
      },
      // Everything is read here, once an opening, and never in a frame. Late answers redraw the page they land on.
      open() {
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
        seen.bar = barH > 0 ? `${barH} px at the ${screen.availTop > 0 ? "top" : "bottom"}` : barW > 0 ? `${barW} px at the ${screen.availLeft > 0 ? "left" : "right"}` : "nothing";
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
        seen.referrerHost = "";
        try { seen.referrerHost = new URL(document.referrer).host; } catch { seen.referrerHost = document.referrer; }
        seen.historyLength = history.length;
        const entry = performance.getEntriesByType("navigation")[0], minutes = Math.floor(performance.now() / 60000);
        seen.arrival = !entry ? "a way Ooga not see" : entry.type === "reload" ? "reloading" : entry.type === "back_forward" ? "going back or forward" : "following a link or typing the address";
        seen.stay = minutes < 1 ? "less than a minute" : plural(minutes, "minute", "minutes");
        seen.print = canvasPrint();
        seen.fonts = readFonts();
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
        stopVoices();
        later("voices", !window.speechSynthesis ? Promise.resolve(false) : new Promise((resolve) => {
          const now = speechSynthesis.getVoices();
          if (now.length) return resolve(now.map((v) => ({ name: v.name, lang: v.lang })));
          const hear = () => {
            stopVoices();
            resolve(speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang })));
          };
          voiceHeard = hear;
          speechSynthesis.addEventListener("voiceschanged", hear);
          voiceWait = setTimeout(hear, 1500);
        }));
        forget();
        board.draw();
      },
      onClose: forget,
      dispose() {
        opening++;
        stopVoices();
        forget();
        form.removeEventListener("input", onInput);
        form.removeEventListener("submit", onSubmit);
        form.removeEventListener("click", onForget);
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
      if (PAGES[board.index].panel === "form") board.draw();
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
      if (PAGES[board.index].panel === "typing") board.draw();
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
      if (PAGES[board.index].panel === "mouse") board.draw();
    };
    form.addEventListener("input", onInput);
    form.addEventListener("submit", onSubmit);
    form.addEventListener("click", onForget);
    typed.addEventListener("keydown", onKeyDown);
    typed.addEventListener("keyup", onKeyUp);
    pad.addEventListener("pointermove", onPointerMove);
    return board;
  };
  BL.leakCheck = { create };
})();
