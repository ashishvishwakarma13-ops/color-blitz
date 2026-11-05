// Color Blitz — rendering, animation, modals.
import { AVATARS, COLOR_NAMES, MAX_PLAYERS, playable, cardLabel, points } from './engine.js';
import { sfx } from './audio.js';

const gsap = window.gsap;
const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => [...el.querySelectorAll(q)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CV = { r: 'var(--cr)', y: 'var(--cy)', g: 'var(--cg)', b: 'var(--cb)' };

const ctx = { myId: null, isHost: false, act: () => { }, offset: 0 };
export function configure(o) { Object.assign(ctx, o); }
let S = null;
let modal = null;
const P = (s, id) => s?.players.find(p => p.id === id);
const me = () => P(S, ctx.myId);
function setHTML(el, h) { if (el && el._h !== h) { el._h = h; el.innerHTML = h; } }
export const avatar = (p, cls = '') => `<span class="av ${cls}" style="--pc:${p.color}"><i class="fa-solid ${p.avatar}"></i></span>`;
export function pname(s, id) { const p = P(s, id); return p ? `<b style="color:color-mix(in srgb, ${p.color} 70%, #fff)">${esc(p.name)}</b>` : '<b>?</b>'; }
const fmtLog = (s, t) => esc(t).replace(/\[\[([^\]]+)\]\]/g, (_, id) => pname(s, id));

// ---------- card markup ----------
function glyph(v) {
  return { skip: '<i class="fa-solid fa-ban"></i>', rev: '<i class="fa-solid fa-arrow-right-arrow-left"></i>', d2: '+2', w4: '+4', wild: '<i class="fa-solid fa-star"></i>' }[v] ?? v;
}
export function cardHTML(c, extra = '') {
  if (!c) return backHTML(extra);
  const g = glyph(c.v);
  const corner = c.v === 'wild' ? '<i class="fa-solid fa-star"></i>' : g;
  const six = (c.v === '6' || c.v === '9') ? '<span class="six-line"></span>' : '';
  return `<div class="card c-${c.c} ${extra}" data-v="${c.v}" data-id="${c.id}"><div class="card-in"><span class="corner tl">${corner}</span><div class="badge"><span>${g}${six}</span></div><span class="corner br">${corner}</span></div></div>`;
}
export function backHTML(extra = '') {
  return `<div class="card back ${extra}"><div class="card-in"><div class="back-logo"><i class="fa-solid fa-bolt"></i><b>COLOR</b><b>BLITZ</b></div></div></div>`;
}

// ---------- background ----------
export function initSky() {
  let stars = '';
  for (let i = 0; i < 60; i++) stars += `<i class="star" style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-delay:${Math.random() * 3}s"></i>`;
  $('#sky').innerHTML = stars;
  const demo = [{ c: 'r', v: '7' }, { c: 'y', v: 'skip' }, { c: 'w', v: 'w4' }, { c: 'g', v: 'rev' }, { c: 'b', v: 'd2' }];
  const hc = $('#hero-cards');
  hc.innerHTML = demo.map((c, i) => cardHTML({ ...c, id: 'h' + i })).join('');
  $$('.card', hc).forEach((el, i) => {
    gsap.fromTo(el, { y: 80, opacity: 0, rotation: 0 }, { y: Math.abs(i - 2) * 10, opacity: 1, rotation: (i - 2) * 11, duration: 0.8, delay: 0.1 + i * 0.08, ease: 'back.out(1.6)' });
  });
}

export function tokenGrid(el, selected, taken = new Set(), onPick) {
  el.innerHTML = AVATARS.map(t => `<button class="token-opt ${t === selected ? 'sel' : ''} ${taken.has(t) && t !== selected ? 'taken' : ''}" data-tok="${t}"><i class="fa-solid ${t}"></i></button>`).join('');
  el.onclick = e => { const b = e.target.closest('[data-tok]'); if (b && !b.classList.contains('taken')) onPick(b.dataset.tok); };
}

