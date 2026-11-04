// Controles touch para celular: joystick, mira da lanterna e botoes de acao.
// Nao mexe na logica do jogo: ele "finge" ser o teclado (isDown dos Key do Phaser)
// e dispara os mesmos eventos de teclado (E, F, ESPACO, ESC) que ja existem.
//
// Use ?mobile=1 na URL para forcar os controles (teste no PC) e ?mobile=0 para desligar.
import { net } from "./net.js";

const params = new URLSearchParams(window.location.search);

function detectMobile() {
  if (params.get("mobile") === "1") return true;
  if (params.get("mobile") === "0") return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

export const isMobile = detectMobile();
if (isMobile) document.body.classList.add("is-mobile");

// Tamanho logico do jogo no celular. A altura fica em 560 e a largura acompanha a
// proporcao da tela, entao a imagem preenche tudo sem faixas pretas e sem deformar.
// Usa FIT (nunca corta o HUD). Se a proporcao mudar um pouco depois (barra do navegador
// some/aparece), sobra no maximo uma faixa fina, pintada com a cor do fundo do jogo.
function computeGameSize() {
  const BASE_W = 960;
  const H = 560;
  const long = Math.max(window.innerWidth, window.innerHeight);
  const short = Math.max(1, Math.min(window.innerWidth, window.innerHeight));
  const ratio = long / short;

  if (ratio < BASE_W / H) return { width: BASE_W, mode: Phaser.Scale.FIT };

  const width = Math.round((H * Math.min(ratio, 2.4)) / 2) * 2;
  return { width, mode: Phaser.Scale.FIT };
}

export const gameSize = computeGameSize();

const STICK_RADIUS = 55; // px de curso do joystick
const STICK_DEADZONE = 0.3; // fracao do raio a partir da qual conta como tecla apertada

let scene = null;
let built = false;
const ui = {};
const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const aim = { id: null, ox: 0, oy: 0 };
const virtual = { run: false };

const CSS = `
body.is-mobile #help { display: none; }
body.is-mobile, body.is-mobile #game { background: #11110f; }
body.is-mobile, body.is-mobile * { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
body.is-mobile #game canvas { touch-action: none; }
#mb-root { position: fixed; inset: 0; z-index: 500; pointer-events: none; font-family: Arial, sans-serif; touch-action: none; }
#mb-root.mb-off { display: none; }
#mb-root .mb-hidden { display: none !important; }
.mb-zone { position: absolute; top: 0; bottom: 0; pointer-events: auto; touch-action: none; }
#mb-move { left: 0; width: 45%; }
#mb-aim { right: 0; width: 55%; }
.mb-base, .mb-ghost { position: absolute; width: ${STICK_RADIUS * 2}px; height: ${STICK_RADIUS * 2}px; margin: -${STICK_RADIUS}px 0 0 -${STICK_RADIUS}px; border-radius: 50%; border: 2px solid rgba(240,213,138,.55); background: rgba(10,10,10,.35); pointer-events: none; }
.mb-ghost { left: calc(max(24px, env(safe-area-inset-left)) + ${STICK_RADIUS + 20}px); bottom: calc(max(18px, env(safe-area-inset-bottom)) + ${STICK_RADIUS + 20}px); opacity: .5; }
.mb-knob { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; border-radius: 50%; background: rgba(240,213,138,.55); border: 2px solid rgba(255,235,170,.8); }
.mb-btn { position: absolute; pointer-events: auto; touch-action: none; display: flex; align-items: center; justify-content: center; flex-direction: column; border-radius: 50%; border: 2px solid rgba(240,213,138,.7); background: rgba(40,18,18,.65); color: #f1e6ce; font-weight: bold; font-size: 12px; letter-spacing: 1px; }
.mb-btn span { font-size: 22px; line-height: 1; margin-bottom: 2px; }
.mb-btn.mb-down { background: rgba(156,52,52,.85); }
#mb-act { width: 84px; height: 84px; right: calc(max(18px, env(safe-area-inset-right)) + 10px); bottom: calc(max(18px, env(safe-area-inset-bottom)) + 10px); }
#mb-run { width: 66px; height: 66px; right: calc(max(18px, env(safe-area-inset-right)) + 110px); bottom: calc(max(18px, env(safe-area-inset-bottom)) + 8px); }
#mb-light { width: 56px; height: 56px; right: calc(max(18px, env(safe-area-inset-right)) + 22px); bottom: calc(max(18px, env(safe-area-inset-bottom)) + 108px); }
#mb-crawl { width: 74px; height: 74px; right: calc(max(18px, env(safe-area-inset-right)) + 100px); bottom: calc(max(18px, env(safe-area-inset-bottom)) + 76px); }
.mb-small { position: absolute; pointer-events: auto; padding: 8px 12px; border-radius: 4px; border: 1px solid rgba(240,213,138,.5); background: rgba(10,10,10,.55); color: #d8c9a6; font-size: 12px; letter-spacing: 1px; }
#mb-exit { left: 50%; margin-left: -96px; top: max(8px, env(safe-area-inset-top)); opacity: .75; }
#mb-full { left: 50%; margin-left: -6px; top: max(8px, env(safe-area-inset-top)); opacity: .75; }
#mb-rotate { position: fixed; inset: 0; z-index: 2000; display: none; align-items: center; justify-content: center; flex-direction: column; background: #08090c; color: #e0d7c4; font-family: Georgia, serif; text-align: center; padding: 24px; font-size: 20px; pointer-events: auto; }
#mb-rotate div { font-size: 64px; margin-bottom: 14px; }
@media (orientation: portrait) { body.is-mobile #mb-rotate { display: flex; } }
`;

function el(tag, id, cls, html) {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (cls) node.className = cls;
  if (html) node.innerHTML = html;
  return node;
}

function bindTap(node, fn) {
  node.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn(e);
  });
}

