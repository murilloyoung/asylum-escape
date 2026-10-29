import { generateMapLayout, buildMap } from "./map.js";
import { installNunMethods } from "./nun.js";
import { installCatMethods, CAT_AI_DIFFICULTY } from "./cat.js";
import { installPlayerMethods } from "./player.js";
import { net } from "./net.js";
import { initLobby } from "./lobby.js";

// ==== MULTIPLAYER: AJUSTES (valores faceis de mexer) ====
const NET_SEND_MS = 66; // ~15 envios por segundo
const TEAM_DIFFICULTY = {
  // pesos da "eficiencia da equipe" (somam 1)
  weightProgress: 0.3, // velocidade media de progressao
  weightCohesion: 0.25, // proximidade em grupo
  weightNoise: 0.2, // ruido acumulado (tempo correndo)
  weightKeyTempo: 0.25, // tempo para achar as chaves
  // variacao da dificuldade por minuto: eficiencia 0 -> minimo, eficiencia 1 -> maximo
  ratePerMinuteMin: -0.35,
  ratePerMinuteMax: 1.6,
  smoothing: 0.15, // suavizacao (EMA) das metricas
  cohesionNear: 250, // distancia media em que a equipe e "colada"
  cohesionFar: 900, // distancia media em que a equipe esta dispersa
  keyTempoFastSec: 45, // achar chaves antes disso = pontuacao maxima
  keyTempoSlowSec: 285, // achar chaves depois disso = pontuacao zero
  deathLossFactor: 0.6, // cada morte alivia caughtLoss * fator
  lowAliveRatio: 0.5, // com menos da metade viva, o ganho de dificuldade cai
  lowAliveGainFactor: 0.5,
};

// O lobby (HTML) fica fora da cena para sobreviver aos reinicios.
let activeScene = null;
const lobby = initLobby({ onStart: () => activeScene?.startMultiplayerAsHost() });

// ==== NAV START ====
// GRADE DE NAVEGACAO (sem dependencia do Phaser)

class MinHeap {
  constructor() {
    this.items = [];
    this.keys = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, key) {
    const items = this.items;
    const keys = this.keys;
    let i = items.length;

    items.push(item);
    keys.push(key);

    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      items[i] = items[parent];
      keys[i] = keys[parent];
      i = parent;
    }

    items[i] = item;
    keys[i] = key;
  }

  pop() {
    const items = this.items;
    const keys = this.keys;
    const top = items[0];
    const lastItem = items.pop();
    const lastKey = keys.pop();
    const n = items.length;

    if (n > 0) {
      let i = 0;

      while (true) {
        let child = i * 2 + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= lastKey) break;
        items[i] = items[child];
        keys[i] = keys[child];
        i = child;
      }

      items[i] = lastItem;
      keys[i] = lastKey;
    }

    return top;
  }
}

const NAV_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

class NavGrid {
  // solids: [{left, right, top, bottom}] — inflate: margem de folga do corpo
  constructor(width, height, cellSize, solids, inflate) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.cellDoors = new Map();

    for (const r of solids) {
      this.forEachCell(r, inflate, (i) => {
        this.blocked[i] = 1;
      });
    }
  }

  forEachCell(rect, margin, fn) {
    const s = this.cellSize;
    const c0 = Math.max(0, Math.floor((rect.left - margin) / s));
    const c1 = Math.min(
      this.cols - 1,
      Math.ceil((rect.right + margin) / s) - 1,
    );
    const r0 = Math.max(0, Math.floor((rect.top - margin) / s));
    const r1 = Math.min(
      this.rows - 1,
      Math.ceil((rect.bottom + margin) / s) - 1,
    );

    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        fn(cy * this.cols + cx);
      }
    }
  }

  // door precisa ter isOpen e isLocked (lidos a cada consulta)
  addDoor(door, rect) {
    this.forEachCell(rect, 0, (i) => {
      if (!this.cellDoors.has(i)) this.cellDoors.set(i, []);
      this.cellDoors.get(i).push(door);
    });
  }

  isFree(cx, cy, blockClosedDoors = false) {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;

    const i = cy * this.cols + cx;
    if (this.blocked[i]) return false;

    const doors = this.cellDoors.get(i);
    if (doors) {
      for (const d of doors) {
        if (!d.isOpen && (d.isLocked || blockClosedDoors)) return false;
      }
    }

    return true;
  }

  toCell(x, y) {
    const s = this.cellSize;
    return {
      cx: Math.min(this.cols - 1, Math.max(0, Math.floor(x / s))),
      cy: Math.min(this.rows - 1, Math.max(0, Math.floor(y / s))),
    };
  }

  center(cx, cy) {
    const s = this.cellSize;
    return { x: (cx + 0.5) * s, y: (cy + 0.5) * s };
  }

  nearestFree(x, y, maxRing = 8, blockClosedDoors = false) {
    const { cx, cy } = this.toCell(x, y);

    if (this.isFree(cx, cy, blockClosedDoors)) return { cx, cy };

    for (let r = 1; r <= maxRing; r++) {
      let best = null;
      let bestD = Infinity;

      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.isFree(cx + dx, cy + dy, blockClosedDoors)) continue;

          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { cx: cx + dx, cy: cy + dy };
          }
        }
      }

      if (best) return best;
    }

    return null;
  }

  canStep(cx, cy, dx, dy, blockClosedDoors = false) {
    if (!this.isFree(cx + dx, cy + dy, blockClosedDoors)) return false;

    // sem cortar quina de parede na diagonal
    if (dx !== 0 && dy !== 0) {
      if (
        !this.isFree(cx + dx, cy, blockClosedDoors) ||
        !this.isFree(cx, cy + dy, blockClosedDoors)
      )
        return false;
    }

    return true;
  }

  // celulas alcancaveis a partir de um ponto (portas trancadas fechadas bloqueiam)
  reachable(x, y) {
    const start = this.nearestFree(x, y);
    if (!start) return null;

    const visited = new Uint8Array(this.cols * this.rows);
    const queue = [start.cy * this.cols + start.cx];
    visited[queue[0]] = 1;

    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head];
      const cx = cur % this.cols;
      const cy = (cur / this.cols) | 0;

      for (const [dx, dy] of NAV_DIRS) {
        if (!this.canStep(cx, cy, dx, dy)) continue;

        const ni = (cy + dy) * this.cols + (cx + dx);
        if (visited[ni]) continue;

        visited[ni] = 1;
        queue.push(ni);
      }
    }

    return visited;
  }

  isReached(visited, x, y) {
    if (!visited) return false;
    const { cx, cy } = this.toCell(x, y);
    return visited[cy * this.cols + cx] === 1;
  }

  findPath(sx, sy, tx, ty, blockClosedDoors = false) {
    const start = this.nearestFree(sx, sy, 8, blockClosedDoors);
    const goal = this.nearestFree(tx, ty, 8, blockClosedDoors);

    if (!start || !goal) return null;

    const cols = this.cols;
    const startI = start.cy * cols + start.cx;
    const goalI = goal.cy * cols + goal.cx;

    if (startI === goalI) return [this.center(goal.cx, goal.cy)];

    const n = cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();

    const heuristic = (cx, cy) => {
      const dx = Math.abs(cx - goal.cx);
      const dy = Math.abs(cy - goal.cy);
      return dx + dy + (1.414 - 2) * Math.min(dx, dy);
    };

    g[startI] = 0;
    heap.push(startI, heuristic(start.cx, start.cy));

    while (heap.size > 0) {
      const cur = heap.pop();

      if (closed[cur]) continue;
      closed[cur] = 1;

      if (cur === goalI) break;

      const cx = cur % cols;
      const cy = (cur / cols) | 0;

      for (const [dx, dy] of NAV_DIRS) {
        if (!this.canStep(cx, cy, dx, dy, blockClosedDoors)) continue;

        const nx = cx + dx;
        const ny = cy + dy;
        const ni = ny * cols + nx;

        if (closed[ni]) continue;

        const ng = g[cur] + (dx !== 0 && dy !== 0 ? 1.414 : 1);

        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + heuristic(nx, ny));
        }
      }
    }

    if (!closed[goalI]) return null;

    const cells = [];
    for (let i = goalI; i !== -1; i = came[i]) {
      cells.push(i);
    }
    cells.reverse();

    // remove pontos intermediarios em linha reta
    const points = [];
    let lastDx = null;
    let lastDy = null;

    for (let k = 0; k < cells.length; k++) {
      const cx = cells[k] % cols;
      const cy = (cells[k] / cols) | 0;

      if (k > 0 && k < cells.length - 1) {
        const nx = cells[k + 1] % cols;
        const ny = (cells[k + 1] / cols) | 0;
        const dx = nx - cx;
        const dy = ny - cy;

        if (dx === lastDx && dy === lastDy) continue;

        lastDx = dx;
        lastDy = dy;
      }

      points.push(this.center(cx, cy));
    }

    return points;
  }
}
// ==== NAV END ====

// ==== CONFIGURACAO DA DIFICULDADE E IA (valores faceis de ajustar) ====
const ENEMY_DIFFICULTY = {
  min: 0,
  max: 10,
  start: 2,
  adaptIntervalMs: 1000,
  survivalGainPerMinute: 0.45,
  followCatMultiplier: 1.5,
  itemGain: 0.25,
  escapeGain: 0.45,
  caughtLoss: 1.25,
  nearMissLoss: 0.2,
  nearMissDistance: 145,
  chaseEndNearMissMs: 4500,
  pathfindingThreshold: 5,
  pathfindingBlendRange: 1.2,
  debugRefreshMs: 160,
  visionHalfAngle: 1.1,
  patrolPoints: [
    { x: 280, y: 260 },
    { x: 700, y: 260 },
    { x: 1100, y: 260 },
    { x: 1500, y: 260 },
    { x: 2100, y: 260 },
    { x: 300, y: 700 },
    { x: 1100, y: 700 },
    { x: 1700, y: 700 },
    { x: 300, y: 1100 },
    { x: 1100, y: 1100 },
    { x: 1800, y: 1100 },
    { x: 2100, y: 1400 },
  ],
  values: {
    wanderSpeed: [55, 82],
    investigateSpeed: [76, 112],
    chaseSpeed: [98, 142],
    chaseSpeedWithKeyBonus: [18, 28],
    visionRange: [275, 430],
    runningVisionBonus: [65, 105],
    hearingRange: [260, 470],
    closeSense: [90, 145],
    chaseMemoryMs: [900, 4200],
    ventHuntMs: [25000, 50000],
    searchDurationMs: [2500, 8500],
    patrolWaitMs: [1500, 500],
    repathMs: [520, 280],
  },
};

// ==== VENT CONFIG ====
// Cada par de ventilacoes se liga: entra numa, sai na outra.
// (posicoes escolhidas para nao cair em cima de moveis, chaves ou paredes)
const VENT_PAIRS = [
  [
    { x: 380, y: 230 },
    { x: 130, y: 1090 },
  ],
  [
    { x: 800, y: 230 },
    { x: 1010, y: 1100 },
  ],
  [
    { x: 1660, y: 230 },
    { x: 600, y: 1105 },
  ],
  [
    { x: 2200, y: 230 },
    { x: 2100, y: 1400 },
  ],
];
// ==== VENT CONFIG END ====