// ---------- layout ----------
export function layout() {
  const wrap = $('#table-wrap'), t = $('#table');
  if (!wrap || !$('#game').classList.contains('active')) return;
  const narrow = window.innerWidth <= 1100;
  const W = wrap.clientWidth - (window.innerWidth <= 640 ? 16 : 40);
  const H = narrow ? Math.min(window.innerHeight * 0.55, W * 0.75) : wrap.clientHeight - 60;
  const ratio = window.innerWidth <= 640 ? 1.05 : 1.75;
  const H2 = window.innerWidth <= 640 ? W / ratio : H;
  let w = Math.min(W, H2 * ratio), h = w / ratio;
  w = Math.max(300, w); h = Math.max(190, h);
  t.style.width = w + 'px'; t.style.height = h + 'px';
  if (narrow) wrap.style.height = (h + 120) + 'px'; else wrap.style.height = '';
  const cw = window.innerWidth <= 640 ? Math.max(52, Math.min(64, w * 0.17)) : Math.max(46, Math.min(96, h * 0.2));
  t.style.setProperty('--card-w', cw + 'px');
  if (S) renderSeats(S);
}

// seat order: everyone else, starting with the player after me, laid out left → over the top → right
function seatOrder(s) {
  const n = s.players.length;
  const mi = s.players.findIndex(p => p.id === ctx.myId);
  const out = [];
  for (let k = 1; k <= n; k++) { const p = s.players[((mi < 0 ? -1 : mi) + k) % n]; if (p.id !== ctx.myId) out.push(p); }
  return out;
}
function seatPos(i, k, spectator) {
  const t = $('#table');
  const w = t.clientWidth, h = t.clientHeight;
  const a0 = spectator ? 215 : 168, a1 = spectator ? -35 : 12;
  const ang = (k === 1 ? 90 : a0 - (a0 - a1) * (i / (k - 1))) * Math.PI / 180;
  const rx = window.innerWidth <= 640 ? 0.42 : 0.5;
  return { x: w / 2 + Math.cos(ang) * w * rx, y: h / 2 - Math.sin(ang) * h * 0.52 };
}

// ---------- render ----------
export function render(s) {
  S = s;
  renderSeats(s);
  renderCenter(s);
  renderHand(s);
  renderStatus(s);
  renderScores(s);
  setHTML($('#pane-log'), s.log.slice().reverse().map(l => `<div class="log-entry">${fmtLog(s, l.text)}</div>`).join(''));
  renderChat(s, $('#game-chat'));
  const tgt = s.settings.target ? `Play to ${s.settings.target}` : 'Single round';
  $('#top-info').textContent = `Round ${s.round} · ${tgt}${s.settings.stacking ? ' · Stacking on' : ''}`;
  refreshModal();
}
export function reset() { S = null; $('#seats').innerHTML = ''; setHTML($('#hand'), ''); }

