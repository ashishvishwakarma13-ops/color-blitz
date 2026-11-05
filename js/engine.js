// Color Blitz — authoritative game engine (runs on the host only).
export class RuleError extends Error {}
const fail = m => { throw new RuleError(m); };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const COLORS = ['r', 'y', 'g', 'b'];
export const COLOR_NAMES = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue' };
export const AVATARS = ['fa-rocket', 'fa-crown', 'fa-gem', 'fa-cat', 'fa-dragon', 'fa-ghost', 'fa-robot', 'fa-user-astronaut', 'fa-dog', 'fa-frog', 'fa-hippo', 'fa-kiwi-bird'];
export const SEAT_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#94a3b8'];
export const MAX_PLAYERS = 10;

export function buildDeck(n = 1) {
  const d = []; let id = 0;
  for (let k = 0; k < n; k++) {
    for (const c of COLORS) {
      d.push({ id: id++, c, v: '0' });
      for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2']) { d.push({ id: id++, c, v }); d.push({ id: id++, c, v }); }
    }
    for (let i = 0; i < 4; i++) { d.push({ id: id++, c: 'w', v: 'wild' }); d.push({ id: id++, c: 'w', v: 'w4' }); }
  }
  return d; // 108 per deck
}
export const points = card => card.c === 'w' ? 50 : ['skip', 'rev', 'd2'].includes(card.v) ? 20 : +card.v;
export const top = s => s.discard[s.discard.length - 1];

// can `card` be played on the current table? (pure; used by UI and bots too)
export function playable(s, card) {
  const t = top(s);
  if (s.pendingDraw > 0) {
    if (!s.settings.stacking) return false;
    if (t.v === 'd2') return card.v === 'd2' || card.v === 'w4';
    if (t.v === 'w4') return card.v === 'w4';
    return false;
  }
  if (card.c === 'w') return true;
  return card.c === s.color || card.v === t.v;
}

export function newState(hostId) {
  return {
    phase: 'lobby', hostId, players: [], deck: [], discard: [], color: 'r', turn: 0, dir: 1,
    pendingDraw: 0, drawn: null, vulnerable: null, round: 0, starter: -1,
    roundWinner: null, champion: null, lastPoints: 0, log: [], chat: [], seq: 0, turnEnds: 0,
    settings: { hand: 7, stacking: true, target: 300, timer: 30 },
  };
}

export class Game {
  constructor(state) { this.s = state; this.ev = []; }
  emit(e) { this.ev.push(e); }
  takeEvents() { const e = this.ev; this.ev = []; return e; }
  log(text) { const s = this.s; s.log.push({ id: ++s.seq, text }); if (s.log.length > 100) s.log.shift(); }
  P(id) { return this.s.players.find(p => p.id === id); }
  cur() { return this.s.players[this.s.turn]; }
  nm(p) { return `[[${p.id}]]`; }
  active() { return this.s.players.filter(p => !p.left); }

  // ---------- lobby ----------
  addPlayer({ id, name, avatar, bot = false }) {
    const s = this.s;
    if (s.phase !== 'lobby') fail('Game already started');
    if (s.players.length >= MAX_PLAYERS) fail('Room is full (10 players max)');
    if (this.P(id)) return this.P(id);
    const usedA = new Set(s.players.map(p => p.avatar)), usedC = new Set(s.players.map(p => p.color));
    if (!avatar || usedA.has(avatar)) avatar = AVATARS.find(a => !usedA.has(a));
    name = String(name || 'Player').trim().slice(0, 16) || 'Player';
    const base = name; let n = 2;
    while (s.players.some(p => p.name.toLowerCase() === name.toLowerCase())) name = `${base} ${n++}`;
    const p = { id, name, avatar, color: SEAT_COLORS.find(c => !usedC.has(c)), hand: [], score: 0, called: false, bot, connected: true, left: false };
    s.players.push(p);
    this.log(`${this.nm(p)} joined`);
    return p;
  }
  removePlayer(id) {
    const s = this.s, p = this.P(id); if (!p) return;
    if (s.phase === 'lobby') { s.players = s.players.filter(x => x.id !== id); return; }
    if (p.left) return;
    const wasTurn = s.phase === 'playing' && this.cur().id === id;
    p.left = true; s.deck.push(...p.hand); shuffle(s.deck); p.hand = [];
    if (s.vulnerable === id) s.vulnerable = null;
    this.log(`${this.nm(p)} left the game`);
    if (this.active().length < 2) return this.finishGame(this.active()[0]);
    if (wasTurn) { s.pendingDraw = 0; s.drawn = null; this.advance(1); }
  }