// Botao que fica "apertado" enquanto o dedo estiver nele (usado para correr).
function bindHold(node, onChange) {
  const release = () => {
    node.classList.remove("mb-down");
    onChange(false);
  };
  node.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    node.setPointerCapture(e.pointerId);
    node.classList.add("mb-down");
    onChange(true);
  });
  node.addEventListener("pointerup", release);
  node.addEventListener("pointercancel", release);
  node.addEventListener("lostpointercapture", release);
}

function emitKey(name) {
  if (scene && scene.input && scene.input.keyboard) {
    scene.input.keyboard.emit(`keydown-${name}`);
  }
}

function setStick(x, y) {
  stick.x = x;
  stick.y = y;
  ui.knob.style.transform = `translate(${x * STICK_RADIUS}px, ${y * STICK_RADIUS}px)`;
}

function setupMoveZone() {
  const zone = ui.move;

  zone.addEventListener("pointerdown", (e) => {
    if (stick.id !== null) return;
    e.preventDefault();
    stick.id = e.pointerId;
    stick.ox = e.clientX;
    stick.oy = e.clientY;
    zone.setPointerCapture(e.pointerId);
    ui.base.style.left = `${e.clientX}px`;
    ui.base.style.top = `${e.clientY}px`;
    ui.base.classList.remove("mb-hidden");
    ui.ghost.classList.add("mb-hidden");
    setStick(0, 0);
  });

  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stick.id) return;
    let dx = e.clientX - stick.ox;
    let dy = e.clientY - stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    setStick(dx / STICK_RADIUS, dy / STICK_RADIUS);
  });

  const end = (e) => {
    if (e.pointerId !== stick.id) return;
    stick.id = null;
    setStick(0, 0);
    ui.base.classList.add("mb-hidden");
    ui.ghost.classList.remove("mb-hidden");
  };
  zone.addEventListener("pointerup", end);
  zone.addEventListener("pointercancel", end);
}

// Arrastar o dedo no lado direito mira a lanterna naquela direcao.
function setupAimZone() {
  const zone = ui.aim;

  zone.addEventListener("pointerdown", (e) => {
    if (aim.id !== null) return;
    e.preventDefault();
    aim.id = e.pointerId;
    aim.ox = e.clientX;
    aim.oy = e.clientY;
    zone.setPointerCapture(e.pointerId);
  });

  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== aim.id || !scene) return;
    const dx = e.clientX - aim.ox;
    const dy = e.clientY - aim.oy;
    if (Math.hypot(dx, dy) > 14) scene.mobileAimAngle = Math.atan2(dy, dx);
  });

  const end = (e) => {
    if (e.pointerId !== aim.id) return;
    aim.id = null;
    if (scene) scene.mobileAimAngle = null;
  };
  zone.addEventListener("pointerup", end);
  zone.addEventListener("pointercancel", end);
}

function toggleFullscreen() {
  const doc = document;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    return;
  }
  const root = doc.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request) return;
  Promise.resolve(request.call(root))
    .then(() => screen.orientation?.lock?.("landscape"))
    .catch(() => {});
}