function renderSeats(s) {
  const wrap = $('#seats');
  const order = seatOrder(s);
  const spectator = !me();
  const ids = order.map(p => p.id);
  $$('.seat', wrap).forEach(el => { if (!ids.includes(el.dataset.pid)) el.remove(); });
  const cur = s.players[s.turn]?.id;
  order.forEach((p, i) => {
    let el = $(`.seat[data-pid="${p.id}"]`, wrap);
    if (!el) { el = document.createElement('div'); el.className = 'seat'; el.dataset.pid = p.id; wrap.appendChild(el); }
    const pos = seatPos(i, order.length, spectator);
    el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
    el.style.setProperty('--pc', p.color);
    el.classList.toggle('turn', s.phase === 'playing' && p.id === cur);
    el.classList.toggle('left', !!p.left);
    const n = p.count ?? p.hand?.length ?? 0;
    const fanN = Math.min(n, 9);
    const fan = Array.from({ length: fanN }, (_, j) => `<i class="mini" style="transform:rotate(${(j - (fanN - 1) / 2) * 9}deg)"></i>`).join('');
    const tags = [];
    if (p.bot) tags.push('<span class="status bot">bot</span>');
    if (!p.bot && !p.connected && !p.left) tags.push('<span class="status dc">offline</span>');
    if (p.called && n <= 1 && s.phase === 'playing') tags.push('<span class="blitz-tag">BLITZ!</span>');
    if (s.settings.target) tags.push(`<span class="score">${p.score} pts</span>`);
    const catchBtn = s.vulnerable === p.id && me() && !me().left ? `<button class="btn tiny danger catch-btn" data-act='${JSON.stringify({ type: 'catch', target: p.id })}'><i class="fa-solid fa-hand"></i> Catch!</button>` : '';
    setHTML(el, `<div class="fan">${fan}</div><div class="av-wrap">${avatar(p)}<span class="count ${n === 1 ? 'low' : ''}">${n}</span></div><div class="sname">${esc(p.name)}</div><div class="tags">${tags.join('')}</div>${catchBtn}`);
  });
}

function renderCenter(s) {
  const t = $('#table');
  t.style.setProperty('--glow', CV[s.color]);
  $('#dir-ring').classList.toggle('ccw', s.dir < 0);
  const m = me();
  const myTurn = m && s.phase === 'playing' && s.players[s.turn]?.id === m.id && s.drawn == null;
  setHTML($('#deck'), backHTML() + backHTML() + backHTML() + `<div class="deck-count">${s.deckCount} cards</div>`);
  $('#deck').classList.toggle('can', !!myTurn);
  const pile = s.discard.slice(-5);
  setHTML($('#discard'), pile.map((c, i) => {
    const r = ((c.id * 37) % 30) - 15;
    const chosen = c.c === 'w' && i === pile.length - 1 ? ` data-chosen style="--chosen:${CV[s.color]};transform:rotate(${r}deg)"` : ` style="transform:rotate(${r}deg)"`;
    return cardHTML(c).replace('<div class="card', `<div${chosen} class="card`);
  }).join(''));
  setHTML($('#color-ind'), `<span class="dot"></span>${COLOR_NAMES[s.color]}`);
  const pd = $('#pending');
  pd.hidden = !s.pendingDraw; pd.textContent = '+' + s.pendingDraw;
}

function renderHand(s) {
  const m = me(), el = $('#hand');
  if (!m) return setHTML(el, '<div class="hand-empty">Spectating</div>');
  const hand = [...(m.hand || [])];
  const order = { r: 0, y: 1, g: 2, b: 3, w: 4 }, vo = v => (/^\d$/.test(v) ? +v : { skip: 10, rev: 11, d2: 12, wild: 13, w4: 14 }[v]);
  hand.sort((a, b) => order[a.c] - order[b.c] || vo(a.v) - vo(b.v));
  const myTurn = s.phase === 'playing' && s.players[s.turn]?.id === m.id;
  el.classList.toggle('myturn', myTurn);
  const cw = parseFloat(getComputedStyle($('#table')).getPropertyValue('--card-w')) || 86;
  el.style.setProperty('--card-w', Math.max(56, Math.min(92, cw * 1.05)) + 'px');
  const avail = el.clientWidth - 40, cardW = Math.max(56, Math.min(92, cw * 1.05));
  const overlap = hand.length > 1 ? Math.min(-8, (avail - cardW) / (hand.length - 1) - cardW) : 0;
  el.style.setProperty('--overlap', Math.max(-cardW * 0.72, overlap) + 'px');
  const html = hand.map(c => {
    const ok = myTurn && playable(s, c) && (s.drawn == null || s.drawn === c.id);
    return cardHTML(c, ok ? 'ok' : '');
  }).join('') || (s.phase === 'playing' ? '<div class="hand-empty">No cards!</div>' : '');
  setHTML(el, html);
}