class AsylumScene extends Phaser.Scene {
  constructor() {
    super("Asylum");
  }

  // data: { mp: true, setup? } quando a cena e (re)iniciada em modo multiplayer
  init(data) {
    this.mpData = data && data.mp ? data : null;
  }

  preload() {
    const playerPath = "assets/personagens/player/";
    for (const [key, file] of Object.entries({
      milaIdleLeft: "milaidleleft.png",
      milaIdleRight: "milaidleright.png",
      milaWalkLeft: "milawalkleft.png",
      milaWalkRight: "milawalkright.png",
      milaRunLeft: "milarunleft.png",
      milaRunRight: "milarunright.png",
    })) {
      this.load.spritesheet(key, playerPath + file, {
        frameWidth: 32,
        frameHeight: 32,
      });
    }
    this.load.spritesheet("freira", "assets/personagens/freira/freira.png", {
      frameWidth: 32,
      frameHeight: 36,
    });
    for (const [key, file] of [
      ["catGrey", "grey/Cat_Grey.png"],
      ["catGinger", "ginger/Cat_Ginger.png"],
      ["catMilena", "milena/milena.png"],
    ]) {
      this.load.spritesheet(key, `assets/personagens/gatos/${file}`, {
        frameWidth: 32,
        frameHeight: 32,
      });
    }
    this.load.image("insideTiles", "assets/mapa/Inside_C.png");
    this.load.image("chave", "assets/mapa/itens/chave.png");
    this.load.image("chaveMestra", "assets/mapa/itens/chaveMestra.png");
    this.load.audio("passos", "assets/audios/passos.mp3");
    this.load.audio("corrida", "assets/audios/corrida.mp3");
    this.load.audio("gritoFreira", "assets/audios/gritoFeira.mp3");
    this.load.audio("ambiente", "assets/audios/ambiente.mp3");
    this.load.audio("chase", "assets/audios/chase.mp3");
    this.load.audio("catMeow", "assets/audios/gatos/gatomiando.mp3");
    this.load.audio("catAngry", "assets/audios/gatos/gatobravo.mp3");
    this.load.audio("catScratch", "assets/audios/gatos/gatoarranhando.mp3");
  }

