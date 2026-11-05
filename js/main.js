// Color Blitz — app controller: screens, host/guest networking, private views, bots.
import { AVATARS, Game, newState, viewFor, playable } from './engine.js';
import { botAction, botNeeds } from './bot.js';
import { HostNet, ClientNet, makeCode } from './net.js';
import { sfx, unlock, isMuted, setMuted } from './audio.js';
import * as UI from './ui.js';

const $ = q => document.querySelector(q);
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
};

let cid = store.get('cb-cid');
if (!cid) { cid = 'u' + Math.random().toString(36).slice(2, 11); store.set('cb-cid', cid); }
let myName = store.get('cb-name', store.get('st-name', ''));
let myAvatar = store.get('cb-avatar', AVATARS[Math.floor(Math.random() * AVATARS.length)]);

let mode = null, code = null, myId = null, game = null, hostNet = null, clientNet = null, latest = null, loopTimer = null;
let netStatus = { level: 'warn', text: 'Connecting…' };
const conns = new Map(); // host: connId -> pid

UI.configure({ act, myId: null, isHost: false });

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  if (id === 'game') requestAnimationFrame(UI.layout);
}
const current = () => document.querySelector('.screen.active')?.id;
function connOverlay(text) { const o = $('#conn-overlay'); if (!text) { o.hidden = true; return; } $('#conn-text').textContent = text; o.hidden = false; }

// ---------- animation queue ----------
const queue = [];
let busy = false, seenFirst = false;
function receive(msg) { queue.push(msg); if (!busy) pump(); }
async function pump() {
  busy = true;
  while (queue.length) {
    const m = queue.shift(), s = m.s;
    if (s.phase === 'lobby') {
      latest = s;
      if (current() !== 'lobby') { UI.closeModal(); show('lobby'); UI.reset(); }
      UI.renderLobby(s, { code, netStatus });
      for (const ev of m.ev || []) if (ev.type === 'chat' && ev.pid !== myId) sfx.chat();
      continue;
    }
    const entering = current() !== 'game';
    if (entering) { show('game'); $('#game-code').textContent = code; UI.layout(); }
    const animate = seenFirst || (m.ev || []).some(e => e.type === 'deal');
    if (entering) UI.render(s);
    if (animate) {
      const fast = queue.length > 1;
      for (const ev of m.ev || []) { try { await UI.playEvent(ev, s, fast); } catch (e) { console.error(e); } }
    }
    seenFirst = true;
    const prevPhase = latest?.phase;
    latest = s;
    UI.render(s);
    if ((s.phase === 'roundover' || s.phase === 'ended') && prevPhase !== s.phase) setTimeout(() => UI.showResults(latest), 500);
    if (s.phase === 'playing' && (prevPhase === 'roundover' || prevPhase === 'ended')) UI.closeModal();
  }
  busy = false;
}

function act(a) {
  unlock();
  if (mode === 'host') {
    const err = game.handle(myId, a);
    if (err) { UI.toast(UI.esc(err), 'err'); sfx.error(); } else sync();
  } else if (mode === 'guest') clientNet?.send({ t: 'act', a });
}

// ---------- HOST ----------
function sync() {
  const ev = game.takeEvents(), s = game.s, now = Date.now();
  for (const [connId, pid] of conns) hostNet?.send(connId, { t: 'state', s: viewFor(s, pid), ev, now });
  receive({ t: 'state', s: viewFor(s, myId), ev, now });
  if (s.phase !== 'ended' && s.phase !== 'lobby') store.set('cb-host', { code, state: s, myId, t: now }); else store.del('cb-host');
}