function renderStatus(s) {
  const m = me(), cur = s.players[s.turn];
  let h = '';
  if (s.phase === 'roundover' || s.phase === 'ended') {
    const w = P(s, s.phase === 'ended' ? s.champion : s.roundWinner);
    h = `<div class="status-text mine">${w ? avatar(w, 'sm') + ' ' + esc(w.name) + (s.phase === 'ended' ? ' wins the game!' : ' wins the round!') : 'Game over'}</div>
      ${s.phase === 'roundover' && ctx.isHost ? `<button class="btn primary" data-act='{"type":"nextRound"}'><i class="fa-solid fa-forward"></i> Next round</button>` : ''}
      <button class="btn" data-ui="results"><i class="fa-solid fa-trophy"></i> Scores</button>`;
  } else if (m && !m.left && cur?.id === m.id) {
    const n = m.hand?.length || 0;
    const opts = (m.hand || []).filter(c => playable(s, c));
    let msg = s.pendingDraw ? (opts.length ? `Stack a draw card or take <b>+${s.pendingDraw}</b>` : `No stack — take <b>+${s.pendingDraw}</b>`) : s.drawn != null ? 'You drew a playable card — play it or pass' : opts.length ? 'Your turn — play a highlighted card' : 'No match — draw a card';
    h = `<div class="status-text mine"><i class="fa-solid fa-hand-pointer"></i> ${msg}</div>`;
    if (s.drawn != null) h += `<button class="btn" data-act='{"type":"pass"}'><i class="fa-solid fa-forward"></i> Pass</button>`;
    else h += `<button class="btn ${opts.length ? '' : 'accent'}" data-act='{"type":"draw"}'><i class="fa-solid fa-layer-group"></i> ${s.pendingDraw ? 'Take ' + s.pendingDraw : 'Draw'}</button>`;
    if (n === 2 && !m.called) h += `<button class="btn blitz" data-act='{"type":"call"}'><i class="fa-solid fa-bolt"></i> BLITZ!</button>`;
  } else {
    if (m && s.vulnerable === m.id) h += `<button class="btn blitz" data-act='{"type":"call"}'><i class="fa-solid fa-bolt"></i> BLITZ! (quick!)</button>`;
    h += cur ? `<div class="status-text">${avatar(cur, 'sm')} ${esc(cur.name)} is playing…</div>` : '';
  }
  setHTML($('#status'), h);
}

