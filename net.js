// Camada de rede P2P (WebRTC via PeerJS).
// O GitHub Pages so serve arquivos estaticos, entao nao existe um servidor proprio:
// o jogador que cria a sala e o HOST e atua como servidor autoritativo
// (IA da freira, dificuldade da equipe, chaves, portas e fim de jogo).

const ROOM_PREFIX = "asylum-escape-v1-";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MAX_PLAYERS = 4;

function iceServers() {
  if (Array.isArray(window.ASYLUM_ICE_SERVERS)) return window.ASYLUM_ICE_SERVERS;
  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ];
}

function peerOptions() {
  return { debug: 0, config: { iceServers: iceServers() } };
}

function randomCode() {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function cleanName(name) {
  const cleaned = String(name || "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, 12);
  return cleaned || "Jogador";
}

function friendly(err) {
  const type = err && err.type;
  if (type === "peer-unavailable") return "Sala não encontrada. Confira o código.";
  if (["network", "server-error", "socket-error", "socket-closed"].includes(type)) {
    return "Não foi possível falar com o servidor de conexão. Tente de novo.";
  }
  if (type === "browser-incompatible") return "Seu navegador não suporta WebRTC.";
  return (err && err.message) || "Erro de conexão.";
}

class Net {
  constructor() {
    this.listeners = new Map();
    this.lobbyOpen = false;
    this.reset();
  }

  reset() {
    this.role = "none"; // none | host | client
    this.peer = null;
    this.conns = new Map(); // host: id -> conexao
    this.hostConn = null; // cliente: conexao com o host
    this.myId = null;
    this.myName = "Jogador";
    this.code = null;
    this.players = []; // [{ id, name }]
    this.inGame = false;
    this.nextId = 1;
  }

  get active() {
    return this.role !== "none";
  }

  get isHost() {
    return this.role === "host";
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  emit(type, ...args) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(...args);
      } catch (error) {
        console.error("[net] erro no listener", type, error);
      }
    }
  }

  // ---------------------------------------------------------------
  // HOST
  // ---------------------------------------------------------------

  createRoom(name) {
    this.leave();
    if (!window.Peer) return Promise.reject(new Error("PeerJS não carregou."));

    this.myName = cleanName(name);
    this.role = "host";
    this.myId = "p0";
    this.players = [{ id: "p0", name: this.myName }];

    return new Promise((resolve, reject) => {
      const attemptOpen = (attempt) => {
        const code = randomCode();
        const peer = new window.Peer(ROOM_PREFIX + code, peerOptions());
        this.peer = peer;

        peer.on("open", () => {
          this.code = code;
          this.bindHost(peer);
          resolve(code);
        });

        peer.on("error", (err) => {
          if (err.type === "unavailable-id" && attempt < 5 && !this.code) {
            peer.destroy();
            attemptOpen(attempt + 1);
            return;
          }
          if (!this.code) {
            this.leave();
            reject(new Error(friendly(err)));
          } else {
            this.emit("error", friendly(err));
          }
        });
      };

      attemptOpen(0);
    });
  }

  bindHost(peer) {
    peer.on("connection", (conn) => {
      conn.on("data", (msg) => this.hostReceive(conn, msg));
      conn.on("close", () => this.hostDrop(conn));
      conn.on("error", () => this.hostDrop(conn));
    });

    peer.on("disconnected", () => {
      try {
        peer.reconnect();
      } catch (error) {
        /* sem reconexao possivel */
      }
    });
  }

  hostReceive(conn, msg) {
    if (!msg || typeof msg !== "object") return;

    if (!conn.playerId) {
      if (msg.t !== "hello") return;

      if (this.inGame || this.players.length >= MAX_PLAYERS) {
        const reason = this.inGame
          ? "A partida já começou."
          : "A sala está cheia.";
        conn.send({ t: "denied", reason });
        setTimeout(() => conn.close(), 400);
        return;
      }

      const id = `p${this.nextId++}`;
      conn.playerId = id;
      this.conns.set(id, conn);
      this.players.push({ id, name: cleanName(msg.name) });
      conn.send({ t: "welcome", id, players: this.players, code: this.code });
      this.broadcast({ t: "lobby", players: this.players }, id);
      this.emit("lobby");
      return;
    }

    this.emit("msg", conn.playerId, msg);
  }

  hostDrop(conn) {
    const id = conn.playerId;
    if (!id) return;
    conn.playerId = null;

    this.conns.delete(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.broadcast({ t: "lobby", players: this.players });
    this.emit("lobby");
    this.emit("playerleft", id);
  }

  // ---------------------------------------------------------------
  // CLIENTE
  // ---------------------------------------------------------------

  joinRoom(code, name) {
    this.leave();
    if (!window.Peer) return Promise.reject(new Error("PeerJS não carregou."));

    this.myName = cleanName(name);
    this.role = "client";
    const roomCode = String(code || "").trim().toUpperCase();

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.leave();
        reject(new Error(message));
      };

      const timer = setTimeout(
        () => fail("Tempo esgotado. Sala não encontrada ou rede bloqueada."),
        15000,
      );

      const peer = new window.Peer(undefined, peerOptions());
      this.peer = peer;

      peer.on("open", () => {
        const conn = peer.connect(ROOM_PREFIX + roomCode, {
          reliable: true,
          serialization: "json",
        });
        this.hostConn = conn;

        conn.on("open", () => conn.send({ t: "hello", name: this.myName }));

        conn.on("data", (msg) => {
          if (!msg || typeof msg !== "object") return;

          if (msg.t === "welcome") {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            this.myId = msg.id;
            this.code = roomCode;
            this.players = msg.players;
            resolve(roomCode);
            this.emit("lobby");
            return;
          }

          if (msg.t === "denied") {
            fail(msg.reason || "Entrada recusada.");
            return;
          }

          if (msg.t === "lobby") {
            this.players = msg.players;
            this.emit("lobby");
            return;
          }

          this.emit("msg", "p0", msg);
        });

        const onGone = () => {
          if (!settled) {
            fail("Não foi possível conectar à sala.");
          } else if (this.hostConn === conn) {
            this.emit("closed");
          }
        };
        conn.on("close", onGone);
        conn.on("error", onGone);
      });

      peer.on("error", (err) => {
        if (!settled) fail(friendly(err));
        else this.emit("error", friendly(err));
      });
    });
  }

  // ---------------------------------------------------------------
  // ENVIO
  // ---------------------------------------------------------------

  sendToHost(msg) {
    if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
  }

  sendTo(id, msg) {
    const conn = this.conns.get(id);
    if (conn && conn.open) conn.send(msg);
  }

  broadcast(msg, exceptId = null) {
    for (const [id, conn] of this.conns) {
      if (id !== exceptId && conn.open) conn.send(msg);
    }
  }

  leave() {
    const peer = this.peer;
    const conns = Array.from(this.conns.values());
    const hostConn = this.hostConn;

    this.reset();

    try {
      for (const conn of conns) conn.close();
      if (hostConn) hostConn.close();
      if (peer) peer.destroy();
    } catch (error) {
      /* ja encerrado */
    }
  }
}

export const net = new Net();
