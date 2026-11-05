// Skyline Tycoon networking — free, no accounts, no servers of our own.
//
// The host's browser runs the game. To reach it, players use whichever of these works first:
//   1. Free public MQTT relays (EMQX, HiveMQ, Mosquitto) over secure WebSockets. These work on
//      mobile data, behind CGNAT and most firewalls, because everyone connects *out* to the relay.
//   2. Direct peer-to-peer WebRTC via the free PeerJS broker (fallback).
// The host listens on ALL of them at once, so if one service is down the others keep the game alive.

const APP = 'colorblitz/v1/';
const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const BROKERS = params.get('broker') ? [params.get('broker')] : DEFAULT_BROKERS;
const USE_P2P = params.get('nop2p') !== '1';

const PEER_PREFIX = 'color-blitz-v1-';
const PEER_OPTS = {
  debug: 0,
  config: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }] },
};

const hasMqtt = () => typeof window !== 'undefined' && window.mqtt && typeof window.mqtt.connect === 'function';
const hasPeer = () => typeof window !== 'undefined' && typeof window.Peer === 'function';
const rid = () => Math.random().toString(36).slice(2, 10);
const enc = o => JSON.stringify(o);
const dec = b => { try { return JSON.parse(typeof b === 'string' ? b : new TextDecoder().decode(b)); } catch { return null; } };
const brokerName = u => (u.match(/\/\/([^.:/]+(?:\.[^.:/]+)?)/) || [])[1] || u;

export function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('');
}

function mqttConnect(url, will) {
  return window.mqtt.connect(url, {
    clientId: 'st_' + rid(), clean: true, keepalive: 20, connectTimeout: 8000, reconnectPeriod: 2500,
    protocolVersion: 4, will,
  });
}

// =====================================================================
// HOST
// =====================================================================
export class HostNet {
  // h: onReady(code), onMessage(connId, msg), onLeave(connId), onError(err, kind), onStatus(text)
  constructor(code, hostCid, h) {
    this.code = code; this.hostCid = hostCid; this.h = h;
    this.base = APP + code;
    this.links = [];               // {kind, name, ready, failed, ...}
    this.conns = new Map();        // connId -> {link, conn, seen}
    this.readyFired = false; this.dead = false;
    if (hasMqtt()) BROKERS.forEach((u, i) => this.openMqtt(u, i));
    if (USE_P2P && hasPeer()) this.openPeer(0);
    if (!this.links.length) setTimeout(() => h.onError(new Error('Networking libraries failed to load'), false));
    this.sweep = setInterval(() => this.sweepConns(), 4000);
  }

  status() {
    const live = this.links.filter(l => l.ready);
    return { live: live.length, total: this.links.length, names: live.map(l => l.name) };
  }
  emitStatus() { this.h.onStatus?.(this.status()); }

  markReady(link) {
    link.ready = true; link.failed = false;
    this.emitStatus();
    if (!this.readyFired) { this.readyFired = true; this.h.onReady(this.code); }
  }
  markFailed(link, err) {
    link.ready = false; link.failed = true;
    this.emitStatus();
    if (this.links.every(l => l.failed) && !this.dead) this.h.onError(err || new Error('Could not reach any connection service'), false);
  }
  taken() {
    if (this.dead) return;
    this.dead = true;
    this.h.onError(new Error('Room code in use'), 'taken');
  }