function renderScores(s) {
  const max = Math.max(1, s.settings.target || Math.max(...s.players.map(p => p.score), 1));
  const rows = [...s.players].sort((a, b) => b.score - a.score).map(p => {
    const n = p.count ?? p.hand?.length ?? 0;
    return `<div class="score-row">${avatar(p, 'sm')}<div style="flex:1;min-width:0"><div style="display:flex;gap:8px"><span class="nm">${esc(p.name)}${p.id === ctx.myId ? ' <span class="status">you</span>' : ''}</span><span class="cards">${p.left ? 'left' : n + (n === 1 ? ' card' : ' cards')}</span><span class="pts">${p.score}</span></div><div class="score-bar"><i style="width:${Math.min(100, p.score / max * 100)}%"></i></div></div></div>`;
  }).join('');
  setHTML($('#pane-scores'), `<div class="muted small">${s.settings.target ? `First to <b>${s.settings.target}</b> points wins. Round winners score the cards left in everyone else's hands.` : 'Single round: first to empty their hand wins.'}</div>${rows}`);
}

export function renderChat(s, el) {
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  setHTML(el, s.chat.length ? s.chat.map(m => `<div class="chat-msg">${pname(s, m.pid)}: ${esc(m.text)}</div>`).join('') : '<div class="muted small">No messages yet.</div>');
  if (atBottom) el.scrollTop = el.scrollHeight;
}

// ---------- lobby ----------
export function renderLobby(s, { code, netStatus }) {
  S = s;
  $('#room-code').textContent = code;
  const isHost = ctx.isHost;
  $('#pcount').textContent = `${s.players.length} / ${MAX_PLAYERS}`;
  let h = s.players.map(p => `<div class="lp">${avatar(p)}<span class="name">${esc(p.name)}</span><span class="tags">
    ${p.id === s.hostId ? '<span class="status host"><i class="fa-solid fa-crown"></i> host</span>' : ''}${p.bot ? '<span class="status bot">bot</span>' : ''}${p.id === ctx.myId ? '<span class="status">you</span>' : ''}
    ${isHost && p.id !== ctx.myId ? `<button class="btn tiny ghost" data-ui="kick:${p.id}" title="Remove"><i class="fa-solid fa-xmark"></i></button>` : ''}</span></div>`).join('');
  for (let i = s.players.length; i < Math.max(4, Math.min(MAX_PLAYERS, s.players.length + 1)); i++) h += `<div class="lp empty"><i class="fa-regular fa-user"></i>&nbsp; Open seat</div>`;
  setHTML($('#lobby-players'), h);
  $('#add-bot').hidden = !isHost; $('#add-bot').disabled = s.players.length >= MAX_PLAYERS;
  $('#start-game').hidden = !isHost; $('#start-game').disabled = s.players.length < 2;
  $('#lobby-wait').hidden = isHost;
  for (const [id, key] of [['set-hand', 'hand'], ['set-target', 'target'], ['set-timer', 'timer']]) { const el = $('#' + id); el.value = String(s.settings[key]); el.disabled = !isHost; }
  $('#set-stack').checked = s.settings.stacking; $('#set-stack').disabled = !isHost;
  const m = me();
  tokenGrid($('#lobby-token'), m?.avatar, new Set(s.players.map(p => p.avatar)), a => ctx.act({ type: 'setAvatar', avatar: a }));
  renderChat(s, $('#lobby-chat'));
  const ns = $('#net-status');
  ns.className = 'net-status ' + (netStatus?.level || '');
  ns.innerHTML = `<span class="dot"></span>${esc(netStatus?.text || '')}`;
}

// ---------- animations ----------
function rectOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }
function seatEl(pid) { return $(`.seat[data-pid="${pid}"] .av-wrap`); }
function flyCard(html, from, to, { dur = 0.45, rot = 0, delay = 0, scaleFrom = 0.6 } = {}) {
  const fx = $('#fx');
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const el = holder.firstChild;
  const cw = parseFloat(getComputedStyle($('#table')).getPropertyValue('--card-w')) || 86;
  el.style.setProperty('--card-w', cw + 'px');
  fx.appendChild(el);
  const w = cw, h = cw * 1.48;
  return new Promise(res => {
    gsap.fromTo(el, { x: from.x - w / 2, y: from.y - h / 2, scale: scaleFrom, rotation: 0, opacity: 1 },
      { x: to.x - w / 2, y: to.y - h / 2, scale: 1, rotation: rot, duration: dur, delay, ease: 'power2.out', onComplete: () => { el.remove(); res(); } });
  });
}
function shout(text, at, cls = '') {
  const el = document.createElement('div');
  el.className = 'shout ' + cls;
  el.textContent = text;
  el.style.left = at.x + 'px'; el.style.top = at.y + 'px';
  document.body.appendChild(el);
  gsap.fromTo(el, { scale: 0.2, opacity: 0, rotation: -12 }, { scale: 1, opacity: 1, rotation: -4, duration: 0.45, ease: 'back.out(3)' });
  gsap.to(el, { opacity: 0, y: -40, delay: 1.1, duration: 0.4, onComplete: () => el.remove() });
}
function originFor(pid) {
  if (pid === ctx.myId) return rectOf($('#hand'));
  const s = seatEl(pid); return s ? rectOf(s) : rectOf($('#deck'));
}