function startHost(resume) {
  stopAll();
  mode = 'host'; myId = cid; seenFirst = false; latest = null;
  code = resume?.code || makeCode();
  const state = resume?.state || newState(myId);
  game = new Game(state);
  if (resume) { state.hostId = myId; for (const p of state.players) if (!p.bot && p.id !== myId) { p.connected = false; p.dcAt = Date.now(); } }
  else game.addPlayer({ id: myId, name: myName, avatar: myAvatar });
  UI.configure({ myId, isHost: true });
  connOverlay('Opening your room…');
  openHostNet(0);
  sync();
  loopTimer = setInterval(hostLoop, 250);
}

function openHostNet(tries) {
  hostNet?.destroy();
  hostNet = new HostNet(code, myId, {
    onReady() { connOverlay(null); },
    onStatus(st) {
      if (!st.live) return;
      netStatus = { level: st.live >= 2 ? '' : 'warn', text: `Room is live on ${st.live} connection route${st.live > 1 ? 's' : ''} (${st.names.join(', ')}). Share the code or invite link!` };
      if (latest?.phase === 'lobby') UI.renderLobby(latest, { code, netStatus });
    },
    onMessage: hostMessage,
    onLeave: hostLeave,
    onError(err, kind) {
      if (kind === 'taken') {
        if (game.s.phase === 'lobby' && tries < 5) { code = makeCode(); setTimeout(() => openHostNet(tries + 1), 300); return; }
        if (tries < 8) { connOverlay(`Reclaiming room ${code}… (${tries + 1})`); setTimeout(() => openHostNet(tries + 1), 4000); return; }
      }
      connOverlay(null);
      netStatus = { level: 'bad', text: 'Couldn’t reach any connection service (check your internet). You can still play here against bots.' };
      if (latest?.phase === 'lobby') UI.renderLobby(latest, { code, netStatus });
      UI.toast('Connection problem: ' + UI.esc(err.message || 'unknown'), 'err');
    },
  });
}

function hostMessage(connId, m) {
  const s = game.s;
  if (m.t === 'hello') {
    let pid = String(m.cid || '').slice(0, 40) || 'g' + Math.random().toString(36).slice(2, 9);
    const avatar = AVATARS.includes(m.avatar) ? m.avatar : null;
    const liveConn = [...conns.entries()].find(([c, p]) => p === pid && c !== connId && hostNet.has(c));
    if (pid === myId || liveConn) {
      if (s.phase !== 'lobby') return hostNet.send(connId, { t: 'denied', msg: 'You are already in this game in another tab.' });
      pid = pid + '-' + Math.random().toString(36).slice(2, 6);
    }
    const existing = game.P(pid);
    if (existing && !existing.bot && !existing.left) {
      existing.connected = true; existing.dcAt = null;
      conns.set(connId, pid);
      game.log(`[[${pid}]] reconnected`);
      hostNet.send(connId, { t: 'welcome', pid });
      return sync();
    }
    if (s.phase !== 'lobby') return hostNet.send(connId, { t: 'denied', msg: 'This game has already started. Ask the host to start a new one.' });
    try { game.addPlayer({ id: pid, name: String(m.name || 'Player').slice(0, 16), avatar }); }
    catch (e) { return hostNet.send(connId, { t: 'denied', msg: e.message }); }
    conns.set(connId, pid);
    hostNet.send(connId, { t: 'welcome', pid });
    return sync();
  }
  const pid = conns.get(connId);
  if (!pid) return;
  if (m.t === 'act' && m.a && typeof m.a === 'object') {
    const err = game.handle(pid, m.a);
    if (err) hostNet.send(connId, { t: 'err', msg: err }); else sync();
  } else if (m.t === 'bye') {
    conns.delete(connId); game.removePlayer(pid); sync();
  }
}
function hostLeave(connId) {
  const pid = conns.get(connId); conns.delete(connId);
  const p = pid && game.P(pid); if (!p) return;
  if (game.s.phase === 'lobby') game.removePlayer(pid);
  else if (!p.left) { p.connected = false; p.dcAt = Date.now(); game.log(`[[${pid}]] disconnected — a bot will cover if they don't return`); }
  sync();
}

