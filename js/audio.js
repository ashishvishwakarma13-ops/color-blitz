// Tiny Web Audio synth — all sound effects are generated, no files needed.
let ctx = null, master = null;
let muted = (() => { try { return localStorage.getItem('cb-muted') === '1'; } catch { return false; } })();

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export const isMuted = () => muted;
export function setMuted(m) { muted = m; try { localStorage.setItem('cb-muted', m ? '1' : '0'); } catch { } }
export function unlock() { ac(); }

function tone(freq, dur, { type = 'sine', vol = 0.3, at = 0, slide = 0, attack = 0.005 } = {}) {
  const c = ac(); if (!c || muted) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, { vol = 0.2, at = 0, freq = 2000 } = {}) {
  const c = ac(); if (!c || muted) return;
  const t = c.currentTime + at;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
  g.gain.value = vol; src.buffer = buf;
  src.connect(f); f.connect(g); g.connect(master); src.start(t);
}

export const sfx = {
  dice() { for (let i = 0; i < 7; i++) noise(0.05, { at: i * 0.07 + Math.random() * 0.03, vol: 0.35, freq: 1800 + Math.random() * 1600 }); },
  hop() { tone(520 + Math.random() * 60, 0.07, { type: 'triangle', vol: 0.12, slide: 200 }); },
  coin() { tone(988, 0.08, { type: 'square', vol: 0.08 }); tone(1319, 0.25, { type: 'square', vol: 0.08, at: 0.08 }); },
  pay() { tone(330, 0.12, { type: 'sawtooth', vol: 0.08 }); tone(247, 0.2, { type: 'sawtooth', vol: 0.08, at: 0.1 }); },
  buy() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.18, at: i * 0.07 })); },
  build() { noise(0.08, { vol: 0.4, freq: 600 }); tone(196, 0.12, { type: 'square', vol: 0.1 }); noise(0.08, { vol: 0.4, freq: 700, at: 0.12 }); },
  card() { noise(0.18, { vol: 0.15, freq: 4000 }); tone(880, 0.3, { type: 'sine', vol: 0.12, at: 0.1, slide: 440 }); },
  jail() { tone(196, 0.35, { type: 'sawtooth', vol: 0.12 }); tone(147, 0.5, { type: 'sawtooth', vol: 0.12, at: 0.25 }); noise(0.2, { at: 0.05, vol: 0.3, freq: 300 }); },
  turn() { tone(660, 0.12, { type: 'sine', vol: 0.15 }); tone(880, 0.2, { type: 'sine', vol: 0.15, at: 0.1 }); },
  myturn() { [523, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.2, at: i * 0.09 })); },
  bid() { tone(740, 0.08, { type: 'square', vol: 0.07 }); },
  gavel() { noise(0.12, { vol: 0.5, freq: 400 }); tone(110, 0.2, { type: 'square', vol: 0.12 }); },
  error() { tone(200, 0.15, { type: 'square', vol: 0.08 }); },
  chat() { tone(1200, 0.06, { type: 'sine', vol: 0.08 }); tone(1600, 0.08, { type: 'sine', vol: 0.06, at: 0.05 }); },
  bankrupt() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: 'sawtooth', vol: 0.1, at: i * 0.18 })); },
  win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.2, at: i * 0.12 })); },
  jackpot() { for (let i = 0; i < 8; i++) tone(1000 + i * 120, 0.12, { type: 'square', vol: 0.06, at: i * 0.05 }); },
  trade() { tone(587, 0.15, { type: 'triangle', vol: 0.15 }); tone(880, 0.25, { type: 'triangle', vol: 0.15, at: 0.12 }); },
};