  // ---- MQTT relay ----
  openMqtt(url, i) {
    const link = { kind: 'mqtt', name: brokerName(url), i, ready: false, failed: false };
    this.links.push(link);
    const base = this.base;
    const c = link.client = mqttConnect(url, { topic: base + '/host', payload: enc({ on: false }), retain: true, qos: 1 });
    let checkTimer = null;
    c.on('connect', () => {
      link.checked = false;
      c.subscribe([base + '/host', base + '/up'], { qos: 1 });
      clearTimeout(checkTimer);
      // wait for any retained "host online" message from someone else before claiming the code
      checkTimer = setTimeout(() => {
        if (this.dead) return;
        link.checked = true;
        c.publish(base + '/host', enc({ on: true, host: this.hostCid, t: Date.now() }), { retain: true, qos: 1 });
        this.markReady(link);
      }, 1500);
    });
    c.on('message', (topic, buf) => {
      const m = dec(buf); if (!m) return;
      if (topic === base + '/host') {
        if (m.on && m.host !== this.hostCid && !link.checked && !this.readyFired) this.taken();
        return;
      }
      if (topic !== base + '/up' || typeof m.conn !== 'string' || !m.m) return;
      const id = `m${i}:${m.conn}`;
      const t = m.m.t;
      if (t === 'gone') { if (this.conns.has(id)) { this.conns.delete(id); this.h.onLeave(id); } return; }
      const rec = this.conns.get(id);
      if (rec) rec.seen = Date.now();
      else if (t === 'hello') this.conns.set(id, { link, conn: m.conn, seen: Date.now() });
      else { c.publish(base + '/to/' + m.conn, enc({ t: 'rehello' }), { qos: 1 }); return; } // host restarted: ask them to rejoin
      if (t === 'ping') return;
      this.h.onMessage(id, m.m);
    });
    c.on('offline', () => { link.ready = false; this.emitStatus(); });
    c.on('error', err => { console.warn('mqtt', link.name, err?.message); });
    // give up on a broker that never connects within 12s (it keeps retrying in the background)
    setTimeout(() => { if (!link.ready && !link.checked) this.markFailed(link, new Error(`${link.name} unreachable`)); }, 12000);
    c.on('connect', () => { if (link.failed) link.failed = false; });
  }

  // ---- PeerJS direct ----
  openPeer(attempt) {
    let link = this.links.find(l => l.kind === 'p2p');
    if (!link) { link = { kind: 'p2p', name: 'direct', ready: false, failed: false }; this.links.push(link); }
    const peer = link.peer = new window.Peer(PEER_PREFIX + this.code, PEER_OPTS);
    peer.on('open', () => { link.everOpen = true; this.markReady(link); });
    peer.on('connection', conn => {
      const id = 'p:' + conn.peer;
      conn.on('open', () => this.conns.set(id, { link, conn, seen: Date.now(), p2p: true }));
      conn.on('data', d => { if (d && typeof d === 'object' && d.t !== 'ping') this.h.onMessage(id, d); });
      const gone = () => { const r = this.conns.get(id); if (r && r.conn === conn) { this.conns.delete(id); this.h.onLeave(id); } };
      conn.on('close', gone); conn.on('error', gone);
    });
    peer.on('disconnected', () => setTimeout(() => { if (!peer.destroyed) try { peer.reconnect(); } catch { } }, 2000));
    peer.on('error', err => {
      if (err.type === 'unavailable-id') { if (!this.readyFired) this.taken(); else this.markFailed(link, err); return; }
      if (!link.everOpen) {
        try { peer.destroy(); } catch { }
        if (attempt < 2 && !this.dead) setTimeout(() => this.openPeer(attempt + 1), 3000);
        else this.markFailed(link, err);
      }
    });
  }

  sweepConns() {
    const now = Date.now();
    for (const [id, r] of this.conns) {
      if (!r.p2p && now - r.seen > 16000) { this.conns.delete(id); this.h.onLeave(id); }
    }
  }

  has(connId) { return this.conns.has(connId); }
  send(connId, msg) {
    const r = this.conns.get(connId); if (!r) return;
    if (r.p2p) { if (r.conn.open) try { r.conn.send(msg); } catch { } }
    else r.link.client?.publish(this.base + '/to/' + r.conn, enc(msg), { qos: 1 });
  }
  broadcast(msg) {
    const payload = enc(msg);
    const usedMqtt = new Set();
    for (const r of this.conns.values()) {
      if (r.p2p) { if (r.conn.open) try { r.conn.send(msg); } catch { } }
      else usedMqtt.add(r.link);
    }
    for (const link of usedMqtt) link.client?.publish(this.base + '/state', payload, { qos: 1 });
  }
  kick(connId) {
    this.send(connId, { t: 'kicked' });
    const r = this.conns.get(connId);
    if (r?.p2p) setTimeout(() => { try { r.conn.close(); } catch { } }, 300);
    this.conns.delete(connId);
  }
  destroy() {
    this.dead = true;
    clearInterval(this.sweep);
    for (const l of this.links) {
      if (l.client) { try { l.client.publish(this.base + '/host', '', { retain: true, qos: 1 }); } catch { } setTimeout(() => { try { l.client.end(true); } catch { } }, 400); }
      if (l.peer) try { l.peer.destroy(); } catch { }
    }
  }
}

// =====================================================================
// CLIENT
// =====================================================================
export class ClientNet {
  // h: onOpen(), onMessage(msg), onClose(), onError(err)
  constructor(code, h) {
    this.code = code.toUpperCase(); this.h = h; this.alive = true;
    this.base = APP + this.code;
    this.conn = 'c' + rid();
    this.via = null;
    this.tryMqtt();
  }