let botNext = 0;
function hostLoop() {
  if (!game) return;
  const s = game.s, now = Date.now();
  if (s.phase !== 'playing') return;
  // turn timer ran out: auto draw / pass
  if (game.tick(now) && !busy) {
    const p = s.players[s.turn];
    const a = s.drawn != null ? { type: 'pass' } : { type: 'draw' };
    if (!game.handle(p.id, a)) { game.log(`[[${p.id}]] ran out of time`); return sync(); }
  }
  if (busy || now < botNext) return;
  for (const p of s.players) {
    const auto = p.bot || (!p.connected && p.dcAt && now - p.dcAt > 15000);
    if (!auto || !botNeeds(s, p.id)) continue;
    const a = botAction(s, p.id);
    if (!a) continue;
    if (game.handle(p.id, a)) continue;
    botNext = now + (a.type === 'catch' ? 400 : a.type === 'call' ? 350 : 700 + Math.random() * 500);
    return sync();
  }
}

const BOT_NAMES = ['Ada', 'Bolt', 'Chip', 'Dex', 'Echo', 'Fizz', 'Gizmo', 'Hex', 'Iris', 'Jinx', 'Koda', 'Lumen'];
function addBot() {
  const used = new Set(game.s.players.map(p => p.name));
  const name = (BOT_NAMES.find(n => !used.has(n + ' 🤖')) || 'Bot') + ' 🤖';
  try { game.addPlayer({ id: 'bot-' + Math.random().toString(36).slice(2, 8), name, bot: true }); sync(); }
  catch (e) { UI.toast(UI.esc(e.message), 'err'); }
}
function kick(pid) {
  const connId = [...conns.entries()].find(([, p]) => p === pid)?.[0];
  if (connId) { hostNet.kick(connId); conns.delete(connId); }
  game.removePlayer(pid); sync();
}
function newGameSameRoom() {
  const old = game.s, s = newState(myId);
  s.settings = { ...old.settings }; s.chat = old.chat;
  const g = new Game(s);
  for (const p of old.players) if (!p.left && (p.bot || p.connected || p.id === myId)) g.addPlayer({ id: p.id, name: p.name, avatar: p.avatar, bot: p.bot });
  game = g; UI.closeModal(); sync();
}

// ---------- GUEST ----------
let reconnectTries = 0, reconnectTimer = null, welcomed = false;
function startGuest(c) {
  stopAll();
  mode = 'guest'; code = c.toUpperCase(); myId = null; seenFirst = false; latest = null; welcomed = false;
  UI.configure({ myId: null, isHost: false });
  connOverlay(`Joining room ${code}…`);
  clientNet = new ClientNet(code, {
    onOpen() { reconnectTries = 0; clearTimeout(reconnectTimer); clientNet.send({ t: 'hello', cid, name: myName, avatar: myAvatar }); },
    onMessage(m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'welcome') {
        myId = m.pid; welcomed = true; UI.configure({ myId }); connOverlay(null);
        const u = new URLSearchParams(location.search); u.set('room', code); history.replaceState(null, '', '?' + u);
      } else if (m.t === 'state') { UI.configure({ offset: m.now - Date.now() }); if (myId) receive(m); }
      else if (m.t === 'rehello') clientNet.send({ t: 'hello', cid, name: myName, avatar: myAvatar });
      else if (m.t === 'err') { UI.toast(UI.esc(m.msg), 'err'); sfx.error(); }
      else if (m.t === 'denied') { UI.toast(UI.esc(m.msg), 'err'); goHome(); }
      else if (m.t === 'kicked') { UI.toast('You were removed from the room by the host', 'err'); goHome(); }
    },
    onClose() { if (mode === 'guest') scheduleReconnect(); },
    onError(err) {
      if (mode !== 'guest') return;
      if (!welcomed) { UI.toast(UI.esc(err.message || 'Could not join'), 'err'); goHome(); return; }
      scheduleReconnect();
    },
  });
}
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (reconnectTries++ > 20) { UI.toast('Lost connection to the host.', 'err'); return goHome(); }
  connOverlay('Connection lost. Reconnecting to the host…');
  reconnectTimer = setTimeout(() => clientNet?.reconnect(), 2500);
}

