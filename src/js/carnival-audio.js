// Ooga Arcade's sound, the carnival games' and the hall's, on Ooga Mine's pattern: one AudioContext opened from a
// gesture the browser has already activated and fixed pools of pre-started voices, each gated by gain and panned:
// tone voices, noise voices, skin drums (a sine whose pitch drops under the hit) and Ooga throats (a sawtooth
// through two band-passes at a vowel's formants, for grunts, chants and the OOGA! shout). A cue only schedules
// automation on a pooled voice: nothing is allocated per cue and nothing is ever restarted. Every sound is the
// Oogas' own: coconut and log toks, a bamboo marimba, skin drums, a tusk horn, a gourd shaker and their voices, and
// the drums and voices ring in a cave echo. `cue(name, level, pan)` plays a cue quieter and to one side, for a sound
// placed in the hall; `room(on)` fades the hall's bed in or out, a jungle cave at night (crickets, a far bird, the
// fire's roar and crackle, a soft drum pulse and now and then the Oogas chanting), and `tick` schedules the bed a
// moment ahead. It shares the rally's mute key.
//
// The retro cabinets speak through a chip of their own (`create(true)` builds it): two pulse channels, a triangle and
// a noise channel, as an 8-bit console's sound was. `chip(name, level)` plays a chip cue straight ahead, and
// `music(id)` loops a game's tune (`SONGS`) on the same four channels, `pause` halting and resuming it; a cue takes a
// channel from the tune for as long as it sounds, as a console's sound effects did, and the big ones duck it.
(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const VOICES = 14, NOISES = 6, DRUMS = 4, THROATS = 3, NOISE_SECONDS = 2, MASTER = 0.45, STORAGE_KEY = "oogaboogaland.audio";
  // The bed's drum pulse, a step every `STEP` seconds over sixteen: the low skin drum's level on each step (0 rests)
  // and the hand drum's; every fourth bar the hand drum fills its last four steps. `AHEAD` is how far ahead `tick`
  // schedules the bed.
  const LOW = [1, 0, 0, 0.45, 0, 0, 0.7, 0, 0.9, 0, 0, 0.45, 0, 0.35, 0.6, 0];
  const HAND = [0, 0, 0.6, 0, 0.35, 0, 0, 0.5, 0, 0, 0.6, 0, 0.35, 0, 0, 0.25];
  const STEP = 0.2, AHEAD = 0.2;
  // The throats' vowels, as their first two formants in hertz.
  const OO = [300, 780], OH = [470, 900], AH = [740, 1180], UH = [600, 1100];

  // ---- the chip's data ----------------------------------------------------------------------------------
  // The pulses' duties (12.5, 25 and 50 per cent), each a PeriodicWave of `HARMONICS` partials; the noise, a 15-bit
  // shift register's `LFSR` bits looped and clocked by its playback rate; `CHIP`, the chip's full level under
  // MASTER, which a chip cue's levels (0 to 1) are shares of; `HZ`, each MIDI note's pitch.
  const CHIP = 0.1, DUTY = [0.125, 0.25, 0.5], HARMONICS = 64, LFSR = 32767, HZ = new Float32Array(128);
  for (let m = 0; m < 128; m++) HZ[m] = 440 * Math.pow(2, (m - 69) / 12);
  // A tune under a big cue plays at DUCK of its level until the cue is done, then comes back over DUCK_BACK seconds;
  // the carnival cues that duck it, and for how long; how far ahead `tick` schedules a tune.
  const DUCK = 0.35, DUCK_BACK = 0.5, SONG_AHEAD = 0.1, DUCKS = { ooga: 1.4, best: 1.2, star0: 0.6, star1: 0.6, star2: 0.8, groan: 0.8 };
  // The chip cues' runs of notes (MIDI): the invaders' march, four steps down; a coin; a pickup; a sparkle; a gulp;
  // ready; a miss; a score; a bonus; a life; a lost life's fall; an alarm's two tones, a beat each; a power-up's
  // triads, climbing a semitone at a time.
  const MARCH = [43, 42, 41, 40], COIN = [83, 88], PICKUP = [72, 76, 79, 84], SPARKLE = [96, 91, 96, 91, 100], CHOMP = [64, 71], READY = [72, 79], MISS = [67, 62];
  const SCORE = [88, 91, 96], BONUS = [72, 76, 79, 84, 88, 91, 96], ONEUP = [79, 83, 86, 91, 95, 98], FALL = [79, 77, 76, 74, 72, 71, 69, 67, 65, 64, 62, 60];
  const ALARM = [81, 76, 81, 76, 81, 76], ONES = [1, 1, 1, 1, 1, 1], RISE = [];
  for (let k = 0; k < 8; k++) RISE.push(60 + k, 64 + k, 67 + k);
  // The jingles: a lead and a harmony on the pulses and a bass on the triangle, each note (0 rests) lasting its
  // `beats` (the bass its own) of `beat` seconds; `len` is the whole, worked out here.
  const JINGLES = {
    clear: { beat: 0.09, lead: [72, 76, 79, 84], harm: [67, 72, 76, 79], beats: [1, 1, 1, 5], bass: [36, 43, 48], bassBeats: [1, 2, 5], len: 0 },
    win: { beat: 0.1, lead: [67, 72, 76, 79, 0, 76, 79], harm: [64, 67, 72, 76, 0, 72, 76], beats: [1, 1, 1, 2, 1, 1, 6], bass: [48, 0, 43, 48], bassBeats: [3, 1, 2, 7], len: 0 },
    over: { beat: 0.17, lead: [76, 75, 74, 73], harm: [72, 71, 70, 69], beats: [1, 1, 1, 4], bass: [45, 44, 43, 42], bassBeats: [1, 1, 1, 4], len: 0 }
  };
  for (const j of Object.values(JINGLES)) j.len = j.beats.reduce((s, b) => s + b, 0) * j.beat;
  // A tune's drums on the noise, by kit number (1 hat, 2 snare, 3 kick): the clock's rate, the low-pass, how long it
  // rings and its level.
  const DRUM_RATE = [0, 1, 0.3, 0.12], DRUM_LP = [0, 11000, 6000, 1500], DRUM_S = [0, 0.035, 0.13, 0.09], DRUM_PEAK = [0, 0.16, 0.3, 0.35];
  // Each retro game's tune, looping while it plays: its tempo, the lead's duty, and bars of sixteenth notes, the lead
  // on the first pulse and the bass on the triangle (a note, "-" holding the one before, "." resting), and the drums
  // on the noise ("k" kick, "s" snare, "x" hat), whose `beat` bar repeats with `fill` as the last.
  // `tune` reads them once, at load, into typed arrays: each step's note (MIDI, 0 none) and, where one starts, how
  // many steps it lasts. The lead's level evens out its duty (`LEAD`); `BASS` is the triangle's.
  const LEAD = [0.58, 0.48, 0.32], BASS = 0.4, KIT = { k: 3, s: 2, x: 1, ".": 0 }, PITCH = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const line = (bars, n) => {
    const note = new Int8Array(n), len = new Uint8Array(n);
    let i = 0, on = -1;
    for (const t of bars.join(" ").split(/\s+/)) {
      if (t === "-") len[on]++;
      else if (t === ".") on = -1;
      else { note[i] = 12 * (Number(t[t.length - 1]) + 1) + PITCH[t[0]] + (t[1] === "#" ? 1 : 0); len[i] = 1; on = i; }
      i++;
    }
    if (i !== n) throw new Error(`carnival-audio: a tune line of ${i} steps, not ${n}`);
    return { note, len };
  };
  const tune = (bpm, duty, lead, bass, beat, fill) => {
    const n = lead.length * 16, L = line(lead, n), B = line(bass, n), drum = new Int8Array(n), kit = beat.split(" "), last = fill.split(" ");
    for (let i = 0; i < n; i++) drum[i] = KIT[(i < n - 16 ? kit : last)[i & 15]];
    return { step: 15 / bpm, n, duty, level: LEAD[duty], lead: L.note, leadLen: L.len, bass: B.note, bassLen: B.len, drum };
  };
  const SONGS = {
    // Coconut Invaders: E minor, dark and marching, a thin pulse creeping over a pulsing bass.
    invaders: tune(126, 0, [
      "e4 - - - g4 - - - f#4 - e4 - d#4 - - -",
      "e4 - - - b4 - - - a4 - g4 - f#4 - - -",
      "g4 - - - c5 - - - b4 - a4 - g4 - - -",
      "f#4 - - - d#4 - - - b3 - - - . . . .",
      "e4 - - - g4 - - - f#4 - e4 - d#4 - - -",
      "e4 - - - b4 - - - c5 - b4 - a4 - - -",
      "a4 - - - c5 - - - e5 - - - d5 - c5 -",
      "b4 - - - a4 - g4 - f#4 - - - d#4 - - -"
    ], [
      "e2 . e2 . e3 . e2 . e2 . e2 . e3 . d3 .",
      "e2 . e2 . e3 . e2 . e2 . e2 . e3 . d3 .",
      "c2 . c2 . c3 . c2 . c2 . c2 . c3 . b2 .",
      "b1 . b1 . b2 . b1 . b1 . b1 . b2 . d#2 .",
      "e2 . e2 . e3 . e2 . e2 . e2 . e3 . d3 .",
      "e2 . e2 . e3 . e2 . c2 . c2 . c3 . c2 .",
      "a2 . a2 . a3 . a2 . a2 . a2 . a3 . g2 .",
      "b1 . b1 . b2 . b1 . b1 . f#2 . b2 . d#2 ."
    ], "k . x . s . x . k . x k s . x .", "k . x . s . x . s . s s s s s s"),
    // Banana Snake: D with a snake charmer's flat second, bouncing along.
    snake: tune(144, 1, [
      "a4 . a#4 a4 f#4 . a4 . g4 f#4 d#4 f#4 d4 - - .",
      "a4 . a#4 a4 f#4 . a4 . c5 a#4 a4 g4 a4 - - .",
      "g4 . a#4 . d#5 - d5 c5 a#4 . c5 a#4 g4 - - .",
      "f#4 . a4 . d5 - - . c5 a#4 a4 f#4 d4 - - .",
      "g4 - a#4 - d5 - a#4 - g4 - f#4 g4 a4 - - .",
      "a4 . f#4 . d4 . f#4 . a4 . d5 . c5 - a4 .",
      "a#4 . a4 . g4 . d#4 . g4 . a#4 . d#5 - d5 .",
      "c5 a#4 a4 g4 f#4 . d#4 . d4 - - - . . a3 ."
    ], [
      "d2 . a2 . d3 . a2 . d2 . a2 . d3 . a2 .",
      "d2 . a2 . d3 . a2 . d2 . a2 . d3 . a2 .",
      "d#2 . a#2 . d#3 . a#2 . d#2 . a#2 . d#3 . a#2 .",
      "d2 . a2 . d3 . a2 . d2 . a2 . d3 . c3 .",
      "g2 . d3 . g2 . d3 . g2 . d3 . a#2 . a2 .",
      "d2 . a2 . d3 . a2 . d2 . a2 . d3 . a2 .",
      "d#2 . a#2 . d#3 . a#2 . d#2 . a#2 . g2 . d#2 .",
      "d2 . a2 . d3 . a2 . d2 . f#2 . a2 . a2 ."
    ], "k . x . s . x x k . x . s . x x", "k . x . s . x x s . s . s s s s"),
    // Ooga Pong: G major and sporty, a bright line batted up and down.
    pong: tune(138, 1, [
      "g4 . b4 . d5 . b4 . g5 - - . d5 . b4 .",
      "c5 . e5 . g5 . e5 . c6 - - . g5 . e5 .",
      "d5 . f#5 . a5 . f#5 . d5 . e5 . f#5 . a5 .",
      "g5 - - . d5 . b4 . g4 - - - . . . .",
      "e5 . g5 . b5 . g5 . e5 - d5 - b4 - - .",
      "c5 . e5 . g5 - e5 . c5 - d5 - e5 - - .",
      "f#5 - e5 - d5 - c5 - b4 - a4 - f#4 - - .",
      "a4 . d5 . f#5 . a5 . c6 - - . a5 . f#5 ."
    ], [
      "g2 . g3 . d3 . g3 . g2 . g3 . d3 . b2 .",
      "c2 . c3 . g2 . c3 . c2 . c3 . g2 . e2 .",
      "d2 . d3 . a2 . d3 . d2 . d3 . a2 . f#2 .",
      "g2 . g3 . d3 . g3 . g2 . d3 . b2 . g2 .",
      "e2 . e3 . b2 . e3 . e2 . e3 . b2 . g2 .",
      "c2 . c3 . g2 . c3 . c2 . c3 . g2 . e2 .",
      "d2 . d3 . a2 . d3 . d2 . d3 . a2 . f#2 .",
      "d2 . d3 . a2 . c3 . d2 . d3 . c3 . a2 ."
    ], "k . x . s . x . k k x . s . x .", "k . x . s . x . s . s . s s s s"),
    // Mammoth Stampede: F major, a hopping folk tune over a galloping bass.
    stampede: tune(124, 1, [
      "c5 - a4 - f4 - a4 - c5 - d5 c5 a4 - - .",
      "c5 - a4 - f4 - a4 - g4 - - - . . . .",
      "d5 - a#4 - f4 - a#4 - d5 - f5 d5 c5 - - .",
      "a4 - c5 - f5 - c5 - a4 - g4 - f4 - - .",
      "g4 - e4 - c4 - e4 - g4 - a4 - a#4 - - .",
      "a4 - f4 - c4 - f4 - a4 - a#4 - c5 - - .",
      "d5 - c5 - a#4 - d5 - c5 - a#4 - a4 - g4 -",
      "f4 - a4 - c5 - - . f5 - - - - . . ."
    ], [
      "f2 . f2 f2 c3 . c3 c3 f2 . f2 f2 c3 . a2 a2",
      "f2 . f2 f2 c3 . c3 c3 c2 . c2 c2 g2 . e2 e2",
      "a#1 . a#1 a#1 f2 . f2 f2 a#1 . a#1 a#1 f2 . d2 d2",
      "f2 . f2 f2 c3 . c3 c3 c2 . c2 c2 g2 . c2 c2",
      "c2 . c2 c2 g2 . g2 g2 c2 . c2 c2 g2 . e2 e2",
      "f2 . f2 f2 c3 . c3 c3 f2 . f2 f2 a2 . a2 a2",
      "a#1 . a#1 a#1 f2 . f2 f2 c2 . c2 c2 g2 . e2 e2",
      "f2 . f2 f2 c3 . c3 c3 f2 . . . c2 . . ."
    ], "k . x x s . x x k . x x s . x x", "k . x x s . x x s . s s s s s s"),
    // Ptero Flap: A with a raised fourth, airy and high, a light pulse gliding over a slow bass.
    flap: tune(112, 0, [
      "e5 - - - c#5 - e5 - a5 - - - g#5 - e5 -",
      "f#5 - - - d#5 - f#5 - b5 - - - a5 - f#5 -",
      "e5 - - - c#5 - e5 - a5 - b5 - c#6 - - -",
      "b5 - a5 - f#5 - d#5 - f#5 - - - - - . .",
      "c#5 - - - a4 - c#5 - f#5 - - - e5 - c#5 -",
      "d5 - - - f#5 - a5 - d6 - - - c#6 - a5 -",
      "b5 - - - g#5 - e5 - b4 - - - e5 - g#5 -",
      "b5 - - - - - - - . . . . e5 - - -"
    ], [
      "a2 - - - - - . . e3 - - - . . a2 .",
      "b2 - - - - - . . f#3 - - - . . b2 .",
      "a2 - - - - - . . e3 - - - . . a2 .",
      "b2 - - - - - . . f#3 - - - . . d#3 .",
      "f#2 - - - - - . . c#3 - - - . . f#2 .",
      "d2 - - - - - . . a2 - - - . . d2 .",
      "e2 - - - - - . . b2 - - - . . e2 .",
      "e2 - - - - - . . b2 - - - . . g#2 ."
    ], "k . . x . . x . s . . x . . x .", "k . . x . . x . s . s . s s s s"),
    // Rock Breaker: A minor, driving, a fat square riff over pumping octaves.
    breaker: tune(148, 2, [
      "a4 . a4 . c5 . a4 . d5 . c5 . a4 . g4 .",
      "a4 . a4 . c5 . a4 . e5 - d5 - c5 - a4 .",
      "f5 . f5 . e5 . c5 . f5 . e5 . c5 . a4 .",
      "g5 . g5 . f5 . d5 . g5 - - - b4 - - .",
      "a4 . a4 . c5 . a4 . d5 . c5 . a4 . g4 .",
      "a4 . c5 . e5 . a5 . g5 - e5 - c5 - d5 .",
      "c5 - - . a4 . f4 . d5 - - . b4 . g4 .",
      "e5 - - - g#5 - - - b5 - - - g#5 - e5 -"
    ], [
      "a2 . a2 . a3 . a2 . a2 . a2 . a3 . g3 .",
      "a2 . a2 . a3 . a2 . a2 . a2 . a3 . c3 .",
      "f2 . f2 . f3 . f2 . f2 . f2 . f3 . e3 .",
      "g2 . g2 . g3 . g2 . g2 . g2 . g3 . b2 .",
      "a2 . a2 . a3 . a2 . a2 . a2 . a3 . g3 .",
      "a2 . a2 . a3 . a2 . a2 . a2 . a3 . c3 .",
      "f2 . f3 . f2 . f3 . g2 . g3 . g2 . g3 .",
      "e2 . e3 . e2 . e3 . e2 . e3 . g#3 . b3 ."
    ], "k . x . s . x . k . k . s . x x", "k . x . s . x . s s . s s s s s"),
    // Dino Dash: C major, heroic and fast, octaves running under it.
    dash: tune(164, 1, [
      "g4 . c5 . e5 . g5 . e5 . c5 . e5 - - .",
      "d5 . g5 . b5 . g5 . d5 - b4 - d5 - - .",
      "c5 . e5 . a5 . e5 . c5 - a4 - c5 - - .",
      "a4 . c5 . f5 . a5 . g5 - f5 - e5 - d5 -",
      "e5 - - - g5 - - - c6 - - - b5 - a5 -",
      "g5 - - - d5 - - - g5 - a5 - b5 - - -",
      "a5 - g5 - f5 - a5 - g5 - f5 - d5 - b4 -",
      "c5 - - - e5 - g5 - c6 - - - . . g4 ."
    ], [
      "c2 . c3 . c2 . c3 . c2 . c3 . c2 . c3 .",
      "b2 . b3 . b2 . b3 . g2 . g3 . g2 . g3 .",
      "a2 . a3 . a2 . a3 . a2 . a3 . a2 . a3 .",
      "f2 . f3 . f2 . f3 . f2 . f3 . f2 . f3 .",
      "c2 . c3 . c2 . c3 . c2 . c3 . c2 . c3 .",
      "g2 . g3 . g2 . g3 . g2 . g3 . g2 . g3 .",
      "f2 . f3 . f2 . f3 . g2 . g3 . g2 . g3 .",
      "c2 . c3 . c2 . c3 . c2 . g2 . a2 . b2 ."
    ], "k . x . s . x . k . x . s . x k", "k . x . s . x . s . s . s s s s"),
    // Stone Stacker: D minor, steady and hypnotic, a hollow square turning over and over.
    stacker: tune(132, 2, [
      "d5 - f5 - a5 - f5 - e5 - d5 - c#5 - d5 -",
      "a4 - - - d5 - - - f5 - e5 - d5 - - -",
      "e5 - g5 - e5 - c#5 - a4 - c#5 - e5 - - -",
      "f5 - e5 - d5 - a4 - d5 - - - . . . .",
      "g5 - - - a#5 - a5 - g5 - f5 - d5 - - -",
      "f5 - - - a5 - g5 - f5 - e5 - d5 - - -",
      "c#5 - e5 - a5 - g5 - e5 - c#5 - a4 - - -",
      "d5 - - - - - - - . . a4 - c#5 - - -"
    ], [
      "d2 . a2 . d3 . a2 . d2 . a2 . d3 . a2 .",
      "d2 . a2 . d3 . a2 . d2 . a2 . d3 . a2 .",
      "a2 . e3 . a3 . e3 . a2 . e3 . c#3 . e3 .",
      "d2 . a2 . d3 . a2 . d2 . a2 . d3 . c3 .",
      "g2 . d3 . g3 . d3 . g2 . d3 . a#2 . d3 .",
      "d2 . a2 . d3 . a2 . d2 . a2 . d3 . a2 .",
      "a2 . e3 . a3 . e3 . a2 . e3 . c#3 . e3 .",
      "d2 . a2 . d3 . a2 . d2 . a2 . c#3 . e3 ."
    ], "k . x . s . x . k . x . s . x .", "k . x . s . x . s . s . s s s s")
  };

  const create = (withChip = false) => {
    let ctx = null, master = null, send = null, ready = false, muted = false, level = 1, pan = 0, bend = 1;
    let bed = null, bedOn = false, beatAt = 0, beatStep = 0, cricketAt = 0, cricketI = 0, crackAt = 0, roarAt = 0, birdAt = 0, callI = 0, chantAt = 0, gruntI = 0, tapI = 0;
    try {
      muted = localStorage.getItem(STORAGE_KEY) === "off";
    } catch {
    }
    const voices = [], noises = [], drums = [], throats = [], running = [];
    let voiceNext = 0, noiseNext = 0, drumNext = 0, throatNext = 0;
    // The chip's four channels (two pulses, the triangle, the noise: { f, gain, osc, wave, vib, lp, until }, `until`
    // when a cue lets it go), its pulse waves, the march's next step, and the tune playing (`M.tune`, one of SONGS),
    // its next step (`M.step`, due at `M.at`), whether it is paused, and until when it is ducked, written in place.
    const chips = [], M = { tune: null, step: 0, at: 0, paused: false, duck: 0 };
    let waves = null, marchI = 0;

    const init = () => {
      if (ctx || typeof AudioContext === "undefined") return;
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER;
      master.connect(ctx.destination);
      // A started source, kept to stop on dispose.
      const run = (node) => { node.start(); running.push(node); return node; };
      // The cave's echo: a feedback delay darkening on each return, which the bed, the drums and the throats feed.
      const delay = ctx.createDelay(1), back = ctx.createGain(), dark = ctx.createBiquadFilter();
      send = ctx.createGain();
      send.gain.value = 0.5;
      delay.delayTime.value = 0.23;
      back.gain.value = 0.35;
      dark.type = "lowpass";
      dark.frequency.value = 1500;
      send.connect(delay);
      delay.connect(dark);
      dark.connect(back);
      back.connect(delay);
      dark.connect(master);
      const buffer = ctx.createBuffer(1, ctx.sampleRate * NOISE_SECONDS, ctx.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noiseSource = () => { const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true; return src; };
      // A voice's gate and panner, into the master and, `wet`, the echo too.
      const gate = (wet) => {
        const gain = ctx.createGain(), panner = ctx.createStereoPanner();
        gain.gain.value = 0;
        gain.connect(panner);
        panner.connect(master);
        if (wet) panner.connect(send);
        return { gain, panner, until: 0 };
      };
      for (let i = 0; i < VOICES; i++) {
        const v = gate(false);
        v.osc = ctx.createOscillator();
        v.osc.connect(v.gain);
        run(v.osc);
        voices.push(v);
      }
      for (let i = 0; i < NOISES; i++) {
        const n = gate(false), src = noiseSource();
        n.filter = ctx.createBiquadFilter();
        n.filter.type = "bandpass";
        n.filter.Q.value = 0.9;
        src.connect(n.filter);
        n.filter.connect(n.gain);
        run(src);
        noises.push(n);
      }
      for (let i = 0; i < DRUMS; i++) {
        const d = gate(true);
        d.osc = ctx.createOscillator();
        d.osc.connect(d.gain);
        run(d.osc);
        drums.push(d);
      }
      for (let i = 0; i < THROATS; i++) {
        const t = gate(true), second = ctx.createGain();
        t.osc = ctx.createOscillator();
        t.osc.type = "sawtooth";
        t.a = ctx.createBiquadFilter();
        t.b = ctx.createBiquadFilter();
        t.a.type = t.b.type = "bandpass";
        t.a.Q.value = 5;
        t.b.Q.value = 7;
        second.gain.value = 0.55;
        t.osc.connect(t.a);
        t.osc.connect(t.b);
        t.a.connect(t.gain);
        t.b.connect(second);
        second.connect(t.gain);
        run(t.osc);
        throats.push(t);
      }
      if (withChip) buildChip(run);
      // The hall's bed, faded in and out by `room` through one gain: the fire's roar (low noise, breathing) and
      // crackle (pops of high noise), two crickets (a high sine each, trilled by a fast square and gated into
      // chirps) and a night bird's whistle.
      const gain = ctx.createGain(), noise = run(noiseSource()), roarF = ctx.createBiquadFilter(), roar = ctx.createGain();
      const crackF = ctx.createBiquadFilter(), crack = ctx.createGain(), bird = ctx.createOscillator(), birdGain = ctx.createGain(), birdPan = ctx.createStereoPanner();
      gain.gain.value = 0;
      gain.connect(master);
      gain.connect(send);
      roarF.type = "lowpass";
      roarF.frequency.value = 320;
      roar.gain.value = 0.1;
      noise.connect(roarF);
      roarF.connect(roar);
      roar.connect(gain);
      crackF.type = "bandpass";
      crackF.Q.value = 1.4;
      crack.gain.value = 0;
      noise.connect(crackF);
      crackF.connect(crack);
      crack.connect(gain);
      const crickets = [4300, 5100].map((f, i) => {
        const osc = ctx.createOscillator(), trill = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain(), chirp = ctx.createGain(), panner = ctx.createStereoPanner();
        osc.frequency.value = f;
        lfo.type = "square";
        lfo.frequency.value = 26 + i * 5;
        depth.gain.value = 0.5;
        trill.gain.value = 0.5;
        chirp.gain.value = 0;
        panner.pan.value = i ? 0.6 : -0.5;
        lfo.connect(depth);
        depth.connect(trill.gain);
        osc.connect(trill);
        trill.connect(chirp);
        chirp.connect(panner);
        panner.connect(gain);
        run(osc);
        run(lfo);
        return chirp.gain;
      });
      birdGain.gain.value = 0;
      bird.connect(birdGain);
      birdGain.connect(birdPan);
      birdPan.connect(gain);
      run(bird);
      bed = { gain, roar, crackF, crack, crickets, bird, birdGain, birdPan };
      ready = true;
      if (bedOn) room(true);
    };
    // The chip, into its own level on the master: the pulse waves and the triangle's, built from their partials;
    // two pulse channels sharing one slow vibrato, each through its own depth in cents; the triangle; the noise.
    const buildChip = (run) => {
      const bus = ctx.createGain(), lfo = run(ctx.createOscillator()), re = new Float32Array(HARMONICS + 1), im = new Float32Array(HARMONICS + 1);
      bus.gain.value = CHIP;
      bus.connect(master);
      lfo.frequency.value = 5.5;
      waves = DUTY.map((d) => {
        for (let k = 1; k <= HARMONICS; k++) { re[k] = Math.sin(2 * Math.PI * k * d) / (Math.PI * k); im[k] = 2 * Math.sin(Math.PI * k * d) ** 2 / (Math.PI * k); }
        return ctx.createPeriodicWave(re, im);
      });
      // The console's triangle: 32 steps, 15 down to 0 and back up, each step's share of a partial integrated exactly.
      for (let k = 1; k <= HARMONICS; k++) {
        let a = 0, b = 0;
        for (let s = 0; s < 32; s++) {
          const v = (s < 16 ? 15 - s : s - 16) / 7.5 - 1, t0 = Math.PI * k * s / 16, t1 = Math.PI * k * (s + 1) / 16;
          a += v * (Math.sin(t1) - Math.sin(t0));
          b += v * (Math.cos(t0) - Math.cos(t1));
        }
        re[k] = a / (Math.PI * k);
        im[k] = b / (Math.PI * k);
      }
      const triangle = ctx.createPeriodicWave(re, im);
      for (let c = 0; c < 3; c++) {
        const osc = ctx.createOscillator(), gain = ctx.createGain(), ch = { f: osc.frequency, gain: gain.gain, osc, wave: 2, vib: null, lp: null, until: 0 };
        osc.setPeriodicWave(c < 2 ? waves[2] : triangle);
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(bus);
        if (c < 2) {
          const vib = ctx.createGain();
          vib.gain.value = 0;
          lfo.connect(vib);
          vib.connect(osc.detune);
          ch.vib = vib.gain;
        }
        run(osc);
        chips.push(ch);
      }
      // The noise: the long-mode shift register (taps 0 and 1) over its whole 32767-step period, so it loops clean.
      const bits = ctx.createBuffer(1, LFSR, ctx.sampleRate), data = bits.getChannelData(0), shift = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), gate = ctx.createGain();
      for (let i = 0, r = 1; i < LFSR; i++) { data[i] = r & 1 ? -1 : 1; r = r >> 1 | ((r ^ r >> 1) & 1) << 14; }
      shift.buffer = bits;
      shift.loop = true;
      lp.type = "lowpass";
      lp.Q.value = 0;
      gate.gain.value = 0;
      shift.connect(lp);
      lp.connect(gate);
      gate.connect(bus);
      run(shift);
      chips.push({ f: shift.playbackRate, gain: gate.gain, osc: null, wave: -1, vib: null, lp: lp.frequency, until: 0 });
    };
    // Only from a gesture the browser has already counted, so nothing warns in the console.
    const activate = () => {
      if (ready) {
        if (ctx.state === "suspended") ctx.resume();
        return;
      }
      if (!navigator.userActivation || navigator.userActivation.hasBeenActive) init();
    };
    const onVisibility = () => {
      if (!ctx || ctx.state === "closed") return;
      if (document.hidden) ctx.suspend().catch(() => {});
      else ctx.resume().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);

    // The first voice of a pool free at `at`, else the next in turn.
    const pick = (pool, next, at) => {
      for (let i = 0; i < pool.length; i++) {
        const k = (next + i) % pool.length;
        if (pool[k].until <= at) return k;
      }
      return next % pool.length;
    };
    // A tone at `at`: a frequency ramp under a gain envelope.
    const tone = (from, to, seconds, peak, type, at) => {
      const i = pick(voices, voiceNext, at), v = voices[i];
      voiceNext = (i + 1) % voices.length;
      v.osc.type = type;
      v.osc.frequency.cancelScheduledValues(at);
      v.osc.frequency.setValueAtTime(from * bend, at);
      v.osc.frequency.exponentialRampToValueAtTime(Math.max(20, to * bend), at + seconds);
      v.panner.pan.setValueAtTime(pan, at);
      v.gain.gain.cancelScheduledValues(at);
      v.gain.gain.setValueAtTime(0.0001, at);
      v.gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * level), at + 0.01);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      v.until = at + seconds;
    };
    // A burst of filtered noise at `at`: a rumble, a swish, a thud, a shaker, a crowd.
    const noise = (from, to, seconds, peak, at) => {
      const i = pick(noises, noiseNext, at), n = noises[i];
      noiseNext = (i + 1) % noises.length;
      n.filter.frequency.cancelScheduledValues(at);
      n.filter.frequency.setValueAtTime(from, at);
      n.filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + seconds);
      n.panner.pan.setValueAtTime(pan, at);
      n.gain.gain.cancelScheduledValues(at);
      n.gain.gain.setValueAtTime(0.0001, at);
      n.gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * level), at + Math.min(0.05, seconds / 3));
      n.gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      n.until = at + seconds;
    };
    // A skin drum at `at`: its pitch drops from 2.4 times `f` to `f` in the first moments and it rings down.
    const drum = (f, peak, seconds, at) => {
      const i = pick(drums, drumNext, at), d = drums[i];
      drumNext = (i + 1) % drums.length;
      d.osc.frequency.cancelScheduledValues(at);
      d.osc.frequency.setValueAtTime(f * 2.4, at);
      d.osc.frequency.exponentialRampToValueAtTime(f, at + 0.06);
      d.panner.pan.setValueAtTime(pan, at);
      d.gain.gain.cancelScheduledValues(at);
      d.gain.gain.setValueAtTime(0.0001, at);
      d.gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * level), at + 0.006);
      d.gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      d.until = at + seconds;
    };
    const throat = (at) => {
      const i = pick(throats, throatNext, at);
      throatNext = (i + 1) % throats.length;
      return throats[i];
    };
    // One syllable on the throat `t` at `at`: its pitch from f0 to f1 and its vowel from v0 to v1 over `seconds`.
    const syllable = (t, f0, f1, v0, v1, seconds, peak, at) => {
      const p = Math.max(0.0002, peak * level);
      t.osc.frequency.cancelScheduledValues(at);
      t.osc.frequency.setValueAtTime(f0, at);
      t.osc.frequency.exponentialRampToValueAtTime(f1, at + seconds);
      t.a.frequency.cancelScheduledValues(at);
      t.a.frequency.setValueAtTime(v0[0], at);
      t.a.frequency.linearRampToValueAtTime(v1[0], at + seconds * 0.6);
      t.b.frequency.cancelScheduledValues(at);
      t.b.frequency.setValueAtTime(v0[1], at);
      t.b.frequency.linearRampToValueAtTime(v1[1], at + seconds * 0.6);
      t.panner.pan.setValueAtTime(pan, at);
      t.gain.gain.cancelScheduledValues(at);
      t.gain.gain.setValueAtTime(0.0001, at);
      t.gain.gain.exponentialRampToValueAtTime(p, at + 0.035);
      t.gain.gain.setValueAtTime(p, at + seconds * 0.55);
      t.gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
      t.until = Math.max(t.until, at + seconds);
    };
    // "OO-GA" on the throat `t`, pitched about `f`: a round "oo", the catch of the g, and an open "ga" falling away,
    // or rising when it `asks`.
    const ooga = (t, f, peak, at, asks = false) => {
      syllable(t, f, f * 0.94, OO, OO, 0.19, peak, at);
      syllable(t, f * 1.12, asks ? f * 1.5 : f * 0.72, UH, AH, 0.3, peak * 1.1, at + 0.22);
    };
    // The whole room at once: OOGA! on two throats a fourth apart.
    const shout = (at, peak) => {
      ooga(throat(at), 175, peak, at);
      ooga(throat(at), 131, peak * 0.8, at + 0.015);
    };
    // A bamboo marimba bar: a sine and its fourfold overtone, which dies first.
    const mallet = (f, peak, seconds, at) => {
      tone(f, f * 0.995, seconds, peak, "sine", at);
      tone(f * 4, f * 3.98, seconds * 0.22, peak * 0.3, "sine", at);
    };
    // A coconut striking something is a hollow "tok": a short sine body with a slight pitch drop, a quick woody
    // overtone above it and a click of noise on the attack.
    const tok = (f, peak, seconds, at) => {
      tone(f, f * 0.74, seconds, peak, "sine", at);
      tone(f * 2.7, f * 2.25, seconds * 0.4, peak * 0.4, "triangle", at);
      noise(f * 5.5, f * 2.2, 0.03, peak * 0.5, at);
    };
    // A tusk horn blown from f0 to f1: an "oh" held on a throat.
    const horn = (f0, f1, seconds, peak, at) => syllable(throat(at), f0 * 0.96, f1, OH, OH, seconds, peak, at);
    // An Ooga's grunt, a different one each time: "hm, ooga", "ooga?", "hoo!" and "ooga ooga".
    const grunt = (at, peak) => {
      const t = throat(at), k = gruntI++ & 3;
      if (k === 0) { syllable(t, 110, 100, OO, OO, 0.16, peak * 0.7, at); ooga(t, 125, peak, at + 0.2); }
      else if (k === 1) ooga(t, 140, peak, at, true);
      else if (k === 2) syllable(t, 180, 150, OO, OH, 0.26, peak, at);
      else { ooga(t, 130, peak, at); ooga(t, 118, peak, at + 0.55); }
    };
    const CUES = {
      // The games' flow: a bamboo tick and lock, a skin drum on each count over a hand drum rolling under it (a `tap`
      // a stroke, on two skins in turn), and on Go the room shouts OOGA!
      tick: (n) => tone(1300, 1000, 0.035, 0.09, "triangle", n),
      lock: (n) => mallet(784, 0.14, 0.2, n),
      count: (n) => { drum(84, 0.4, 0.6, n); noise(1100, 300, 0.07, 0.16, n); },
      tap: (n) => drum(tapI++ & 1 ? 196 : 174, 0.2, 0.14, n),
      go: (n) => { drum(58, 0.55, 0.9, n); drum(116, 0.3, 0.4, n + 0.22); noise(1100, 250, 0.1, 0.2, n); shout(n + 0.02, 0.6); noise(700, 1700, 0.9, 0.1, n + 0.25); },
      // Coconuts in play.
      roll: (n) => noise(300, 120, 0.8, 0.22, n),
      throw: (n) => noise(1400, 500, 0.25, 0.16, n),
      thunk: (n) => tok(300, 0.3, 0.13, n),
      swish: (n) => noise(4000, 1800, 0.35, 0.2, n),
      clang: (n) => { tok(440, 0.26, 0.11, n); tone(1250, 1180, 0.16, 0.06, "triangle", n + 0.01); },
      knock: (n) => { tone(200, 90, 0.16, 0.26, "sine", n); noise(900, 200, 0.2, 0.16, n); },
      bonk: (n) => tok(520, 0.28, 0.1, n),
      miss: (n) => { tone(210, 130, 0.22, 0.16, "sine", n); noise(500, 160, 0.1, 0.08, n); },
      // Scoring on the marimba, the tusk horn for fire, a round and a flop, and a shaker over the big ones.
      score: (n) => { mallet(523, 0.16, 0.25, n); mallet(784, 0.14, 0.3, n + 0.08); },
      big: (n) => { mallet(523, 0.16, 0.3, n); mallet(659, 0.15, 0.3, n + 0.06); mallet(784, 0.15, 0.3, n + 0.12); mallet(1046, 0.16, 0.5, n + 0.18); noise(5200, 7000, 0.5, 0.06, n + 0.1); },
      fire: (n) => { noise(500, 2400, 0.6, 0.2, n); horn(220, 330, 0.5, 0.3, n); },
      round: (n) => { horn(196, 196, 0.16, 0.22, n); horn(262, 262, 0.16, 0.22, n + 0.19); horn(330, 392, 0.45, 0.25, n + 0.38); drum(70, 0.28, 0.5, n + 0.38); },
      buzzer: (n) => { horn(150, 100, 0.95, 0.26, n); drum(52, 0.3, 0.8, n); },
      // The HUD's own: a star earned (two marimba bars a fifth apart and a shaker, higher for each star), the best
      // passed (the tusk horn's three-note call over a skin drum), the results' tally ticking up, and the weight
      // under a big moment's hit-stop (a low skin drum and a falling rush).
      star0: (n) => { mallet(659, 0.15, 0.3, n); mallet(988, 0.13, 0.45, n + 0.07); noise(5200, 7400, 0.35, 0.05, n + 0.05); },
      star1: (n) => { mallet(784, 0.15, 0.3, n); mallet(1175, 0.13, 0.45, n + 0.07); noise(5200, 7400, 0.35, 0.06, n + 0.05); },
      star2: (n) => { mallet(988, 0.16, 0.3, n); mallet(1480, 0.14, 0.55, n + 0.07); noise(5200, 7400, 0.45, 0.07, n + 0.05); },
      best: (n) => { horn(262, 262, 0.12, 0.24, n); horn(330, 330, 0.12, 0.24, n + 0.14); horn(392, 523, 0.5, 0.28, n + 0.28); drum(62, 0.3, 0.6, n + 0.28); mallet(1046, 0.12, 0.6, n + 0.3); noise(5200, 7000, 0.6, 0.06, n + 0.3); },
      tally: (n) => tone(1568, 1480, 0.03, 0.05, "sine", n),
      slam: (n) => { drum(46, 0.45, 0.5, n); noise(1800, 200, 0.35, 0.12, n); },
      win: (n) => { mallet(523, 0.16, 0.35, n); mallet(659, 0.15, 0.35, n + 0.12); mallet(784, 0.15, 0.35, n + 0.24); mallet(1046, 0.17, 0.8, n + 0.36); drum(62, 0.35, 0.8, n + 0.36); shout(n + 0.55, 0.35); noise(900, 1800, 1.4, 0.1, n + 0.6); },
      // The hall's machines: shell tokens, a wooden puck, the claw's rope winch, tickets clicking out, a bamboo
      // chime for a prize, the wheel's bone clapper.
      coin: (n) => { tone(2600, 2450, 0.05, 0.09, "triangle", n); tone(3150, 3000, 0.07, 0.07, "triangle", n + 0.05); },
      clack: (n) => { tone(820, 520, 0.05, 0.13, "triangle", n); noise(2600, 1800, 0.04, 0.09, n); },
      whirr: (n) => { tone(150, 190, 0.6, 0.05, "triangle", n); for (let k = 0; k < 3; k++) tone(540, 470, 0.03, 0.05, "triangle", n + 0.1 + k * 0.17); },
      spit: (n) => { for (let k = 0; k < 6; k++) tone(1500, 1300, 0.025, 0.06, "triangle", n + k * 0.07); },
      bell: (n) => { mallet(1046, 0.15, 1.1, n); mallet(1568, 0.1, 0.9, n + 0.02); mallet(784, 0.12, 1, n + 0.12); },
      click: (n) => tone(2100, 1600, 0.02, 0.07, "triangle", n),
      flip: (n) => { tone(320, 180, 0.06, 0.12, "triangle", n); noise(1500, 600, 0.05, 0.06, n); },
      cheer: (n) => { noise(900, 1600, 1.2, 0.18, n); noise(1400, 2200, 1, 0.1, n + 0.15); shout(n + 0.1, 0.22); },
      chirp: (n) => { tone(880, 1320, 0.12, 0.1, "triangle", n); tone(1320, 990, 0.14, 0.08, "triangle", n + 0.14); },
      ding: (n) => mallet(1318, 0.11, 0.4, n),
      // The Oogas themselves: a grunt, a laugh ("hoo hoo ha ha"), and a snack bought with a shell and crunched; the
      // watchers' chant for a big moment (OOGA! OOGA! over a skin drum each) and their groan at a flop ("ohhh" on two
      // throats, falling); and a coconut cracking open, a sharp woody split and the milk's splash.
      grunt: (n) => grunt(n, 0.4),
      ooga: (n) => { shout(n, 0.42); drum(62, 0.3, 0.45, n); shout(n + 0.58, 0.5); drum(62, 0.34, 0.5, n + 0.58); noise(900, 1700, 1.3, 0.08, n + 0.1); },
      groan: (n) => { syllable(throat(n), 200, 128, OH, UH, 0.75, 0.24, n); syllable(throat(n), 152, 98, OO, OH, 0.8, 0.17, n + 0.03); },
      crack: (n) => { tok(760, 0.3, 0.07, n); noise(3000, 5600, 0.05, 0.24, n); noise(2400, 700, 0.4, 0.12, n + 0.05); },
      laugh: (n) => { const t = throat(n); for (let k = 0; k < 4; k++) syllable(t, 215 - k * 9, 190 - k * 9, k < 2 ? OO : AH, k < 2 ? OO : AH, 0.13, 0.3, n + k * 0.16); },
      crunch: (n) => { tone(2600, 2450, 0.05, 0.08, "triangle", n); for (let k = 0; k < 3; k++) noise(2800, 900, 0.07, 0.22, n + 0.14 + k * 0.13); }
    };
    // A cue at `gain` of its full level and panned (-1 left to 1 right), for a sound somewhere in the hall, its tones
    // `pitch` times as high (the jackpot wheel's clapper, rising as it slows).
    const cue = (name, gain = 1, side = 0, pitch = 1) => {
      activate();
      const fn = CUES[name];
      if (!fn || gain < 0.03 || !ready || muted) return;
      level = gain;
      pan = side;
      bend = pitch;
      fn(ctx.currentTime);
      if (DUCKS[name]) duck(ctx.currentTime, DUCKS[name]);
      level = 1;
      pan = 0;
      bend = 1;
    };

    // ---- the chip ------------------------------------------------------------------------------------------
    // Chip channel `c` taken by a cue at `at` for `seconds`: whatever the tune had scheduled on it from then is
    // cancelled, and it is silent until the cue writes its notes.
    const take = (c, at, seconds) => {
      const ch = chips[c];
      ch.gain.cancelScheduledValues(at);
      ch.gain.setValueAtTime(0, at);
      ch.f.cancelScheduledValues(at);
      if (ch.vib) { ch.vib.cancelScheduledValues(at); ch.vib.setValueAtTime(0, at); }
      if (ch.lp) ch.lp.cancelScheduledValues(at);
      ch.until = at + seconds;
      return ch;
    };
    const duty = (ch, d) => {
      if (ch.wave !== d) { ch.osc.setPeriodicWave(waves[d]); ch.wave = d; }
      return ch;
    };
    // The pulse a cue takes, at duty `d`: the second, which the tune leaves to the cues, then the lead's, then
    // whichever frees first; a `soft` cue (a step, a march beat, a heartbeat) takes only the second, and only free.
    const pulse = (at, seconds, d, soft = false) => {
      const a = chips[0].until, b = chips[1].until, c = b <= at ? 1 : soft ? -1 : a <= at ? 0 : b <= a ? 1 : 0;
      return c < 0 ? null : duty(take(c, at, seconds), d);
    };
    // A note on a channel at `at`, `seconds` long: its pitch (the noise's is its clock rate) from f0 sliding to f1 (0
    // holds it), its level up to `peak` of the chip's at once (by the cue's level), held for `hold` of the note, then
    // falling to nothing.
    const note = (ch, f0, f1, seconds, peak, at, hold = 0) => {
      const p = peak * level, end = at + seconds;
      ch.f.setValueAtTime(f0, at);
      if (f1) ch.f.exponentialRampToValueAtTime(f1, end);
      ch.gain.setValueAtTime(0, at);
      ch.gain.linearRampToValueAtTime(p, at + 0.003);
      if (hold) ch.gain.setValueAtTime(p, at + seconds * hold);
      ch.gain.linearRampToValueAtTime(0, end);
    };
    // A burst on the noise: its clock from r0 to r1 through a low-pass from lp0 to lp1 (0 holds it).
    const hiss = (ch, r0, r1, lp0, lp1, seconds, peak, at, hold = 0) => {
      ch.lp.setValueAtTime(lp0, at);
      if (lp1) ch.lp.exponentialRampToValueAtTime(lp1, at + seconds);
      note(ch, r0, r1, seconds, peak, at, hold);
    };
    // The notes of `list` (MIDI) run legato on one channel `each` seconds apart, the last held `tail` as it fades.
    const arp = (ch, list, each, tail, peak, at) => {
      const p = peak * level, last = at + each * (list.length - 1);
      for (let k = 0; k < list.length; k++) ch.f.setValueAtTime(HZ[list[k]], at + k * each);
      ch.gain.setValueAtTime(0, at);
      ch.gain.linearRampToValueAtTime(p, at + 0.003);
      ch.gain.setValueAtTime(p, last);
      ch.gain.linearRampToValueAtTime(0, last + tail);
    };
    // A phrase on one channel: each note of `list` (MIDI, 0 rests) lasting `beats[k]` of `beat` seconds, struck at
    // `peak`, decaying toward half and cut just before the next; a long one swells into a vibrato `vib` cents deep.
    const phrase = (ch, list, beats, beat, peak, at, vib = 0) => {
      const p = peak * level;
      let t = at;
      for (let k = 0; k < list.length; k++) {
        const len = beats[k] * beat;
        if (list[k]) {
          ch.f.setValueAtTime(HZ[list[k]], t);
          ch.gain.setValueAtTime(0, t);
          ch.gain.linearRampToValueAtTime(p, t + 0.004);
          ch.gain.linearRampToValueAtTime(p * 0.5, t + len * 0.92);
          ch.gain.linearRampToValueAtTime(0, t + len);
          if (vib && len > 0.3) { ch.vib.setValueAtTime(0, t + 0.12); ch.vib.linearRampToValueAtTime(vib, t + 0.3); ch.vib.setValueAtTime(0, t + len); }
        }
        t += len;
      }
    };
    const wobble = (ch, cents, at, end) => { ch.vib.setValueAtTime(cents, at); ch.vib.setValueAtTime(0, end); };
    // The tune ducks under a big moment until `at + seconds`; a quiet cue (placed far off, or meant soft) leaves it.
    // What it had already queued or is still holding louder than the duck goes under it at once (`reduck`).
    const duck = (at, seconds) => {
      if (level < 0.5 || at + seconds <= M.duck) return;
      const louder = M.duck < M.at;
      M.duck = at + seconds;
      if (louder && M.tune && !M.paused && ready) reduck(at);
    };
    // A jingle on all three tonal channels, the tune ducked under it; a life lost, the pulse falling a scale with a
    // wobble.
    const jingle = (J, n) => {
      phrase(pulse(n, J.len, 2), J.lead, J.beats, J.beat, 0.43, n, 25);
      phrase(pulse(n, J.len, 1), J.harm, J.beats, J.beat, 0.34, n, 25);
      phrase(take(2, n, J.len), J.bass, J.bassBeats, J.beat, 0.68, n);
      duck(n, J.len + 0.3);
    };
    const fall = (at, peak) => {
      const c = pulse(at, 0.92, 2);
      arp(c, FALL, 0.065, 0.2, peak, at);
      wobble(c, 35, at, at + 0.92);
      duck(at, 1.4);
    };
    // The chip's cues, each only automation on the channels it takes (`pulse`, `take`): ticks and steps (a menu's
    // tick, a sideways step, the invaders' march and a heartbeat, the soft ones never cutting the tune's lead); shots
    // and moves; hits; pickups; the big moments, which duck the tune (a bonus, a life, a power-up's climb, fire, a
    // boom, a rumble, a lost life, the jingles); and warnings.
    const CHIPS = {
      tick: (n) => note(pulse(n, 0.035, 0), 1760, 0, 0.035, 0.5, n, 0.3),
      step: (n) => { const c = pulse(n, 0.025, 1, true); if (c) note(c, 880, 0, 0.025, 0.35, n); },
      march: (n) => { const c = pulse(n, 0.1, 0, true); if (c) note(c, HZ[MARCH[marchI++ & 3]], 0, 0.1, 0.8, n, 0.5); },
      beat: (n) => { const c = pulse(n, 0.26, 0, true); if (c) { note(c, 82, 0, 0.07, 0.7, n); note(c, 78, 0, 0.09, 0.55, n + 0.17); } },
      pew: (n) => note(pulse(n, 0.15, 1), 1568, 220, 0.15, 0.6, n),
      zap: (n) => { note(pulse(n, 0.26, 2), 2093, 131, 0.26, 0.5, n, 0.1); hiss(take(3, n, 0.1), 1, 0.3, 9000, 0, 0.1, 0.35, n); },
      jump: (n) => note(pulse(n, 0.2, 2), 196, 784, 0.2, 0.5, n, 0.6),
      air: (n) => note(pulse(n, 0.15, 1), 392, 1319, 0.15, 0.55, n, 0.5),
      flap: (n) => note(pulse(n, 0.08, 1), 330, 698, 0.08, 0.55, n, 0.4),
      hop: (n) => note(pulse(n, 0.07, 2), 440, 880, 0.07, 0.45, n, 0.4),
      whiff: (n) => hiss(take(3, n, 0.09), 0.3, 1, 2500, 9000, 0.09, 0.3, n),
      blip: (n) => note(pulse(n, 0.06, 2), 880, 0, 0.06, 0.5, n, 0.6),
      bleep: (n) => note(pulse(n, 0.05, 2), 440, 0, 0.05, 0.5, n, 0.6),
      bloop: (n) => note(pulse(n, 0.08, 2), 262, 196, 0.08, 0.55, n, 0.4),
      stomp: (n) => note(pulse(n, 0.12, 2), 523, 110, 0.12, 0.55, n, 0.2),
      thud: (n) => note(take(2, n, 0.13), 170, 45, 0.13, 1, n, 0.3),
      clack: (n) => hiss(take(3, n, 0.035), 0.9, 0, 11000, 0, 0.035, 0.5, n),
      hit: (n) => hiss(take(3, n, 0.16), 0.5, 0.12, 8000, 2500, 0.16, 0.63, n),
      crumble: (n) => hiss(take(3, n, 0.22), 0.26, 0.12, 5000, 1500, 0.22, 0.55, n, 0.2),
      pop: (n) => hiss(take(3, n, 0.3), 0.3, 0.08, 6000, 1200, 0.3, 0.45, n),
      coin: (n) => arp(pulse(n, 0.42, 1), COIN, 0.07, 0.35, 0.5, n),
      pickup: (n) => arp(pulse(n, 0.23, 0), PICKUP, 0.035, 0.12, 0.6, n),
      sparkle: (n) => arp(pulse(n, 0.2, 0), SPARKLE, 0.03, 0.08, 0.4, n),
      chomp: (n) => arp(pulse(n, 0.09, 2), CHOMP, 0.035, 0.05, 0.5, n),
      ready: (n) => arp(pulse(n, 0.19, 1), READY, 0.07, 0.12, 0.5, n),
      miss: (n) => arp(pulse(n, 0.22, 1), MISS, 0.08, 0.14, 0.45, n),
      score: (n) => arp(pulse(n, 0.24, 0), SCORE, 0.045, 0.15, 0.6, n),
      bonus: (n) => { arp(pulse(n, 0.51, 1), BONUS, 0.035, 0.3, 0.6, n); duck(n, 0.6); },
      oneup: (n) => { arp(pulse(n, 0.58, 1), ONEUP, 0.065, 0.25, 0.55, n); duck(n, 0.7); },
      powerup: (n) => { arp(pulse(n, 0.82, 2), RISE, 0.028, 0.15, 0.45, n); duck(n, 1); },
      fire: (n) => { hiss(take(3, n, 0.45), 0.08, 0.7, 1200, 8000, 0.45, 0.45, n, 0.4); note(pulse(n, 0.35, 1), 262, 1046, 0.35, 0.22, n, 0.3); duck(n, 0.4); },
      boom: (n) => { hiss(take(3, n, 0.7), 0.12, 0.02, 4000, 350, 0.7, 0.7, n, 0.1); note(take(2, n, 0.3), 110, 30, 0.3, 0.8, n, 0.2); duck(n, 0.8); },
      rumble: (n) => { hiss(take(3, n, 1), 0.04, 0.03, 900, 400, 1, 0.6, n, 0.5); duck(n, 0.6); },
      lose: (n) => { fall(n, 0.4); hiss(take(3, n, 0.2), 0.3, 0.1, 6000, 1000, 0.2, 0.4, n); note(take(2, n, 0.9), 98, 49, 0.9, 0.5, n, 0.5); },
      burn: (n) => { hiss(take(3, n, 0.45), 0.08, 0.7, 1200, 8000, 0.45, 0.45, n, 0.4); fall(n, 0.4); },
      splash: (n) => { hiss(take(3, n, 0.45), 0.6, 0.15, 9000, 1200, 0.45, 0.55, n); fall(n + 0.05, 0.36); },
      over: (n) => jingle(JINGLES.over, n),
      clear: (n) => jingle(JINGLES.clear, n),
      win: (n) => jingle(JINGLES.win, n),
      dive: (n) => { const c = pulse(n, 0.35, 0); note(c, 1568, 392, 0.35, 0.5, n, 0.2); wobble(c, 50, n, n + 0.35); },
      drop: (n) => { const c = pulse(n, 0.35, 1); note(c, 523, 131, 0.35, 0.5, n, 0.3); wobble(c, 40, n, n + 0.35); },
      alarm: (n) => phrase(pulse(n, 0.48, 2), ALARM, ONES, 0.08, 0.45, n)
    };
    // A chip cue at `gain` of its full level: a retro cabinet's own voice, straight ahead. A name the chip does not
    // know is a slip in a game's cue map, so it throws rather than play nothing.
    const chip = (name, gain = 1) => {
      const fn = CHIPS[name];
      if (!fn) throw new Error(`carnival-audio: no chip cue "${name}"`);
      activate();
      if (gain < 0.03 || !ready || muted) return;
      level = gain;
      fn(ctx.currentTime);
      level = 1;
    };

    // ---- the tunes -----------------------------------------------------------------------------------------
    // A step's lead or bass note on channel `c`: the lead at the tune's duty, decaying a little and swelling into
    // vibrato when held; the triangle at one level, as the console's had no volume; both stop a moment early, so a
    // repeated note parts from the one before.
    const voice = (c, m, seconds, peak, at) => {
      const ch = chips[c], end = at + seconds - Math.min(0.03, seconds * 0.2);
      ch.f.setValueAtTime(HZ[m], at);
      ch.gain.setValueAtTime(0, at);
      ch.gain.linearRampToValueAtTime(peak, at + 0.004);
      ch.gain.linearRampToValueAtTime(c ? peak : peak * 0.6, end - 0.008);
      ch.gain.linearRampToValueAtTime(0, end);
      if (!c && seconds > 0.3) { ch.vib.setValueAtTime(0, at + 0.15); ch.vib.linearRampToValueAtTime(18, Math.min(at + 0.35, end)); ch.vib.setValueAtTime(0, end); }
    };
    // A step's drum on the noise (see DRUM_RATE): the kick's clock drops as it rings.
    const strike = (d, k, at) => {
      const ch = chips[3], end = at + DRUM_S[d];
      ch.f.setValueAtTime(DRUM_RATE[d], at);
      if (d === 3) ch.f.exponentialRampToValueAtTime(0.025, end);
      ch.lp.setValueAtTime(DRUM_LP[d], at);
      ch.gain.setValueAtTime(0, at);
      ch.gain.linearRampToValueAtTime(DRUM_PEAK[d] * k, at + 0.002);
      ch.gain.linearRampToValueAtTime(0, end);
    };
    // How loud the tune's note at `t` plays under the duck.
    const ducked = (t) => t < M.duck ? DUCK : t < M.duck + DUCK_BACK ? DUCK + (1 - DUCK) * (t - M.duck) / DUCK_BACK : 1;
    // Every step due before SONG_AHEAD from now, on each of its channels no cue holds; a tune that fell behind (a
    // pause, a mute, a hidden tab) carries on from now. Allocation-free.
    const play = () => {
      const now = ctx.currentTime, end = now + SONG_AHEAD, T = M.tune;
      if (M.at < now) M.at = now + 0.02;
      if (chips[0].until <= now) duty(chips[0], T.duty);
      while (M.at < end) {
        const i = M.step, at = M.at, k = ducked(at);
        if (T.lead[i] && chips[0].until <= now) voice(0, T.lead[i], T.leadLen[i] * T.step, T.level * k, at);
        if (T.bass[i] && chips[2].until <= now) voice(2, T.bass[i], T.bassLen[i] * T.step, BASS * k, at);
        if (T.drum[i] && chips[3].until <= now) strike(T.drum[i], k, at);
        M.step = i + 1 === T.n ? 0 : i + 1;
        M.at = at + T.step;
      }
    };
    // The tune's channels silenced from `now`, but for any a cue holds (the second pulse is only ever the cues').
    const hush = (now) => {
      for (let c = 0; c < 4; c++) {
        const ch = chips[c];
        if (c === 1 || ch.until > now) continue;
        ch.gain.cancelScheduledValues(now);
        ch.gain.setValueAtTime(0, now);
        ch.f.cancelScheduledValues(now);
        if (ch.vib) { ch.vib.cancelScheduledValues(now); ch.vib.setValueAtTime(0, now); }
      }
    };
    // A game's tune from its top, or none (`id` null).
    const music = (id) => {
      activate();
      M.tune = id ? SONGS[id] : null;
      M.step = 0;
      M.at = M.duck = 0;
      M.paused = false;
      if (ready) hush(ctx.currentTime);
    };
    // The steps queued but not yet begun taken back and the tune's channels silenced from `now`, so it goes on from the
    // first step not yet heard.
    const rewind = (now) => {
      const T = M.tune;
      while (M.at - T.step >= now) { M.at -= T.step; M.step = M.step ? M.step - 1 : T.n - 1; }
      hush(now);
    };
    // A fresh duck at `now`: the steps queued are played again at its level, and the lead's and bass's notes still
    // sounding are struck again from now to their ends at that level, rather than ringing on at the level they began.
    const reduck = (now) => {
      rewind(now);
      const T = M.tune, k = ducked(now);
      for (let c = 0; c < 3; c += 2) {
        if (chips[c].until > now) continue;
        const notes = c ? T.bass : T.lead, lens = c ? T.bassLen : T.leadLen;
        for (let back = 1, i = M.step; back <= 16; back++) {
          i = i ? i - 1 : T.n - 1;
          if (!notes[i]) continue;
          const left = M.at + (lens[i] - back) * T.step - now;
          if (left > 0.02) voice(c, notes[i], left, (c ? BASS : T.level) * k, now);
          break;
        }
      }
      play();
    };
    // Halts the tune where it is, back to the first step not yet heard, or lets it carry on from there.
    const pause = (on) => {
      if (!M.tune || M.paused === on) return;
      M.paused = on;
      if (on && ready) rewind(ctx.currentTime);
    };

    // ---- the hall's bed ------------------------------------------------------------------------------------
    // A cricket's chirp, the other cricket next time.
    const chirp = (at) => {
      const g = bed.crickets[cricketI++ & 1], seconds = 0.1 + Math.random() * 0.2;
      g.setValueAtTime(0, at);
      g.linearRampToValueAtTime(0.022, at + 0.015);
      g.setValueAtTime(0.022, at + seconds - 0.02);
      g.linearRampToValueAtTime(0, at + seconds);
    };
    // A pop of the fire, somewhere between a tick and a snap.
    const crackle = (at) => {
      bed.crackF.frequency.setValueAtTime(1500 + Math.random() * 3500, at);
      bed.crack.gain.setValueAtTime(0.02 + Math.random() * 0.05, at);
      bed.crack.gain.exponentialRampToValueAtTime(0.0001, at + 0.012 + Math.random() * 0.03);
    };
    // A night bird off in the jungle, somewhere to one side: mostly a whistle up and a longer one down, every third
    // call an owl's two soft hoots.
    const birdCall = (at) => {
      const f = bed.bird.frequency, g = bed.birdGain.gain;
      bed.birdPan.pan.setValueAtTime(Math.random() * 1.4 - 0.7, at);
      f.cancelScheduledValues(at);
      g.cancelScheduledValues(at);
      if (callI++ % 3 === 2) {
        for (let k = 0; k < 2; k++) {
          const t = at + k * 0.42;
          f.setValueAtTime(390, t);
          f.exponentialRampToValueAtTime(350, t + 0.3);
          g.setValueAtTime(0.0001, t);
          g.exponentialRampToValueAtTime(0.05, t + 0.06);
          g.exponentialRampToValueAtTime(0.0001, t + 0.32);
        }
        return;
      }
      f.setValueAtTime(1700, at);
      f.exponentialRampToValueAtTime(2600, at + 0.16);
      g.setValueAtTime(0.0001, at);
      g.exponentialRampToValueAtTime(0.025, at + 0.03);
      g.exponentialRampToValueAtTime(0.0001, at + 0.17);
      f.setValueAtTime(2700, at + 0.28);
      f.exponentialRampToValueAtTime(1500, at + 0.62);
      g.setValueAtTime(0.0001, at + 0.28);
      g.exponentialRampToValueAtTime(0.03, at + 0.32);
      g.exponentialRampToValueAtTime(0.0001, at + 0.62);
    };
    // Oogas somewhere in the hall take up a chant, "ooga ooga", or one of them grunts.
    const chant = (at) => {
      pan = Math.random() * 1.2 - 0.6;
      if (Math.random() < 0.6) for (let w = 0; w < 2; w++) { ooga(throat(at), 140, 0.1, at + w * 0.6); ooga(throat(at), 105, 0.085, at + w * 0.6 + 0.02); }
      else grunt(at, 0.12);
      pan = 0;
    };
    // A time the bed fell behind (a mute, a hidden tab) starts again from now.
    const due = (t, now) => t < now ? now + 0.02 : t;
    const room = (on) => {
      bedOn = on;
      if (!ready) return;
      const at = ctx.currentTime;
      bed.gain.gain.setTargetAtTime(on ? 1 : 0, at, 0.8);
      beatAt = cricketAt = crackAt = roarAt = at + 0.3;
      birdAt = at + 2 + Math.random() * 4;
      chantAt = at + 6 + Math.random() * 8;
    };
    // The tune's and the bed's next moments: every event due before its lead time from now is scheduled; called per
    // frame, allocation-free.
    const tick = () => {
      if (!ready || muted) return;
      if (M.tune && !M.paused) play();
      if (!bedOn) return;
      const now = ctx.currentTime, end = now + AHEAD;
      beatAt = due(beatAt, now);
      cricketAt = due(cricketAt, now);
      crackAt = due(crackAt, now);
      roarAt = due(roarAt, now);
      birdAt = due(birdAt, now);
      chantAt = due(chantAt, now);
      while (beatAt < end) {
        const s = beatStep & 15, hand = (beatStep >> 4 & 3) === 3 && s >= 12 ? 0.5 : HAND[s];
        if (LOW[s]) drum(58, 0.1 * LOW[s], 0.5, beatAt);
        if (hand) drum(150, 0.06 * hand, 0.18, beatAt);
        beatStep++;
        beatAt += STEP;
      }
      while (cricketAt < end) { chirp(cricketAt); cricketAt += 0.25 + Math.random() * 0.8; }
      while (crackAt < end) { crackle(crackAt); crackAt += 0.05 + Math.random() * Math.random() * 0.5; }
      if (roarAt < end) { bed.roar.gain.setTargetAtTime(0.07 + Math.random() * 0.07, roarAt, 0.25); roarAt += 0.3 + Math.random() * 0.5; }
      if (birdAt < end) { birdCall(birdAt); birdAt += 6 + Math.random() * 10; }
      if (chantAt < end) { chant(chantAt); chantAt += 16 + Math.random() * 22; }
    };
    const setMuted = (value) => {
      muted = !!value;
      try {
        localStorage.setItem(STORAGE_KEY, muted ? "off" : "on");
      } catch {
      }
      if (ready) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.05);
      return muted;
    };
    return {
      cue, chip, music, pause, activate, setMuted, room, tick,
      get muted() { return muted; },
      dispose() {
        document.removeEventListener("visibilitychange", onVisibility);
        M.tune = null;
        if (!ctx) return;
        for (const node of running) node.stop();
        running.length = voices.length = noises.length = drums.length = throats.length = chips.length = 0;
        bed = waves = null;
        ctx.close();
        ctx = master = send = null;
        ready = false;
      }
    };
  };

  BL.carnivalAudio = { create, SONGS };
})();