  start() {
    const s = this.s;
    if (s.players.length < 2) fail('Need at least 2 players');
    shuffle(s.players);
    for (const p of s.players) p.score = 0;
    this.newRound();
  }

  newRound() {
    const s = this.s;
    const ps = this.active();
    const decks = ps.length * s.settings.hand > 60 ? 2 : 1;
    s.deck = shuffle(buildDeck(decks)); s.discard = []; s.decks = decks;
    s.round++; s.phase = 'playing'; s.dir = 1; s.pendingDraw = 0; s.drawn = null; s.vulnerable = null; s.roundWinner = null;
    for (const p of s.players) { p.hand = []; p.called = false; }
    for (let k = 0; k < s.settings.hand; k++) for (const p of ps) p.hand.push(s.deck.pop());
    // first card: never a +4
    let first;
    while (true) { first = s.deck.pop(); if (first.v !== 'w4') break; s.deck.unshift(first); }
    s.discard.push(first);
    s.color = first.c === 'w' ? COLORS[Math.floor(Math.random() * 4)] : first.c;
    // rotate who starts each round
    s.starter = this.nextIndex(s.starter < 0 ? -1 : s.starter, 1, true);
    s.turn = s.starter;
    this.log(`Round ${s.round} begins — ${decks > 1 ? '2 decks, ' : ''}${s.settings.hand} cards each`);
    this.emit({ type: 'deal', n: s.settings.hand });
    this.emit({ type: 'flip', card: first, color: s.color });
    // first-card effects apply to the starting player
    if (first.v === 'skip') { this.log(`First card is a Skip — ${this.nm(this.cur())} is skipped`); this.emit({ type: 'skip', pid: this.cur().id }); s.turn = this.nextIndex(s.turn, 1); }
    else if (first.v === 'rev') { s.dir = -1; this.emit({ type: 'reverse', dir: -1 }); this.log('First card is a Reverse — play goes the other way'); }
    else if (first.v === 'd2') { const p = this.cur(); this.give(p, 2); this.log(`${this.nm(p)} draws 2 from the first card`); s.turn = this.nextIndex(s.turn, 1); }
    this.beginTurn();
  }

  // index of the next active player moving `steps` in direction
  nextIndex(from, steps = 1, ignoreDir = false, dir = null) {
    const s = this.s, n = s.players.length, d = dir ?? (ignoreDir ? 1 : s.dir);
    let i = from;
    for (let k = 0; k < steps; k++) {
      let guard = 0;
      do { i = ((i + d) % n + n) % n; } while (s.players[i].left && ++guard < n);
    }
    return i;
  }

  refill() {
    const s = this.s;
    if (s.deck.length) return true;
    if (s.discard.length <= 1) return false;
    const t = s.discard.pop();
    s.deck = shuffle(s.discard); s.discard = [t];
    this.emit({ type: 'shuffle' });
    this.log('The discard pile was reshuffled into the deck');
    return true;
  }
  give(p, n) {
    let got = 0;
    for (let k = 0; k < n; k++) { if (!this.refill()) break; p.hand.push(this.s.deck.pop()); got++; }
    if (p.hand.length > 1) { p.called = false; if (this.s.vulnerable === p.id) this.s.vulnerable = null; }
    if (got) this.emit({ type: 'draw', pid: p.id, n: got });
    return got;
  }

  beginTurn() {
    const s = this.s;
    s.drawn = null;
    s.turnEnds = s.settings.timer ? Date.now() + s.settings.timer * 1000 : 0;
    this.emit({ type: 'turn', pid: this.cur().id });
  }
  advance(steps) {
    const s = this.s;
    s.turn = this.nextIndex(s.turn, steps);
    this.beginTurn();
  }
  clearVulnerable(byPid) {
    const s = this.s;
    if (s.vulnerable && s.vulnerable !== byPid) s.vulnerable = null;
  }