export async function playEvent(ev, s, fast) {
  const myId = ctx.myId;
  const d = fast ? 0.5 : 1;
  switch (ev.type) {
    case 'deal': {
      sfx.dice();
      const deck = rectOf($('#deck'));
      const targets = s.players.filter(p => !p.left).map(p => p.id);
      const rounds = Math.min(3, ev.n);
      const jobs = [];
      let k = 0;
      for (let r = 0; r < rounds; r++) for (const pid of targets) jobs.push(flyCard(backHTML(), deck, originFor(pid), { dur: 0.3 * d, delay: (k++) * 0.035 * d, rot: Math.random() * 30 - 15 }));
      await Promise.all(jobs);
      return;
    }
    case 'flip': sfx.card(); return sleep(200 * d);
    case 'turn':
      if (ev.pid === myId) { sfx.myturn(); } else sfx.turn();
      return;
    case 'play': {
      sfx.card();
      let from = originFor(ev.pid);
      if (ev.pid === myId) { const el = $(`#hand .card[data-id="${ev.card.id}"]`); if (el) { from = rectOf(el); el.style.visibility = 'hidden'; } }
      await flyCard(cardHTML(ev.card), from, rectOf($('#discard')), { dur: 0.42 * d, rot: ((ev.card.id * 37) % 30) - 15, scaleFrom: ev.pid === myId ? 1 : 0.5 });
      if (ev.card.c === 'w') { const t = $('#table'); t.style.setProperty('--glow', CV[ev.color]); shout(COLOR_NAMES[ev.color].toUpperCase() + '!', rectOf($('#discard')), 'small'); }
      if (ev.card.v === 'd2' || ev.card.v === 'w4') { sfx.pay(); shout(ev.card.v === 'd2' ? '+2' : '+4', rectOf($('#discard'))); await sleep(300 * d); }
      return;
    }
    case 'draw': {
      const deck = rectOf($('#deck')), to = originFor(ev.pid);
      const n = Math.min(ev.n, 6);
      sfx.hop();
      await Promise.all(Array.from({ length: n }, (_, j) => flyCard(backHTML(), deck, to, { dur: 0.35 * d, delay: j * 0.08 * d, rot: Math.random() * 20 - 10, scaleFrom: 1 })));
      if (ev.n >= 2) { const sEl = originFor(ev.pid); shout('+' + ev.n, { x: sEl.x, y: sEl.y - 30 }, 'small bad'); }
      return;
    }
    case 'skip': {
      sfx.error();
      const at = originFor(ev.pid);
      shout('SKIPPED', { x: at.x, y: at.y - 20 }, 'small bad');
      return sleep(350 * d);
    }
    case 'reverse': {
      sfx.trade();
      const svg = $('#dir-ring svg');
      gsap.fromTo(svg, { scale: 1.25, opacity: 1 }, { scale: 1, opacity: 0.5, duration: 0.8 });
      shout('REVERSE!', rectOf($('#center')), 'small');
      return sleep(300 * d);
    }
    case 'shuffle': sfx.dice(); toast('Deck reshuffled', 'info', 'fa-shuffle'); return;
    case 'call': {
      sfx.jackpot();
      const at = originFor(ev.pid);
      shout('BLITZ!', { x: at.x, y: at.y - 40 });
      return sleep(300 * d);
    }
    case 'catch': {
      sfx.jail();
      const at = originFor(ev.target);
      shout('CAUGHT! +2', { x: at.x, y: at.y - 40 }, 'bad');
      toast(`${esc(P(s, ev.by)?.name)} caught ${esc(P(s, ev.target)?.name)}!`, 'gold', 'fa-hand');
      return sleep(300 * d);
    }
    case 'roundWin': {
      sfx.win();
      const at = originFor(ev.pid);
      shout(ev.pid === myId ? 'YOU WIN THE ROUND!' : 'ROUND OVER', { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      confetti(80);
      return sleep(900);
    }
    case 'win': sfx.win(); confetti(160); return;
    case 'chat':
      if (ev.pid !== myId) {
        sfx.chat();
        if (!$('.tab[data-tab="chat"]')?.classList.contains('active')) { const b = $('#chat-badge'); b.hidden = false; b.textContent = (+b.textContent || 0) + 1; }
      }
      return;
  }
}
function confetti(n) {
  if (!window.confetti) return;
  const colors = ['#ff4d5e', '#ffc23d', '#22c97a', '#3d8bff', '#ffffff'];
  window.confetti({ particleCount: n, spread: 90, origin: { y: 0.6 }, colors });
}

// ---------- timer ring ----------
setInterval(() => {
  if (!S || S.phase !== 'playing' || !S.turnEnds || !S.settings.timer) return;
  const left = S.turnEnds - (Date.now() + ctx.offset);
  const pct = Math.max(0, Math.min(1, left / (S.settings.timer * 1000)));
  const cur = S.players[S.turn];
  const el = cur && $(`.seat[data-pid="${cur.id}"]`);
  if (el) el.style.setProperty('--pct', pct.toFixed(3));
}, 200);

// ---------- toasts & modals ----------
export function toast(html, kind = 'info', icon) {
  const icons = { err: 'fa-circle-exclamation', good: 'fa-circle-check', info: 'fa-circle-info', gold: 'fa-star' };
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<i class="fa-solid ${icon || icons[kind]}"></i><span>${html}</span>`;
  $('#toasts').appendChild(el);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
  gsap.fromTo(el, { y: -20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'back.out(2)' });
  gsap.to(el, { opacity: 0, delay: kind === 'err' ? 3.5 : 2.4, duration: 0.3, onComplete: () => el.remove() });
}
export function closeModal() {
  if (!modal) return;
  const el = modal.el; modal = null;
  gsap.to(el, { opacity: 0, duration: 0.15, onComplete: () => el.remove() });
}
function openModal(kind, html) {
  if (modal) { modal.el.remove(); modal = null; }
  const el = document.createElement('div');
  el.className = 'modal-bg';
  el.innerHTML = `<div class="modal glass"><button class="icon-btn close" data-ui="close"><i class="fa-solid fa-xmark"></i></button><div class="modal-body">${html}</div></div>`;
  el.addEventListener('mousedown', e => { if (e.target === el && kind !== 'color') closeModal(); });
  $('#modal-root').appendChild(el);
  gsap.fromTo(el.querySelector('.modal'), { y: 30, scale: 0.95, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.6)' });
  modal = { kind, el };
  return el;
}
function refreshModal() {
  if (modal?.kind === 'results' && S) setHTML(modal.el.querySelector('.modal-body'), resultsHTML(S));
}

export function pickColor(onPick) {
  const el = openModal('color', `<h2>Choose a color</h2><div class="color-pick">${['r', 'y', 'g', 'b'].map(c => `<button data-color="${c}">${COLOR_NAMES[c]}</button>`).join('')}</div>`);
  el.querySelector('.color-pick').onclick = e => { const b = e.target.closest('[data-color]'); if (b) { closeModal(); onPick(b.dataset.color); } };
}

function resultsHTML(s) {
  const ended = s.phase === 'ended';
  const w = P(s, ended ? s.champion : s.roundWinner);
  const ranked = [...s.players].sort((a, b) => b.score - a.score);
  const rows = ranked.map((p, j) => {
    const n = p.count ?? p.hand?.length ?? 0;
    return `<div class="rank"><span class="pos">#${j + 1}</span>${avatar(p, 'sm')}<span class="nm">${esc(p.name)}</span><span class="muted small">${p.id === s.roundWinner ? 'won round' : n + (n === 1 ? ' card left' : ' cards left')}</span><b style="color:var(--cy);min-width:60px;text-align:right">${p.score}</b></div>`;
  }).join('');
  const title = !w ? 'Game over' : ended ? `${esc(w.name)} wins the game!` : `${esc(w.name)} wins round ${s.round}`;
  const sub = ended ? (s.settings.target ? `Reached ${w?.score} points` : 'Single-round game') : `+${s.lastPoints} points · first to ${s.settings.target} wins`;
  const actions = ended
    ? `${ctx.isHost ? '<button class="btn primary" data-ui="newGame"><i class="fa-solid fa-rotate"></i> New game, same room</button>' : ''}<button class="btn" data-ui="home"><i class="fa-solid fa-house"></i> Main menu</button>`
    : (ctx.isHost ? `<button class="btn primary" data-act='{"type":"nextRound"}'><i class="fa-solid fa-forward"></i> Next round</button>` : '<span class="muted">Waiting for the host to start the next round…</span>');
  return `<div class="winner-wrap"><div class="trophy"><i class="fa-solid fa-trophy"></i></div><h2 style="margin-top:8px">${title}</h2><div class="muted">${sub}</div>
    <div style="margin-top:16px">${rows}</div><div class="modal-actions" style="justify-content:center">${actions}</div></div>`;
}
export function showResults(s) { openModal('results', resultsHTML(s)); }