function stopAll() {
  clearInterval(loopTimer); loopTimer = null; clearTimeout(reconnectTimer);
  hostNet?.destroy(); hostNet = null; clientNet?.destroy(); clientNet = null;
  conns.clear(); game = null; queue.length = 0;
}
function goHome() {
  if (mode === 'guest') clientNet?.send({ t: 'bye' });
  stopAll(); mode = null; latest = null; myId = null;
  UI.closeModal(); UI.reset(); connOverlay(null);
  const u = new URLSearchParams(location.search); u.delete('room');
  history.replaceState(null, '', location.pathname + (u.toString() ? '?' + u : ''));
  show('home'); renderHome();
}
function leave() {
  const inGame = latest && latest.phase !== 'lobby' && latest.phase !== 'ended';
  const msg = mode === 'host' ? (inGame ? 'You are the host: leaving pauses the room for everyone. You can resume it later from this browser.' : 'This closes the room for everyone.') : (inGame ? 'You will leave this game. Your cards go back into the deck.' : 'Leave this room?');
  UI.confirmBox('Leave game?', msg, 'Leave', goHome);
}
const inviteLink = () => { const u = new URLSearchParams(location.search); u.set('room', code); return `${location.origin}${location.pathname}?${u}`; };
async function copy(text, label) { try { await navigator.clipboard.writeText(text); UI.toast(`${label} copied!`, 'good'); } catch { prompt('Copy this:', text); } }