  // ---------- actions ----------
  handle(pid, a) {
    try { this._handle(pid, a); return null; }
    catch (e) { if (e instanceof RuleError) return e.message; throw e; }
  }
  _handle(pid, a) {
    const s = this.s, p = this.P(pid);
    if (!p) fail('Unknown player');
    if (a.type === 'chat') return this.chat(p, a.text);
    if (s.phase === 'lobby') {
      if (a.type === 'setAvatar') {
        if (!AVATARS.includes(a.avatar) || s.players.some(x => x.avatar === a.avatar && x.id !== pid)) fail('Avatar taken');
        p.avatar = a.avatar; return;
      }
      if (pid !== s.hostId) fail('Only the host can do that');
      if (a.type === 'settings') {
        const v = a.settings || {};
        if ([5, 7, 10].includes(v.hand)) s.settings.hand = v.hand;
        if (typeof v.stacking === 'boolean') s.settings.stacking = v.stacking;
        if ([0, 100, 300, 500].includes(v.target)) s.settings.target = v.target;
        if ([0, 15, 30, 60].includes(v.timer)) s.settings.timer = v.timer;
        return;
      }
      if (a.type === 'start') return this.start();
      fail('Game not started');
    }
    if (a.type === 'nextRound') {
      if (pid !== s.hostId) fail('Only the host can start the next round');
      if (s.phase !== 'roundover') fail('Round still running');
      return this.newRound();
    }
    if (s.phase !== 'playing') fail('Round is over');
    if (p.left) fail('You left this game');
    switch (a.type) {
      case 'play': return this.play(p, a.card, a.color);
      case 'draw': return this.draw(p);
      case 'pass': return this.pass(p);
      case 'call': return this.call(p);
      case 'catch': return this.catch(p, a.target);
      default: fail('Unknown action');
    }
  }

  chat(p, text) {
    text = String(text || '').trim().slice(0, 200); if (!text) return;
    this.s.chat.push({ id: ++this.s.seq, pid: p.id, text }); if (this.s.chat.length > 60) this.s.chat.shift();
    this.emit({ type: 'chat', pid: p.id });
  }

  play(p, cardId, color) {
    const s = this.s;
    if (this.cur().id !== p.id) fail('Not your turn');
    const idx = p.hand.findIndex(c => c.id === cardId);
    if (idx < 0) fail('You don\'t have that card');
    const card = p.hand[idx];
    if (s.drawn != null && s.drawn !== cardId) fail('You can only play the card you just drew (or pass)');
    if (!playable(s, card)) fail(s.pendingDraw ? `Stack a draw card or take ${s.pendingDraw} cards` : 'That card doesn\'t match');
    if (card.c === 'w' && !COLORS.includes(color)) fail('Pick a color');
    this.clearVulnerable(p.id);
    p.hand.splice(idx, 1);
    s.discard.push(card);
    if (s.discard.length > 60) s.deck.unshift(...s.discard.splice(0, s.discard.length - 30)); // keep payload small
    s.color = card.c === 'w' ? color : card.c;
    s.drawn = null;
    this.emit({ type: 'play', pid: p.id, card, color: s.color });
    const label = cardLabel(card) + (card.c === 'w' ? ` → ${COLOR_NAMES[s.color]}` : '');
    this.log(`${this.nm(p)} played ${label}`);

    // last-card call check
    if (p.hand.length === 1) {
      if (!p.called) { s.vulnerable = p.id; }
    } else if (p.hand.length > 1) p.called = false;

    const n = this.active().length;
    if (p.hand.length === 0) {
      // a final draw card still hits the next player
      if (card.v === 'd2' || card.v === 'w4') {
        const victim = s.players[this.nextIndex(s.turn, 1)];
        const total = s.pendingDraw + (card.v === 'd2' ? 2 : 4);
        this.give(victim, total); s.pendingDraw = 0;
      }
      return this.winRound(p);
    }

    switch (card.v) {
      case 'skip': {
        const victim = s.players[this.nextIndex(s.turn, 1)];
        this.emit({ type: 'skip', pid: victim.id });
        return this.advance(2);
      }
      case 'rev':
        s.dir *= -1;
        this.emit({ type: 'reverse', dir: s.dir });
        return this.advance(n === 2 ? 2 : 1);
      case 'd2': case 'w4': {
        const add = card.v === 'd2' ? 2 : 4;
        if (s.settings.stacking) {
          s.pendingDraw += add;
          return this.advance(1);
        }
        const victim = s.players[this.nextIndex(s.turn, 1)];
        this.give(victim, add);
        this.log(`${this.nm(victim)} draws ${add} and is skipped`);
        this.emit({ type: 'skip', pid: victim.id });
        return this.advance(2);
      }
      default:
        return this.advance(1);
    }
  }

