// Color Blitz bot brain. Works from the full host state.
import { playable, COLORS } from './engine.js';

function bestColor(hand) {
  const n = { r: 0, y: 0, g: 0, b: 0 };
  for (const c of hand) if (c.c !== 'w') n[c.c]++;
  return COLORS.reduce((a, b) => (n[b] > n[a] ? b : a), COLORS[Math.floor(Math.random() * 4)]);
}

export function botAction(s, pid) {
  const p = s.players.find(x => x.id === pid);
  if (!p || p.left || s.phase !== 'playing') return null;
  const myTurn = s.players[s.turn].id === pid;

  // catch someone who forgot to call (bots are not instant: 45% chance per look)
  if (s.vulnerable && s.vulnerable !== pid && Math.random() < 0.45) return { type: 'catch', target: s.vulnerable };
  // late call if we forgot
  if (s.vulnerable === pid && Math.random() < 0.6) return { type: 'call' };
  if (!myTurn) return null;

  let options = p.hand.filter(c => playable(s, c));
  if (s.drawn != null) options = options.filter(c => c.id === s.drawn);
  if (!options.length) return { type: s.drawn != null ? 'pass' : 'draw' };

  // call BLITZ before playing the second-to-last card (bots forget 12% of the time)
  if (p.hand.length === 2 && !p.called && Math.random() < 0.88) return { type: 'call' };

  const next = s.players.filter(x => !x.left);
  const nextIdx = (() => { const n = s.players.length; let i = s.turn; do { i = ((i + s.dir) % n + n) % n; } while (s.players[i].left); return i; })();
  const nextCount = s.players[nextIdx].hand.length;
  const score = c => {
    let v = 0;
    if (c.c === 'w') v -= 30;                                   // save wilds
    if (['skip', 'rev', 'd2'].includes(c.v)) v += nextCount <= 3 ? 40 : 5;
    if (c.v === 'w4') v += nextCount <= 2 ? 60 : -10;
    if (c.c !== 'w') v += p.hand.filter(h => h.c === c.c).length * 3; // keep colour control
    if (/^\d$/.test(c.v)) v += +c.v;                             // dump high numbers
    return v + Math.random() * 4;
  };
  options.sort((a, b) => score(b) - score(a));
  const card = options[0];
  void next;
  return { type: 'play', card: card.id, color: card.c === 'w' ? bestColor(p.hand.filter(h => h.id !== card.id)) : undefined };
}

export function botNeeds(s, pid) {
  const p = s.players.find(x => x.id === pid);
  if (!p || p.left || s.phase !== 'playing') return false;
  return s.players[s.turn].id === pid || (s.vulnerable && s.vulnerable !== pid) || s.vulnerable === pid;
}