function renderHome() {
  $('#name').value = myName;
  UI.tokenGrid($('#token-pick'), myAvatar, new Set(), t => { myAvatar = t; store.set('cb-avatar', t); renderHome(); });
  const saved = store.get('cb-host'), btn = $('#btn-resume');
  if (saved && saved.myId === cid && ['playing', 'roundover'].includes(saved.state?.phase) && Date.now() - saved.t < 36 * 3600e3) {
    btn.hidden = false; btn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Resume hosting room ${UI.esc(saved.code)} (round ${saved.state.round})`;
  } else btn.hidden = true;
}
function needName() {
  myName = $('#name').value.trim().slice(0, 16);
  if (!myName) { UI.toast('Enter your name first', 'err'); $('#name').focus(); return false; }
  store.set('cb-name', myName); return true;
}

function playCard(id) {
  const s = latest, m = s?.players.find(p => p.id === myId);
  const card = m?.hand?.find(c => c.id === id);
  if (!card || s.phase !== 'playing' || s.players[s.turn].id !== myId) return;
  if (!playable(s, card) || (s.drawn != null && s.drawn !== id)) { sfx.error(); return; }
  // remember to call BLITZ? we don't auto-call; that's the fun
  if (card.c === 'w') UI.pickColor(color => act({ type: 'play', card: id, color }));
  else act({ type: 'play', card: id });
}

function wire() {
  UI.initSky(); renderHome();
  const params = new URLSearchParams(location.search);
  if (params.get('room')) { $('#join-code').value = params.get('room').toUpperCase().slice(0, 5); setTimeout(() => (myName ? $('#btn-join') : $('#name')).focus(), 100); }
  $('#btn-create').onclick = () => { unlock(); if (needName()) startHost(null); };
  $('#btn-join').onclick = () => {
    unlock(); if (!needName()) return;
    const c = $('#join-code').value.trim().toUpperCase();
    if (c.length !== 5) { UI.toast('Room codes are 5 characters', 'err'); return; }
    startGuest(c);
  };
  $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });
  $('#name').addEventListener('keydown', e => { if (e.key === 'Enter') ($('#join-code').value ? $('#btn-join') : $('#btn-create')).click(); });
  $('#btn-resume').onclick = () => { unlock(); const saved = store.get('cb-host'); if (saved) startHost(saved); };
  $('#conn-cancel').onclick = goHome;
  $('#open-rules').onclick = e => { e.preventDefault(); UI.openRules(); };
  $('#lobby-leave').onclick = leave;
  $('#copy-code').onclick = () => copy(code, 'Room code');
  $('#copy-link').onclick = () => copy(inviteLink(), 'Invite link');
  $('#game-code').onclick = () => copy(inviteLink(), 'Invite link');
  $('#add-bot').onclick = () => mode === 'host' && addBot();
  $('#start-game').onclick = () => act({ type: 'start' });
  const settings = () => act({ type: 'settings', settings: { hand: +$('#set-hand').value, stacking: $('#set-stack').checked, target: +$('#set-target').value, timer: +$('#set-timer').value } });
  ['#set-hand', '#set-stack', '#set-target', '#set-timer'].forEach(q => $(q).addEventListener('change', settings));
  document.querySelectorAll('[data-chat]').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault(); const inp = f.querySelector('input'); if (inp.value.trim()) act({ type: 'chat', text: inp.value }); inp.value = '';
  }));
  document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + t.dataset.tab));
    if (t.dataset.tab === 'chat') { const b = $('#chat-badge'); b.hidden = true; b.textContent = ''; }
  });
  const muteBtn = $('#btn-mute');
  const syncMute = () => { muteBtn.innerHTML = `<i class="fa-solid ${isMuted() ? 'fa-volume-xmark' : 'fa-volume-high'}"></i>`; };
  syncMute(); muteBtn.onclick = () => { setMuted(!isMuted()); syncMute(); };
  $('#btn-rules').onclick = UI.openRules;
  $('#btn-menu').onclick = e => {
    const items = [{ icon: 'fa-link', label: 'Copy invite link', run: () => copy(inviteLink(), 'Invite link') }, { icon: 'fa-trophy', label: 'Scores', run: () => latest && UI.showResults(latest) }];
    if (mode === 'host' && latest && latest.phase !== 'ended') {
      for (const p of latest.players.filter(p => p.id !== myId && !p.left)) items.push({ icon: 'fa-user-xmark', label: `Remove ${UI.esc(p.name)}`, danger: true, run: () => UI.confirmBox(`Remove ${UI.esc(p.name)}?`, 'Their cards go back into the deck.', 'Remove', () => kick(p.id)) });
    }
    items.push({ icon: 'fa-right-from-bracket', label: 'Leave game', danger: true, run: leave });
    UI.showMenu(e.currentTarget, items);
  };
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a && !a.disabled) { try { act(JSON.parse(a.dataset.act)); } catch (err) { console.error(err); } return; }
    const u = e.target.closest('[data-ui]');
    if (u) {
      const [cmd, x] = u.dataset.ui.split(':');
      if (cmd === 'close') UI.closeModal();
      else if (cmd === 'results') latest && UI.showResults(latest);
      else if (cmd === 'home') goHome();
      else if (cmd === 'newGame') mode === 'host' && newGameSameRoom();
      else if (cmd === 'kick') mode === 'host' && kick(x);
      return;
    }
    const card = e.target.closest('#hand .card');
    if (card) return playCard(+card.dataset.id);
    if (e.target.closest('#deck')) {
      const s = latest;
      if (s?.phase === 'playing' && s.players[s.turn]?.id === myId && s.drawn == null) act({ type: 'draw' });
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') UI.closeModal(); });
  window.addEventListener('resize', () => { UI.layout(); latest && latest.phase !== 'lobby' && UI.render(latest); });
  window.addEventListener('beforeunload', e => { if (mode === 'host' && latest && latest.phase === 'playing') { e.preventDefault(); e.returnValue = ''; } });
}

wire();
window.__cb = { get state() { return latest; }, get game() { return game; }, act, addBot: () => addBot() };