  draw(p) {
    const s = this.s;
    if (this.cur().id !== p.id) fail('Not your turn');
    if (s.drawn != null) fail('You already drew — play it or pass');
    this.clearVulnerable(p.id);
    if (s.pendingDraw > 0) {
      const n = s.pendingDraw; s.pendingDraw = 0;
      this.give(p, n);
      this.log(`${this.nm(p)} takes ${n} cards`);
      return this.advance(1);
    }
    if (!this.give(p, 1)) { this.log('No cards left to draw'); return this.advance(1); }
    const card = p.hand[p.hand.length - 1];
    if (playable(s, card)) { s.drawn = card.id; s.turnEnds = s.settings.timer ? Date.now() + Math.min(15, s.settings.timer) * 1000 : 0; this.log(`${this.nm(p)} drew a card`); return; }
    this.log(`${this.nm(p)} drew a card and passes`);
    this.advance(1);
  }

  pass(p) {
    const s = this.s;
    if (this.cur().id !== p.id) fail('Not your turn');
    if (s.drawn == null) fail('Draw a card first');
    s.drawn = null;
    this.advance(1);
  }

  call(p) {
    const s = this.s;
    if (p.hand.length > 2) fail('You can only call BLITZ! with 2 cards or fewer');
    if (p.called) return;
    if (p.hand.length === 2 && this.cur().id !== p.id) fail('Call it on your turn, as you play your second-last card');
    p.called = true;
    if (s.vulnerable === p.id) s.vulnerable = null;
    this.emit({ type: 'call', pid: p.id });
    this.log(`${this.nm(p)} shouts BLITZ!`);
  }

  catch(p, targetId) {
    const s = this.s;
    const t = this.P(targetId);
    if (!t || s.vulnerable !== targetId || t.id === p.id) fail('Too late!');
    s.vulnerable = null;
    this.give(t, 2);
    this.emit({ type: 'catch', by: p.id, target: t.id });
    this.log(`${this.nm(p)} caught ${this.nm(t)} not calling BLITZ! (+2 cards)`);
  }

  winRound(p) {
    const s = this.s;
    let pts = 0;
    for (const o of s.players) if (o !== p) pts += o.hand.reduce((a, c) => a + points(c), 0);
    p.score += pts;
    s.roundWinner = p.id; s.lastPoints = pts; s.vulnerable = null; s.turnEnds = 0;
    this.log(`🏆 ${this.nm(p)} wins round ${s.round} (+${pts} points)`);
    this.emit({ type: 'roundWin', pid: p.id, pts });
    if (!s.settings.target || p.score >= s.settings.target) return this.finishGame(p);
    s.phase = 'roundover';
  }
  finishGame(p) {
    const s = this.s;
    s.phase = 'ended'; s.champion = p?.id ?? null; s.turnEnds = 0;
    if (p) this.log(`🎉 ${this.nm(p)} wins the game!`);
    this.emit({ type: 'win', pid: p?.id });
  }

  // host timer: returns true if something happened
  tick(now = Date.now()) {
    const s = this.s;
    return s.phase === 'playing' && s.turnEnds && now > s.turnEnds;
  }
}

export function cardLabel(c) {
  const v = { skip: 'Skip', rev: 'Reverse', d2: '+2', wild: 'Wild', w4: 'Wild +4' }[c.v] || c.v;
  return c.c === 'w' ? v : `${COLOR_NAMES[c.c]} ${v}`;
}

// What a given player is allowed to see: their own hand, everyone else's card counts.
export function viewFor(s, pid) {
  const v = { ...s, deck: undefined, deckCount: s.deck.length, discard: s.discard.slice(-8) };
  v.players = s.players.map(p => ({ ...p, hand: p.id === pid ? p.hand : undefined, count: p.hand.length }));
  v.log = s.log.slice(-40); v.chat = s.chat.slice(-40);
  return v;
}