export function openRules() {
  openModal('rules', `<h2><i class="fa-solid fa-book-open"></i> How to play</h2><div class="rules">
  <h3>Goal</h3>Be the first to get rid of all your cards.
  <h3>Your turn</h3><ul><li>Play one card that matches the top card's <b>color</b> or its <b>number/symbol</b>. Wild cards can always be played.</li>
  <li>Can't (or don't want to)? <b>Draw</b> one card. If it fits you may play it right away, otherwise your turn ends.</li></ul>
  <h3>Action cards</h3><ul><li><i class="fa-solid fa-ban"></i> <b>Skip</b>: the next player loses their turn.</li><li><i class="fa-solid fa-arrow-right-arrow-left"></i> <b>Reverse</b>: play changes direction (with 2 players it acts like Skip).</li>
  <li><b>+2</b>: the next player draws 2 and loses their turn.</li><li><i class="fa-solid fa-star"></i> <b>Wild</b>: choose the next color.</li><li><b>Wild +4</b>: choose the color, and the next player draws 4 and loses their turn.</li></ul>
  <h3>Stacking (optional)</h3>If enabled, answer a +2 with another +2 (or a +4), or a +4 with a +4, to pass the growing penalty to the next player.
  <h3>BLITZ!</h3>When you're about to go down to one card, press <b>BLITZ!</b> as you play your second-last card. Forget, and anyone can hit <b>Catch!</b> on you before the next player moves, and you draw 2.
  <h3>Scoring</h3>The round winner scores the cards left in everyone's hands: numbers at face value, action cards 20, wilds 50. First to the target wins.
  <h3>Timer</h3>If the turn timer runs out, you automatically draw and pass.
  </div>`);
}

export function confirmBox(title, text, okLabel, onOk) {
  const el = openModal('confirm', `<h2>${title}</h2><p class="muted" style="line-height:1.6">${text}</p><div class="modal-actions"><button class="btn ghost" data-ui="close">Cancel</button><button class="btn danger" id="confirm-ok">${okLabel}</button></div>`);
  el.querySelector('#confirm-ok').onclick = () => { closeModal(); onOk(); };
}
export function showMenu(anchor, items) {
  $$('.menu-pop').forEach(m => m.remove());
  const el = document.createElement('div');
  el.className = 'menu-pop';
  el.innerHTML = items.map((it, j) => `<button data-j="${j}" class="${it.danger ? 'danger' : ''}"><i class="fa-solid ${it.icon}"></i> ${it.label}</button>`).join('');
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.top = r.bottom + 6 + 'px';
  el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.right - el.offsetWidth)) + 'px';
  el.onclick = e => { const b = e.target.closest('[data-j]'); if (b) { el.remove(); items[+b.dataset.j].run(); } };
  setTimeout(() => document.addEventListener('click', function off(e) { if (!el.contains(e.target)) { el.remove(); document.removeEventListener('click', off); } }), 0);
}
export { cardLabel, points };
