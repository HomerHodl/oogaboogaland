// The Leak Check kiosk's board: what the visitor's own browser tells any page that asks, read when the board opens
// and shown in Ooga-speak through the shared board dialog (`hud.openBoard`). Each page is a reading in the jumbotron's
// 5x7 font on the board's small canvas, a caption and a note, as the Mempool island's boards draw theirs. Nothing is
// stored or sent: every value stays in this module's `seen` until the next open, and the page makes no request.
//
// The last page is the hidden-autofill demo. Its `panel` is the `#leak-form` from index.html: a name box the visitor
// sees, and email, phone and address boxes kept off screen. When the browser fills the hidden ones along with the name,
// the board counts which and how many letters, never reading or keeping the text, and empties every box on Forget, on
// close and in `dispose`.
//
// `create(form)` returns the board, plus `open()` (read and draw), `onClose()` and `dispose()`. The GPU's name is asked
// of one throwaway WebGL context once a page, since every context counts against the browser's limit.
(() => {
  "use strict";
  const BL = window.BL;
  const W = 128, H = 48, BG = "#0f110f", DIM = "#9b8f7a", INK = "#7ff5e6";
  const text = BL.jumbotron.text;
  const HIDDEN = { email: "email", tel: "phone", street: "street", postal: "postcode", org: "workplace" };
  const BROWSERS = [["Edg/", "Edge"], ["OPR/", "Opera"], ["Firefox/", "Firefox"], ["FxiOS/", "Firefox"], ["CriOS/", "Chrome"], ["Chrome/", "Chrome"], ["Version/", "Safari"]];
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
    if (!gl) return gpu = "";
    // Chrome masks RENDERER and answers on the debug extension; Firefox answers RENDERER and warns on the extension.
    let name = gl.getParameter(gl.RENDERER);
    if (!name || /^WebKit/.test(name)) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      if (info) name = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    }
    return gpu = String(name || "");
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
    const px = c2.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < px.length; i++) hash = Math.imul(hash ^ px[i], 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
  };
  const utcOf = (minutes) => {
    const a = Math.abs(minutes);
    return `UTC${minutes < 0 ? "-" : "+"}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
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
  const PAGES = [
    {
      caption: "Who you are",
      draw: (c2, s) => reading(c2, "OOGA SEE YOU ON", s.os.toUpperCase(), s.browser.toUpperCase()),
      note: (s) => `Ooga see you ride ${s.browser} on ${s.os}. Your browser shout this to every cave it visit, before anyone ask.\nWhole shout: ${s.ua}`
    },
    {
      caption: "Talk and time",
      draw: (c2, s) => reading(c2, "OOGA HEAR YOU SPEAK", s.languages[0].toUpperCase(), s.zone.toUpperCase()),
      note: (s) => `Ooga hear you speak ${s.languages.join(", ")}. Your sun-clock say ${s.zone} (${s.utc}). Talk and sun-clock together tell any cave roughly where in world you sleep.`
    },
    {
      caption: "Screen",
      draw: (c2, s) => reading(c2, "OOGA SEE CAVE WALL", `${s.screenW}X${s.screenH}`, `PIXEL RATIO ${s.ratio}`),
      note: (s) => `Ooga see your cave wall is ${s.screenW} by ${s.screenH}, each dot ${s.ratio} pixels thick and ${s.depth} colour-bits deep. This window ${s.windowW} by ${s.windowH}. Not many Ooga have exact same wall.`
    },
    {
      caption: "CPU and memory",
      draw: (c2, s) => reading(c2, "BRAIN-ROCKS", s.cores ? `${s.cores} CORES` : "HIDDEN", s.memory ? `${s.memory} GB MEMORY` : "MEMORY HIDDEN"),
      note: (s) => (s.cores ? `Ooga see you have ${plural(s.cores, "brain-rock", "brain-rocks")} thinking at once` : "Your browser hide how many brain-rocks you have")
        + (s.memory ? ` and about ${s.memory} GB of remember-sand. Browser round it so Ooga not count exact.` : ". It not tell Ooga your remember-sand either. Sneaky browser, good browser.")
    },
    {
      caption: "GPU",
      draw: (c2, s) => reading(c2, "OOGA SEE PICTURE ROCK", s.gpu ? shortGpu(s.gpu).toUpperCase() : "SECRET", "ASKED THROUGH WEBGL"),
      note: (s) => s.gpu ? `Ooga ask WebGL and it say: ${s.gpu}. Picture-rock name narrow you down a lot, and any cave can ask it.` : "WebGL not answer Ooga. Your picture rock stay secret."
    },
    {
      caption: "Touch",
      draw: (c2, s) => reading(c2, "OOGA FEEL FOR FINGERS", s.touch ? `${s.touch} FINGERS` : "NO TOUCH", s.coarse ? "POINTER COARSE" : "POINTER FINE"),
      note: (s) => s.touch ? `Ooga see your screen feel ${plural(s.touch, "finger", "fingers")} at once${s.coarse ? ". Cave know you poke with your hand." : ", but you mostly poke with mouse-stick. Cave know you have touch laptop."}`
        : "Ooga see no touch. You poke with mouse-stick. Cave know you sit at big computer."
    },
    {
      caption: "Canvas print",
      draw: (c2, s) => reading(c2, "OOGA PAINT PICTURE", s.print, "YOUR CANVAS PRINT"),
      note: (s) => `Ooga paint same secret picture every cave can paint. Your fonts, smoothing and picture rock paint it tiny bit different, so its hash ${s.print} follow you cave to cave, no cookie needed. If hash change every time you open this, your browser fib to Ooga on purpose. Good browser.`
    },
    {
      caption: "Hidden autofill", panel: true,
      draw: (c2, s) => reading(c2, "OOGA HIDE BOXES", `${s.caught.length} CAUGHT`, "HIDDEN BOXES FILLED"),
      note: (s) => s.caught.length
        ? `Ooga catch ${s.caught.join(", ")} from boxes you never see. Bad cave take them same way. Ooga only count letters, never read them, and forget all when board close. Press Forget to clear now.`
        : "Put your name in Ooga box and pick your browser's fill-in. Ooga hide email, phone, street, postcode and workplace boxes where you no see. If browser fill them too, Ooga tell you here. Ooga only count letters, never read them."
    }
  ];
  const create = (form) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const c2 = canvas.getContext("2d", { alpha: false });
    const seen = { ua: "", os: "", browser: "", languages: [""], zone: "", utc: "", screenW: 0, screenH: 0, ratio: 1, depth: 0, windowW: 0, windowH: 0, cores: 0, memory: 0, gpu: "", touch: 0, coarse: false, print: "", caught: [] };
    const clear = () => {
      form.reset();
      seen.caught.length = 0;
    };
    const catches = () => {
      seen.caught.length = 0;
      for (const name in HIDDEN) {
        const n = form.elements[name].value.length;
        if (n) seen.caught.push(`${HIDDEN[name]} (${plural(n, "letter", "letters")})`);
      }
    };
    const board = {
      title: "Leak Check", help: "Ooga look only in your browser. Nothing stored, nothing sent.",
      canvas, count: PAGES.length, index: 0, version: 0, caption: "", note: "",
      get panel() { return PAGES[board.index].panel ? form : null; },
      go(i) {
        board.index = i;
        board.draw();
      },
      draw() {
        const page = PAGES[board.index];
        c2.fillStyle = BG;
        c2.fillRect(0, 0, W, H);
        page.draw(c2, seen);
        board.caption = page.caption;
        board.note = page.note(seen);
        board.version++;
      },
      // Everything is read here, once an opening, and never in a frame.
      open() {
        const ua = navigator.userAgent;
        seen.ua = ua;
        seen.os = osOf(ua);
        seen.browser = browserOf(ua);
        seen.languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "unknown"];
        seen.zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
        seen.utc = utcOf(-new Date().getTimezoneOffset());
        seen.screenW = screen.width;
        seen.screenH = screen.height;
        seen.ratio = Math.round(window.devicePixelRatio * 100) / 100;
        seen.depth = screen.colorDepth;
        seen.windowW = window.innerWidth;
        seen.windowH = window.innerHeight;
        seen.cores = navigator.hardwareConcurrency || 0;
        seen.memory = navigator.deviceMemory || 0;
        seen.gpu = readGpu();
        seen.touch = navigator.maxTouchPoints || 0;
        seen.coarse = window.matchMedia("(pointer: coarse)").matches;
        seen.print = canvasPrint();
        clear();
        board.draw();
      },
      onClose: clear,
      dispose() {
        clear();
        form.removeEventListener("input", onInput);
        form.removeEventListener("submit", onSubmit);
        form.removeEventListener("click", onClick);
      }
    };
    const onInput = () => {
      catches();
      if (PAGES[board.index].panel) board.draw();
    };
    const onSubmit = (e) => e.preventDefault();
    const onClick = (e) => {
      if (!e.target.closest(".leak-forget")) return;
      e.target.blur();
      clear();
      board.draw();
    };
    form.addEventListener("input", onInput);
    form.addEventListener("submit", onSubmit);
    form.addEventListener("click", onClick);
    return board;
  };
  BL.leakCheck = { create };
})();