  create() {
    activeScene = this;

    // MULTIPLAYER: papel desta instancia (host = servidor autoritativo)
    this.mp = !!this.mpData && net.active;
    this.isHostMp = this.mp && net.isHost;
    this.isClientMp = this.mp && !net.isHost;
    this.netSetup = this.isClientMp ? this.mpData.setup : null;
    this.localDead = false;
    this.spectated = null;
    this.remotePlayers = new Map();
    this.netSendAt = 0;
    this.mpWaiting = null;
    this.teamHudAt = 0;
    this.spectateAt = 0;
    this.nunNetTarget = null;
    this.teamStats = {
      playSeconds: 0,
      dist: 0,
      noise: 0,
      lastPos: new Map(),
      progress: 0.5,
      cohesion: 0.5,
      noiseLevel: 0,
      tempo: 1,
      efficiency: 0.5,
      keyTimes: {},
      deaths: 0,
    };
    this.mpSlots = {};
    if (this.mp) {
      this.mpSlots = this.isClientMp
        ? this.netSetup.slots
        : Object.fromEntries(net.players.map((p, i) => [p.id, i]));
    }
    this.mpSlot = this.mp ? this.mpSlots[net.myId] || 0 : 0;

    this.gameOver = false;
    this.gameStarted = false;
    this.godMode = false;
    this.footstepSound = this.sound.add("passos", { loop: true, volume: 0.3 });
    this.runningSound = this.sound.add("corrida", { loop: true, volume: 0.35 });
    this.screamSound = this.sound.add("gritoFreira", { volume: 0.65 });
    this.ambientMusic = this.sound.add("ambiente", { loop: true, volume: 0.3 });
    this.chaseMusic = this.sound.add("chase", { loop: true, volume: 0.4 });
    this.hasKey = false;
    this.hasMasterKey = false;
    this.catMeowSound = this.sound.add("catMeow", { volume: 0.2 });
    this.catAngrySound = this.sound.add("catAngry", { volume: 0.25 });
    this.catScratchSound = this.sound.add("catScratch", { volume: 0.18 });
    this.catSoundCooldown = 0;
    this.cats = []; // sempre reiniciado: um unico gato e criado por partida

    this.mapLayout = this.netSetup ? this.netSetup.layout : generateMapLayout();
    this.mapWidth = this.mapLayout.width;
    this.mapHeight = this.mapLayout.height;
    this.worldDepth = (y) =>
      1 + (50 * Phaser.Math.Clamp(y, 0, this.mapHeight)) / this.mapHeight;
    this.characterDepth = 80;

    // Recortes do tileset: piso, camas, armarios e caixas do asilo.
    const insideTiles = this.textures.get("insideTiles");
    if (!insideTiles.has("floor")) {
      insideTiles.add("floor", 0, 144, 576, 96, 48);
      insideTiles.add("bloodFloor", 0, 240, 576, 48, 48);
      insideTiles.add("wall", 0, 0, 528, 96, 96);
      insideTiles.add("bedA", 0, 60, 28, 72, 68);
      insideTiles.add("bedB", 0, 156, 28, 72, 68);
      insideTiles.add("locker", 0, 248, 28, 32, 72);
      insideTiles.add("crateA", 0, 16, 212, 52, 68);
      insideTiles.add("crateB", 0, 104, 216, 40, 64);
    }

    // JOGADOR
    this.walkSpeed = 145;
    this.runSpeed = 205;
    this.stamina = 100;
    this.staminaLocked = false;
    this.playerRunning = false;
    this.playerFacingAngle = 0;
    this.lastPointerMoveAt = -10000;

    // FREIRA (velocidades, visao e audicao vem de adaptiveTuning)
    this.nunState = "patrol"; // patrol | investigate | chase | search | ventHunt
    this.nunFov = ENEMY_DIFFICULTY.visionHalfAngle; // meio angulo de visao (rad)
    this.nunCloseSense = 120; // percebe o jogador perto, mesmo de costas
    this.nunFacing = Math.PI;
    this.nunDest = null;
    this.nunPath = [];
    this.nunPathFailed = false;
    this.nunRepathAt = 0;
    this.nunWaitUntil = 0;
    this.nunSearchUntil = 0;
    this.nunLastSeen = { x: 0, y: 0 };
    this.nunLastSeenAt = 0;
    this.nunMoving = false;
    this.nunLastPos = { x: 1550, y: 1000 };
    this.nunStuckCheckAt = 0;
    this.nunHunt = null; // quando ela viu voce entrar numa ventilacao
    this.difficulty = Phaser.Math.Clamp(
      // multiplayer sempre comeca do zero (a dificuldade e da equipe, nao do jogador)
      (this.mp ? null : this.registry.get("enemyDifficulty")) ??
        ENEMY_DIFFICULTY.start,
      ENEMY_DIFFICULTY.min,
      ENEMY_DIFFICULTY.max,
    );
    this.difficultyPlaySeconds = 0;
    this.difficultyNextUpdate = 0;
    this.difficultyItems = 0;
    this.difficultyEscapes = 0;
    this.difficultyCatches = 0;
    this.difficultyNearMisses = 0;
    this.difficultyFollowMultiplier = 1;
    this.nunChaseStartedAt = 0;
    this.nunNearMissCounted = false;
    this.pathfindingBlend = 0;
    this.adaptiveTuning = null;
    // Calcula os parametros ja na criacao, para adaptiveTuning nunca ficar nulo.
    this.refreshDifficultyTuning();
    this.debugEnemyAI = false;
    this.debugDrawAt = 0;
    this.debugCommand = "";
    this.debugCommandMessage = "Clique aqui para digitar: difficulty 0-10";
    this.debugCommandFocused = false;

    // VENTILACOES
    this.ventState = "none"; // none | hidden | crawling
    this.ventAt = null;
    this.ventCooldownUntil = 0;
    this.crawlDuration = 2000;
    this.breath = 100; // "ar" para ficar escondido (acaba em ~8s)
    this.crawlTween = null;
    this.ventEscapePending = false;

    // LANTERNA
    this.lightRange = 200;
    this.lightHalfAngle = 0.48;
    this.lightRayCount = 90;
    this.ambientRange = 100;
    this.lightDipUntil = 0;
    this.flashlightOn = true;
    this.statusUntil = 0;

    buildMap(this, { NavGrid, ENEMY_DIFFICULTY, VENT_PAIRS });
    if (this.mp) this.setupMultiplayer();

    // CONTROLES
    this.keys = this.input.keyboard.addKeys(
      "W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,E,F,SPACE",
    );

    // HOTBAR: nove espacos centralizados na parte inferior, como no Minecraft.
    this.hotbar = this.add.graphics().setScrollFactor(0).setDepth(99);
    const hotbarSlotSize = 44;
    const hotbarGap = 4;
    const hotbarWidth = hotbarSlotSize * 9 + hotbarGap * 8;
    const hotbarX = (this.scale.width - hotbarWidth) / 2;
    const hotbarY = this.scale.height - hotbarSlotSize - 14;

    for (let slot = 0; slot < 9; slot++) {
      const x = hotbarX + slot * (hotbarSlotSize + hotbarGap);
      this.hotbar.fillStyle(0x171716, 0.82);
      this.hotbar.fillRect(x, hotbarY, hotbarSlotSize, hotbarSlotSize);
      this.hotbar.lineStyle(
        slot === 0 ? 2 : 1,
        slot === 0 ? 0xf0d58a : 0x77736b,
        0.95,
      );
      this.hotbar.strokeRect(x, hotbarY, hotbarSlotSize, hotbarSlotSize);
    }

    const hotbarCenterY = hotbarY + hotbarSlotSize / 2;
    const firstSlotCenterX = hotbarX + hotbarSlotSize / 2;
    const secondSlotCenterX =
      hotbarX + hotbarSlotSize + hotbarGap + hotbarSlotSize / 2;

    this.normalKeyIndicator = this.add
      .image(firstSlotCenterX, hotbarCenterY, "chave")
      .setDisplaySize(16, 36)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);
    this.masterKeyIndicator = this.add
      .image(secondSlotCenterX, hotbarCenterY, "chaveMestra")
      .setDisplaySize(16, 36)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);

    // O MOUSE MANDA NA LANTERNA QUANDO ESTA SENDO USADO
    this.input.on("pointermove", () => {
      this.lastPointerMoveAt = this.time.now;
    });

    // TECLA E: ABRIR E FECHAR PORTAS
    this.input.keyboard.on("keydown-E", () => this.onInteract());
    this.input.keyboard.on("keydown-F", () => {
      this.flashlightOn = !this.flashlightOn;
      this.say(`Lanterna ${this.flashlightOn ? "ligada" : "desligada"}.`, 1400);
    });
    this.input.keyboard.on("keydown-F4", () => {
      this.godMode = !this.godMode;
      this.say(`God mode ${this.godMode ? "ativado" : "desativado"}.`, 2200);
    });

    // ESPACO: RASTEJAR ATE A OUTRA VENTILACAO (quando escondido)
    this.input.keyboard.on("keydown-SPACE", () => this.onSpacePressed());

    // CAMERA
    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // TEXTURA DA ILUMINACAO (reaproveitada ao reiniciar a cena)
    const darkKey = "asylumDarkness";

    this.darkTexture = this.textures.exists(darkKey)
      ? this.textures.get(darkKey)
      : this.textures.createCanvas(
          darkKey,
          this.scale.width,
          this.scale.height,
        );

    this.darkContext = this.darkTexture.getContext();

    this.darkness = this.add.image(0, 0, darkKey);
    this.darkness.setOrigin(0, 0).setScrollFactor(0).setDepth(90);

    // INTERFACE
    this.heart = this.add
      .text(36, 31, "♥", {
        fontSize: "32px",
        color: "#e54444",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(100);

    this.staminaBar = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.breathBar = this.add.graphics().setScrollFactor(0).setDepth(100);

    this.status = this.add
      .text(20, 60, "", {
        fontSize: "16px",
        color: "#eeeeee",
        stroke: "#000000",
        strokeThickness: 3,
        padding: { x: 9, y: 7 },
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.add
      .text(940, 14, "ASYLUM ESCAPE", {
        fontFamily: "Georgia",
        fontSize: "28px",
        color: "#bb4545",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100);

    this.doorHint = this.add
      .text(480, 458, "", {
        fontSize: "16px",
        align: "center",
        color: "#ffffff",
        backgroundColor: "#111111dd",
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(110);

    this.teamText = this.add
      .text(940, 48, "", {
        fontSize: "13px",
        color: "#d8d2c2",
        align: "right",
        stroke: "#000000",
        strokeThickness: 3,
        lineSpacing: 2,
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(this.mp);

    this.createEnemyDebug();
    this.drawStamina();
    this.updateLighting(0, 0);
    // no multiplayer o menu inicial e pulado: a partida comeca pelo lobby
    if (!this.mp) {
      this.createMainMenu();

      // Quem esta no lobby (menu) como cliente entra na partida quando o host inicia.
      const offStart = net.on("msg", (id, msg) => {
        if (msg.t !== "start" || !net.active || net.isHost) return;
        lobby.close();
        net.inGame = true;
        this.scene.restart({ mp: true, setup: msg.setup });
      });
      this.events.once("shutdown", offStart);
    } else {
      this.say("Sincronizando com a sala...", 8000);
    }
  }

  // ---------------------------------------------------------------
  // UTILIDADES
  // ---------------------------------------------------------------

  say(text, duration = 3500) {
    this.status.setText(text).setVisible(true);
    this.statusUntil = this.time.now + duration;
  }

  createMainMenu() {
    const menu = (this.mainMenu = this.add
      .container(0, 0)
      .setScrollFactor(0)
      .setDepth(200));
    const add = (object) => {
      menu.add(object.setScrollFactor(0));
      return object;
    };

    add(this.add.rectangle(480, 280, 960, 560, 0x08090c, 0.96));
    add(this.add.rectangle(52, 280, 4, 430, 0x9c3434));

    add(
      this.add.text(78, 66, "ASILO · NOITE 01", {
        fontFamily: "Arial",
        fontSize: "13px",
        color: "#c8b98e",
        letterSpacing: 3,
      }),
    );
    add(
      this.add.text(76, 132, "ASYLUM\nESCAPE", {
        fontFamily: "Georgia",
        fontSize: "58px",
        color: "#eee8d9",
        lineSpacing: -10,
      }),
    );
    add(
      this.add.text(80, 292, "Encontre as chaves. Encontre a saída.", {
        fontFamily: "Arial",
        fontSize: "17px",
        color: "#aaa69d",
      }),
    );

    const startFrame = add(
      this.add
        .rectangle(276, 395, 400, 58, 0x241718)
        .setStrokeStyle(1, 0x9c3434),
    );
    const startPrompt = add(
      this.add
        .text(276, 395, "APERTE ESPAÇO PARA INICIAR", {
          fontFamily: "Arial",
          fontSize: "17px",
          fontStyle: "bold",
          color: "#f1e6ce",
        })
        .setOrigin(0.5),
    );
    this.tweens.add({
      targets: [startFrame, startPrompt],
      alpha: { from: 0.72, to: 1 },
      duration: 900,
      yoyo: true,
      repeat: -1,
    });

    // BOTAO MULTIPLAYER (abre o lobby HTML)
    const multiplayerButton = add(
      this.add
        .rectangle(276, 448, 400, 40, 0x171a22)
        .setStrokeStyle(1, 0x5d6f8f)
        .setInteractive({ useHandCursor: true }),
    );
    add(
      this.add
        .text(276, 448, "MULTIPLAYER", {
          fontFamily: "Arial",
          fontSize: "15px",
          fontStyle: "bold",
          color: "#cfd8ea",
          letterSpacing: 2,
        })
        .setOrigin(0.5),
    );
    multiplayerButton.on("pointerover", () =>
      multiplayerButton.setFillStyle(0x27304a),
    );
    multiplayerButton.on("pointerout", () =>
      multiplayerButton.setFillStyle(0x171a22),
    );
    multiplayerButton.on("pointerdown", () => lobby.open());

    add(
      this.add.text(80, 490, "WASD / SETAS  mover     SHIFT  correr", {
        fontFamily: "Arial",
        fontSize: "13px",
        color: "#8f8d88",
      }),
    );
    add(
      this.add.text(80, 513, "E  interagir     ESPAÇO  rastejar", {
        fontFamily: "Arial",
        fontSize: "13px",
        color: "#8f8d88",
      }),
    );

    add(
      this.add
        .rectangle(752, 280, 360, 448, 0x111214, 0.98)
        .setStrokeStyle(1, 0x49433a),
    );
    add(
      this.add.text(598, 76, "ATUALIZAÇÕES", {
        fontFamily: "Arial",
        fontSize: "16px",
        fontStyle: "bold",
        color: "#d3bd87",
        letterSpacing: 2,
      }),
    );

    const suggestionsButton = add(
      this.add
        .rectangle(839, 77, 170, 34, 0x392020)
        .setStrokeStyle(1, 0x9c3434)
        .setInteractive({ useHandCursor: true }),
    );
    add(
      this.add
        .text(839, 77, "FAÇA SUGESTÕES", {
          fontFamily: "Arial",
          fontSize: "12px",
          fontStyle: "bold",
          color: "#eadfca",
        })
        .setOrigin(0.5),
    );
    suggestionsButton.on("pointerover", () =>
      suggestionsButton.setFillStyle(0x612b2b),
    );
    suggestionsButton.on("pointerout", () =>
      suggestionsButton.setFillStyle(0x392020),
    );
    suggestionsButton.on("pointerdown", () => {
      window.open(
        "https://github.com/murilloyoung/asylum-escape/issues",
        "_blank",
        "noopener,noreferrer",
      );
    });
    add(
      this.add.text(598, 102, "O QUE MUDOU", {
        fontFamily: "Arial",
        fontSize: "11px",
        color: "#77746e",
        letterSpacing: 2,
      }),
    );

    const updates = [
      [
        "MULTIPLAYER",
        "Crie uma sala, passe o código e fujam juntos. A freira aprende com a equipe.",
      ],
      [
        "MAPA AMPLIADO",
        "Novas alas a leste e ao sul, com uma saída mais distante.",
      ],
      ["VENTILAÇÃO", "O ar também diminui durante a travessia entre dutos."],
      ["HOTBAR", "As chaves aparecem nos primeiros espaços da barra."],
      [
        "LUZ E CENÁRIO",
        "Alcance da lanterna ajustado; personagem à frente dos objetos.",
      ],
    ];

    updates.forEach(([title, description], index) => {
      const y = 150 + index * 70;
      add(this.add.circle(604, y + 6, 3, 0x9c3434));
      add(
        this.add.text(618, y - 5, title, {
          fontFamily: "Arial",
          fontSize: "13px",
          fontStyle: "bold",
          color: "#e0d7c4",
        }),
      );
      add(
        this.add.text(618, y + 17, description, {
          fontFamily: "Arial",
          fontSize: "12px",
          color: "#96938c",
          wordWrap: { width: 286 },
          lineSpacing: 3,
        }),
      );
    });
  }

  drawStamina() {
    const g = this.staminaBar;

    g.clear();
    g.fillStyle(0x000000, 0.55);
    g.fillRect(62, 26, 150, 10);
    g.fillStyle(this.staminaLocked ? 0xaa3333 : 0xd8c18a, 0.9);
    g.fillRect(62, 26, (150 * this.stamina) / 100, 10);
    g.lineStyle(1, 0x777368, 0.8);
    g.strokeRect(62, 26, 150, 10);
    g.setAlpha(this.stamina >= 100 ? 0.35 : 1);
  }

  // lista de obstaculos usada pela lanterna e pela visao da freira
  rebuildObstacles() {
    this.obstacleRects = this.wallRects.concat(
      this.furnitureRects || [],
      this.doors.filter((d) => !d.isOpen).map((d) => d.rect),
    );
  }

  // distancia do ponto ate o retangulo da porta (ponto mais proximo)
  distanceToDoor(door, x, y) {
    const r = door.rect;
    const cx = Phaser.Math.Clamp(x, r.left, r.right);
    const cy = Phaser.Math.Clamp(y, r.top, r.bottom);

    return Phaser.Math.Distance.Between(x, y, cx, cy);
  }

  getNearbyDoor(maxDistance = 55) {
    let nearest = null;
    let nearestDistance = maxDistance;

    for (const door of this.doors) {
      const distance = this.distanceToDoor(door, this.player.x, this.player.y);

      if (distance <= nearestDistance) {
        nearest = door;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  setDoorOpen(door, open, fromNet = false) {
    door.isOpen = open;
    door.setVisible(!open);
    door.body.enable = !open;

    if (!open) door.body.updateFromGameObject();

    for (const detail of door.decorations) {
      detail.setVisible(!open);
    }

    this.rebuildObstacles();
    if (this.mp && !fromNet) this.netSendDoor(door);
  }

  // ---------------------------------------------------------------
  // MULTIPLAYER: PORTAS, CHAVES E JOGADORES
  // ---------------------------------------------------------------

  localPlayerId() {
    return this.mp ? net.myId : "local";
  }

  netBroadcast(msg, exceptId = null) {
    if (this.isHostMp) net.broadcast(msg, exceptId);
  }

  netSendDoor(door) {
    const msg = {
      t: "door",
      i: door.doorIndex,
      open: door.isOpen,
      locked: door.isLocked,
    };
    if (this.isHostMp) net.broadcast(msg);
    else if (this.isClientMp) net.sendToHost(msg);
  }

  applyDoorState(index, open, locked) {
    const door = this.doors[index];
    if (!door) return;
    if (!locked && door.isLocked) this.unlockDoor(door);
    if (door.isOpen !== open) this.setDoorOpen(door, open, true);
  }

  // dificuldade: eventos individuais pesam menos quando ha varios jogadores
  difficultyScale() {
    if (!this.mp) return 1;
    return 1 / Math.sqrt(Math.max(1, this.getPlayerStates().length));
  }

  eventDifficulty(amount) {
    this.changeDifficulty(amount * this.difficultyScale());
  }

  // Lista unificada dos jogadores vivos (local + remotos). Usada pela IA da freira.
  getPlayerStates() {
    const list = [];
    if (!this.localDead) {
      list.push({
        id: this.localPlayerId(),
        x: this.player.x,
        y: this.player.y,
        running: this.playerRunning,
        ventState: this.ventState,
        ventAt: this.ventAt,
        facing: this.playerFacingAngle,
        flashlightOn: this.flashlightOn,
      });
    }
    if (this.mp) {
      for (const g of this.remotePlayers.values()) {
        if (g.dead || g.left) continue;
        list.push({
          id: g.id,
          x: g.container.x,
          y: g.container.y,
          running: g.running,
          ventState: g.ventState,
          ventAt: g.ventAt,
          facing: g.facing,
          flashlightOn: g.flashlightOn,
        });
      }
    }
    return list;
  }

  // coleta de chave: compartilhada por toda a equipe
  collectKey(which, opts = {}) {
    if (this.gameOver) return;
    const item = which === "master" ? this.masterKeyItem : this.keyItem;
    if (!item || item.collected) return;

    item.collected = true;
    item.destroy();

    if (this.mp) {
      if (this.isHostMp) net.broadcast({ t: "key", which }, opts.fromId ?? null);
      else if (!opts.fromNet) net.sendToHost({ t: "key", which });
    }

    if (which === "normal") {
      this.hasKey = true;
      this.catGuideTarget = this.masterKeySpot;
      this.normalKeyIndicator.setVisible(true);
      this.say(
        "A equipe encontrou a chave das portas! A freira ouviu o barulho...",
        5000,
      );
    } else {
      this.hasMasterKey = true;
      this.masterKeyIndicator.setVisible(true);
      this.catGuideTarget = { x: 2290, y: 1470 };
      this.say("A chave mestra foi encontrada. Alcancem a saida!", 5000);
    }

    // efeitos na IA: so o host (ou o jogo solo) mexe na freira e na dificuldade
    if (this.mp && !this.isHostMp) return;
    this.difficultyItems++;
    this.eventDifficulty(ENEMY_DIFFICULTY.itemGain);
    this.teamStats.keyTimes[which] = this.teamStats.playSeconds;

    if (which === "normal" && this.nunState === "patrol") {
      const pos = opts.pos || { x: this.player.x, y: this.player.y };
      this.setNunState("investigate");
      this.setNunDestination(pos.x, pos.y);
    }
  }

  onExitReached() {
    if (!this.mp) {
      if (this.hasMasterKey) this.finish(true);
      else this.say("A saida precisa da chave mestra.");
      return;
    }
    if (!this.hasMasterKey) {
      this.say("A saida precisa da chave mestra.");
      return;
    }
    if (this.isHostMp) this.finish(true, "Sua equipe escapou do asilo!");
    else net.sendToHost({ t: "exit" });
  }

  onPlayerCaught(id, message) {
    if (!this.mp) {
      this.finish(false, message);
      return;
    }
    this.killPlayer(id, message);
  }

  unlockDoor(door) {
    door.isLocked = false;
    door.setFillStyle(0x966033);
    door.setStrokeStyle(4, 0xf0c778);

    if (door.lockIcon) {
      door.decorations = door.decorations.filter((d) => d !== door.lockIcon);
      door.lockIcon.destroy();
      door.lockIcon = null;
    }
  }

  // nao deixa fechar a porta com alguem em cima
  canCloseDoor(door) {
    const r = door.rect;
    const pad = 6;

    const hit = (obj, hw, hh) =>
      obj.x + hw + pad > r.left &&
      obj.x - hw - pad < r.right &&
      obj.y + hh + pad > r.top &&
      obj.y - hh - pad < r.bottom;

    for (const g of this.remotePlayers.values()) {
      if (!g.dead && !g.left && hit(g.container, 11, 15)) return false;
    }

    return !hit(this.player, 11, 15) && !hit(this.nun, 13, 19);
  }

  interactWithDoor() {
    if (this.gameOver) return;

    const door = this.getNearbyDoor(55);

    if (!door) {
      this.say("Chegue perto de uma porta para usar E.");
      return;
    }

    // FECHAR PORTA
    if (door.isOpen) {
      if (!this.canCloseDoor(door)) {
        this.say("Tem alguém no caminho da porta.");
        return;
      }

      this.setDoorOpen(door, false);
      this.say("Você fechou a porta.");
      return;
    }

    // PORTA TRANCADA SEM CHAVE
    if (door.isLocked && !this.hasKey) {
      this.say("Porta trancada! Voce precisa da chave comum.");
      return;
    }

    // ABRIR PORTA (destranca de vez se estava trancada)
    const wasLocked = door.isLocked;

    if (wasLocked) this.unlockDoor(door);

    this.setDoorOpen(door, true); // no multiplayer isso avisa os outros jogadores
    this.say(
      wasLocked ? "Você destrancou e abriu a porta." : "Você abriu a porta.",
    );
  }

  // ---------------------------------------------------------------
  // GATO (exatamente um por partida)
  // ---------------------------------------------------------------

  createVentTexture() {
    if (this.textures.exists("ventilacao")) return;

    const w = 56;
    const h = 40;
    const g = this.make.graphics({ x: 0, y: 0, add: false });

    g.fillStyle(0x23221f, 1);
    g.fillRect(0, 0, w, h);
    g.fillStyle(0x77736a, 1);
    g.fillRect(2, 2, w - 4, h - 4);
    g.fillStyle(0x07070a, 1);
    g.fillRect(5, 5, w - 10, h - 10);
    g.fillStyle(0x8c887d, 1);

    for (let i = 0; i < 4; i++) {
      g.fillRect(10 + i * 12, 5, 4, h - 10);
    }

    g.fillStyle(0x3a3833, 1);
    g.fillRect(5, h - 8, w - 10, 3);

    g.generateTexture("ventilacao", w, h);
    g.destroy();
  }

  ventPartner(vent) {
    return this.vents.find((v) => v.pair === vent.pair && v.side !== vent.side);
  }

  getNearbyVent(maxDistance = 46) {
    let nearest = null;
    let nearestDistance = maxDistance;

    for (const vent of this.vents) {
      const d = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        vent.x,
        vent.y,
      );

      if (d <= nearestDistance) {
        nearest = vent;
        nearestDistance = d;
      }
    }

    return nearest;
  }

  // tecla E: sair da ventilacao, entrar numa ou usar uma porta
  onInteract() {
    if (
      this.gameOver ||
      !this.gameStarted ||
      this.debugCommandFocused ||
      this.localDead
    )
      return;

    if (this.ventState === "hidden") {
      this.exitVent(false);
      return;
    }

    if (this.ventState === "crawling") return;

    const vent = this.getNearbyVent(46);

    if (vent) {
      this.enterVent(vent);
      return;
    }

    this.interactWithDoor();
  }

  // tecla ESPACO: rastejar ate a outra ponta
  onSpacePressed() {
    if (this.gameOver || this.debugCommandFocused || net.lobbyOpen) return;

    if (!this.gameStarted) {
      // dentro de uma sala, quem inicia a partida e o host pelo lobby
      if (this.mp || net.active) return;
      this.gameStarted = true;
      this.mainMenu.setVisible(false);
      this.ambientMusic.play();
      this.say("Encontre a chave e escape.", 6000);
      return;
    }

    this.onCrawlKey();
  }

  onCrawlKey() {
    if (this.gameOver || !this.gameStarted || this.ventState !== "hidden")
      return;

    this.crawlVent();
  }

  // barulho: se a freira estiver perto e distraida, ela vai investigar
  makeNoise(x, y, radius) {
    const d = Phaser.Math.Distance.Between(this.nun.x, this.nun.y, x, y);

    if (
      d <= radius &&
      ["patrol", "search", "investigate"].includes(this.nunState)
    ) {
      this.setNunState("investigate");
      this.setNunDestination(x, y);
      return true;
    }

    return false;
  }

  enterVent(vent) {
    const now = this.time.now;

    if (now < this.ventCooldownUntil) return;

    if (this.breath < 25) {
      this.say("Você está sem fôlego para entrar agora.");
      return;
    }

    // ela te viu entrar? (confere antes de sumir; no cliente quem decide e o host)
    let outcome = "quiet";
    if (this.isClientMp) {
      net.sendToHost({
        t: "vent",
        pair: vent.pair,
        side: vent.side,
        running: this.playerRunning,
      });
    } else {
      outcome = this.nunReactToVentEntry(
        {
          id: this.localPlayerId(),
          x: this.player.x,
          y: this.player.y,
          running: this.playerRunning,
        },
        vent,
      );
    }
    this.ventEscapePending =
      this.nunState === "chase" || this.nunState === "ventHunt";

    this.ventState = "hidden";
    this.ventAt = vent;
    this.playerRunning = false;

    this.player.setPosition(vent.x, vent.y);
    this.player.body.setVelocity(0, 0);
    this.player.body.enable = false;
    this.player.setVisible(false);

    this.showVentOutcome(outcome);
  }

  showVentOutcome(outcome) {
    if (outcome === "saw") {
      this.say("A freira viu você entrar na ventilação!", 3500);
      this.cameras.main.shake(180, 0.005);
    } else if (outcome === "heard") {
      this.say("A ventilação rangeu... a freira ouviu!", 3000);
    } else {
      this.say("Você entrou na ventilação.", 2500);
    }
  }

  crawlVent() {
    const from = this.ventAt;
    const to = this.ventPartner(from);

    this.ventState = "crawling";
    this.say("Você rasteja pelo duto...", this.crawlDuration);

    this.crawlTween = this.tweens.add({
      targets: this.player,
      x: to.x,
      y: to.y,
      duration: this.crawlDuration,
      ease: "Sine.easeInOut",
      onComplete: () => {
        if (this.gameOver) return;

        this.crawlTween = null;
        this.ventState = "hidden";
        this.ventAt = to;
        if (this.ventEscapePending) {
          if (this.isClientMp) {
            net.sendToHost({ t: "escape" });
          } else {
            this.difficultyEscapes++;
            this.eventDifficulty(ENEMY_DIFFICULTY.escapeGain);
          }
          this.ventEscapePending = false;
        }
        this.say("Você chegou na outra ventilação.", 2500);
      },
    });
  }

  exitVent(force) {
    const v = this.ventAt;

    if (!v) return;

    // nao sai com a freira em cima da ventilacao
    if (
      !force &&
      Phaser.Math.Distance.Between(this.nun.x, this.nun.y, v.x, v.y) < 70
    ) {
      this.say("A freira está bem ali! Espere ela se afastar.");
      return;
    }

    this.ventState = "none";
    this.ventAt = null;

    this.player.setPosition(v.x, v.y);
    this.player.setVisible(true);
    this.player.body.enable = true;
    this.player.body.updateFromGameObject();
    this.player.body.setVelocity(0, 0);

    this.ventCooldownUntil = this.time.now + 900;

    if (force) {
      this.say("Sem ar! Você saiu tossindo.");
      if (this.isClientMp) {
        net.sendToHost({ t: "noise", x: v.x, y: v.y, r: 360 });
      } else {
        this.makeNoise(v.x, v.y, 360);
      }
    }
  }

  // o ar acaba escondido; fora da ventilacao ele volta
  updateVent(time, dt) {
    if (this.ventState === "hidden" || this.ventState === "crawling") {
      this.breath = Math.max(0, this.breath - 12.5 * dt);

      // Wait until the crawl tween reaches the other vent before forcing an exit.
      if (this.breath <= 0 && this.ventState === "hidden") this.exitVent(true);
    } else if (this.ventState === "none") {
      this.breath = Math.min(100, this.breath + 15 * dt);
    }
  }

  updateHint() {
    let text = "";

    if (this.ventState === "hidden") {
      text = "ESPAÇO — RASTEJAR ATÉ A OUTRA VENTILAÇÃO\nE — SAIR DAQUI";
    } else if (this.ventState === "crawling") {
      text = "RASTEJANDO...";
    } else {
      const vent = this.getNearbyVent(46);
      const door = this.getNearbyDoor(55);

      if (vent) {
        text = "E — ENTRAR NA VENTILAÇÃO";
      } else if (door) {
        text = door.isOpen
          ? "E — FECHAR PORTA"
          : door.isLocked && !this.hasKey
            ? "PORTA TRANCADA - ENCONTRE A CHAVE COMUM"
            : "E — ABRIR PORTA";
      }
    }

    this.doorHint.setText(text);
  }

  drawBreath() {
    const g = this.breathBar;

    g.clear();

    if (this.breath >= 100 && this.ventState === "none") return;

    g.fillStyle(0x000000, 0.55);
    g.fillRect(62, 50, 150, 6);
    g.fillStyle(this.breath < 25 ? 0xaa3333 : 0x7fa9b3, 0.9);
    g.fillRect(62, 50, (150 * this.breath) / 100, 6);
    g.lineStyle(1, 0x777368, 0.8);
    g.strokeRect(62, 50, 150, 6);
  }

  // ---------------------------------------------------------------
  // RAIOS (lanterna e visao da freira)
  // ---------------------------------------------------------------

  // distancia ate o primeiro obstaculo na direcao do angulo (calculo exato, sem passos)
  rayDistance(ox, oy, angle, maxDist) {
    const rects = this.obstacleRects;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let best = maxDist;

    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      let tmin = 0;
      let tmax = best;

      if (Math.abs(dx) < 1e-9) {
        if (ox < r.left || ox > r.right) continue;
      } else {
        let t1 = (r.left - ox) / dx;
        let t2 = (r.right - ox) / dx;

        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }

        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }

      if (Math.abs(dy) < 1e-9) {
        if (oy < r.top || oy > r.bottom) continue;
      } else {
        let t1 = (r.top - oy) / dy;
        let t2 = (r.bottom - oy) / dy;

        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }

        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) continue;
      }

      if (tmin < best) best = tmin;
    }

    return best;
  }

  hasLineOfSight(x1, y1, x2, y2) {
    const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const angle = Math.atan2(y2 - y1, x2 - x1);

    return this.rayDistance(x1, y1, angle, dist) >= dist - 1;
  }

  // poligono de visibilidade (em coordenadas de tela)
  buildVisibility(angle, halfAngle, range, rayCount, camera) {
    const px = this.player.x;
    const py = this.player.y;
    const points = [];

    for (let i = 0; i <= rayCount; i++) {
      const a = angle - halfAngle + (i / rayCount) * halfAngle * 2;
      const d = this.rayDistance(px, py, a, range);

      points.push({
        x: px + Math.cos(a) * d - camera.scrollX,
        y: py + Math.sin(a) * d - camera.scrollY,
      });
    }

    return points;
  }

  // ---------------------------------------------------------------
  // LANTERNA
  // ---------------------------------------------------------------

  carveLight(sx, sy, points, range, innerRadius, strength) {
    const ctx = this.darkContext;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx, sy);

    for (const p of points) ctx.lineTo(p.x, p.y);

    ctx.closePath();
    ctx.clip();

    const gradient = ctx.createRadialGradient(
      sx,
      sy,
      innerRadius,
      sx,
      sy,
      range,
    );

    gradient.addColorStop(0, `rgba(0,0,0,${strength})`);
    gradient.addColorStop(0.55, `rgba(0,0,0,${strength})`);
    gradient.addColorStop(0.8, `rgba(0,0,0,${strength * 0.85})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.scale.width, this.scale.height);
    ctx.restore();
  }

  tintLight(sx, sy, points, range) {
    const ctx = this.darkContext;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(sx, sy);

    for (const p of points) ctx.lineTo(p.x, p.y);

    ctx.closePath();
    ctx.clip();

    const gradient = ctx.createRadialGradient(sx, sy, 10, sx, sy, range);

    gradient.addColorStop(0, "rgba(255,214,140,0.16)");
    gradient.addColorStop(1, "rgba(255,214,140,0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.scale.width, this.scale.height);
    ctx.restore();
  }

  // fear: 0..1 (quanto mais perto a freira, mais a luz falha)
  updateLighting(now, fear) {
    if (!this.darkContext || !this.player) return;

    // espectador (capturado no multiplayer): sem escuridao, ve tudo
    if (this.localDead) {
      this.darkContext.clearRect(0, 0, this.scale.width, this.scale.height);
      this.darkTexture.refresh();
      return;
    }

    const ctx = this.darkContext;
    const width = this.scale.width;
    const height = this.scale.height;
    const camera = this.cameras.main;

    const sx = this.player.x - camera.scrollX;
    const sy = this.player.y - camera.scrollY;

    // OSCILACAO E FALHAS DA LUZ
    let flicker =
      1 + Math.sin(now * 0.013) * 0.015 + Math.sin(now * 0.031) * 0.01;

    if (now < this.lightDipUntil) {
      flicker *= 0.45;
    } else if (fear > 0.1 && Math.random() < 0.02 * fear) {
      this.lightDipUntil = now + Phaser.Math.Between(60, 170);
    }

    const range = this.lightRange * flicker;
    const angle = this.playerFacingAngle;
    const half = this.lightHalfAngle;

    // ESCURIDAO TOTAL
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(0, 0, 0, 0.97)";
    ctx.fillRect(0, 0, width, height);

    // DENTRO DA VENTILACAO: lanterna apagada, so um fiapo de luz ao redor
    const inVent = this.ventState !== "none";
    const ambientRange = inVent ? 70 : this.ambientRange;

    const ambient = this.buildVisibility(
      0,
      Math.PI,
      ambientRange * flicker,
      56,
      camera,
    );

    ctx.globalCompositeOperation = "destination-out";

    let core = null;

    if (!inVent && this.flashlightOn) {
      // CONE LARGO E SUAVE (penumbra) E CONE CENTRAL FORTE
      const soft = this.buildVisibility(
        angle,
        half * 1.35,
        range * 0.92,
        60,
        camera,
      );

      core = this.buildVisibility(
        angle,
        half,
        range,
        this.lightRayCount,
        camera,
      );

      this.carveLight(sx, sy, soft, range * 0.92, 8, 0.5);
      this.carveLight(sx, sy, core, range, 8, 1);
    }

    this.carveLight(
      sx,
      sy,
      ambient,
      ambientRange * flicker,
      6,
      inVent ? 0.55 : 0.8,
    );

    // TOM QUENTE DA LANTERNA
    ctx.globalCompositeOperation = "source-over";
    if (core) this.tintLight(sx, sy, core, range);

    this.darkTexture.refresh();
  }

  // ---------------------------------------------------------------
  // DIFICULDADE ADAPTATIVA
  // ---------------------------------------------------------------

  difficultyFactor() {
    const { min, max } = ENEMY_DIFFICULTY;
    return Phaser.Math.Clamp((this.difficulty - min) / (max - min), 0, 1);
  }

  changeDifficulty(amount) {
    this.difficulty = Phaser.Math.Clamp(
      this.difficulty + amount,
      ENEMY_DIFFICULTY.min,
      ENEMY_DIFFICULTY.max,
    );
    this.refreshDifficultyTuning();
    if (!this.mp) this.registry.set("enemyDifficulty", this.difficulty);
  }

  updateDifficulty(now, dt) {
    this.difficultyPlaySeconds += dt;
    if (now < this.difficultyNextUpdate) return;
    this.difficultyNextUpdate = now + ENEMY_DIFFICULTY.adaptIntervalMs;

    // seguir o gato (que guia ate as chaves) faz a dificuldade subir mais rapido
    this.difficultyFollowMultiplier = this.isPlayerFollowingCat()
      ? ENEMY_DIFFICULTY.followCatMultiplier
      : 1;

    const gain =
      (ENEMY_DIFFICULTY.survivalGainPerMinute / 60) *
      (ENEMY_DIFFICULTY.adaptIntervalMs / 1000) *
      this.difficultyFollowMultiplier;
    this.changeDifficulty(gain);
  }

  refreshDifficultyTuning() {
    const cfg = ENEMY_DIFFICULTY.values;
    const f = this.difficultyFactor();
    const value = (range) => Phaser.Math.Linear(range[0], range[1], f);
    this.adaptiveTuning = {
      wanderSpeed: value(cfg.wanderSpeed),
      investigateSpeed: value(cfg.investigateSpeed),
      chaseSpeed: value(cfg.chaseSpeed),
      chaseSpeedWithKeyBonus: value(cfg.chaseSpeedWithKeyBonus),
      visionRange: value(cfg.visionRange),
      runningVisionBonus: value(cfg.runningVisionBonus),
      hearingRange: value(cfg.hearingRange),
      closeSense: value(cfg.closeSense),
      chaseMemoryMs: value(cfg.chaseMemoryMs),
      ventHuntMs: value(cfg.ventHuntMs),
      searchDurationMs: value(cfg.searchDurationMs),
      patrolWaitMs: value(cfg.patrolWaitMs),
      repathMs: value(cfg.repathMs),
    };
    this.nunCloseSense = this.adaptiveTuning.closeSense;
    this.nunFov = Phaser.Math.Linear(0.8, ENEMY_DIFFICULTY.visionHalfAngle, f);

    const threshold = ENEMY_DIFFICULTY.pathfindingThreshold;
    const halfBlend = ENEMY_DIFFICULTY.pathfindingBlendRange / 2;
    this.pathfindingBlend = Phaser.Math.Clamp(
      (this.difficulty - (threshold - halfBlend)) / (halfBlend * 2),
      0,
      1,
    );
  }

  // ---------------------------------------------------------------
  // DEBUG DA IA (F3)
  // ---------------------------------------------------------------

  createEnemyDebug() {
    this.enemyDebugGrid = this.add.graphics().setDepth(95).setVisible(false);

    this.enemyDebugPanel = this.add
      .text(12, 84, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#d8f5d8",
        backgroundColor: "#000000cc",
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(130)
      .setVisible(false);

    this.enemyDebugCommandBar = this.add
      .text(12, 486, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#ffffff",
        backgroundColor: "#000000dd",
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(130)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });

    this.enemyDebugCommandBar.on("pointerdown", () => {
      this.debugCommandFocused = true;
      this.debugCommandMessage = "Console ativo. Enter executa; Esc sai.";
      this.updateDebugCommandBar();
    });

    // clicar fora da barra tira o foco
    this.input.on("pointerdown", (pointer, over) => {
      if (
        this.debugCommandFocused &&
        !over.includes(this.enemyDebugCommandBar)
      ) {
        this.debugCommandFocused = false;
        this.debugCommandMessage = "Clique aqui para digitar: difficulty 0-10";
        this.updateDebugCommandBar();
      }
    });

    this.input.keyboard.addCapture("F3");
    this.input.keyboard.on("keydown-F3", () => this.toggleEnemyDebug());
    this.input.keyboard.on("keydown", (event) =>
      this.handleDebugCommandKey(event),
    );
  }

  toggleEnemyDebug() {
    this.debugEnemyAI = !this.debugEnemyAI;
    this.enemyDebugGrid.setVisible(this.debugEnemyAI);
    this.enemyDebugPanel.setVisible(this.debugEnemyAI);
    this.enemyDebugCommandBar.setVisible(this.debugEnemyAI);

    if (this.debugEnemyAI) {
      this.updateDebugCommandBar();
      this.drawEnemyDebug(this.time.now, true);
    } else {
      this.debugCommandFocused = false;
      this.enemyDebugGrid.clear();
    }
  }

  updateDebugCommandBar() {
    if (!this.enemyDebugCommandBar) return;
    this.enemyDebugCommandBar.setText(
      `> ${this.debugCommand}\n${this.debugCommandMessage}`,
    );
  }

  handleDebugCommandKey(event) {
    if (!this.debugEnemyAI || !this.debugCommandFocused || event.code === "F3")
      return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Enter") {
      const command = this.debugCommand.trim();
      const goto = command.match(
        /^goto\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)$/i,
      );
      const difficulty = command.match(
        /^(?:difficulty|d)\s+([0-9]+(?:\.[0-9]+)?)$/i,
      );

      if (/^(?:help|\?)$/i.test(command)) {
        this.debugCommandMessage =
          "Comandos: difficulty 0-10, status, repath, goto X Y";
      } else if (/^status$/i.test(command)) {
        this.debugCommandMessage = `Freira: ${this.nunState}; A*: ${Math.round(this.pathfindingBlend * 100)}%; pontos: ${this.nunPath.length}.`;
      } else if (/^repath$/i.test(command)) {
        if (this.nunDest) {
          this.setNunDestination(this.nunDest.x, this.nunDest.y);
          this.nunRepathAt = 0;
          this.debugCommandMessage = "Rota recalculada.";
        } else {
          this.debugCommandMessage = "A freira ainda nao tem destino.";
        }
      } else if (goto) {
        const x = Phaser.Math.Clamp(Number(goto[1]), 0, this.mapWidth);
        const y = Phaser.Math.Clamp(Number(goto[2]), 0, this.mapHeight);
        this.setNunState("investigate");
        this.setNunDestination(x, y);
        this.debugCommandMessage = `Destino definido: ${Math.round(x)}, ${Math.round(y)}.`;
      } else if (difficulty) {
        const level = Number(difficulty[1]);
        if (level >= ENEMY_DIFFICULTY.min && level <= ENEMY_DIFFICULTY.max) {
          this.difficulty = level;
          this.refreshDifficultyTuning();
          this.registry.set("enemyDifficulty", level);
          this.nunRepathAt = 0;
          if (this.nunDest)
            this.setNunDestination(this.nunDest.x, this.nunDest.y);
          this.debugCommandMessage = `Dificuldade manual definida: ${level.toFixed(1)}.`;
        } else {
          this.debugCommandMessage = `Use um valor entre ${ENEMY_DIFFICULTY.min} e ${ENEMY_DIFFICULTY.max}.`;
        }
      } else {
        this.debugCommandMessage = "Comando invalido. Digite help.";
      }
      this.debugCommand = "";
      this.updateDebugCommandBar();
      return;
    }

    if (event.key === "Backspace") {
      this.debugCommand = this.debugCommand.slice(0, -1);
    } else if (event.key === "Escape") {
      this.debugCommand = "";
      this.debugCommandFocused = false;
      this.debugCommandMessage = "Clique aqui para digitar; Enter executa.";
    } else if (event.key.length === 1 && /^[a-z0-9 ._-]$/i.test(event.key)) {
      this.debugCommand += event.key;
    }
    this.updateDebugCommandBar();
  }

  drawEnemyDebug(now, force = false) {
    if (!this.debugEnemyAI || (!force && now < this.debugDrawAt)) return;
    this.debugDrawAt = now + ENEMY_DIFFICULTY.debugRefreshMs;

    const g = this.enemyDebugGrid;
    const cam = this.cameras.main;
    const size = this.nav.cellSize;
    const left = Math.max(0, Math.floor(cam.scrollX / size));
    const top = Math.max(0, Math.floor(cam.scrollY / size));
    const right = Math.min(
      this.nav.cols - 1,
      Math.ceil((cam.scrollX + cam.width / cam.zoom) / size),
    );
    const bottom = Math.min(
      this.nav.rows - 1,
      Math.ceil((cam.scrollY + cam.height / cam.zoom) / size),
    );

    g.clear();
    g.lineStyle(1, 0x9fc69f, 0.15);
    for (let cx = left; cx <= right; cx++) {
      const x = cx * size;
      g.lineBetween(x, top * size, x, (bottom + 1) * size);
    }
    for (let cy = top; cy <= bottom; cy++) {
      const y = cy * size;
      g.lineBetween(left * size, y, (right + 1) * size, y);
    }

    g.fillStyle(0xff3b3b, 0.22);
    for (let cy = top; cy <= bottom; cy++) {
      for (let cx = left; cx <= right; cx++) {
        if (!this.nav.isFree(cx, cy)) {
          g.fillRect(cx * size + 1, cy * size + 1, size - 2, size - 2);
        }
      }
    }

    if (this.nunPath.length) {
      g.lineStyle(4, 0xffcf4a, 0.9);
      g.beginPath();
      g.moveTo(this.nun.x, this.nun.y);
      for (const point of this.nunPath) g.lineTo(point.x, point.y);
      g.strokePath();
      g.fillStyle(0xffcf4a, 1);
      for (const point of this.nunPath) g.fillCircle(point.x, point.y, 5);
    } else if (this.nunDest) {
      g.lineStyle(3, 0xffcf4a, 0.75);
      g.lineBetween(this.nun.x, this.nun.y, this.nunDest.x, this.nunDest.y);
      g.fillStyle(0xffcf4a, 1);
      g.fillCircle(this.nunDest.x, this.nunDest.y, 6);
    }

    const catPathColors = [0x61d9ff, 0xffa85c, 0xd29aff];
    this.cats.forEach((cat, index) => {
      const color = catPathColors[index % catPathColors.length];
      if (cat.path.length) {
        g.lineStyle(3, color, 0.95);
        g.beginPath();
        g.moveTo(cat.x, cat.y);
        for (const point of cat.path) g.lineTo(point.x, point.y);
        g.strokePath();
        g.fillStyle(color, 1);
        for (const point of cat.path) g.fillCircle(point.x, point.y, 4);
      }
      if (cat.dest) {
        g.fillStyle(color, 1);
        g.fillCircle(cat.dest.x, cat.dest.y, 6);
      }
    });

    const tune = this.adaptiveTuning;
    const destination = this.nunDest
      ? `${Math.round(this.nunDest.x)}, ${Math.round(this.nunDest.y)}`
      : "parada";
    const lockedDoors = this.doors.filter(
      (door) => door.isLocked && !door.isOpen,
    ).length;

    this.enemyDebugPanel.setText([
      "DEBUG IA  [F3]",
      `Dificuldade: ${this.difficulty.toFixed(2)} / ${ENEMY_DIFFICULTY.max} (${this.difficultyFollowMultiplier.toFixed(1)}x seguindo gato)`,
      `Freira: ${this.nunState} | A*: ${Math.round(this.pathfindingBlend * 100)}%`,
      `Caminho: ${this.nunPath.length}${this.nunPathFailed ? " (fallback)" : ""} | Destino: ${destination}`,
      `Visao: ${Math.round(tune.visionRange)} | Audicao: ${Math.round(tune.hearingRange)}`,
      `Perseg.: ${Math.round(tune.chaseMemoryMs)}ms | Recalculo: ${Math.round(tune.repathMs)}ms`,
      `Sobreviveu: ${Math.floor(this.difficultyPlaySeconds)}s | Itens: ${this.difficultyItems} | Fugas: ${this.difficultyEscapes}`,
      `Quase pega: ${this.difficultyNearMisses} | Capturas: ${this.difficultyCatches}`,
      `Portas trancadas: ${lockedDoors} | Gatos: ${this.cats.length} (A* nivel ${CAT_AI_DIFFICULTY})`,
      ...(this.mp
        ? [
            `Equipe(${this.getPlayerStates().length} vivos) efic: ${Math.round(this.teamStats.efficiency * 100)}%`,
            `prog ${Math.round(this.teamStats.progress * 100)}% | coesao ${Math.round(this.teamStats.cohesion * 100)}% | ruido ${Math.round(this.teamStats.noiseLevel * 100)}% | chaves ${Math.round(this.teamStats.tempo * 100)}%`,
          ]
        : []),
    ]);
  }

  // ---------------------------------------------------------------
  // FREIRA
  // ---------------------------------------------------------------

  update(time, delta) {
    if (this.isHostMp && this.mpWaiting) this.checkMpStart(time);
    if (this.gameOver || !this.gameStarted) return;

    const dt = delta / 1000;
    this.updatePlayer(time, delta);

    if (!this.mp) {
      // DIFICULDADE ADAPTATIVA
      this.updateDifficulty(time, dt);

      // VENTILACOES (ar) E DICA DE INTERACAO
      this.updateVent(time, dt);
      this.updateHint();

      // FREIRA E GATO
      this.updateNun(time, delta);
      this.updateCats(time);
    } else if (this.isHostMp) {
      // HOST: simula tudo e manda o estado para os clientes
      this.smoothRemotePlayers(delta);
      this.updateTeamDifficulty(time, dt);
      this.updateVent(time, dt);
      this.updateHint();
      this.updateNun(time, delta);
      this.updateCats(time);
      this.checkRemoteCaptures();
      this.sendSnapshot(time);
      this.updateSpectator(time);
    } else {
      // CLIENTE: simula so o proprio jogador; freira e gato vem do host
      this.smoothRemotePlayers(delta);
      this.smoothNetWorld(delta);
      this.updateVent(time, dt);
      this.updateHint();
      this.sendLocalState(time);
      this.updateSpectator(time);
    }
    if (this.mp) this.updateTeamHud(time);

    // MEDO: quanto mais perto a freira, mais o coracao bate e a luz falha
    const nunDist = Phaser.Math.Distance.Between(
      this.nun.x,
      this.nun.y,
      this.player.x,
      this.player.y,
    );
    const fear = Phaser.Math.Clamp(1 - (nunDist - 120) / 320, 0, 1);

    this.heart.setScale(
      1 + fear * 0.2 * Math.abs(Math.sin(time * (0.006 + 0.01 * fear))),
    );

    this.updateLighting(time, fear);
    this.drawStamina();
    this.drawBreath();
    this.drawEnemyDebug(time);

    if (this.statusUntil && time > this.statusUntil) {
      this.status.setVisible(false);
      this.statusUntil = 0;
    }
  }

  // FINAL DO JOGO
  finish(won, message, fromNet = false) {
    if (this.gameOver) return;

    // O modo de teste impede que a freira encerre a partida.
    if (!won && this.godMode && !this.mp) {
      this.say("God mode ativo: a freira nao pode te capturar.", 2200);
      return;
    }

    // host avisa todos os jogadores do resultado
    if (this.isHostMp && !fromNet) net.broadcast({ t: "end", won, message });

    this.gameOver = true;

    if (!this.mp) {
      // ser capturado alivia a dificuldade para a proxima partida
      if (!won) {
        this.difficultyCatches++;
        this.changeDifficulty(-ENEMY_DIFFICULTY.caughtLoss);
      }
      this.registry.set("enemyDifficulty", this.difficulty);
    }

    if (this.crawlTween) this.crawlTween.stop();
    this.ambientMusic.stop();
    this.chaseMusic.stop();
    this.player.setVisible(true);
    this.footstepSound.stop();
    this.runningSound.stop();
    this.nun.body.setVelocity(0, 0);
    this.player.body.setVelocity(0, 0);
    this.physics.pause();

    this.add
      .rectangle(480, this.mp ? 300 : 280, 520, this.mp ? 300 : 230, 0x080808, 0.97)
      .setScrollFactor(0)
      .setDepth(200);

    this.add
      .text(480, 225, won ? "VOCÊ ESCAPOU" : "FIM DE JOGO", {
        fontFamily: "Georgia",
        fontSize: "30px",
        color: won ? "#d8c18a" : "#d34b4b",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    this.add
      .text(
        480,
        275,
        message ||
          (won
            ? "Você conseguiu fugir do asilo!"
            : "A freira capturou você..."),
        {
          fontSize: "15px",
          color: "#eeeeee",
        },
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    if (this.mp) this.createMultiplayerEndButtons();
    if (this.isClientMp) return; // cliente espera o host iniciar outra partida

    const restartButton = this.add
      .text(480, 335, this.mp ? "⟳  NOVA PARTIDA" : "⟳  RECOMEÇAR", {
        fontFamily: "Arial",
        fontSize: "20px",
        color: "#ffffff",
        backgroundColor: "#762d2d",
        padding: { x: 22, y: 12 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(202)
      .setInteractive({ useHandCursor: true });

    restartButton.on("pointerover", () => {
      restartButton.setStyle({ backgroundColor: "#a33b3b" });
    });

    restartButton.on("pointerout", () => {
      restartButton.setStyle({ backgroundColor: "#762d2d" });
    });

    restartButton.on("pointerdown", () => {
      restartButton.disableInteractive();
      if (this.isHostMp) this.startMultiplayerAsHost();
      else this.scene.restart();
    });
  }

  // ---------------------------------------------------------------
  // MULTIPLAYER
  // ---------------------------------------------------------------

  createMultiplayerEndButtons() {
    if (this.isClientMp) {
      this.add
        .text(480, 335, "Aguardando o host iniciar uma nova partida...", {
          fontSize: "15px",
          color: "#aaa69d",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(202);
    }

    const leave = this.add
      .text(480, 400, "SAIR DA SALA", {
        fontFamily: "Arial",
        fontSize: "15px",
        color: "#cccccc",
        backgroundColor: "#2a2a2e",
        padding: { x: 18, y: 8 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(202)
      .setInteractive({ useHandCursor: true });

    leave.on("pointerdown", () => {
      net.leave();
      this.scene.restart(); // volta ao menu principal (modo solo)
    });
  }

  // Host: sorteia o mapa (ja feito em buildMap), avisa os clientes e espera todos ficarem prontos.
  setupMultiplayer() {
    this.netUnsubs = [
      net.on("msg", (id, msg) => this.onNetMessage(id, msg)),
      net.on("playerleft", (id) => this.onPlayerLeft(id)),
      net.on("closed", () => this.onHostLost()),
      net.on("error", (text) => this.say(text, 4000)),
    ];
    this.events.once("shutdown", () => {
      for (const off of this.netUnsubs) off();
    });

    for (const p of net.players) {
      if (p.id !== net.myId) this.addRemotePlayer(p.id, p.name);
    }

    if (this.isHostMp) {
      const setup = {
        layout: this.mapLayout,
        nun: this.nunSpawnSetup,
        keys: this.keySetup,
        cat: this.catSetup,
        slots: this.mpSlots,
      };
      net.broadcast({ t: "start", setup });
      this.mpWaiting = new Set(
        net.players.filter((p) => p.id !== net.myId).map((p) => p.id),
      );
      this.mpWaitUntil = this.time.now + 6000;
    } else {
      net.sendToHost({ t: "ready" });
    }
  }

  addRemotePlayer(id, name) {
    const slot = this.mpSlots[id] || 0;
    const container = this.add.container(
      110 + (slot % 2) * 40,
      250 + Math.floor(slot / 2) * 40,
    );
    container.setDepth(this.characterDepth);
    const sprite = this.add
      .sprite(0, 0, "milaIdleRight")
      .setOrigin(0.5, 0.5)
      .setScale(1.5);
    sprite.play("mila-idle-right");
    const label = this.add
      .text(0, -30, name, {
        fontSize: "11px",
        color: "#f1e6ce",
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    container.add([sprite, label]);

    this.remotePlayers.set(id, {
      id,
      name,
      container,
      sprite,
      target: { x: container.x, y: container.y },
      anim: "mila-idle-right",
      running: false,
      ventState: "none",
      ventAt: null,
      facing: 0,
      flashlightOn: true,
      dead: false,
      left: false,
    });
  }

  startMultiplayerAsHost() {
    if (!net.isHost) return;
    net.inGame = true;
    lobby.close();
    this.scene.restart({ mp: true });
  }

  checkMpStart(time) {
    if (this.mpWaiting.size === 0 || this.time.now > this.mpWaitUntil) {
      this.mpWaiting = null;
      this.beginMatch();
    }
  }

  beginMatch() {
    this.gameStarted = true;
    this.ambientMusic.play();
    this.say("Encontrem a chave e escapem juntos.", 6000);
    if (this.isHostMp) net.broadcast({ t: "go" });
  }

  onPlayerLeft(id) {
    const g = this.remotePlayers.get(id);
    if (!g) return;
    g.left = true;
    g.container.setVisible(false);
    if (this.mpWaiting) this.mpWaiting.delete(id);
    if (!this.gameOver && this.gameStarted && this.getPlayerStates().length === 0) {
      this.finish(false, "Toda a equipe foi capturada...");
    }
  }

  onHostLost() {
    if (!this.isClientMp || this.gameOver) return;
    this.finish(false, "A conexão com o host foi perdida.", true);
  }

  // ---- mensagens recebidas ----
  onNetMessage(id, msg) {
    if (this.isHostMp) {
      switch (msg.t) {
        case "ready":
          if (this.mpWaiting) this.mpWaiting.delete(id);
          break;
        case "p":
          this.applyRemoteState(id, msg);
          break;
        case "door":
          this.applyDoorState(msg.i, msg.open, msg.locked);
          net.broadcast(msg, id);
          break;
        case "key": {
          const g = this.remotePlayers.get(id);
          this.collectKey(msg.which, {
            fromNet: true,
            fromId: id,
            pos: g ? { x: g.container.x, y: g.container.y } : null,
          });
          break;
        }
        case "vent": {
          const g = this.remotePlayers.get(id);
          const vent = this.vents.find(
            (v) => v.pair === msg.pair && v.side === msg.side,
          );
          if (!g || !vent || g.dead) break;
          const outcome = this.nunReactToVentEntry(
            { id, x: vent.x, y: vent.y, running: !!msg.running },
            vent,
          );
          net.sendTo(id, { t: "ventResult", outcome });
          break;
        }
        case "noise":
          this.makeNoise(msg.x, msg.y, Math.min(msg.r || 0, 400));
          break;
        case "escape":
          this.difficultyEscapes++;
          this.eventDifficulty(ENEMY_DIFFICULTY.escapeGain);
          break;
        case "exit":
          if (this.hasMasterKey && !this.gameOver) {
            this.finish(true, "Sua equipe escapou do asilo!");
          }
          break;
        default:
      }
      return;
    }

    // cliente
    switch (msg.t) {
      case "start":
        lobby.close();
        net.inGame = true;
        this.scene.restart({ mp: true, setup: msg.setup });
        break;
      case "go":
        if (!this.gameStarted) this.beginMatch();
        break;
      case "s":
        this.applySnapshot(msg);
        break;
      case "door":
        this.applyDoorState(msg.i, msg.open, msg.locked);
        break;
      case "key":
        this.collectKey(msg.which, { fromNet: true });
        break;
      case "ventResult":
        this.showVentOutcome(msg.outcome);
        break;
      case "spot":
        this.onNunSpotted(true);
        break;
      case "dead":
        this.onDeadMessage(msg);
        break;
      case "end":
        this.finish(msg.won, msg.message, true);
        break;
      default:
    }
  }

  applyRemoteState(id, msg) {
    const g = this.remotePlayers.get(id);
    if (!g || g.dead) return;
    g.target = { x: msg.x, y: msg.y };
    g.anim = msg.a;
    g.running = !!msg.r;
    g.ventState = msg.v || "none";
    g.ventAt = msg.vt ? { pair: msg.vt[0], side: msg.vt[1] } : null;
    g.facing = msg.f || 0;
    g.flashlightOn = !!msg.fo;
  }

  // ---- jogadores remotos (suavizacao e animacao) ----
  smoothRemotePlayers(delta) {
    const k = Math.min(1, delta / 90);
    for (const g of this.remotePlayers.values()) {
      const visible = !g.dead && !g.left && g.ventState === "none";
      g.container.setVisible(visible);
      if (g.dead || g.left) continue;

      const dx = g.target.x - g.container.x;
      const dy = g.target.y - g.container.y;
      if (Math.hypot(dx, dy) > 250) g.container.setPosition(g.target.x, g.target.y);
      else g.container.setPosition(g.container.x + dx * k, g.container.y + dy * k);

      if (g.anim && g.sprite.anims.currentAnim?.key !== g.anim && this.anims.exists(g.anim)) {
        g.sprite.play(g.anim);
      }
    }
  }

  // Cliente: move a copia da freira e do gato ate a posicao enviada pelo host.
  smoothNetWorld(delta) {
    const k = Math.min(1, delta / 90);
    if (this.nunNetTarget) {
      const dx = this.nunNetTarget.x - this.nun.x;
      const dy = this.nunNetTarget.y - this.nun.y;
      if (Math.hypot(dx, dy) > 250) this.nun.setPosition(this.nunNetTarget.x, this.nunNetTarget.y);
      else this.nun.setPosition(this.nun.x + dx * k, this.nun.y + dy * k);
      this.nun.setDepth(this.worldDepth(this.nun.y));
    }
    for (const cat of this.cats) {
      const t = cat.netTarget;
      if (!t) continue;
      const dx = t.x - cat.x;
      const dy = t.y - cat.y;
      if (Math.hypot(dx, dy) > 250) cat.setPosition(t.x, t.y);
      else cat.setPosition(cat.x + dx * k, cat.y + dy * k);
      cat.setDepth(this.worldDepth(cat.y));
    }
  }

  // ---- envio ----
  localAnim() {
    return this.playerSprite.anims.currentAnim?.key;
  }

  sendLocalState(time) {
    if (this.localDead || time < this.netSendAt) return;
    this.netSendAt = time + NET_SEND_MS;
    net.sendToHost({
      t: "p",
      x: Math.round(this.player.x * 10) / 10,
      y: Math.round(this.player.y * 10) / 10,
      a: this.localAnim(),
      r: this.playerRunning ? 1 : 0,
      v: this.ventState,
      vt: this.ventAt ? [this.ventAt.pair, this.ventAt.side] : null,
      f: Math.round(this.playerFacingAngle * 100) / 100,
      fo: this.flashlightOn ? 1 : 0,
    });
  }

  sendSnapshot(time) {
    if (time < this.netSendAt) return;
    this.netSendAt = time + NET_SEND_MS;

    const players = [
      {
        id: net.myId,
        x: Math.round(this.player.x * 10) / 10,
        y: Math.round(this.player.y * 10) / 10,
        a: this.localAnim(),
        r: this.playerRunning ? 1 : 0,
        v: this.ventState,
        vt: this.ventAt ? [this.ventAt.pair, this.ventAt.side] : null,
        f: Math.round(this.playerFacingAngle * 100) / 100,
        fo: this.flashlightOn ? 1 : 0,
        d: this.localDead ? 1 : 0,
      },
    ];
    for (const g of this.remotePlayers.values()) {
      players.push({
        id: g.id,
        x: g.target.x,
        y: g.target.y,
        a: g.anim,
        r: g.running ? 1 : 0,
        v: g.ventState,
        vt: g.ventAt ? [g.ventAt.pair, g.ventAt.side] : null,
        f: g.facing,
        fo: g.flashlightOn ? 1 : 0,
        d: g.dead || g.left ? 1 : 0,
      });
    }

    net.broadcast({
      t: "s",
      pl: players,
      nun: {
        x: Math.round(this.nun.x * 10) / 10,
        y: Math.round(this.nun.y * 10) / 10,
        st: this.nunState,
        fc: Math.round(this.nunFacing * 100) / 100,
      },
      cat: this.cats[0]
        ? {
            x: Math.round(this.cats[0].x * 10) / 10,
            y: Math.round(this.cats[0].y * 10) / 10,
            an: this.cats[0].sprite.anims.currentAnim?.key,
            fx: this.cats[0].sprite.flipX ? 1 : 0,
          }
        : null,
      df: Math.round(this.difficulty * 100) / 100,
    });
  }

  applySnapshot(msg) {
    for (const p of msg.pl) {
      if (p.id === net.myId) continue;
      const g = this.remotePlayers.get(p.id);
      if (!g) continue;
      g.target = { x: p.x, y: p.y };
      g.anim = p.a;
      g.running = !!p.r;
      g.ventState = p.v || "none";
      g.ventAt = p.vt ? { pair: p.vt[0], side: p.vt[1] } : null;
      g.facing = p.f || 0;
      g.flashlightOn = !!p.fo;
      if (p.d && !g.dead) {
        g.dead = true;
        g.container.setVisible(false);
      }
    }

    this.nunNetTarget = { x: msg.nun.x, y: msg.nun.y };
    this.nunFacing = msg.nun.fc;
    this.setNunState(msg.nun.st);

    const cat = this.cats[0];
    if (cat && msg.cat) {
      cat.netTarget = { x: msg.cat.x, y: msg.cat.y };
      if (msg.cat.an && cat.sprite.anims.currentAnim?.key !== msg.cat.an) {
        cat.sprite.play(msg.cat.an);
      }
      cat.sprite.setFlipX(!!msg.cat.fx);
    }
    this.difficulty = msg.df;
  }

  // ---- capturas e espectador ----
  checkRemoteCaptures() {
    for (const g of this.remotePlayers.values()) {
      if (g.dead || g.left || g.ventState !== "none") continue;
      if (
        Math.abs(g.container.x - this.nun.x) < 24 &&
        Math.abs(g.container.y - this.nun.y) < 34
      ) {
        this.killPlayer(g.id);
      }
    }
  }

  killPlayer(id, message) {
    if (!this.isHostMp || this.gameOver) return;

    if (id === net.myId) {
      if (this.localDead) return;
      if (this.godMode) {
        this.say("God mode ativo: a freira nao pode te capturar.", 2200);
        return;
      }
      this.markLocalDead(message);
    } else {
      const g = this.remotePlayers.get(id);
      if (!g || g.dead || g.left) return;
      g.dead = true;
      g.container.setVisible(false);
      this.say(`${g.name} foi capturado!`, 3500);
    }

    net.broadcast({ t: "dead", id, message });
    this.teamStats.deaths++;
    this.difficultyCatches++;
    // equipe com baixas: a pressao diminui moderadamente
    this.changeDifficulty(
      -ENEMY_DIFFICULTY.caughtLoss * TEAM_DIFFICULTY.deathLossFactor,
    );

    if (this.getPlayerStates().length === 0) {
      this.finish(false, "Toda a equipe foi capturada...");
    }
  }

  onDeadMessage(msg) {
    if (msg.id === net.myId) {
      this.markLocalDead(msg.message);
    } else {
      const g = this.remotePlayers.get(msg.id);
      if (g && !g.dead) {
        g.dead = true;
        g.container.setVisible(false);
        this.say(`${g.name} foi capturado!`, 3500);
      }
    }
  }

  markLocalDead(message) {
    if (this.localDead) return;
    this.localDead = true;
    if (this.crawlTween) {
      this.crawlTween.stop();
      this.crawlTween = null;
    }
    this.ventState = "none";
    this.ventAt = null;
    this.player.setVisible(false);
    this.player.body.setVelocity(0, 0);
    this.player.body.enable = false;
    this.footstepSound.stop();
    this.runningSound.stop();
    this.say(message || "A freira pegou você! Acompanhe seus colegas.", 6000);
    this.cameras.main.shake(300, 0.01);
    this.spectateAt = 0;
  }

  // espectador: a camera acompanha um colega vivo
  updateSpectator(time) {
    if (!this.localDead || time < this.spectateAt) return;
    this.spectateAt = time + 500;
    const alive = Array.from(this.remotePlayers.values()).find(
      (g) => !g.dead && !g.left,
    );
    if (alive && this.spectated !== alive.id) {
      this.spectated = alive.id;
      this.cameras.main.startFollow(alive.container, true, 0.1, 0.1);
    }
  }

  // ---- dificuldade adaptativa baseada na equipe (somente no host) ----
  keyTempoScore(seconds) {
    const fast = TEAM_DIFFICULTY.keyTempoFastSec;
    const slow = TEAM_DIFFICULTY.keyTempoSlowSec;
    return Phaser.Math.Clamp(1 - (seconds - fast) / (slow - fast), 0, 1);
  }

  updateTeamDifficulty(now, dt) {
    const t = this.teamStats;
    t.playSeconds += dt;

    const alive = this.getPlayerStates();
    for (const p of alive) {
      // distancia percorrida a pe (rastejar na ventilacao nao conta como progresso)
      const prev = t.lastPos.get(p.id);
      if (prev && p.ventState === "none") {
        t.dist += Math.hypot(p.x - prev.x, p.y - prev.y);
      }
      t.lastPos.set(p.id, { x: p.x, y: p.y });
      if (p.running) t.noise += dt;
    }

    if (now < this.difficultyNextUpdate) return;
    this.difficultyNextUpdate = now + ENEMY_DIFFICULTY.adaptIntervalMs;
    const interval = ENEMY_DIFFICULTY.adaptIntervalMs / 1000;
    const n = alive.length;
    const a = TEAM_DIFFICULTY.smoothing;

    if (n > 0) {
      // 1) velocidade media de progressao (px/s por jogador, relativo a corrida)
      const progress = Phaser.Math.Clamp(t.dist / n / interval / this.runSpeed, 0, 1);
      t.progress = Phaser.Math.Linear(t.progress, progress, a);

      // 2) proximidade em grupo (distancia media entre os pares)
      let cohesion = 0.5; // sozinho: neutro
      if (n >= 2) {
        let sum = 0;
        let pairs = 0;
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            sum += Math.hypot(alive[i].x - alive[j].x, alive[i].y - alive[j].y);
            pairs++;
          }
        }
        const avg = sum / pairs;
        cohesion = Phaser.Math.Clamp(
          1 -
            (avg - TEAM_DIFFICULTY.cohesionNear) /
              (TEAM_DIFFICULTY.cohesionFar - TEAM_DIFFICULTY.cohesionNear),
          0,
          1,
        );
      }
      t.cohesion = Phaser.Math.Linear(t.cohesion, cohesion, a);

      // 3) ruido acumulado (fracao do tempo que a equipe passa correndo)
      const noise = Phaser.Math.Clamp(t.noise / n / interval, 0, 1);
      t.noiseLevel = Phaser.Math.Linear(t.noiseLevel, noise, a);
    }
    t.dist = 0;
    t.noise = 0;

    // 4) tempo para encontrar as chaves (quanto mais rapido, maior a pontuacao)
    const normalSecs = t.keyTimes.normal ?? t.playSeconds;
    const masterSecs = t.keyTimes.master ?? t.playSeconds;
    t.tempo = this.keyTempoScore((normalSecs + masterSecs) / 2);

    t.efficiency =
      TEAM_DIFFICULTY.weightProgress * t.progress +
      TEAM_DIFFICULTY.weightCohesion * t.cohesion +
      TEAM_DIFFICULTY.weightNoise * t.noiseLevel +
      TEAM_DIFFICULTY.weightKeyTempo * t.tempo;

    let rate = Phaser.Math.Linear(
      TEAM_DIFFICULTY.ratePerMinuteMin,
      TEAM_DIFFICULTY.ratePerMinuteMax,
      Phaser.Math.Clamp(t.efficiency, 0, 1),
    );

    // muitos jogadores capturados: a pressao cresce bem mais devagar
    const total = this.remotePlayers.size + 1;
    if (rate > 0 && n / total <= TEAM_DIFFICULTY.lowAliveRatio) {
      rate *= TEAM_DIFFICULTY.lowAliveGainFactor;
    }

    this.changeDifficulty((rate / 60) * interval);
  }

  updateTeamHud(time) {
    if (time < this.teamHudAt) return;
    this.teamHudAt = time + 400;

    const lines = net.players.map((p) => {
      if (p.id === net.myId) {
        const state = this.localDead ? "✖" : this.ventState !== "none" ? "▫" : "●";
        return `${p.name} ${state}`;
      }
      const g = this.remotePlayers.get(p.id);
      const state = !g || g.dead || g.left ? "✖" : g.ventState !== "none" ? "▫" : "●";
      return `${p.name} ${state}`;
    });
    this.teamText.setText(lines.join("\n"));
  }
}

installCatMethods(AsylumScene, ENEMY_DIFFICULTY);
installNunMethods(AsylumScene, ENEMY_DIFFICULTY);
installPlayerMethods(AsylumScene);

// CONFIGURACAO DO PHASER
const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: 960,
  height: 560,
  backgroundColor: "#11110f",

  physics: {
    default: "arcade",
    arcade: {
      debug: false,
    },
  },

  scale: {
    // Mantem o espaco logico usado pelo HUD e pelos menus; o CSS amplia a tela.
    mode: Phaser.Scale.NONE,
  },

  scene: [AsylumScene],
};

new Phaser.Game(config);