  // Connect to every relay at once; use the first one that reports the host online.
  tryMqtt() {
    if (!hasMqtt()) return this.tryPeer();
    const base = this.base, me = this.conn;
    const cands = BROKERS.map(url => {
      const c = mqttConnect(url, { topic: base + '/up', payload: enc({ conn: me, m: { t: 'gone' } }), qos: 1, retain: false });
      const cand = { url, c };
      c.on('connect', () => c.subscribe(base + '/host', { qos: 1 }));
      c.on('message', (topic, buf) => {
        const m = dec(buf); if (!m) return;
        if (topic === base + '/host' && m.on && !this.via && this.alive) this.choose(cand, cands);
      });
      c.on('error', () => { });
      return cand;
    });
    this.pending = cands;
    this.pickTimer = setTimeout(() => {
      if (this.via || !this.alive) return;
      cands.forEach(x => { try { x.c.end(true); } catch { } });
      this.tryPeer();
    }, 9000);
  }

  choose(cand, all) {
    clearTimeout(this.pickTimer);
    all.forEach(x => { if (x !== cand) try { x.c.end(true); } catch { } });
    this.via = 'mqtt'; this.client = cand.c;
    const c = cand.c, base = this.base;
    let open = false;
    const onConnect = () => {
      c.subscribe([base + '/state', base + '/to/' + this.conn, base + '/host'], { qos: 1 }, () => {
        if (!open) { open = true; this.h.onOpen(); }
      });
    };
    c.on('connect', onConnect);
    c.on('message', (topic, buf) => {
      if (topic === base + '/host') {
        const m = dec(buf) || { on: false };
        if (m.on === false && open) { open = false; this.h.onClose(); }
        else if (m.on && !open && c.connected) { open = true; this.h.onOpen(); }
        return;
      }
      const m = dec(buf);
      if (m) this.h.onMessage(m);
    });
    c.on('offline', () => { if (open) { open = false; this.h.onClose(); } });
    onConnect();
    this.ping = setInterval(() => this.send({ t: 'ping' }), 5000);
  }

  tryPeer() {
    if (!USE_P2P || !hasPeer()) return this.h.onError(new Error(`Room ${this.code} not found. Check the code, and make sure the host still has the game open.`));
    this.via = 'p2p';
    this.peer = new window.Peer(PEER_OPTS);
    this.peer.on('open', () => this.connectPeer());
    this.peer.on('error', err => {
      if (err.type === 'peer-unavailable') return this.h.onError(new Error(`Room ${this.code} not found. Check the code, and make sure the host still has the game open.`));
      this.h.onError(err);
    });
    this.peer.on('disconnected', () => setTimeout(() => { if (this.alive && !this.peer.destroyed) try { this.peer.reconnect(); } catch { } }, 1500));
  }
  connectPeer() {
    const conn = this.pconn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'json' });
    const timer = setTimeout(() => { if (!conn.open) this.h.onError(new Error('Could not reach the host.')); }, 15000);
    conn.on('open', () => { clearTimeout(timer); this.h.onOpen(); });
    conn.on('data', d => this.h.onMessage(d));
    conn.on('close', () => { if (this.alive) this.h.onClose(); });
  }

  get transport() { return this.via === 'mqtt' ? 'relay' : this.via === 'p2p' ? 'direct' : '…'; }
  reconnect() {
    if (this.via === 'mqtt') return; // mqtt.js reconnects by itself
    if (!this.peer || this.peer.destroyed) return;
    if (this.peer.disconnected) { try { this.peer.reconnect(); } catch { } setTimeout(() => this.connectPeer(), 1500); }
    else this.connectPeer();
  }
  send(msg) {
    if (this.via === 'mqtt') { if (this.client?.connected) this.client.publish(this.base + '/up', enc({ conn: this.conn, m: msg }), { qos: 1 }); }
    else if (this.pconn?.open) try { this.pconn.send(msg); } catch { }
  }
  destroy() {
    this.alive = false;
    clearTimeout(this.pickTimer); clearInterval(this.ping);
    if (this.via === 'mqtt' && this.client?.connected) { this.send({ t: 'gone' }); }
    setTimeout(() => {
      (this.pending || []).forEach(x => { try { x.c.end(true); } catch { } });
      try { this.peer?.destroy(); } catch { }
    }, 300);
  }
}
