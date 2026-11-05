(() => {
  // js/engine.js
  var RuleError = class extends Error {
  };
  var fail = (m) => {
    throw new RuleError(m);
  };
  var shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  var COLORS = ["r", "y", "g", "b"];
  var COLOR_NAMES = { r: "Red", y: "Yellow", g: "Green", b: "Blue" };
  var AVATARS = ["fa-rocket", "fa-crown", "fa-gem", "fa-cat", "fa-dragon", "fa-ghost", "fa-robot", "fa-user-astronaut", "fa-dog", "fa-frog", "fa-hippo", "fa-kiwi-bird"];
  var SEAT_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#94a3b8"];
  var MAX_PLAYERS = 10;
  function buildDeck(n = 1) {
    const d = [];
    let id = 0;
    for (let k = 0; k < n; k++) {
      for (const c of COLORS) {
        d.push({ id: id++, c, v: "0" });
        for (const v of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "rev", "d2"]) {
          d.push({ id: id++, c, v });
          d.push({ id: id++, c, v });
        }
      }
      for (let i = 0; i < 4; i++) {
        d.push({ id: id++, c: "w", v: "wild" });
        d.push({ id: id++, c: "w", v: "w4" });
      }
    }
    return d;
  }
  var points = (card) => card.c === "w" ? 50 : ["skip", "rev", "d2"].includes(card.v) ? 20 : +card.v;
  var top = (s) => s.discard[s.discard.length - 1];
  function playable(s, card) {
    const t = top(s);
    if (s.pendingDraw > 0) {
      if (!s.settings.stacking) return false;
      if (t.v === "d2") return card.v === "d2" || card.v === "w4";
      if (t.v === "w4") return card.v === "w4";
      return false;
    }
    if (card.c === "w") return true;
    return card.c === s.color || card.v === t.v;
  }
  function newState(hostId) {
    return {
      phase: "lobby",
      hostId,
      players: [],
      deck: [],
      discard: [],
      color: "r",
      turn: 0,
      dir: 1,
      pendingDraw: 0,
      drawn: null,
      vulnerable: null,
      round: 0,
      starter: -1,
      roundWinner: null,
      champion: null,
      lastPoints: 0,
      log: [],
      chat: [],
      seq: 0,
      turnEnds: 0,
      settings: { hand: 7, stacking: true, target: 300, timer: 30 }
    };
  }
  var Game = class {
    constructor(state) {
      this.s = state;
      this.ev = [];
    }
    emit(e) {
      this.ev.push(e);
    }
    takeEvents() {
      const e = this.ev;
      this.ev = [];
      return e;
    }
    log(text) {
      const s = this.s;
      s.log.push({ id: ++s.seq, text });
      if (s.log.length > 100) s.log.shift();
    }
    P(id) {
      return this.s.players.find((p) => p.id === id);
    }
    cur() {
      return this.s.players[this.s.turn];
    }
    nm(p) {
      return `[[${p.id}]]`;
    }
    active() {
      return this.s.players.filter((p) => !p.left);
    }
    // ---------- lobby ----------
    addPlayer({ id, name, avatar: avatar2, bot = false }) {
      const s = this.s;
      if (s.phase !== "lobby") fail("Game already started");
      if (s.players.length >= MAX_PLAYERS) fail("Room is full (10 players max)");
      if (this.P(id)) return this.P(id);
      const usedA = new Set(s.players.map((p2) => p2.avatar)), usedC = new Set(s.players.map((p2) => p2.color));
      if (!avatar2 || usedA.has(avatar2)) avatar2 = AVATARS.find((a) => !usedA.has(a));
      name = String(name || "Player").trim().slice(0, 16) || "Player";
      const base = name;
      let n = 2;
      while (s.players.some((p2) => p2.name.toLowerCase() === name.toLowerCase())) name = `${base} ${n++}`;
      const p = { id, name, avatar: avatar2, color: SEAT_COLORS.find((c) => !usedC.has(c)), hand: [], score: 0, called: false, bot, connected: true, left: false };
      s.players.push(p);
      this.log(`${this.nm(p)} joined`);
      return p;
    }
    removePlayer(id) {
      const s = this.s, p = this.P(id);
      if (!p) return;
      if (s.phase === "lobby") {
        s.players = s.players.filter((x) => x.id !== id);
        return;
      }
      if (p.left) return;
      const wasTurn = s.phase === "playing" && this.cur().id === id;
      p.left = true;
      s.deck.push(...p.hand);
      shuffle(s.deck);
      p.hand = [];
      if (s.vulnerable === id) s.vulnerable = null;
      this.log(`${this.nm(p)} left the game`);
      if (this.active().length < 2) return this.finishGame(this.active()[0]);
      if (wasTurn) {
        s.pendingDraw = 0;
        s.drawn = null;
        this.advance(1);
      }
    }
    start() {
      const s = this.s;
      if (s.players.length < 2) fail("Need at least 2 players");
      shuffle(s.players);
      for (const p of s.players) p.score = 0;
      this.newRound();
    }
    newRound() {
      const s = this.s;
      const ps = this.active();
      const decks = ps.length * s.settings.hand > 60 ? 2 : 1;
      s.deck = shuffle(buildDeck(decks));
      s.discard = [];
      s.decks = decks;
      s.round++;
      s.phase = "playing";
      s.dir = 1;
      s.pendingDraw = 0;
      s.drawn = null;
      s.vulnerable = null;
      s.roundWinner = null;
      for (const p of s.players) {
        p.hand = [];
        p.called = false;
      }
      for (let k = 0; k < s.settings.hand; k++) for (const p of ps) p.hand.push(s.deck.pop());
      let first;
      while (true) {
        first = s.deck.pop();
        if (first.v !== "w4") break;
        s.deck.unshift(first);
      }
      s.discard.push(first);
      s.color = first.c === "w" ? COLORS[Math.floor(Math.random() * 4)] : first.c;
      s.starter = this.nextIndex(s.starter < 0 ? -1 : s.starter, 1, true);
      s.turn = s.starter;
      this.log(`Round ${s.round} begins \u2014 ${decks > 1 ? "2 decks, " : ""}${s.settings.hand} cards each`);
      this.emit({ type: "deal", n: s.settings.hand });
      this.emit({ type: "flip", card: first, color: s.color });
      if (first.v === "skip") {
        this.log(`First card is a Skip \u2014 ${this.nm(this.cur())} is skipped`);
        this.emit({ type: "skip", pid: this.cur().id });
        s.turn = this.nextIndex(s.turn, 1);
      } else if (first.v === "rev") {
        s.dir = -1;
        this.emit({ type: "reverse", dir: -1 });
        this.log("First card is a Reverse \u2014 play goes the other way");
      } else if (first.v === "d2") {
        const p = this.cur();
        this.give(p, 2);
        this.log(`${this.nm(p)} draws 2 from the first card`);
        s.turn = this.nextIndex(s.turn, 1);
      }
      this.beginTurn();
    }
    // index of the next active player moving `steps` in direction
    nextIndex(from, steps = 1, ignoreDir = false, dir = null) {
      const s = this.s, n = s.players.length, d = dir ?? (ignoreDir ? 1 : s.dir);
      let i = from;
      for (let k = 0; k < steps; k++) {
        let guard = 0;
        do {
          i = ((i + d) % n + n) % n;
        } while (s.players[i].left && ++guard < n);
      }
      return i;
    }
    refill() {
      const s = this.s;
      if (s.deck.length) return true;
      if (s.discard.length <= 1) return false;
      const t = s.discard.pop();
      s.deck = shuffle(s.discard);
      s.discard = [t];
      this.emit({ type: "shuffle" });
      this.log("The discard pile was reshuffled into the deck");
      return true;
    }
    give(p, n) {
      let got = 0;
      for (let k = 0; k < n; k++) {
        if (!this.refill()) break;
        p.hand.push(this.s.deck.pop());
        got++;
      }
      if (p.hand.length > 1) {
        p.called = false;
        if (this.s.vulnerable === p.id) this.s.vulnerable = null;
      }
      if (got) this.emit({ type: "draw", pid: p.id, n: got });
      return got;
    }
    beginTurn() {
      const s = this.s;
      s.drawn = null;
      s.turnEnds = s.settings.timer ? Date.now() + s.settings.timer * 1e3 : 0;
      this.emit({ type: "turn", pid: this.cur().id });
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
      try {
        this._handle(pid, a);
        return null;
      } catch (e) {
        if (e instanceof RuleError) return e.message;
        throw e;
      }
    }
    _handle(pid, a) {
      const s = this.s, p = this.P(pid);
      if (!p) fail("Unknown player");
      if (a.type === "chat") return this.chat(p, a.text);
      if (s.phase === "lobby") {
        if (a.type === "setAvatar") {
          if (!AVATARS.includes(a.avatar) || s.players.some((x) => x.avatar === a.avatar && x.id !== pid)) fail("Avatar taken");
          p.avatar = a.avatar;
          return;
        }
        if (pid !== s.hostId) fail("Only the host can do that");
        if (a.type === "settings") {
          const v = a.settings || {};
          if ([5, 7, 10].includes(v.hand)) s.settings.hand = v.hand;
          if (typeof v.stacking === "boolean") s.settings.stacking = v.stacking;
          if ([0, 100, 300, 500].includes(v.target)) s.settings.target = v.target;
          if ([0, 15, 30, 60].includes(v.timer)) s.settings.timer = v.timer;
          return;
        }
        if (a.type === "start") return this.start();
        fail("Game not started");
      }
      if (a.type === "nextRound") {
        if (pid !== s.hostId) fail("Only the host can start the next round");
        if (s.phase !== "roundover") fail("Round still running");
        return this.newRound();
      }
      if (s.phase !== "playing") fail("Round is over");
      if (p.left) fail("You left this game");
      switch (a.type) {
        case "play":
          return this.play(p, a.card, a.color);
        case "draw":
          return this.draw(p);
        case "pass":
          return this.pass(p);
        case "call":
          return this.call(p);
        case "catch":
          return this.catch(p, a.target);
        default:
          fail("Unknown action");
      }
    }
    chat(p, text) {
      text = String(text || "").trim().slice(0, 200);
      if (!text) return;
      this.s.chat.push({ id: ++this.s.seq, pid: p.id, text });
      if (this.s.chat.length > 60) this.s.chat.shift();
      this.emit({ type: "chat", pid: p.id });
    }
    play(p, cardId, color) {
      const s = this.s;
      if (this.cur().id !== p.id) fail("Not your turn");
      const idx = p.hand.findIndex((c) => c.id === cardId);
      if (idx < 0) fail("You don't have that card");
      const card = p.hand[idx];
      if (s.drawn != null && s.drawn !== cardId) fail("You can only play the card you just drew (or pass)");
      if (!playable(s, card)) fail(s.pendingDraw ? `Stack a draw card or take ${s.pendingDraw} cards` : "That card doesn't match");
      if (card.c === "w" && !COLORS.includes(color)) fail("Pick a color");
      this.clearVulnerable(p.id);
      p.hand.splice(idx, 1);
      s.discard.push(card);
      if (s.discard.length > 60) s.deck.unshift(...s.discard.splice(0, s.discard.length - 30));
      s.color = card.c === "w" ? color : card.c;
      s.drawn = null;
      this.emit({ type: "play", pid: p.id, card, color: s.color });
      const label = cardLabel(card) + (card.c === "w" ? ` \u2192 ${COLOR_NAMES[s.color]}` : "");
      this.log(`${this.nm(p)} played ${label}`);
      if (p.hand.length === 1) {
        if (!p.called) {
          s.vulnerable = p.id;
        }
      } else if (p.hand.length > 1) p.called = false;
      const n = this.active().length;
      if (p.hand.length === 0) {
        if (card.v === "d2" || card.v === "w4") {
          const victim = s.players[this.nextIndex(s.turn, 1)];
          const total = s.pendingDraw + (card.v === "d2" ? 2 : 4);
          this.give(victim, total);
          s.pendingDraw = 0;
        }
        return this.winRound(p);
      }
      switch (card.v) {
        case "skip": {
          const victim = s.players[this.nextIndex(s.turn, 1)];
          this.emit({ type: "skip", pid: victim.id });
          return this.advance(2);
        }
        case "rev":
          s.dir *= -1;
          this.emit({ type: "reverse", dir: s.dir });
          return this.advance(n === 2 ? 2 : 1);
        case "d2":
        case "w4": {
          const add = card.v === "d2" ? 2 : 4;
          if (s.settings.stacking) {
            s.pendingDraw += add;
            return this.advance(1);
          }
          const victim = s.players[this.nextIndex(s.turn, 1)];
          this.give(victim, add);
          this.log(`${this.nm(victim)} draws ${add} and is skipped`);
          this.emit({ type: "skip", pid: victim.id });
          return this.advance(2);
        }
        default:
          return this.advance(1);
      }
    }
    draw(p) {
      const s = this.s;
      if (this.cur().id !== p.id) fail("Not your turn");
      if (s.drawn != null) fail("You already drew \u2014 play it or pass");
      this.clearVulnerable(p.id);
      if (s.pendingDraw > 0) {
        const n = s.pendingDraw;
        s.pendingDraw = 0;
        this.give(p, n);
        this.log(`${this.nm(p)} takes ${n} cards`);
        return this.advance(1);
      }
      if (!this.give(p, 1)) {
        this.log("No cards left to draw");
        return this.advance(1);
      }
      const card = p.hand[p.hand.length - 1];
      if (playable(s, card)) {
        s.drawn = card.id;
        s.turnEnds = s.settings.timer ? Date.now() + Math.min(15, s.settings.timer) * 1e3 : 0;
        this.log(`${this.nm(p)} drew a card`);
        return;
      }
      this.log(`${this.nm(p)} drew a card and passes`);
      this.advance(1);
    }
    pass(p) {
      const s = this.s;
      if (this.cur().id !== p.id) fail("Not your turn");
      if (s.drawn == null) fail("Draw a card first");
      s.drawn = null;
      this.advance(1);
    }
    call(p) {
      const s = this.s;
      if (p.hand.length > 2) fail("You can only call BLITZ! with 2 cards or fewer");
      if (p.called) return;
      if (p.hand.length === 2 && this.cur().id !== p.id) fail("Call it on your turn, as you play your second-last card");
      p.called = true;
      if (s.vulnerable === p.id) s.vulnerable = null;
      this.emit({ type: "call", pid: p.id });
      this.log(`${this.nm(p)} shouts BLITZ!`);
    }
    catch(p, targetId) {
      const s = this.s;
      const t = this.P(targetId);
      if (!t || s.vulnerable !== targetId || t.id === p.id) fail("Too late!");
      s.vulnerable = null;
      this.give(t, 2);
      this.emit({ type: "catch", by: p.id, target: t.id });
      this.log(`${this.nm(p)} caught ${this.nm(t)} not calling BLITZ! (+2 cards)`);
    }
    winRound(p) {
      const s = this.s;
      let pts = 0;
      for (const o of s.players) if (o !== p) pts += o.hand.reduce((a, c) => a + points(c), 0);
      p.score += pts;
      s.roundWinner = p.id;
      s.lastPoints = pts;
      s.vulnerable = null;
      s.turnEnds = 0;
      this.log(`\u{1F3C6} ${this.nm(p)} wins round ${s.round} (+${pts} points)`);
      this.emit({ type: "roundWin", pid: p.id, pts });
      if (!s.settings.target || p.score >= s.settings.target) return this.finishGame(p);
      s.phase = "roundover";
    }
    finishGame(p) {
      const s = this.s;
      s.phase = "ended";
      s.champion = p?.id ?? null;
      s.turnEnds = 0;
      if (p) this.log(`\u{1F389} ${this.nm(p)} wins the game!`);
      this.emit({ type: "win", pid: p?.id });
    }
    // host timer: returns true if something happened
    tick(now = Date.now()) {
      const s = this.s;
      return s.phase === "playing" && s.turnEnds && now > s.turnEnds;
    }
  };
  function cardLabel(c) {
    const v = { skip: "Skip", rev: "Reverse", d2: "+2", wild: "Wild", w4: "Wild +4" }[c.v] || c.v;
    return c.c === "w" ? v : `${COLOR_NAMES[c.c]} ${v}`;
  }
  function viewFor(s, pid) {
    const v = { ...s, deck: void 0, deckCount: s.deck.length, discard: s.discard.slice(-8) };
    v.players = s.players.map((p) => ({ ...p, hand: p.id === pid ? p.hand : void 0, count: p.hand.length }));
    v.log = s.log.slice(-40);
    v.chat = s.chat.slice(-40);
    return v;
  }

  // js/bot.js
  function bestColor(hand) {
    const n = { r: 0, y: 0, g: 0, b: 0 };
    for (const c of hand) if (c.c !== "w") n[c.c]++;
    return COLORS.reduce((a, b) => n[b] > n[a] ? b : a, COLORS[Math.floor(Math.random() * 4)]);
  }
  function botAction(s, pid) {
    const p = s.players.find((x) => x.id === pid);
    if (!p || p.left || s.phase !== "playing") return null;
    const myTurn = s.players[s.turn].id === pid;
    if (s.vulnerable && s.vulnerable !== pid && Math.random() < 0.45) return { type: "catch", target: s.vulnerable };
    if (s.vulnerable === pid && Math.random() < 0.6) return { type: "call" };
    if (!myTurn) return null;
    let options = p.hand.filter((c) => playable(s, c));
    if (s.drawn != null) options = options.filter((c) => c.id === s.drawn);
    if (!options.length) return { type: s.drawn != null ? "pass" : "draw" };
    if (p.hand.length === 2 && !p.called && Math.random() < 0.88) return { type: "call" };
    const next = s.players.filter((x) => !x.left);
    const nextIdx = (() => {
      const n = s.players.length;
      let i = s.turn;
      do {
        i = ((i + s.dir) % n + n) % n;
      } while (s.players[i].left);
      return i;
    })();
    const nextCount = s.players[nextIdx].hand.length;
    const score = (c) => {
      let v = 0;
      if (c.c === "w") v -= 30;
      if (["skip", "rev", "d2"].includes(c.v)) v += nextCount <= 3 ? 40 : 5;
      if (c.v === "w4") v += nextCount <= 2 ? 60 : -10;
      if (c.c !== "w") v += p.hand.filter((h) => h.c === c.c).length * 3;
      if (/^\d$/.test(c.v)) v += +c.v;
      return v + Math.random() * 4;
    };
    options.sort((a, b) => score(b) - score(a));
    const card = options[0];
    return { type: "play", card: card.id, color: card.c === "w" ? bestColor(p.hand.filter((h) => h.id !== card.id)) : void 0 };
  }
  function botNeeds(s, pid) {
    const p = s.players.find((x) => x.id === pid);
    if (!p || p.left || s.phase !== "playing") return false;
    return s.players[s.turn].id === pid || s.vulnerable && s.vulnerable !== pid || s.vulnerable === pid;
  }

  // js/net.js
  var APP = "colorblitz/v1/";
  var DEFAULT_BROKERS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://test.mosquitto.org:8081/mqtt"
  ];
  var params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  var BROKERS = params.get("broker") ? [params.get("broker")] : DEFAULT_BROKERS;
  var USE_P2P = params.get("nop2p") !== "1";
  var PEER_PREFIX = "color-blitz-v1-";
  var PEER_OPTS = {
    debug: 0,
    config: { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, { urls: "stun:stun.cloudflare.com:3478" }] }
  };
  var hasMqtt = () => typeof window !== "undefined" && window.mqtt && typeof window.mqtt.connect === "function";
  var hasPeer = () => typeof window !== "undefined" && typeof window.Peer === "function";
  var rid = () => Math.random().toString(36).slice(2, 10);
  var enc = (o) => JSON.stringify(o);
  var dec = (b) => {
    try {
      return JSON.parse(typeof b === "string" ? b : new TextDecoder().decode(b));
    } catch {
      return null;
    }
  };
  var brokerName = (u) => (u.match(/\/\/([^.:/]+(?:\.[^.:/]+)?)/) || [])[1] || u;
  function makeCode() {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join("");
  }
  function mqttConnect(url, will) {
    return window.mqtt.connect(url, {
      clientId: "st_" + rid(),
      clean: true,
      keepalive: 20,
      connectTimeout: 8e3,
      reconnectPeriod: 2500,
      protocolVersion: 4,
      will
    });
  }
  var HostNet = class {
    // h: onReady(code), onMessage(connId, msg), onLeave(connId), onError(err, kind), onStatus(text)
    constructor(code2, hostCid, h) {
      this.code = code2;
      this.hostCid = hostCid;
      this.h = h;
      this.base = APP + code2;
      this.links = [];
      this.conns = /* @__PURE__ */ new Map();
      this.readyFired = false;
      this.dead = false;
      if (hasMqtt()) BROKERS.forEach((u, i) => this.openMqtt(u, i));
      if (USE_P2P && hasPeer()) this.openPeer(0);
      if (!this.links.length) setTimeout(() => h.onError(new Error("Networking libraries failed to load"), false));
      this.sweep = setInterval(() => this.sweepConns(), 4e3);
    }
    status() {
      const live = this.links.filter((l) => l.ready);
      return { live: live.length, total: this.links.length, names: live.map((l) => l.name) };
    }
    emitStatus() {
      this.h.onStatus?.(this.status());
    }
    markReady(link) {
      link.ready = true;
      link.failed = false;
      this.emitStatus();
      if (!this.readyFired) {
        this.readyFired = true;
        this.h.onReady(this.code);
      }
    }
    markFailed(link, err) {
      link.ready = false;
      link.failed = true;
      this.emitStatus();
      if (this.links.every((l) => l.failed) && !this.dead) this.h.onError(err || new Error("Could not reach any connection service"), false);
    }
    taken() {
      if (this.dead) return;
      this.dead = true;
      this.h.onError(new Error("Room code in use"), "taken");
    }
    // ---- MQTT relay ----
    openMqtt(url, i) {
      const link = { kind: "mqtt", name: brokerName(url), i, ready: false, failed: false };
      this.links.push(link);
      const base = this.base;
      const c = link.client = mqttConnect(url, { topic: base + "/host", payload: enc({ on: false }), retain: true, qos: 1 });
      let checkTimer = null;
      c.on("connect", () => {
        link.checked = false;
        c.subscribe([base + "/host", base + "/up"], { qos: 1 });
        clearTimeout(checkTimer);
        checkTimer = setTimeout(() => {
          if (this.dead) return;
          link.checked = true;
          c.publish(base + "/host", enc({ on: true, host: this.hostCid, t: Date.now() }), { retain: true, qos: 1 });
          this.markReady(link);
        }, 1500);
      });
      c.on("message", (topic, buf) => {
        const m = dec(buf);
        if (!m) return;
        if (topic === base + "/host") {
          if (m.on && m.host !== this.hostCid && !link.checked && !this.readyFired) this.taken();
          return;
        }
        if (topic !== base + "/up" || typeof m.conn !== "string" || !m.m) return;
        const id = `m${i}:${m.conn}`;
        const t = m.m.t;
        if (t === "gone") {
          if (this.conns.has(id)) {
            this.conns.delete(id);
            this.h.onLeave(id);
          }
          return;
        }
        const rec = this.conns.get(id);
        if (rec) rec.seen = Date.now();
        else if (t === "hello") this.conns.set(id, { link, conn: m.conn, seen: Date.now() });
        else {
          c.publish(base + "/to/" + m.conn, enc({ t: "rehello" }), { qos: 1 });
          return;
        }
        if (t === "ping") return;
        this.h.onMessage(id, m.m);
      });
      c.on("offline", () => {
        link.ready = false;
        this.emitStatus();
      });
      c.on("error", (err) => {
        console.warn("mqtt", link.name, err?.message);
      });
      setTimeout(() => {
        if (!link.ready && !link.checked) this.markFailed(link, new Error(`${link.name} unreachable`));
      }, 12e3);
      c.on("connect", () => {
        if (link.failed) link.failed = false;
      });
    }
    // ---- PeerJS direct ----
    openPeer(attempt) {
      let link = this.links.find((l) => l.kind === "p2p");
      if (!link) {
        link = { kind: "p2p", name: "direct", ready: false, failed: false };
        this.links.push(link);
      }
      const peer = link.peer = new window.Peer(PEER_PREFIX + this.code, PEER_OPTS);
      peer.on("open", () => {
        link.everOpen = true;
        this.markReady(link);
      });
      peer.on("connection", (conn) => {
        const id = "p:" + conn.peer;
        conn.on("open", () => this.conns.set(id, { link, conn, seen: Date.now(), p2p: true }));
        conn.on("data", (d) => {
          if (d && typeof d === "object" && d.t !== "ping") this.h.onMessage(id, d);
        });
        const gone = () => {
          const r = this.conns.get(id);
          if (r && r.conn === conn) {
            this.conns.delete(id);
            this.h.onLeave(id);
          }
        };
        conn.on("close", gone);
        conn.on("error", gone);
      });
      peer.on("disconnected", () => setTimeout(() => {
        if (!peer.destroyed) try {
          peer.reconnect();
        } catch {
        }
      }, 2e3));
      peer.on("error", (err) => {
        if (err.type === "unavailable-id") {
          if (!this.readyFired) this.taken();
          else this.markFailed(link, err);
          return;
        }
        if (!link.everOpen) {
          try {
            peer.destroy();
          } catch {
          }
          if (attempt < 2 && !this.dead) setTimeout(() => this.openPeer(attempt + 1), 3e3);
          else this.markFailed(link, err);
        }
      });
    }
    sweepConns() {
      const now = Date.now();
      for (const [id, r] of this.conns) {
        if (!r.p2p && now - r.seen > 16e3) {
          this.conns.delete(id);
          this.h.onLeave(id);
        }
      }
    }
    has(connId) {
      return this.conns.has(connId);
    }
    send(connId, msg) {
      const r = this.conns.get(connId);
      if (!r) return;
      if (r.p2p) {
        if (r.conn.open) try {
          r.conn.send(msg);
        } catch {
        }
      } else r.link.client?.publish(this.base + "/to/" + r.conn, enc(msg), { qos: 1 });
    }
    broadcast(msg) {
      const payload = enc(msg);
      const usedMqtt = /* @__PURE__ */ new Set();
      for (const r of this.conns.values()) {
        if (r.p2p) {
          if (r.conn.open) try {
            r.conn.send(msg);
          } catch {
          }
        } else usedMqtt.add(r.link);
      }
      for (const link of usedMqtt) link.client?.publish(this.base + "/state", payload, { qos: 1 });
    }
    kick(connId) {
      this.send(connId, { t: "kicked" });
      const r = this.conns.get(connId);
      if (r?.p2p) setTimeout(() => {
        try {
          r.conn.close();
        } catch {
        }
      }, 300);
      this.conns.delete(connId);
    }
    destroy() {
      this.dead = true;
      clearInterval(this.sweep);
      for (const l of this.links) {
        if (l.client) {
          try {
            l.client.publish(this.base + "/host", "", { retain: true, qos: 1 });
          } catch {
          }
          setTimeout(() => {
            try {
              l.client.end(true);
            } catch {
            }
          }, 400);
        }
        if (l.peer) try {
          l.peer.destroy();
        } catch {
        }
      }
    }
  };
  var ClientNet = class {
    // h: onOpen(), onMessage(msg), onClose(), onError(err)
    constructor(code2, h) {
      this.code = code2.toUpperCase();
      this.h = h;
      this.alive = true;
      this.base = APP + this.code;
      this.conn = "c" + rid();
      this.via = null;
      this.tryMqtt();
    }
    // Connect to every relay at once; use the first one that reports the host online.
    tryMqtt() {
      if (!hasMqtt()) return this.tryPeer();
      const base = this.base, me2 = this.conn;
      const cands = BROKERS.map((url) => {
        const c = mqttConnect(url, { topic: base + "/up", payload: enc({ conn: me2, m: { t: "gone" } }), qos: 1, retain: false });
        const cand = { url, c };
        c.on("connect", () => c.subscribe(base + "/host", { qos: 1 }));
        c.on("message", (topic, buf) => {
          const m = dec(buf);
          if (!m) return;
          if (topic === base + "/host" && m.on && !this.via && this.alive) this.choose(cand, cands);
        });
        c.on("error", () => {
        });
        return cand;
      });
      this.pending = cands;
      this.pickTimer = setTimeout(() => {
        if (this.via || !this.alive) return;
        cands.forEach((x) => {
          try {
            x.c.end(true);
          } catch {
          }
        });
        this.tryPeer();
      }, 9e3);
    }
    choose(cand, all) {
      clearTimeout(this.pickTimer);
      all.forEach((x) => {
        if (x !== cand) try {
          x.c.end(true);
        } catch {
        }
      });
      this.via = "mqtt";
      this.client = cand.c;
      const c = cand.c, base = this.base;
      let open = false;
      const onConnect = () => {
        c.subscribe([base + "/state", base + "/to/" + this.conn, base + "/host"], { qos: 1 }, () => {
          if (!open) {
            open = true;
            this.h.onOpen();
          }
        });
      };
      c.on("connect", onConnect);
      c.on("message", (topic, buf) => {
        if (topic === base + "/host") {
          const m2 = dec(buf) || { on: false };
          if (m2.on === false && open) {
            open = false;
            this.h.onClose();
          } else if (m2.on && !open && c.connected) {
            open = true;
            this.h.onOpen();
          }
          return;
        }
        const m = dec(buf);
        if (m) this.h.onMessage(m);
      });
      c.on("offline", () => {
        if (open) {
          open = false;
          this.h.onClose();
        }
      });
      onConnect();
      this.ping = setInterval(() => this.send({ t: "ping" }), 5e3);
    }
    tryPeer() {
      if (!USE_P2P || !hasPeer()) return this.h.onError(new Error(`Room ${this.code} not found. Check the code, and make sure the host still has the game open.`));
      this.via = "p2p";
      this.peer = new window.Peer(PEER_OPTS);
      this.peer.on("open", () => this.connectPeer());
      this.peer.on("error", (err) => {
        if (err.type === "peer-unavailable") return this.h.onError(new Error(`Room ${this.code} not found. Check the code, and make sure the host still has the game open.`));
        this.h.onError(err);
      });
      this.peer.on("disconnected", () => setTimeout(() => {
        if (this.alive && !this.peer.destroyed) try {
          this.peer.reconnect();
        } catch {
        }
      }, 1500));
    }
    connectPeer() {
      const conn = this.pconn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: "json" });
      const timer = setTimeout(() => {
        if (!conn.open) this.h.onError(new Error("Could not reach the host."));
      }, 15e3);
      conn.on("open", () => {
        clearTimeout(timer);
        this.h.onOpen();
      });
      conn.on("data", (d) => this.h.onMessage(d));
      conn.on("close", () => {
        if (this.alive) this.h.onClose();
      });
    }
    get transport() {
      return this.via === "mqtt" ? "relay" : this.via === "p2p" ? "direct" : "\u2026";
    }
    reconnect() {
      if (this.via === "mqtt") return;
      if (!this.peer || this.peer.destroyed) return;
      if (this.peer.disconnected) {
        try {
          this.peer.reconnect();
        } catch {
        }
        setTimeout(() => this.connectPeer(), 1500);
      } else this.connectPeer();
    }
    send(msg) {
      if (this.via === "mqtt") {
        if (this.client?.connected) this.client.publish(this.base + "/up", enc({ conn: this.conn, m: msg }), { qos: 1 });
      } else if (this.pconn?.open) try {
        this.pconn.send(msg);
      } catch {
      }
    }
    destroy() {
      this.alive = false;
      clearTimeout(this.pickTimer);
      clearInterval(this.ping);
      if (this.via === "mqtt" && this.client?.connected) {
        this.send({ t: "gone" });
      }
      setTimeout(() => {
        (this.pending || []).forEach((x) => {
          try {
            x.c.end(true);
          } catch {
          }
        });
        try {
          this.peer?.destroy();
        } catch {
        }
      }, 300);
    }
  };

  // js/audio.js
  var ctx = null;
  var master = null;
  var muted = (() => {
    try {
      return localStorage.getItem("cb-muted") === "1";
    } catch {
      return false;
    }
  })();
  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  var isMuted = () => muted;
  function setMuted(m) {
    muted = m;
    try {
      localStorage.setItem("cb-muted", m ? "1" : "0");
    } catch {
    }
  }
  function unlock() {
    ac();
  }
  function tone(freq, dur, { type = "sine", vol = 0.3, at = 0, slide = 0, attack = 5e-3 } = {}) {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(1e-4, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function noise(dur, { vol = 0.2, at = 0, freq = 2e3 } = {}) {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime + at;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = 1.2;
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
  }
  var sfx = {
    dice() {
      for (let i = 0; i < 7; i++) noise(0.05, { at: i * 0.07 + Math.random() * 0.03, vol: 0.35, freq: 1800 + Math.random() * 1600 });
    },
    hop() {
      tone(520 + Math.random() * 60, 0.07, { type: "triangle", vol: 0.12, slide: 200 });
    },
    coin() {
      tone(988, 0.08, { type: "square", vol: 0.08 });
      tone(1319, 0.25, { type: "square", vol: 0.08, at: 0.08 });
    },
    pay() {
      tone(330, 0.12, { type: "sawtooth", vol: 0.08 });
      tone(247, 0.2, { type: "sawtooth", vol: 0.08, at: 0.1 });
    },
    buy() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: "triangle", vol: 0.18, at: i * 0.07 }));
    },
    build() {
      noise(0.08, { vol: 0.4, freq: 600 });
      tone(196, 0.12, { type: "square", vol: 0.1 });
      noise(0.08, { vol: 0.4, freq: 700, at: 0.12 });
    },
    card() {
      noise(0.18, { vol: 0.15, freq: 4e3 });
      tone(880, 0.3, { type: "sine", vol: 0.12, at: 0.1, slide: 440 });
    },
    jail() {
      tone(196, 0.35, { type: "sawtooth", vol: 0.12 });
      tone(147, 0.5, { type: "sawtooth", vol: 0.12, at: 0.25 });
      noise(0.2, { at: 0.05, vol: 0.3, freq: 300 });
    },
    turn() {
      tone(660, 0.12, { type: "sine", vol: 0.15 });
      tone(880, 0.2, { type: "sine", vol: 0.15, at: 0.1 });
    },
    myturn() {
      [523, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: "triangle", vol: 0.2, at: i * 0.09 }));
    },
    bid() {
      tone(740, 0.08, { type: "square", vol: 0.07 });
    },
    gavel() {
      noise(0.12, { vol: 0.5, freq: 400 });
      tone(110, 0.2, { type: "square", vol: 0.12 });
    },
    error() {
      tone(200, 0.15, { type: "square", vol: 0.08 });
    },
    chat() {
      tone(1200, 0.06, { type: "sine", vol: 0.08 });
      tone(1600, 0.08, { type: "sine", vol: 0.06, at: 0.05 });
    },
    bankrupt() {
      [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: "sawtooth", vol: 0.1, at: i * 0.18 }));
    },
    win() {
      [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, { type: "triangle", vol: 0.2, at: i * 0.12 }));
    },
    jackpot() {
      for (let i = 0; i < 8; i++) tone(1e3 + i * 120, 0.12, { type: "square", vol: 0.06, at: i * 0.05 });
    },
    trade() {
      tone(587, 0.15, { type: "triangle", vol: 0.15 });
      tone(880, 0.25, { type: "triangle", vol: 0.15, at: 0.12 });
    }
  };

  // js/ui.js
  var gsap = window.gsap;
  var $ = (q, el = document) => el.querySelector(q);
  var $$ = (q, el = document) => [...el.querySelectorAll(q)];
  var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var CV = { r: "var(--cr)", y: "var(--cy)", g: "var(--cg)", b: "var(--cb)" };
  var ctx2 = { myId: null, isHost: false, act: () => {
  }, offset: 0 };
  function configure(o) {
    Object.assign(ctx2, o);
  }
  var S = null;
  var modal = null;
  var P = (s, id) => s?.players.find((p) => p.id === id);
  var me = () => P(S, ctx2.myId);
  function setHTML(el, h) {
    if (el && el._h !== h) {
      el._h = h;
      el.innerHTML = h;
    }
  }
  var avatar = (p, cls = "") => `<span class="av ${cls}" style="--pc:${p.color}"><i class="fa-solid ${p.avatar}"></i></span>`;
  function pname(s, id) {
    const p = P(s, id);
    return p ? `<b style="color:color-mix(in srgb, ${p.color} 70%, #fff)">${esc(p.name)}</b>` : "<b>?</b>";
  }
  var fmtLog = (s, t) => esc(t).replace(/\[\[([^\]]+)\]\]/g, (_, id) => pname(s, id));
  function glyph(v) {
    return { skip: '<i class="fa-solid fa-ban"></i>', rev: '<i class="fa-solid fa-arrow-right-arrow-left"></i>', d2: "+2", w4: "+4", wild: '<i class="fa-solid fa-star"></i>' }[v] ?? v;
  }
  function cardHTML(c, extra = "") {
    if (!c) return backHTML(extra);
    const g = glyph(c.v);
    const corner = c.v === "wild" ? '<i class="fa-solid fa-star"></i>' : g;
    const six = c.v === "6" || c.v === "9" ? '<span class="six-line"></span>' : "";
    return `<div class="card c-${c.c} ${extra}" data-v="${c.v}" data-id="${c.id}"><div class="card-in"><span class="corner tl">${corner}</span><div class="badge"><span>${g}${six}</span></div><span class="corner br">${corner}</span></div></div>`;
  }
  function backHTML(extra = "") {
    return `<div class="card back ${extra}"><div class="card-in"><div class="back-logo"><i class="fa-solid fa-bolt"></i><b>COLOR</b><b>BLITZ</b></div></div></div>`;
  }
  function initSky() {
    let stars = "";
    for (let i = 0; i < 60; i++) stars += `<i class="star" style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-delay:${Math.random() * 3}s"></i>`;
    $("#sky").innerHTML = stars;
    const demo = [{ c: "r", v: "7" }, { c: "y", v: "skip" }, { c: "w", v: "w4" }, { c: "g", v: "rev" }, { c: "b", v: "d2" }];
    const hc = $("#hero-cards");
    hc.innerHTML = demo.map((c, i) => cardHTML({ ...c, id: "h" + i })).join("");
    $$(".card", hc).forEach((el, i) => {
      gsap.fromTo(el, { y: 80, opacity: 0, rotation: 0 }, { y: Math.abs(i - 2) * 10, opacity: 1, rotation: (i - 2) * 11, duration: 0.8, delay: 0.1 + i * 0.08, ease: "back.out(1.6)" });
    });
  }
  function tokenGrid(el, selected, taken = /* @__PURE__ */ new Set(), onPick) {
    el.innerHTML = AVATARS.map((t) => `<button class="token-opt ${t === selected ? "sel" : ""} ${taken.has(t) && t !== selected ? "taken" : ""}" data-tok="${t}"><i class="fa-solid ${t}"></i></button>`).join("");
    el.onclick = (e) => {
      const b = e.target.closest("[data-tok]");
      if (b && !b.classList.contains("taken")) onPick(b.dataset.tok);
    };
  }
  function layout() {
    const wrap = $("#table-wrap"), t = $("#table");
    if (!wrap || !$("#game").classList.contains("active")) return;
    const narrow = window.innerWidth <= 1100;
    const W = wrap.clientWidth - (window.innerWidth <= 640 ? 16 : 40);
    const H = narrow ? Math.min(window.innerHeight * 0.55, W * 0.75) : wrap.clientHeight - 60;
    const ratio = window.innerWidth <= 640 ? 1.05 : 1.75;
    const H2 = window.innerWidth <= 640 ? W / ratio : H;
    let w = Math.min(W, H2 * ratio), h = w / ratio;
    w = Math.max(300, w);
    h = Math.max(190, h);
    t.style.width = w + "px";
    t.style.height = h + "px";
    if (narrow) wrap.style.height = h + 120 + "px";
    else wrap.style.height = "";
    const cw = window.innerWidth <= 640 ? Math.max(52, Math.min(64, w * 0.17)) : Math.max(46, Math.min(96, h * 0.2));
    t.style.setProperty("--card-w", cw + "px");
    if (S) renderSeats(S);
  }
  function seatOrder(s) {
    const n = s.players.length;
    const mi = s.players.findIndex((p) => p.id === ctx2.myId);
    const out = [];
    for (let k = 1; k <= n; k++) {
      const p = s.players[((mi < 0 ? -1 : mi) + k) % n];
      if (p.id !== ctx2.myId) out.push(p);
    }
    return out;
  }
  function seatPos(i, k, spectator) {
    const t = $("#table");
    const w = t.clientWidth, h = t.clientHeight;
    const a0 = spectator ? 215 : 168, a1 = spectator ? -35 : 12;
    const ang = (k === 1 ? 90 : a0 - (a0 - a1) * (i / (k - 1))) * Math.PI / 180;
    const rx = window.innerWidth <= 640 ? 0.42 : 0.5;
    return { x: w / 2 + Math.cos(ang) * w * rx, y: h / 2 - Math.sin(ang) * h * 0.52 };
  }
  function render(s) {
    S = s;
    renderSeats(s);
    renderCenter(s);
    renderHand(s);
    renderStatus(s);
    renderScores(s);
    setHTML($("#pane-log"), s.log.slice().reverse().map((l) => `<div class="log-entry">${fmtLog(s, l.text)}</div>`).join(""));
    renderChat(s, $("#game-chat"));
    const tgt = s.settings.target ? `Play to ${s.settings.target}` : "Single round";
    $("#top-info").textContent = `Round ${s.round} \xB7 ${tgt}${s.settings.stacking ? " \xB7 Stacking on" : ""}`;
    refreshModal();
  }
  function reset() {
    S = null;
    $("#seats").innerHTML = "";
    setHTML($("#hand"), "");
  }
  function renderSeats(s) {
    const wrap = $("#seats");
    const order = seatOrder(s);
    const spectator = !me();
    const ids = order.map((p) => p.id);
    $$(".seat", wrap).forEach((el) => {
      if (!ids.includes(el.dataset.pid)) el.remove();
    });
    const cur = s.players[s.turn]?.id;
    order.forEach((p, i) => {
      let el = $(`.seat[data-pid="${p.id}"]`, wrap);
      if (!el) {
        el = document.createElement("div");
        el.className = "seat";
        el.dataset.pid = p.id;
        wrap.appendChild(el);
      }
      const pos = seatPos(i, order.length, spectator);
      el.style.left = pos.x + "px";
      el.style.top = pos.y + "px";
      el.style.setProperty("--pc", p.color);
      el.classList.toggle("turn", s.phase === "playing" && p.id === cur);
      el.classList.toggle("left", !!p.left);
      const n = p.count ?? p.hand?.length ?? 0;
      const fanN = Math.min(n, 9);
      const fan = Array.from({ length: fanN }, (_, j) => `<i class="mini" style="transform:rotate(${(j - (fanN - 1) / 2) * 9}deg)"></i>`).join("");
      const tags = [];
      if (p.bot) tags.push('<span class="status bot">bot</span>');
      if (!p.bot && !p.connected && !p.left) tags.push('<span class="status dc">offline</span>');
      if (p.called && n <= 1 && s.phase === "playing") tags.push('<span class="blitz-tag">BLITZ!</span>');
      if (s.settings.target) tags.push(`<span class="score">${p.score} pts</span>`);
      const catchBtn = s.vulnerable === p.id && me() && !me().left ? `<button class="btn tiny danger catch-btn" data-act='${JSON.stringify({ type: "catch", target: p.id })}'><i class="fa-solid fa-hand"></i> Catch!</button>` : "";
      setHTML(el, `<div class="fan">${fan}</div><div class="av-wrap">${avatar(p)}<span class="count ${n === 1 ? "low" : ""}">${n}</span></div><div class="sname">${esc(p.name)}</div><div class="tags">${tags.join("")}</div>${catchBtn}`);
    });
  }
  function renderCenter(s) {
    const t = $("#table");
    t.style.setProperty("--glow", CV[s.color]);
    $("#dir-ring").classList.toggle("ccw", s.dir < 0);
    const m = me();
    const myTurn = m && s.phase === "playing" && s.players[s.turn]?.id === m.id && s.drawn == null;
    setHTML($("#deck"), backHTML() + backHTML() + backHTML() + `<div class="deck-count">${s.deckCount} cards</div>`);
    $("#deck").classList.toggle("can", !!myTurn);
    const pile = s.discard.slice(-5);
    setHTML($("#discard"), pile.map((c, i) => {
      const r = c.id * 37 % 30 - 15;
      const chosen = c.c === "w" && i === pile.length - 1 ? ` data-chosen style="--chosen:${CV[s.color]};transform:rotate(${r}deg)"` : ` style="transform:rotate(${r}deg)"`;
      return cardHTML(c).replace('<div class="card', `<div${chosen} class="card`);
    }).join(""));
    setHTML($("#color-ind"), `<span class="dot"></span>${COLOR_NAMES[s.color]}`);
    const pd = $("#pending");
    pd.hidden = !s.pendingDraw;
    pd.textContent = "+" + s.pendingDraw;
  }
  function renderHand(s) {
    const m = me(), el = $("#hand");
    if (!m) return setHTML(el, '<div class="hand-empty">Spectating</div>');
    const hand = [...m.hand || []];
    const order = { r: 0, y: 1, g: 2, b: 3, w: 4 }, vo = (v) => /^\d$/.test(v) ? +v : { skip: 10, rev: 11, d2: 12, wild: 13, w4: 14 }[v];
    hand.sort((a, b) => order[a.c] - order[b.c] || vo(a.v) - vo(b.v));
    const myTurn = s.phase === "playing" && s.players[s.turn]?.id === m.id;
    el.classList.toggle("myturn", myTurn);
    const cw = parseFloat(getComputedStyle($("#table")).getPropertyValue("--card-w")) || 86;
    el.style.setProperty("--card-w", Math.max(56, Math.min(92, cw * 1.05)) + "px");
    const avail = el.clientWidth - 40, cardW = Math.max(56, Math.min(92, cw * 1.05));
    const overlap = hand.length > 1 ? Math.min(-8, (avail - cardW) / (hand.length - 1) - cardW) : 0;
    el.style.setProperty("--overlap", Math.max(-cardW * 0.72, overlap) + "px");
    const html = hand.map((c) => {
      const ok = myTurn && playable(s, c) && (s.drawn == null || s.drawn === c.id);
      return cardHTML(c, ok ? "ok" : "");
    }).join("") || (s.phase === "playing" ? '<div class="hand-empty">No cards!</div>' : "");
    setHTML(el, html);
  }
  function renderStatus(s) {
    const m = me(), cur = s.players[s.turn];
    let h = "";
    if (s.phase === "roundover" || s.phase === "ended") {
      const w = P(s, s.phase === "ended" ? s.champion : s.roundWinner);
      h = `<div class="status-text mine">${w ? avatar(w, "sm") + " " + esc(w.name) + (s.phase === "ended" ? " wins the game!" : " wins the round!") : "Game over"}</div>
      ${s.phase === "roundover" && ctx2.isHost ? `<button class="btn primary" data-act='{"type":"nextRound"}'><i class="fa-solid fa-forward"></i> Next round</button>` : ""}
      <button class="btn" data-ui="results"><i class="fa-solid fa-trophy"></i> Scores</button>`;
    } else if (m && !m.left && cur?.id === m.id) {
      const n = m.hand?.length || 0;
      const opts = (m.hand || []).filter((c) => playable(s, c));
      let msg = s.pendingDraw ? opts.length ? `Stack a draw card or take <b>+${s.pendingDraw}</b>` : `No stack \u2014 take <b>+${s.pendingDraw}</b>` : s.drawn != null ? "You drew a playable card \u2014 play it or pass" : opts.length ? "Your turn \u2014 play a highlighted card" : "No match \u2014 draw a card";
      h = `<div class="status-text mine"><i class="fa-solid fa-hand-pointer"></i> ${msg}</div>`;
      if (s.drawn != null) h += `<button class="btn" data-act='{"type":"pass"}'><i class="fa-solid fa-forward"></i> Pass</button>`;
      else h += `<button class="btn ${opts.length ? "" : "accent"}" data-act='{"type":"draw"}'><i class="fa-solid fa-layer-group"></i> ${s.pendingDraw ? "Take " + s.pendingDraw : "Draw"}</button>`;
      if (n === 2 && !m.called) h += `<button class="btn blitz" data-act='{"type":"call"}'><i class="fa-solid fa-bolt"></i> BLITZ!</button>`;
    } else {
      if (m && s.vulnerable === m.id) h += `<button class="btn blitz" data-act='{"type":"call"}'><i class="fa-solid fa-bolt"></i> BLITZ! (quick!)</button>`;
      h += cur ? `<div class="status-text">${avatar(cur, "sm")} ${esc(cur.name)} is playing\u2026</div>` : "";
    }
    setHTML($("#status"), h);
  }
  function renderScores(s) {
    const max = Math.max(1, s.settings.target || Math.max(...s.players.map((p) => p.score), 1));
    const rows = [...s.players].sort((a, b) => b.score - a.score).map((p) => {
      const n = p.count ?? p.hand?.length ?? 0;
      return `<div class="score-row">${avatar(p, "sm")}<div style="flex:1;min-width:0"><div style="display:flex;gap:8px"><span class="nm">${esc(p.name)}${p.id === ctx2.myId ? ' <span class="status">you</span>' : ""}</span><span class="cards">${p.left ? "left" : n + (n === 1 ? " card" : " cards")}</span><span class="pts">${p.score}</span></div><div class="score-bar"><i style="width:${Math.min(100, p.score / max * 100)}%"></i></div></div></div>`;
    }).join("");
    setHTML($("#pane-scores"), `<div class="muted small">${s.settings.target ? `First to <b>${s.settings.target}</b> points wins. Round winners score the cards left in everyone else's hands.` : "Single round: first to empty their hand wins."}</div>${rows}`);
  }
  function renderChat(s, el) {
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setHTML(el, s.chat.length ? s.chat.map((m) => `<div class="chat-msg">${pname(s, m.pid)}: ${esc(m.text)}</div>`).join("") : '<div class="muted small">No messages yet.</div>');
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  function renderLobby(s, { code: code2, netStatus: netStatus2 }) {
    S = s;
    $("#room-code").textContent = code2;
    const isHost = ctx2.isHost;
    $("#pcount").textContent = `${s.players.length} / ${MAX_PLAYERS}`;
    let h = s.players.map((p) => `<div class="lp">${avatar(p)}<span class="name">${esc(p.name)}</span><span class="tags">
    ${p.id === s.hostId ? '<span class="status host"><i class="fa-solid fa-crown"></i> host</span>' : ""}${p.bot ? '<span class="status bot">bot</span>' : ""}${p.id === ctx2.myId ? '<span class="status">you</span>' : ""}
    ${isHost && p.id !== ctx2.myId ? `<button class="btn tiny ghost" data-ui="kick:${p.id}" title="Remove"><i class="fa-solid fa-xmark"></i></button>` : ""}</span></div>`).join("");
    for (let i = s.players.length; i < Math.max(4, Math.min(MAX_PLAYERS, s.players.length + 1)); i++) h += `<div class="lp empty"><i class="fa-regular fa-user"></i>&nbsp; Open seat</div>`;
    setHTML($("#lobby-players"), h);
    $("#add-bot").hidden = !isHost;
    $("#add-bot").disabled = s.players.length >= MAX_PLAYERS;
    $("#start-game").hidden = !isHost;
    $("#start-game").disabled = s.players.length < 2;
    $("#lobby-wait").hidden = isHost;
    for (const [id, key] of [["set-hand", "hand"], ["set-target", "target"], ["set-timer", "timer"]]) {
      const el = $("#" + id);
      el.value = String(s.settings[key]);
      el.disabled = !isHost;
    }
    $("#set-stack").checked = s.settings.stacking;
    $("#set-stack").disabled = !isHost;
    const m = me();
    tokenGrid($("#lobby-token"), m?.avatar, new Set(s.players.map((p) => p.avatar)), (a) => ctx2.act({ type: "setAvatar", avatar: a }));
    renderChat(s, $("#lobby-chat"));
    const ns = $("#net-status");
    ns.className = "net-status " + (netStatus2?.level || "");
    ns.innerHTML = `<span class="dot"></span>${esc(netStatus2?.text || "")}`;
  }
  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }
  function seatEl(pid) {
    return $(`.seat[data-pid="${pid}"] .av-wrap`);
  }
  function flyCard(html, from, to, { dur = 0.45, rot = 0, delay = 0, scaleFrom = 0.6 } = {}) {
    const fx = $("#fx");
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const el = holder.firstChild;
    const cw = parseFloat(getComputedStyle($("#table")).getPropertyValue("--card-w")) || 86;
    el.style.setProperty("--card-w", cw + "px");
    fx.appendChild(el);
    const w = cw, h = cw * 1.48;
    return new Promise((res) => {
      gsap.fromTo(
        el,
        { x: from.x - w / 2, y: from.y - h / 2, scale: scaleFrom, rotation: 0, opacity: 1 },
        { x: to.x - w / 2, y: to.y - h / 2, scale: 1, rotation: rot, duration: dur, delay, ease: "power2.out", onComplete: () => {
          el.remove();
          res();
        } }
      );
    });
  }
  function shout(text, at, cls = "") {
    const el = document.createElement("div");
    el.className = "shout " + cls;
    el.textContent = text;
    el.style.left = at.x + "px";
    el.style.top = at.y + "px";
    document.body.appendChild(el);
    gsap.fromTo(el, { scale: 0.2, opacity: 0, rotation: -12 }, { scale: 1, opacity: 1, rotation: -4, duration: 0.45, ease: "back.out(3)" });
    gsap.to(el, { opacity: 0, y: -40, delay: 1.1, duration: 0.4, onComplete: () => el.remove() });
  }
  function originFor(pid) {
    if (pid === ctx2.myId) return rectOf($("#hand"));
    const s = seatEl(pid);
    return s ? rectOf(s) : rectOf($("#deck"));
  }
  async function playEvent(ev, s, fast) {
    const myId2 = ctx2.myId;
    const d = fast ? 0.5 : 1;
    switch (ev.type) {
      case "deal": {
        sfx.dice();
        const deck = rectOf($("#deck"));
        const targets = s.players.filter((p) => !p.left).map((p) => p.id);
        const rounds = Math.min(3, ev.n);
        const jobs = [];
        let k = 0;
        for (let r = 0; r < rounds; r++) for (const pid of targets) jobs.push(flyCard(backHTML(), deck, originFor(pid), { dur: 0.3 * d, delay: k++ * 0.035 * d, rot: Math.random() * 30 - 15 }));
        await Promise.all(jobs);
        return;
      }
      case "flip":
        sfx.card();
        return sleep(200 * d);
      case "turn":
        if (ev.pid === myId2) {
          sfx.myturn();
        } else sfx.turn();
        return;
      case "play": {
        sfx.card();
        let from = originFor(ev.pid);
        if (ev.pid === myId2) {
          const el = $(`#hand .card[data-id="${ev.card.id}"]`);
          if (el) {
            from = rectOf(el);
            el.style.visibility = "hidden";
          }
        }
        await flyCard(cardHTML(ev.card), from, rectOf($("#discard")), { dur: 0.42 * d, rot: ev.card.id * 37 % 30 - 15, scaleFrom: ev.pid === myId2 ? 1 : 0.5 });
        if (ev.card.c === "w") {
          const t = $("#table");
          t.style.setProperty("--glow", CV[ev.color]);
          shout(COLOR_NAMES[ev.color].toUpperCase() + "!", rectOf($("#discard")), "small");
        }
        if (ev.card.v === "d2" || ev.card.v === "w4") {
          sfx.pay();
          shout(ev.card.v === "d2" ? "+2" : "+4", rectOf($("#discard")));
          await sleep(300 * d);
        }
        return;
      }
      case "draw": {
        const deck = rectOf($("#deck")), to = originFor(ev.pid);
        const n = Math.min(ev.n, 6);
        sfx.hop();
        await Promise.all(Array.from({ length: n }, (_, j) => flyCard(backHTML(), deck, to, { dur: 0.35 * d, delay: j * 0.08 * d, rot: Math.random() * 20 - 10, scaleFrom: 1 })));
        if (ev.n >= 2) {
          const sEl = originFor(ev.pid);
          shout("+" + ev.n, { x: sEl.x, y: sEl.y - 30 }, "small bad");
        }
        return;
      }
      case "skip": {
        sfx.error();
        const at = originFor(ev.pid);
        shout("SKIPPED", { x: at.x, y: at.y - 20 }, "small bad");
        return sleep(350 * d);
      }
      case "reverse": {
        sfx.trade();
        const svg = $("#dir-ring svg");
        gsap.fromTo(svg, { scale: 1.25, opacity: 1 }, { scale: 1, opacity: 0.5, duration: 0.8 });
        shout("REVERSE!", rectOf($("#center")), "small");
        return sleep(300 * d);
      }
      case "shuffle":
        sfx.dice();
        toast("Deck reshuffled", "info", "fa-shuffle");
        return;
      case "call": {
        sfx.jackpot();
        const at = originFor(ev.pid);
        shout("BLITZ!", { x: at.x, y: at.y - 40 });
        return sleep(300 * d);
      }
      case "catch": {
        sfx.jail();
        const at = originFor(ev.target);
        shout("CAUGHT! +2", { x: at.x, y: at.y - 40 }, "bad");
        toast(`${esc(P(s, ev.by)?.name)} caught ${esc(P(s, ev.target)?.name)}!`, "gold", "fa-hand");
        return sleep(300 * d);
      }
      case "roundWin": {
        sfx.win();
        const at = originFor(ev.pid);
        shout(ev.pid === myId2 ? "YOU WIN THE ROUND!" : "ROUND OVER", { x: window.innerWidth / 2, y: window.innerHeight / 2 });
        confetti(80);
        return sleep(900);
      }
      case "win":
        sfx.win();
        confetti(160);
        return;
      case "chat":
        if (ev.pid !== myId2) {
          sfx.chat();
          if (!$('.tab[data-tab="chat"]')?.classList.contains("active")) {
            const b = $("#chat-badge");
            b.hidden = false;
            b.textContent = (+b.textContent || 0) + 1;
          }
        }
        return;
    }
  }
  function confetti(n) {
    if (!window.confetti) return;
    const colors = ["#ff4d5e", "#ffc23d", "#22c97a", "#3d8bff", "#ffffff"];
    window.confetti({ particleCount: n, spread: 90, origin: { y: 0.6 }, colors });
  }
  setInterval(() => {
    if (!S || S.phase !== "playing" || !S.turnEnds || !S.settings.timer) return;
    const left = S.turnEnds - (Date.now() + ctx2.offset);
    const pct = Math.max(0, Math.min(1, left / (S.settings.timer * 1e3)));
    const cur = S.players[S.turn];
    const el = cur && $(`.seat[data-pid="${cur.id}"]`);
    if (el) el.style.setProperty("--pct", pct.toFixed(3));
  }, 200);
  function toast(html, kind = "info", icon) {
    const icons = { err: "fa-circle-exclamation", good: "fa-circle-check", info: "fa-circle-info", gold: "fa-star" };
    const el = document.createElement("div");
    el.className = "toast " + kind;
    el.innerHTML = `<i class="fa-solid ${icon || icons[kind]}"></i><span>${html}</span>`;
    $("#toasts").appendChild(el);
    while ($("#toasts").children.length > 4) $("#toasts").firstChild.remove();
    gsap.fromTo(el, { y: -20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "back.out(2)" });
    gsap.to(el, { opacity: 0, delay: kind === "err" ? 3.5 : 2.4, duration: 0.3, onComplete: () => el.remove() });
  }
  function closeModal() {
    if (!modal) return;
    const el = modal.el;
    modal = null;
    gsap.to(el, { opacity: 0, duration: 0.15, onComplete: () => el.remove() });
  }
  function openModal(kind, html) {
    if (modal) {
      modal.el.remove();
      modal = null;
    }
    const el = document.createElement("div");
    el.className = "modal-bg";
    el.innerHTML = `<div class="modal glass"><button class="icon-btn close" data-ui="close"><i class="fa-solid fa-xmark"></i></button><div class="modal-body">${html}</div></div>`;
    el.addEventListener("mousedown", (e) => {
      if (e.target === el && kind !== "color") closeModal();
    });
    $("#modal-root").appendChild(el);
    gsap.fromTo(el.querySelector(".modal"), { y: 30, scale: 0.95, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.3, ease: "back.out(1.6)" });
    modal = { kind, el };
    return el;
  }
  function refreshModal() {
    if (modal?.kind === "results" && S) setHTML(modal.el.querySelector(".modal-body"), resultsHTML(S));
  }
  function pickColor(onPick) {
    const el = openModal("color", `<h2>Choose a color</h2><div class="color-pick">${["r", "y", "g", "b"].map((c) => `<button data-color="${c}">${COLOR_NAMES[c]}</button>`).join("")}</div>`);
    el.querySelector(".color-pick").onclick = (e) => {
      const b = e.target.closest("[data-color]");
      if (b) {
        closeModal();
        onPick(b.dataset.color);
      }
    };
  }
  function resultsHTML(s) {
    const ended = s.phase === "ended";
    const w = P(s, ended ? s.champion : s.roundWinner);
    const ranked = [...s.players].sort((a, b) => b.score - a.score);
    const rows = ranked.map((p, j) => {
      const n = p.count ?? p.hand?.length ?? 0;
      return `<div class="rank"><span class="pos">#${j + 1}</span>${avatar(p, "sm")}<span class="nm">${esc(p.name)}</span><span class="muted small">${p.id === s.roundWinner ? "won round" : n + (n === 1 ? " card left" : " cards left")}</span><b style="color:var(--cy);min-width:60px;text-align:right">${p.score}</b></div>`;
    }).join("");
    const title = !w ? "Game over" : ended ? `${esc(w.name)} wins the game!` : `${esc(w.name)} wins round ${s.round}`;
    const sub = ended ? s.settings.target ? `Reached ${w?.score} points` : "Single-round game" : `+${s.lastPoints} points \xB7 first to ${s.settings.target} wins`;
    const actions = ended ? `${ctx2.isHost ? '<button class="btn primary" data-ui="newGame"><i class="fa-solid fa-rotate"></i> New game, same room</button>' : ""}<button class="btn" data-ui="home"><i class="fa-solid fa-house"></i> Main menu</button>` : ctx2.isHost ? `<button class="btn primary" data-act='{"type":"nextRound"}'><i class="fa-solid fa-forward"></i> Next round</button>` : '<span class="muted">Waiting for the host to start the next round\u2026</span>';
    return `<div class="winner-wrap"><div class="trophy"><i class="fa-solid fa-trophy"></i></div><h2 style="margin-top:8px">${title}</h2><div class="muted">${sub}</div>
    <div style="margin-top:16px">${rows}</div><div class="modal-actions" style="justify-content:center">${actions}</div></div>`;
  }
  function showResults(s) {
    openModal("results", resultsHTML(s));
  }
  function openRules() {
    openModal("rules", `<h2><i class="fa-solid fa-book-open"></i> How to play</h2><div class="rules">
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
  function confirmBox(title, text, okLabel, onOk) {
    const el = openModal("confirm", `<h2>${title}</h2><p class="muted" style="line-height:1.6">${text}</p><div class="modal-actions"><button class="btn ghost" data-ui="close">Cancel</button><button class="btn danger" id="confirm-ok">${okLabel}</button></div>`);
    el.querySelector("#confirm-ok").onclick = () => {
      closeModal();
      onOk();
    };
  }
  function showMenu(anchor, items) {
    $$(".menu-pop").forEach((m) => m.remove());
    const el = document.createElement("div");
    el.className = "menu-pop";
    el.innerHTML = items.map((it, j) => `<button data-j="${j}" class="${it.danger ? "danger" : ""}"><i class="fa-solid ${it.icon}"></i> ${it.label}</button>`).join("");
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    el.style.top = r.bottom + 6 + "px";
    el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.right - el.offsetWidth)) + "px";
    el.onclick = (e) => {
      const b = e.target.closest("[data-j]");
      if (b) {
        el.remove();
        items[+b.dataset.j].run();
      }
    };
    setTimeout(() => document.addEventListener("click", function off(e) {
      if (!el.contains(e.target)) {
        el.remove();
        document.removeEventListener("click", off);
      }
    }), 0);
  }

  // js/main.js
  var $2 = (q) => document.querySelector(q);
  var store = {
    get(k, d = null) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch {
      }
    }
  };
  var cid = store.get("cb-cid");
  if (!cid) {
    cid = "u" + Math.random().toString(36).slice(2, 11);
    store.set("cb-cid", cid);
  }
  var myName = store.get("cb-name", store.get("st-name", ""));
  var myAvatar = store.get("cb-avatar", AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  var mode = null;
  var code = null;
  var myId = null;
  var game = null;
  var hostNet = null;
  var clientNet = null;
  var latest = null;
  var loopTimer = null;
  var netStatus = { level: "warn", text: "Connecting\u2026" };
  var conns = /* @__PURE__ */ new Map();
  configure({ act, myId: null, isHost: false });
  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    if (id === "game") requestAnimationFrame(layout);
  }
  var current = () => document.querySelector(".screen.active")?.id;
  function connOverlay(text) {
    const o = $2("#conn-overlay");
    if (!text) {
      o.hidden = true;
      return;
    }
    $2("#conn-text").textContent = text;
    o.hidden = false;
  }
  var queue = [];
  var busy = false;
  var seenFirst = false;
  function receive(msg) {
    queue.push(msg);
    if (!busy) pump();
  }
  async function pump() {
    busy = true;
    while (queue.length) {
      const m = queue.shift(), s = m.s;
      if (s.phase === "lobby") {
        latest = s;
        if (current() !== "lobby") {
          closeModal();
          show("lobby");
          reset();
        }
        renderLobby(s, { code, netStatus });
        for (const ev of m.ev || []) if (ev.type === "chat" && ev.pid !== myId) sfx.chat();
        continue;
      }
      const entering = current() !== "game";
      if (entering) {
        show("game");
        $2("#game-code").textContent = code;
        layout();
      }
      const animate = seenFirst || (m.ev || []).some((e) => e.type === "deal");
      if (entering) render(s);
      if (animate) {
        const fast = queue.length > 1;
        for (const ev of m.ev || []) {
          try {
            await playEvent(ev, s, fast);
          } catch (e) {
            console.error(e);
          }
        }
      }
      seenFirst = true;
      const prevPhase = latest?.phase;
      latest = s;
      render(s);
      if ((s.phase === "roundover" || s.phase === "ended") && prevPhase !== s.phase) setTimeout(() => showResults(latest), 500);
      if (s.phase === "playing" && (prevPhase === "roundover" || prevPhase === "ended")) closeModal();
    }
    busy = false;
  }
  function act(a) {
    unlock();
    if (mode === "host") {
      const err = game.handle(myId, a);
      if (err) {
        toast(esc(err), "err");
        sfx.error();
      } else sync();
    } else if (mode === "guest") clientNet?.send({ t: "act", a });
  }
  function sync() {
    const ev = game.takeEvents(), s = game.s, now = Date.now();
    for (const [connId, pid] of conns) hostNet?.send(connId, { t: "state", s: viewFor(s, pid), ev, now });
    receive({ t: "state", s: viewFor(s, myId), ev, now });
    if (s.phase !== "ended" && s.phase !== "lobby") store.set("cb-host", { code, state: s, myId, t: now });
    else store.del("cb-host");
  }
  function startHost(resume) {
    stopAll();
    mode = "host";
    myId = cid;
    seenFirst = false;
    latest = null;
    code = resume?.code || makeCode();
    const state = resume?.state || newState(myId);
    game = new Game(state);
    if (resume) {
      state.hostId = myId;
      for (const p of state.players) if (!p.bot && p.id !== myId) {
        p.connected = false;
        p.dcAt = Date.now();
      }
    } else game.addPlayer({ id: myId, name: myName, avatar: myAvatar });
    configure({ myId, isHost: true });
    connOverlay("Opening your room\u2026");
    openHostNet(0);
    sync();
    loopTimer = setInterval(hostLoop, 250);
  }
  function openHostNet(tries) {
    hostNet?.destroy();
    hostNet = new HostNet(code, myId, {
      onReady() {
        connOverlay(null);
      },
      onStatus(st) {
        if (!st.live) return;
        netStatus = { level: st.live >= 2 ? "" : "warn", text: `Room is live on ${st.live} connection route${st.live > 1 ? "s" : ""} (${st.names.join(", ")}). Share the code or invite link!` };
        if (latest?.phase === "lobby") renderLobby(latest, { code, netStatus });
      },
      onMessage: hostMessage,
      onLeave: hostLeave,
      onError(err, kind) {
        if (kind === "taken") {
          if (game.s.phase === "lobby" && tries < 5) {
            code = makeCode();
            setTimeout(() => openHostNet(tries + 1), 300);
            return;
          }
          if (tries < 8) {
            connOverlay(`Reclaiming room ${code}\u2026 (${tries + 1})`);
            setTimeout(() => openHostNet(tries + 1), 4e3);
            return;
          }
        }
        connOverlay(null);
        netStatus = { level: "bad", text: "Couldn\u2019t reach any connection service (check your internet). You can still play here against bots." };
        if (latest?.phase === "lobby") renderLobby(latest, { code, netStatus });
        toast("Connection problem: " + esc(err.message || "unknown"), "err");
      }
    });
  }
  function hostMessage(connId, m) {
    const s = game.s;
    if (m.t === "hello") {
      let pid2 = String(m.cid || "").slice(0, 40) || "g" + Math.random().toString(36).slice(2, 9);
      const avatar2 = AVATARS.includes(m.avatar) ? m.avatar : null;
      const liveConn = [...conns.entries()].find(([c, p]) => p === pid2 && c !== connId && hostNet.has(c));
      if (pid2 === myId || liveConn) {
        if (s.phase !== "lobby") return hostNet.send(connId, { t: "denied", msg: "You are already in this game in another tab." });
        pid2 = pid2 + "-" + Math.random().toString(36).slice(2, 6);
      }
      const existing = game.P(pid2);
      if (existing && !existing.bot && !existing.left) {
        existing.connected = true;
        existing.dcAt = null;
        conns.set(connId, pid2);
        game.log(`[[${pid2}]] reconnected`);
        hostNet.send(connId, { t: "welcome", pid: pid2 });
        return sync();
      }
      if (s.phase !== "lobby") return hostNet.send(connId, { t: "denied", msg: "This game has already started. Ask the host to start a new one." });
      try {
        game.addPlayer({ id: pid2, name: String(m.name || "Player").slice(0, 16), avatar: avatar2 });
      } catch (e) {
        return hostNet.send(connId, { t: "denied", msg: e.message });
      }
      conns.set(connId, pid2);
      hostNet.send(connId, { t: "welcome", pid: pid2 });
      return sync();
    }
    const pid = conns.get(connId);
    if (!pid) return;
    if (m.t === "act" && m.a && typeof m.a === "object") {
      const err = game.handle(pid, m.a);
      if (err) hostNet.send(connId, { t: "err", msg: err });
      else sync();
    } else if (m.t === "bye") {
      conns.delete(connId);
      game.removePlayer(pid);
      sync();
    }
  }
  function hostLeave(connId) {
    const pid = conns.get(connId);
    conns.delete(connId);
    const p = pid && game.P(pid);
    if (!p) return;
    if (game.s.phase === "lobby") game.removePlayer(pid);
    else if (!p.left) {
      p.connected = false;
      p.dcAt = Date.now();
      game.log(`[[${pid}]] disconnected \u2014 a bot will cover if they don't return`);
    }
    sync();
  }
  var botNext = 0;
  function hostLoop() {
    if (!game) return;
    const s = game.s, now = Date.now();
    if (s.phase !== "playing") return;
    if (game.tick(now) && !busy) {
      const p = s.players[s.turn];
      const a = s.drawn != null ? { type: "pass" } : { type: "draw" };
      if (!game.handle(p.id, a)) {
        game.log(`[[${p.id}]] ran out of time`);
        return sync();
      }
    }
    if (busy || now < botNext) return;
    for (const p of s.players) {
      const auto = p.bot || !p.connected && p.dcAt && now - p.dcAt > 15e3;
      if (!auto || !botNeeds(s, p.id)) continue;
      const a = botAction(s, p.id);
      if (!a) continue;
      if (game.handle(p.id, a)) continue;
      botNext = now + (a.type === "catch" ? 400 : a.type === "call" ? 350 : 700 + Math.random() * 500);
      return sync();
    }
  }
  var BOT_NAMES = ["Ada", "Bolt", "Chip", "Dex", "Echo", "Fizz", "Gizmo", "Hex", "Iris", "Jinx", "Koda", "Lumen"];
  function addBot() {
    const used = new Set(game.s.players.map((p) => p.name));
    const name = (BOT_NAMES.find((n) => !used.has(n + " \u{1F916}")) || "Bot") + " \u{1F916}";
    try {
      game.addPlayer({ id: "bot-" + Math.random().toString(36).slice(2, 8), name, bot: true });
      sync();
    } catch (e) {
      toast(esc(e.message), "err");
    }
  }
  function kick(pid) {
    const connId = [...conns.entries()].find(([, p]) => p === pid)?.[0];
    if (connId) {
      hostNet.kick(connId);
      conns.delete(connId);
    }
    game.removePlayer(pid);
    sync();
  }
  function newGameSameRoom() {
    const old = game.s, s = newState(myId);
    s.settings = { ...old.settings };
    s.chat = old.chat;
    const g = new Game(s);
    for (const p of old.players) if (!p.left && (p.bot || p.connected || p.id === myId)) g.addPlayer({ id: p.id, name: p.name, avatar: p.avatar, bot: p.bot });
    game = g;
    closeModal();
    sync();
  }
  var reconnectTries = 0;
  var reconnectTimer = null;
  var welcomed = false;
  function startGuest(c) {
    stopAll();
    mode = "guest";
    code = c.toUpperCase();
    myId = null;
    seenFirst = false;
    latest = null;
    welcomed = false;
    configure({ myId: null, isHost: false });
    connOverlay(`Joining room ${code}\u2026`);
    clientNet = new ClientNet(code, {
      onOpen() {
        reconnectTries = 0;
        clearTimeout(reconnectTimer);
        clientNet.send({ t: "hello", cid, name: myName, avatar: myAvatar });
      },
      onMessage(m) {
        if (!m || typeof m !== "object") return;
        if (m.t === "welcome") {
          myId = m.pid;
          welcomed = true;
          configure({ myId });
          connOverlay(null);
          const u = new URLSearchParams(location.search);
          u.set("room", code);
          history.replaceState(null, "", "?" + u);
        } else if (m.t === "state") {
          configure({ offset: m.now - Date.now() });
          if (myId) receive(m);
        } else if (m.t === "rehello") clientNet.send({ t: "hello", cid, name: myName, avatar: myAvatar });
        else if (m.t === "err") {
          toast(esc(m.msg), "err");
          sfx.error();
        } else if (m.t === "denied") {
          toast(esc(m.msg), "err");
          goHome();
        } else if (m.t === "kicked") {
          toast("You were removed from the room by the host", "err");
          goHome();
        }
      },
      onClose() {
        if (mode === "guest") scheduleReconnect();
      },
      onError(err) {
        if (mode !== "guest") return;
        if (!welcomed) {
          toast(esc(err.message || "Could not join"), "err");
          goHome();
          return;
        }
        scheduleReconnect();
      }
    });
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    if (reconnectTries++ > 20) {
      toast("Lost connection to the host.", "err");
      return goHome();
    }
    connOverlay("Connection lost. Reconnecting to the host\u2026");
    reconnectTimer = setTimeout(() => clientNet?.reconnect(), 2500);
  }
  function stopAll() {
    clearInterval(loopTimer);
    loopTimer = null;
    clearTimeout(reconnectTimer);
    hostNet?.destroy();
    hostNet = null;
    clientNet?.destroy();
    clientNet = null;
    conns.clear();
    game = null;
    queue.length = 0;
  }
  function goHome() {
    if (mode === "guest") clientNet?.send({ t: "bye" });
    stopAll();
    mode = null;
    latest = null;
    myId = null;
    closeModal();
    reset();
    connOverlay(null);
    const u = new URLSearchParams(location.search);
    u.delete("room");
    history.replaceState(null, "", location.pathname + (u.toString() ? "?" + u : ""));
    show("home");
    renderHome();
  }
  function leave() {
    const inGame = latest && latest.phase !== "lobby" && latest.phase !== "ended";
    const msg = mode === "host" ? inGame ? "You are the host: leaving pauses the room for everyone. You can resume it later from this browser." : "This closes the room for everyone." : inGame ? "You will leave this game. Your cards go back into the deck." : "Leave this room?";
    confirmBox("Leave game?", msg, "Leave", goHome);
  }
  var inviteLink = () => {
    const u = new URLSearchParams(location.search);
    u.set("room", code);
    return `${location.origin}${location.pathname}?${u}`;
  };
  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copied!`, "good");
    } catch {
      prompt("Copy this:", text);
    }
  }
  function renderHome() {
    $2("#name").value = myName;
    tokenGrid($2("#token-pick"), myAvatar, /* @__PURE__ */ new Set(), (t) => {
      myAvatar = t;
      store.set("cb-avatar", t);
      renderHome();
    });
    const saved = store.get("cb-host"), btn = $2("#btn-resume");
    if (saved && saved.myId === cid && ["playing", "roundover"].includes(saved.state?.phase) && Date.now() - saved.t < 36 * 36e5) {
      btn.hidden = false;
      btn.innerHTML = `<i class="fa-solid fa-rotate-left"></i> Resume hosting room ${esc(saved.code)} (round ${saved.state.round})`;
    } else btn.hidden = true;
  }
  function needName() {
    myName = $2("#name").value.trim().slice(0, 16);
    if (!myName) {
      toast("Enter your name first", "err");
      $2("#name").focus();
      return false;
    }
    store.set("cb-name", myName);
    return true;
  }
  function playCard(id) {
    const s = latest, m = s?.players.find((p) => p.id === myId);
    const card = m?.hand?.find((c) => c.id === id);
    if (!card || s.phase !== "playing" || s.players[s.turn].id !== myId) return;
    if (!playable(s, card) || s.drawn != null && s.drawn !== id) {
      sfx.error();
      return;
    }
    if (card.c === "w") pickColor((color) => act({ type: "play", card: id, color }));
    else act({ type: "play", card: id });
  }
  function wire() {
    initSky();
    renderHome();
    const params2 = new URLSearchParams(location.search);
    if (params2.get("room")) {
      $2("#join-code").value = params2.get("room").toUpperCase().slice(0, 5);
      setTimeout(() => (myName ? $2("#btn-join") : $2("#name")).focus(), 100);
    }
    $2("#btn-create").onclick = () => {
      unlock();
      if (needName()) startHost(null);
    };
    $2("#btn-join").onclick = () => {
      unlock();
      if (!needName()) return;
      const c = $2("#join-code").value.trim().toUpperCase();
      if (c.length !== 5) {
        toast("Room codes are 5 characters", "err");
        return;
      }
      startGuest(c);
    };
    $2("#join-code").addEventListener("keydown", (e) => {
      if (e.key === "Enter") $2("#btn-join").click();
    });
    $2("#name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") ($2("#join-code").value ? $2("#btn-join") : $2("#btn-create")).click();
    });
    $2("#btn-resume").onclick = () => {
      unlock();
      const saved = store.get("cb-host");
      if (saved) startHost(saved);
    };
    $2("#conn-cancel").onclick = goHome;
    $2("#open-rules").onclick = (e) => {
      e.preventDefault();
      openRules();
    };
    $2("#lobby-leave").onclick = leave;
    $2("#copy-code").onclick = () => copy(code, "Room code");
    $2("#copy-link").onclick = () => copy(inviteLink(), "Invite link");
    $2("#game-code").onclick = () => copy(inviteLink(), "Invite link");
    $2("#add-bot").onclick = () => mode === "host" && addBot();
    $2("#start-game").onclick = () => act({ type: "start" });
    const settings = () => act({ type: "settings", settings: { hand: +$2("#set-hand").value, stacking: $2("#set-stack").checked, target: +$2("#set-target").value, timer: +$2("#set-timer").value } });
    ["#set-hand", "#set-stack", "#set-target", "#set-timer"].forEach((q) => $2(q).addEventListener("change", settings));
    document.querySelectorAll("[data-chat]").forEach((f) => f.addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = f.querySelector("input");
      if (inp.value.trim()) act({ type: "chat", text: inp.value });
      inp.value = "";
    }));
    document.querySelectorAll(".tab").forEach((t) => t.onclick = () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
      document.querySelectorAll(".tab-pane").forEach((p) => p.classList.toggle("active", p.id === "pane-" + t.dataset.tab));
      if (t.dataset.tab === "chat") {
        const b = $2("#chat-badge");
        b.hidden = true;
        b.textContent = "";
      }
    });
    const muteBtn = $2("#btn-mute");
    const syncMute = () => {
      muteBtn.innerHTML = `<i class="fa-solid ${isMuted() ? "fa-volume-xmark" : "fa-volume-high"}"></i>`;
    };
    syncMute();
    muteBtn.onclick = () => {
      setMuted(!isMuted());
      syncMute();
    };
    $2("#btn-rules").onclick = openRules;
    $2("#btn-menu").onclick = (e) => {
      const items = [{ icon: "fa-link", label: "Copy invite link", run: () => copy(inviteLink(), "Invite link") }, { icon: "fa-trophy", label: "Scores", run: () => latest && showResults(latest) }];
      if (mode === "host" && latest && latest.phase !== "ended") {
        for (const p of latest.players.filter((p2) => p2.id !== myId && !p2.left)) items.push({ icon: "fa-user-xmark", label: `Remove ${esc(p.name)}`, danger: true, run: () => confirmBox(`Remove ${esc(p.name)}?`, "Their cards go back into the deck.", "Remove", () => kick(p.id)) });
      }
      items.push({ icon: "fa-right-from-bracket", label: "Leave game", danger: true, run: leave });
      showMenu(e.currentTarget, items);
    };
    document.addEventListener("click", (e) => {
      const a = e.target.closest("[data-act]");
      if (a && !a.disabled) {
        try {
          act(JSON.parse(a.dataset.act));
        } catch (err) {
          console.error(err);
        }
        return;
      }
      const u = e.target.closest("[data-ui]");
      if (u) {
        const [cmd, x] = u.dataset.ui.split(":");
        if (cmd === "close") closeModal();
        else if (cmd === "results") latest && showResults(latest);
        else if (cmd === "home") goHome();
        else if (cmd === "newGame") mode === "host" && newGameSameRoom();
        else if (cmd === "kick") mode === "host" && kick(x);
        return;
      }
      const card = e.target.closest("#hand .card");
      if (card) return playCard(+card.dataset.id);
      if (e.target.closest("#deck")) {
        const s = latest;
        if (s?.phase === "playing" && s.players[s.turn]?.id === myId && s.drawn == null) act({ type: "draw" });
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
    window.addEventListener("resize", () => {
      layout();
      latest && latest.phase !== "lobby" && render(latest);
    });
    window.addEventListener("beforeunload", (e) => {
      if (mode === "host" && latest && latest.phase === "playing") {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }
  wire();
  window.__cb = { get state() {
    return latest;
  }, get game() {
    return game;
  }, act, addBot: () => addBot() };
})();