function build() {
  built = true;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = el("div", "mb-root", "mb-off");
  ui.root = root;

  ui.move = el("div", "mb-move", "mb-zone");
  ui.aim = el("div", "mb-aim", "mb-zone");
  ui.base = el("div", null, "mb-base mb-hidden");
  ui.knob = el("div", null, "mb-knob");
  ui.base.appendChild(ui.knob);
  ui.ghost = el("div", null, "mb-ghost");

  ui.act = el("div", "mb-act", "mb-btn", "<span>✋</span>AÇÃO");
  ui.run = el("div", "mb-run", "mb-btn", "<span>🏃</span>CORRER");
  ui.light = el("div", "mb-light", "mb-btn", "<span>🔦</span>");
  ui.crawl = el("div", "mb-crawl", "mb-btn mb-hidden", "<span>🐛</span>RASTEJAR");
  ui.exit = el("div", "mb-exit", "mb-small", "✕ SAIR");
  ui.full = el("div", "mb-full", "mb-small", "⛶ TELA CHEIA");

  root.append(
    ui.move,
    ui.aim,
    ui.ghost,
    ui.base,
    ui.act,
    ui.run,
    ui.light,
    ui.crawl,
    ui.exit,
    ui.full,
  );
  document.body.appendChild(root);

  const rotate = el("div", "mb-rotate", null, "<div>⟳</div>Gire o celular para o modo paisagem");
  document.body.appendChild(rotate);

  setupMoveZone();
  setupAimZone();

  bindTap(ui.act, () => {
    ui.act.classList.add("mb-down");
    setTimeout(() => ui.act.classList.remove("mb-down"), 120);
    emitKey("E");
  });
  bindTap(ui.light, () => emitKey("F"));
  bindTap(ui.crawl, () => emitKey("SPACE"));
  bindTap(ui.exit, () => {
    if (window.confirm("Sair da partida?")) emitKey("ESC");
  });
  bindTap(ui.full, toggleFullscreen);
  bindHold(ui.run, (down) => (virtual.run = down));

  // Mostra/esconde os controles conforme o estado do jogo.
  setInterval(refreshVisibility, 150);

  // Se a aba perder o foco com o dedo na tela, solta tudo.
  window.addEventListener("blur", () => {
    stick.id = null;
    aim.id = null;
    virtual.run = false;
    setStick(0, 0);
    if (scene) scene.mobileAimAngle = null;
  });
}

function refreshVisibility() {
  if (!scene || !scene.sys || !scene.sys.isActive()) {
    ui.root.classList.add("mb-off");
    return;
  }

  const lobby = net.lobbyOpen;
  const playing = scene.gameStarted && !scene.gameOver && !lobby;
  const waitingStart = !scene.gameStarted && !net.active && !lobby;

  ui.root.classList.toggle("mb-off", !playing && !waitingStart);

  for (const node of [ui.move, ui.aim, ui.ghost, ui.act, ui.run, ui.light, ui.exit]) {
    node.classList.toggle("mb-hidden", !playing || (node === ui.ghost && stick.id !== null));
  }
  ui.crawl.classList.toggle("mb-hidden", !(playing && scene.ventState === "hidden"));
  ui.full.classList.toggle("mb-hidden", !(playing || waitingStart));

  if (!playing && stick.id !== null) {
    stick.id = null;
    setStick(0, 0);
    ui.base.classList.add("mb-hidden");
  }
}

// Chamado em create() da cena, logo depois de this.keys ser criado.
export function attachMobileControls(s) {
  if (!isMobile) return;
  if (!built) build();

  scene = s;
  s.mobileControls = true;
  s.mobileAimAngle = null;
  virtual.run = false;
  stick.id = null;
  aim.id = null;
  setStick(0, 0);

  // O jogo continua lendo keys.X.isDown; aqui o toque vira "tecla apertada".
  const dir = {
    W: () => stick.y < -STICK_DEADZONE,
    UP: () => stick.y < -STICK_DEADZONE,
    S: () => stick.y > STICK_DEADZONE,
    DOWN: () => stick.y > STICK_DEADZONE,
    A: () => stick.x < -STICK_DEADZONE,
    LEFT: () => stick.x < -STICK_DEADZONE,
    D: () => stick.x > STICK_DEADZONE,
    RIGHT: () => stick.x > STICK_DEADZONE,
    SHIFT: () => virtual.run,
  };

  for (const [name, isVirtualDown] of Object.entries(dir)) {
    const key = s.keys[name];
    if (!key) continue;
    let real = false;
    Object.defineProperty(key, "isDown", {
      configurable: true,
      get: () => real || isVirtualDown(),
      set: (value) => {
        real = value;
      },
    });
  }

  s.events.once("shutdown", () => {
    if (scene === s) scene = null;
  });
}
