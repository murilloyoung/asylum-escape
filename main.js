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

// Os gatos usam sempre a precisao de pathfinding do nivel maximo.
const CAT_AI_DIFFICULTY = 10;
const CAT_REPATH_INTERVAL = 250;
const CAT_AUDIBLE_RADIUS = 160;

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
    this.gameOver = false;
    this.gameStarted = false;
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

    this.mapWidth = 2400;
    this.mapHeight = 1600;
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

    // FREIRA
    this.nunState = "patrol"; // patrol | investigate | chase | search
    this.nunWanderSpeed = 68;
    this.nunInvestigateSpeed = 95;
    this.nunChaseSpeed = 120;
    this.nunChaseSpeedWithKey = 152;
    this.nunFov = 1.1; // meio angulo de visao (rad)
    this.nunCloseSense = 120; // percebe o jogador perto, mesmo de costas
    this.difficulty = Phaser.Math.Clamp(
      this.registry.get("enemyDifficulty") ?? 2,
      0,
      10,
    );
    this.difficultyPlaySeconds = 0;
    this.difficultyNextUpdate = 0;
    this.difficultyFollowMultiplier = 1;
    this.applyDifficultyTuning(this.difficulty);
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

    // VENTILACOES
    this.ventState = "none"; // none | hidden | crawling
    this.ventAt = null;
    this.ventCooldownUntil = 0;
    this.crawlDuration = 2000;
    this.breath = 100; // "ar" para ficar escondido (acaba em ~8s)
    this.crawlTween = null;

    // LANTERNA
    this.lightRange = 200;
    this.lightHalfAngle = 0.48;
    this.lightRayCount = 90;
    this.ambientRange = 100;
    this.lightDipUntil = 0;
    this.statusUntil = 0;

    this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);

    // PISO MONTADO COM OS QUATRO AZULEJOS LIMPOS DO TILESET.
    this.add
      .tileSprite(
        this.mapWidth / 2,
        this.mapHeight / 2,
        this.mapWidth,
        this.mapHeight,
        "insideTiles",
        "floor",
      )
      .setDepth(0);
    for (const [x, y] of [
      [780, 690],
      [1390, 690],
      [280, 1040],
      [1540, 1030],
    ]) {
      this.add.image(x, y, "insideTiles", "bloodFloor").setDepth(1);
    }

    // VENTILACOES: sem fisica, o jogador passa por cima.
    // Criadas antes do jogador e da freira (mesmo depth), entao ficam desenhadas abaixo deles.
    this.createVentTexture();
    this.vents = [];

    VENT_PAIRS.forEach((pair, index) => {
      pair.forEach((p, side) => {
        const img = this.add
          .image(p.x, p.y, "ventilacao")
          .setDepth(this.worldDepth(p.y));

        this.vents.push({ pair: index, side, x: p.x, y: p.y, img });
      });
    });

    // PAREDES
    this.walls = [];
    this.wallRects = [];

    const addWall = (x, y, w, h) => {
      const wall = this.add.tileSprite(x, y, w, h, "insideTiles", "wall");
      wall.setDepth(this.worldDepth(y + h / 2));

      this.physics.add.existing(wall, true);
      this.walls.push(wall);
      this.wallRects.push({
        left: x - w / 2,
        right: x + w / 2,
        top: y - h / 2,
        bottom: y + h / 2,
      });

      return wall;
    };

    // PAREDES EXTERNAS
    addWall(this.mapWidth / 2, 10, this.mapWidth, 20);
    addWall(this.mapWidth / 2, this.mapHeight - 10, this.mapWidth, 20);
    addWall(10, this.mapHeight / 2, 20, this.mapHeight);
    addWall(this.mapWidth - 10, this.mapHeight / 2, 20, this.mapHeight);

    // PAREDES VERTICAIS
    for (const x of [500, 900, 1300]) {
      addWall(x, 330, 24, 300);
      addWall(x, 890, 24, 380);
    }

    // Ala leste conectada ao restante do asilo pelo corredor central.
    addWall(1900, 330, 24, 300);
    addWall(1900, 890, 24, 380);

    // PAREDES HORIZONTAIS
    addWall(250, 400, 400, 24);
    addWall(750, 400, 300, 24);
    addWall(1150, 400, 300, 24);

    addWall(250, 850, 400, 24);
    addWall(750, 850, 300, 24);
    addWall(1150, 850, 300, 24);

    // DIVISOES DA ALA SUL: salas menores com passagens entre elas.
    addWall(350, 1220, 620, 24);
    addWall(1150, 1220, 500, 24);
    addWall(350, 1270, 24, 100);
    addWall(350, 1490, 24, 180);
    addWall(900, 1250, 24, 60);
    addWall(900, 1490, 24, 180);
    addWall(1500, 1250, 24, 60);
    addWall(1500, 1490, 24, 180);
    addWall(1850, 1220, 100, 24);

    // ANIMACOES DA MILA: os arquivos sao folhas horizontais de quadros 32x32.
    for (const [key, texture, frames, rate] of [
      ["mila-idle-left", "milaIdleLeft", 4, 4],
      ["mila-idle-right", "milaIdleRight", 4, 4],
      ["mila-walk-left", "milaWalkLeft", 6, 8],
      ["mila-walk-right", "milaWalkRight", 6, 8],
      ["mila-run-left", "milaRunLeft", 6, 12],
      ["mila-run-right", "milaRunRight", 6, 12],
    ]) {
      if (this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(texture, {
          start: 0,
          end: frames - 1,
        }),
        frameRate: rate,
        repeat: -1,
      });
    }

    // JOGADOR
    this.player = this.add.container(110, 250);
    this.player.setDepth(this.characterDepth);
    this.playerSprite = this.add
      .sprite(0, 0, "milaIdleRight")
      .setOrigin(0.5, 0.5)
      .setScale(1.5);
    this.player.add(this.playerSprite);

    this.physics.add.existing(this.player);
    this.player.body.setSize(22, 30);
    this.player.body.setOffset(-11, -15);
    this.player.body.setCollideWorldBounds(true);

    // VILA (FREIRA): sprite sheet com quadros 32x36.
    this.nun = this.add.container(1550, 1000);
    this.nun.setDepth(this.characterDepth);
    this.nunSprite = this.add.sprite(0, 0, "freira", 0).setScale(1.5);
    this.nun.add(this.nunSprite);

    this.physics.add.existing(this.nun);
    this.nun.body.setSize(26, 38);
    this.nun.body.setOffset(-13, -19);
    this.nun.body.setCollideWorldBounds(true);
    this.nun.body.setMaxVelocity(220, 220);

    // Moveis e caixas distribuidos pelas alas, usando recortes do tileset.
    // As novas pecas tambem bloqueiam a passagem e entram na navegacao da freira.
    this.furnitureRects = [];
    this.furniture = [];
    for (const [x, y, frame] of [
      [180, 315, "bedA"],
      [640, 315, "bedB"],
      [1060, 315, "bedA"],
      [1480, 315, "bedB"],
      [1740, 315, "bedA"],
      [370, 700, "locker"],
      [820, 700, "locker"],
      [1240, 700, "locker"],
      [1660, 700, "locker"],
      [330, 1040, "crateA"],
      [760, 1040, "crateB"],
      [1160, 1040, "crateA"],
      [1460, 1120, "crateB"],
      [2050, 1080, "crateA"],
      [2080, 315, "bedA"],
      [2230, 720, "locker"],
      [1840, 1370, "crateB"],
      [2160, 1370, "crateA"],
    ]) {
      const furniture = this.add.image(x, y, "insideTiles", frame);
      furniture.setDepth(this.worldDepth(y + furniture.displayHeight / 2));
      this.physics.add.existing(furniture, true);
      this.physics.add.collider(this.player, furniture);
      this.physics.add.collider(this.nun, furniture);
      this.furniture.push(furniture);
      this.furnitureRects.push({
        left: x - furniture.displayWidth / 2,
        right: x + furniture.displayWidth / 2,
        top: y - furniture.displayHeight / 2,
        bottom: y + furniture.displayHeight / 2,
      });
    }

    // COLISOES DAS PAREDES
    for (const wall of this.walls) {
      this.physics.add.collider(this.player, wall);
      this.physics.add.collider(this.nun, wall);
    }

    // PORTAS
    this.doors = [];

    const addDoor = (x, y, w, h, locked = false) => {
      const horizontal = w > h;

      // Porta normal: madeira. Porta trancada: vermelho escuro.
      const door = this.add.rectangle(x, y, w, h, locked ? 0x792e32 : 0x966033);

      door.setStrokeStyle(4, locked ? 0xff5555 : 0xf0c778);
      door.setDepth(this.worldDepth(y + h / 2));

      this.physics.add.existing(door, true);

      door.isLocked = locked;
      door.isOpen = false;
      door.decorations = [];
      door.lockIcon = null;
      door.rect = {
        left: x - w / 2,
        right: x + w / 2,
        top: y - h / 2,
        bottom: y + h / 2,
      };

      const addDetail = (obj, depth = door.depth + 0.01) => {
        obj.setDepth(depth);
        door.decorations.push(obj);
        return obj;
      };

      // MOLDURA INTERNA
      addDetail(
        this.add
          .rectangle(
            x,
            y,
            Math.max(4, w - 12),
            Math.max(4, h - 12),
            0x000000,
            0,
          )
          .setStrokeStyle(2, 0xd9ad6b),
      );

      // TABUAS DA MADEIRA
      if (horizontal) {
        for (const offset of [-5, 5]) {
          addDetail(
            this.add.rectangle(x, y + offset, Math.max(2, w - 16), 2, 0x402719),
          );
        }
      } else {
        for (const offset of [-5, 5]) {
          addDetail(
            this.add.rectangle(x + offset, y, 2, Math.max(2, h - 16), 0x402719),
          );
        }
      }

      // MACANETA
      const handleX = horizontal ? x + w * 0.32 : x + 6;
      const handleY = horizontal ? y + 5 : y + h * 0.25;

      addDetail(this.add.circle(handleX, handleY, 4, 0xffdf80));

      // CADEADO NAS PORTAS TRANCADAS
      if (locked) {
        const lock = this.add.text(x, y, "🔒", {
          fontSize: horizontal ? "18px" : "22px",
          backgroundColor: "#351719",
          padding: { x: 3, y: 2 },
        });

        lock.setOrigin(0.5);
        lock.setDepth(door.depth + 0.02);
        door.decorations.push(lock);
        door.lockIcon = lock;
      }

      // COLISOES DAS PORTAS
      this.physics.add.collider(this.player, door);
      this.physics.add.collider(this.nun, door);

      this.doors.push(door);

      return door;
    };

    // PORTAS VERTICAIS
    addDoor(500, 590, 24, 220, false);
    addDoor(900, 590, 24, 220, true);
    addDoor(1300, 590, 24, 220, false);
    addDoor(1900, 590, 24, 220, false);

    // PORTAS HORIZONTAIS
    addDoor(525, 400, 150, 24, true);
    addDoor(950, 400, 100, 24, false);
    addDoor(525, 850, 150, 24, false);
    addDoor(950, 850, 100, 24, true);

    // Portas da ala sul, posicionadas nos vaos das novas paredes.
    addDoor(780, 1220, 180, 24, false);
    addDoor(350, 1370, 24, 60, false);
    addDoor(900, 1370, 24, 120, false);
    addDoor(1500, 1370, 24, 120, false);

    this.rebuildObstacles();

    // GRADE DE NAVEGACAO (pathfinding da freira)
    this.nav = new NavGrid(
      this.mapWidth,
      this.mapHeight,
      32,
      this.wallRects.concat(this.furnitureRects),
      16,
    );

    for (const door of this.doors) {
      this.nav.addDoor(door, door.rect);
    }

    // Debug visual do A* da freira, alternado pela tecla F2.
    this.debugEnemyAI = false;
    this.debugDrawAt = 0;
    this.enemyDebugGrid = this.add.graphics().setDepth(150).setVisible(false);
    this.enemyDebugPanel = this.add
      .text(14, 14, "", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#e7f2e7",
        backgroundColor: "#080b0add",
        padding: { x: 8, y: 6 },
        lineSpacing: 3,
      })
      .setScrollFactor(0)
      .setDepth(151)
      .setVisible(false);
    this.debugCommand = "";
    this.debugCommandMessage = "Clique aqui para digitar; Enter executa.";
    this.debugCommandFocused = false;
    this.enemyDebugCommandBar = this.add
      .text(14, 166, "> \nClique aqui para digitar; Enter executa.", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#fff2c7",
        backgroundColor: "#080b0add",
        padding: { x: 8, y: 7 },
        lineSpacing: 3,
      })
      .setScrollFactor(0)
      .setDepth(151)
      .setInteractive(
        new Phaser.Geom.Rectangle(0, 0, 720, 58),
        Phaser.Geom.Rectangle.Contains,
      )
      .setVisible(false);
    this.updateDebugCommandBar();
    this.input.on("pointerdown", (pointer) => {
      if (!this.debugEnemyAI) return;
      this.debugCommandFocused = this.enemyDebugCommandBar
        .getBounds()
        .contains(pointer.x, pointer.y);
      this.debugCommandMessage = this.debugCommandFocused
        ? "Console ativo. Enter executa; clique fora para sair."
        : "Clique na caixa para digitar; Enter executa.";
      this.updateDebugCommandBar();
    });

    // Gatos aparecem em salas acessiveis e usam a mesma grade da freira.
    this.cats = [];
    const catSpawnSpots = [
      { x: 280, y: 260 },
      { x: 700, y: 260 },
      { x: 1100, y: 260 },
      { x: 1500, y: 260 },
      { x: 2080, y: 260 },
      { x: 300, y: 1000 },
      { x: 700, y: 1000 },
      { x: 1100, y: 1000 },
      { x: 1450, y: 1000 },
      { x: 2200, y: 1420 },
    ];
    const validCatSpots = catSpawnSpots.filter((spot) => {
      const cell = this.nav.nearestFree(spot.x, spot.y);
      return (
        cell &&
        Phaser.Math.Distance.Between(
          spot.x,
          spot.y,
          this.player.x,
          this.player.y,
        ) > 220
      );
    });
    const catCount = Phaser.Math.Between(2, 3);
    const catTextures = ["catGrey", "catGinger", "catMilena"];
    for (let i = 0; i < catCount && validCatSpots.length; i++) {
      const spot = Phaser.Utils.Array.RemoveRandomElement(validCatSpots);
      const texture = Phaser.Utils.Array.GetRandom(catTextures);
      const idleAnimation = `${texture}-idle`;
      if (!this.anims.exists(idleAnimation)) {
        this.anims.create({
          key: idleAnimation,
          frames: this.anims.generateFrameNumbers(texture, {
            start: 0,
            end: 3,
          }),
          frameRate: 4,
          repeat: -1,
        });
        this.anims.create({
          key: `${texture}-walk`,
          frames: this.anims.generateFrameNumbers(texture, {
            start: 32,
            end: 39,
          }),
          frameRate: 8,
          repeat: -1,
        });
        this.anims.create({
          key: `${texture}-run`,
          frames: this.anims.generateFrameNumbers(texture, {
            start: 206,
            end: 211,
          }),
          frameRate: 12,
          repeat: -1,
        });
        const scratchFrames = [
          [459, 463],
          [469, 473],
          [474, 481],
          [464, 468],
        ].flatMap(([start, end]) =>
          this.anims.generateFrameNumbers(texture, { start, end }),
        );
        this.anims.create({
          key: `${texture}-scratch`,
          frames: scratchFrames,
          frameRate: 8,
          repeat: 0,
        });
      }
      const cat = this.add
        .container(spot.x, spot.y)
        .setDepth(this.worldDepth(spot.y));
      cat.sprite = this.add.sprite(0, 0, texture, 0).setScale(1.35);
      cat.sprite.play(idleAnimation);
      cat.idleAnimation = idleAnimation;
      cat.walkAnimation = `${texture}-walk`;
      cat.runAnimation = `${texture}-run`;
      cat.scratchAnimation = `${texture}-scratch`;
      cat.scratchPlaying = false;
      cat.sprite.on("animationcomplete", (animation) => {
        if (animation.key !== cat.scratchAnimation) return;
        cat.scratchPlaying = false;
        cat.sprite.play(cat.idleAnimation);
      });
      cat.add(cat.sprite);
      this.physics.add.existing(cat);
      cat.body.setSize(20, 18).setOffset(-10, -9).setCollideWorldBounds(true);
      cat.path = [];
      cat.dest = null;
      cat.repathAt = 0;
      cat.fleeUntil = 0;
      cat.wasScared = false;
      cat.angryPlayed = false;
      cat.meowAt = this.time.now + Phaser.Math.Between(2500, 7000);
      cat.scratchAt = this.time.now + Phaser.Math.Between(5000, 11000);
      for (const wall of this.walls) this.physics.add.collider(cat, wall);
      for (const furniture of this.furniture)
        this.physics.add.collider(cat, furniture);
      for (const door of this.doors) this.physics.add.collider(cat, door);
      this.cats.push(cat);
    }

    // CHAVE EM LOCAL ALEATORIO (sempre alcancavel sem passar por porta trancada)
    const keySpots = [
      { x: 280, y: 260 },
      { x: 350, y: 600 },
      { x: 700, y: 260 },
      { x: 700, y: 600 },
      { x: 1100, y: 260 },
      { x: 1150, y: 600 },
      { x: 1500, y: 260 },
      { x: 1500, y: 700 },
      { x: 300, y: 1000 },
      { x: 700, y: 1000 },
      { x: 1100, y: 1000 },
      { x: 1450, y: 1000 },
      { x: 2080, y: 260 },
      { x: 2220, y: 980 },
      { x: 1840, y: 1420 },
      { x: 2200, y: 1420 },
    ];

    const reachable = this.nav.reachable(this.player.x, this.player.y);
    const reachableSpots = keySpots.filter((spot) =>
      this.nav.isReached(reachable, spot.x, spot.y),
    );

    const validKeySpots = (
      reachableSpots.length ? reachableSpots : keySpots
    ).filter(
      (spot) =>
        Phaser.Math.Distance.Between(
          spot.x,
          spot.y,
          this.player.x,
          this.player.y,
        ) > 260 &&
        Phaser.Math.Distance.Between(spot.x, spot.y, this.nun.x, this.nun.y) >
          180 &&
        Phaser.Math.Distance.Between(spot.x, spot.y, 2290, 1470) > 180,
    );

    const availableKeySpots = (
      validKeySpots.length
        ? validKeySpots
        : reachableSpots.length
          ? reachableSpots
          : keySpots
    ).slice();
    const normalKeySpot =
      Phaser.Utils.Array.RemoveRandomElement(availableKeySpots);
    const masterKeySpot = Phaser.Utils.Array.GetRandom(availableKeySpots);

    const addCollectibleKey = (spot, texture, onCollect) => {
      const item = this.add.image(spot.x, spot.y, texture);
      item
        .setDisplaySize(20, 42)
        .setDepth(this.worldDepth(spot.y + item.displayHeight / 2));
      this.physics.add.existing(item, true);
      this.tweens.add({
        targets: item,
        angle: 360,
        duration: 4000,
        repeat: -1,
      });
      this.physics.add.overlap(this.player, item, () => {
        if (this.gameOver || item.collected) return;
        item.collected = true;
        item.destroy();
        onCollect();
      });
      return item;
    };

    this.keyItem = addCollectibleKey(normalKeySpot, "chave", () => {
      this.hasKey = true;
      this.catGuideTarget = masterKeySpot;
      this.normalKeyIndicator.setVisible(true);
      this.applyDifficultyTuning(this.difficulty);
      this.say(
        "Voce encontrou a chave das portas! A freira ouviu o barulho...",
        5000,
      );
      if (this.nunState === "patrol") {
        this.setNunState("investigate");
        this.setNunDestination(this.player.x, this.player.y);
      }
    });
    this.masterKeyItem = addCollectibleKey(masterKeySpot, "chaveMestra", () => {
      this.hasMasterKey = true;
      this.masterKeyIndicator.setVisible(true);
      this.catGuideTarget = { x: 2290, y: 1470 };
      this.say("Voce encontrou a chave mestra. Agora alcance a saida!", 5000);
    });
    this.catGuideTarget = normalKeySpot;
    // SAIDA
    this.exit = this.add.rectangle(2290, 1470, 70, 90, 0x522d2d);

    this.exit.setStrokeStyle(4, 0x98756b);
    this.exit.setDepth(this.worldDepth(1470 + 45));

    this.physics.add.existing(this.exit, true);

    this.physics.add.overlap(this.player, this.exit, () => {
      if (this.gameOver) return;

      if (this.hasMasterKey) {
        this.finish(true);
      } else {
        this.say("A saida precisa da chave mestra.");
      }
    });

    // COLISAO COM A FREIRA
    this.physics.add.overlap(this.player, this.nun, () => this.finish(false));

    // CONTROLES
    this.keys = this.input.keyboard.addKeys(
      "W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,E,SPACE",
    );
    this.input.keyboard.on("keydown-F2", () => {
      this.debugEnemyAI = !this.debugEnemyAI;
      this.enemyDebugGrid.setVisible(this.debugEnemyAI);
      this.enemyDebugPanel.setVisible(this.debugEnemyAI);
      this.enemyDebugCommandBar.setVisible(this.debugEnemyAI);
      this.debugCommandFocused = false;
      this.debugCommandMessage = "Clique aqui para digitar; Enter executa.";
      this.updateDebugCommandBar();
      if (!this.debugEnemyAI) this.enemyDebugGrid.clear();
      else this.drawEnemyDebug(this.time.now, true);
    });
    this.input.keyboard.addCapture(Phaser.Input.Keyboard.KeyCodes.F2);
    this.input.keyboard.on("keydown", (event) =>
      this.handleDebugCommandKey(event),
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

    this.drawStamina();
    this.updateLighting(0, 0);
    this.createMainMenu();
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

    add(
      this.add.text(80, 472, "WASD / SETAS  mover     SHIFT  correr", {
        fontFamily: "Arial",
        fontSize: "13px",
        color: "#8f8d88",
      }),
    );
    add(
      this.add.text(80, 497, "E  interagir     ESPAÇO  rastejar", {
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
      const y = 154 + index * 86;
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

  setDoorOpen(door, open) {
    door.isOpen = open;
    door.setVisible(!open);
    door.body.enable = !open;

    if (!open) door.body.updateFromGameObject();

    for (const detail of door.decorations) {
      detail.setVisible(!open);
    }

    this.rebuildObstacles();
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

    this.setDoorOpen(door, true);
    this.say(
      wasLocked ? "Você destrancou e abriu a porta." : "Você abriu a porta.",
    );
  }

  // ---------------------------------------------------------------
  // VENTILACOES (atalho entre salas + esconderijo)
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
    if (this.debugCommandFocused) return;
    if (this.gameOver || !this.gameStarted) return;

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
    if (this.debugCommandFocused) return;
    if (this.gameOver) return;

    if (!this.gameStarted) {
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

    // ela te viu entrar? (confere antes de sumir)
    const saw =
      this.nunCanSee(430) ||
      (this.nunState === "chase" && now - this.nunLastSeenAt < 1400);

    this.ventState = "hidden";
    this.ventAt = vent;
    this.playerRunning = false;

    this.player.setPosition(vent.x, vent.y);
    this.player.body.setVelocity(0, 0);
    this.player.body.enable = false;
    this.player.setVisible(false);

    if (saw) {
      this.nunHunt = {
        stage: "toEntry",
        entry: vent,
        target: { x: vent.x, y: vent.y },
        expireAt: now + 40000,
      };

      this.setNunState("ventHunt");
      this.nunRepathAt = 0;
      this.say("A freira viu você entrar na ventilação!", 3500);
      this.cameras.main.shake(180, 0.005);
    } else if (this.makeNoise(vent.x, vent.y, 320)) {
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
      this.makeNoise(v.x, v.y, 360);
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

    if (!inVent) {
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

  drawEnemyDebug(now, force = false) {
    if (!this.debugEnemyAI || (!force && now < this.debugDrawAt)) return;
    this.debugDrawAt = now + 160;

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
    g.lineStyle(1, 0x9fc69f, 0.18);
    for (let cx = left; cx <= right; cx++) {
      const x = cx * size;
      g.lineBetween(x, top * size, x, (bottom + 1) * size);
    }
    for (let cy = top; cy <= bottom; cy++) {
      const y = cy * size;
      g.lineBetween(left * size, y, (right + 1) * size, y);
    }

    g.fillStyle(0xff3b3b, 0.25);
    for (let cy = top; cy <= bottom; cy++) {
      for (let cx = left; cx <= right; cx++) {
        if (!this.nav.isFree(cx, cy)) {
          g.fillRect(cx * size + 1, cy * size + 1, size - 2, size - 2);
        }
      }
    }

    if (this.nunPath.length) {
      g.lineStyle(4, 0xffcf4a, 0.95);
      g.beginPath();
      g.moveTo(this.nun.x, this.nun.y);
      for (const point of this.nunPath) g.lineTo(point.x, point.y);
      g.strokePath();
      g.fillStyle(0xffcf4a, 1);
      for (const point of this.nunPath) g.fillCircle(point.x, point.y, 5);
    } else if (this.nunDest) {
      g.lineStyle(3, 0xffcf4a, 0.8);
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
        g.lineStyle(2, color, 0.75);
        g.fillStyle(color, 1);
        g.fillCircle(cat.dest.x, cat.dest.y, 6);
      }
    });

    const destination = this.nunDest
      ? `${Math.round(this.nunDest.x)}, ${Math.round(this.nunDest.y)}`
      : "parada";
    const lockedDoors = this.doors.filter(
      (door) => door.isLocked && !door.isOpen,
    ).length;
    this.enemyDebugPanel.setText([
      "DEBUG IA  [F2]",
      `Freira: ${this.nunState} | A*: ligado`,
      `Caminho: ${this.nunPath.length}${this.nunPathFailed ? " (sem rota)" : ""}`,
      `Destino: ${destination}`,
      `Portas trancadas: ${lockedDoors}`,
      `Gatos: ${this.cats.length} | A*: nivel ${CAT_AI_DIFFICULTY}`,
      `Freira: nivel ${this.difficulty.toFixed(2)} (${this.difficultyFollowMultiplier.toFixed(1)}x seguindo gato)`,
    ]);
  }

  applyDifficultyTuning(level) {
    const f = Phaser.Math.Clamp(level / 10, 0, 1);
    const value = (low, high) => Phaser.Math.Linear(low, high, f);
    this.nunWanderSpeed = value(55, 82);
    this.nunInvestigateSpeed = value(76, 112);
    const chaseSpeed = value(98, 142);
    this.nunChaseSpeedWithKey = chaseSpeed + value(18, 28);
    this.nunChaseSpeed = this.hasKey
      ? this.nunChaseSpeedWithKey
      : chaseSpeed;
    this.nunCloseSense = value(90, 145);
    this.nunFov = value(0.8, 1.1);
    this.nunVisionRange = value(275, 430);
    this.nunRunningVisionBonus = value(65, 105);
    this.nunHearingRange = value(260, 470);
  }

  setDebugDifficulty(level) {
    this.difficulty = Phaser.Math.Clamp(level, 0, 10);
    this.applyDifficultyTuning(this.difficulty);
    this.nunRepathAt = 0;
    this.registry.set("enemyDifficulty", this.difficulty);
  }

  isPlayerFollowingCat() {
    const playerVelocity = this.player.body.velocity;
    const playerSpeed = Math.hypot(playerVelocity.x, playerVelocity.y);
    if (playerSpeed < 25) return false;

    return this.cats.some((cat) => {
      if (this.time.now < cat.fleeUntil) return false;
      const catSpeed = Math.hypot(cat.body.velocity.x, cat.body.velocity.y);
      if (catSpeed < 20) return false;
      if (
        Phaser.Math.Distance.Between(
          this.player.x,
          this.player.y,
          cat.x,
          cat.y,
        ) > 190
      ) {
        return false;
      }

      const alignment =
        (playerVelocity.x * cat.body.velocity.x +
          playerVelocity.y * cat.body.velocity.y) /
        (playerSpeed * catSpeed);
      return alignment > 0.2;
    });
  }

  updateAdaptiveDifficulty(now, delta) {
    if (!this.gameStarted || this.gameOver) return;

    this.difficultyPlaySeconds += delta / 1000;
    if (now < this.difficultyNextUpdate) return;
    this.difficultyNextUpdate = now + 1000;
    this.difficultyFollowMultiplier = this.isPlayerFollowingCat() ? 1.5 : 1;

    const previous = this.difficulty;
    const gain = (0.45 / 60) * this.difficultyFollowMultiplier;
    this.difficulty = Phaser.Math.Clamp(this.difficulty + gain, 0, 10);
    if (this.difficulty !== previous) {
      this.applyDifficultyTuning(this.difficulty);
      this.nunRepathAt = 0;
      this.registry.set("enemyDifficulty", this.difficulty);
    }
  }

  updateDebugCommandBar() {
    if (!this.enemyDebugCommandBar) return;
    this.enemyDebugCommandBar.setText(
      `> ${this.debugCommand}\n${this.debugCommandMessage}`,
    );
  }

  handleDebugCommandKey(event) {
    if (!this.debugEnemyAI || !this.debugCommandFocused || event.code === "F2")
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
        this.debugCommandMessage = "Comandos: difficulty 0-10, status, repath, goto X Y";
      } else if (/^status$/i.test(command)) {
        this.debugCommandMessage = `Freira: ${this.nunState}; A*: ligado; pontos: ${this.nunPath.length}.`;
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
        if (level >= 0 && level <= 10) {
          this.setDebugDifficulty(level);
          this.debugCommandMessage = `Dificuldade manual definida: ${level.toFixed(1)}.`;
        } else {
          this.debugCommandMessage = "Use um valor entre 0 e 10.";
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

  // ---------------------------------------------------------------
  // FREIRA
  // ---------------------------------------------------------------

  setNunState(state) {
    if (this.nunState === state) return;

    this.nunState = state;

    const pursuing = state === "chase" || state === "ventHunt";
    if (pursuing) {
      if (this.ambientMusic.isPlaying) this.ambientMusic.pause();
      if (!this.chaseMusic.isPlaying) this.chaseMusic.play();
    } else {
      if (this.chaseMusic.isPlaying) this.chaseMusic.stop();
      if (this.gameStarted && !this.gameOver && !this.ambientMusic.isPlaying) {
        if (this.ambientMusic.isPaused) this.ambientMusic.resume();
        else this.ambientMusic.play();
      }
    }

    // destaca a freira em vermelho enquanto ela persegue a personagem
    this.nunSprite.setTint(
      state === "chase" || state === "ventHunt" ? 0xffb0b0 : 0xffffff,
    );
  }

  updateCats(now) {
    for (const cat of this.cats) {
      const distanceToNun = Phaser.Math.Distance.Between(
        cat.x,
        cat.y,
        this.nun.x,
        this.nun.y,
      );
      const distanceToPlayer = Phaser.Math.Distance.Between(
        cat.x,
        cat.y,
        this.player.x,
        this.player.y,
      );
      const playerCanHearCat = distanceToPlayer <= CAT_AUDIBLE_RADIUS;
      const scared = distanceToNun < 210;
      if (scared) cat.fleeUntil = now + 700;
      const fleeing = now < cat.fleeUntil;
      if (fleeing) {
        if (!cat.wasScared) {
          if (cat.scratchPlaying) cat.sprite.stop();
          cat.scratchPlaying = false;
          cat.repathAt = 0;
        }
      }
      if (
        fleeing &&
        !cat.angryPlayed &&
        playerCanHearCat &&
        now >= this.catSoundCooldown
      ) {
        this.catAngrySound.play();
        this.catSoundCooldown = now + 900;
        cat.angryPlayed = true;
      }
      if (!fleeing) cat.angryPlayed = false;
      cat.wasScared = fleeing;

      if (!fleeing && now >= cat.meowAt) {
        if (playerCanHearCat && now >= this.catSoundCooldown) {
          this.catMeowSound.play();
          this.catSoundCooldown = now + 500;
          cat.meowAt = now + Phaser.Math.Between(7000, 13000);
        } else {
          cat.meowAt = now + 500;
        }
      }

      if (now >= cat.repathAt) {
        if (fleeing) {
          const angle = Phaser.Math.Angle.Between(
            this.nun.x,
            this.nun.y,
            cat.x,
            cat.y,
          );
          const fleeTarget = {
            x: Phaser.Math.Clamp(
              cat.x + Math.cos(angle) * 250,
              24,
              this.mapWidth - 24,
            ),
            y: Phaser.Math.Clamp(
              cat.y + Math.sin(angle) * 250,
              24,
              this.mapHeight - 24,
            ),
          };
          cat.dest = fleeTarget;
        } else {
          cat.dest = this.catGuideTarget;
        }
        const path =
          cat.dest &&
          this.nav.findPath(cat.x, cat.y, cat.dest.x, cat.dest.y, true);
        cat.path = path || [];
        cat.repathAt = now + CAT_REPATH_INTERVAL;
      }

      const atGuide =
        !fleeing &&
        cat.dest &&
        Phaser.Math.Distance.Between(cat.x, cat.y, cat.dest.x, cat.dest.y) < 58;
      if (atGuide) {
        cat.body.setVelocity(0, 0);
        if (!fleeing && !cat.scratchPlaying && now >= cat.scratchAt) {
          if (playerCanHearCat) this.catScratchSound.play();
          cat.scratchPlaying = true;
          cat.sprite.play(cat.scratchAnimation);
          cat.scratchAt = now + Phaser.Math.Between(9000, 16000);
        } else if (
          !cat.scratchPlaying &&
          cat.sprite.anims.currentAnim?.key !== cat.idleAnimation
        ) {
          cat.sprite.play(cat.idleAnimation);
        }
        continue;
      }

      while (
        cat.path.length &&
        Phaser.Math.Distance.Between(
          cat.x,
          cat.y,
          cat.path[0].x,
          cat.path[0].y,
        ) < 12
      ) {
        cat.path.shift();
      }
      const target = cat.path[0];
      if (!target) {
        cat.body.setVelocity(0, 0);
        if (cat.scratchPlaying) {
          cat.sprite.stop();
          cat.scratchPlaying = false;
        }
        if (cat.sprite.anims.currentAnim?.key !== cat.idleAnimation) {
          cat.sprite.play(cat.idleAnimation);
        }
        continue;
      }
      if (cat.scratchPlaying) {
        cat.sprite.stop();
        cat.scratchPlaying = false;
      }
      const moveAnimation = fleeing ? cat.runAnimation : cat.walkAnimation;
      if (cat.sprite.anims.currentAnim?.key !== moveAnimation) {
        cat.sprite.play(moveAnimation);
      }
      const angle = Phaser.Math.Angle.Between(cat.x, cat.y, target.x, target.y);
      cat.body.setVelocity(
        Math.cos(angle) * (fleeing ? 125 : 72),
        Math.sin(angle) * (fleeing ? 125 : 72),
      );
      cat.setDepth(this.worldDepth(cat.y));
    }
  }

  // calcula o caminho ate o destino
  setNunDestination(x, y) {
    this.nunDest = { x, y };

    const path = this.nav.findPath(this.nun.x, this.nun.y, x, y);
    if (path && path.length > 1) path.shift();

    this.nunPathFailed = !path;
    this.nunPath = path || [];
  }

  nunArrived() {
    if (this.nunPath.length > 0) return false;
    if (!this.nunPathFailed || !this.nunDest) return true;

    return (
      Phaser.Math.Distance.Between(
        this.nun.x,
        this.nun.y,
        this.nunDest.x,
        this.nunDest.y,
      ) <= 24
    );
  }

  stopNun() {
    this.nun.body.setVelocity(0, 0);
    this.nunMoving = false;
  }

  // segue o caminho; se nao ha caminho, vai direto ao destino
  moveNun(speed, directTarget = null) {
    let target = directTarget;

    if (!target) {
      while (
        this.nunPath.length &&
        Phaser.Math.Distance.Between(
          this.nun.x,
          this.nun.y,
          this.nunPath[0].x,
          this.nunPath[0].y,
        ) < 10
      ) {
        this.nunPath.shift();
      }

      if (this.nunPath.length) {
        target = this.nunPath[0];
      } else if (
        this.nunPathFailed &&
        this.nunDest &&
        Phaser.Math.Distance.Between(
          this.nun.x,
          this.nun.y,
          this.nunDest.x,
          this.nunDest.y,
        ) > 24
      ) {
        target = this.nunDest;
      }
    }

    if (!target) {
      this.stopNun();
      return;
    }

    const a = Phaser.Math.Angle.Between(
      this.nun.x,
      this.nun.y,
      target.x,
      target.y,
    );

    this.nun.body.setVelocity(Math.cos(a) * speed, Math.sin(a) * speed);
    this.nunMoving = true;
  }

  // a freira enxerga: alcance, cone de visao (ou muito perto) e linha de visao livre
  nunCanSee(visionRange) {
    // escondido ou rastejando na ventilacao: ninguem te ve
    if (this.ventState !== "none") return false;

    const nx = this.nun.x;
    const ny = this.nun.y;
    const px = this.player.x;
    const py = this.player.y;

    const dist = Phaser.Math.Distance.Between(nx, ny, px, py);

    if (dist > visionRange) return false;

    const angleTo = Math.atan2(py - ny, px - nx);
    const diff = Math.abs(Phaser.Math.Angle.Wrap(angleTo - this.nunFacing));

    if (dist > this.nunCloseSense && diff > this.nunFov) return false;

    return this.hasLineOfSight(nx, ny, px, py);
  }

  // escolhe um ponto de patrulha alcancavel (as vezes perto do jogador)
  pickPatrolTarget() {
    const visited = this.nav.reachable(this.nun.x, this.nun.y);

    if (!visited) return;

    const far = [];
    const nearPlayer = [];

    for (let cy = 0; cy < this.nav.rows; cy++) {
      for (let cx = 0; cx < this.nav.cols; cx++) {
        if (!visited[cy * this.nav.cols + cx]) continue;

        const c = this.nav.center(cx, cy);

        if (
          Phaser.Math.Distance.Between(c.x, c.y, this.nun.x, this.nun.y) < 250
        ) {
          continue;
        }

        far.push(c);

        if (
          Phaser.Math.Distance.Between(c.x, c.y, this.player.x, this.player.y) <
          520
        ) {
          nearPlayer.push(c);
        }
      }
    }

    const pool =
      nearPlayer.length && Math.random() < 0.35
        ? nearPlayer
        : far.length
          ? far
          : null;

    if (!pool) return;

    const target = Phaser.Utils.Array.GetRandom(pool);

    this.setNunDestination(target.x, target.y);
  }

  // escolhe um ponto proximo para "procurar" o jogador
  pickSearchSpot() {
    const spots = [];
    const base = this.nun;

    for (let i = 0; i < 14; i++) {
      const x = base.x + Phaser.Math.Between(-220, 220);
      const y = base.y + Phaser.Math.Between(-220, 220);
      const cell = this.nav.toCell(x, y);

      if (this.nav.isFree(cell.cx, cell.cy)) spots.push({ x, y });
    }

    if (!spots.length) return false;

    const t = Phaser.Utils.Array.GetRandom(spots);

    this.setNunDestination(t.x, t.y);
    return true;
  }

  onNunSpotted() {
    this.say("A FREIRA TE VIU!", 2500);
    this.screamSound.play();
    this.cameras.main.shake(220, 0.006);
  }

  updateNun(now, delta) {
    this.updateAdaptiveDifficulty(now, delta);
    const nun = this.nun;
    const px = this.player.x;
    const py = this.player.y;
    const dist = Phaser.Math.Distance.Between(nun.x, nun.y, px, py);

    // A FREIRA ABRE PORTAS DESTRANCADAS
    for (const door of this.doors) {
      if (door.isOpen || door.isLocked) continue;

      if (this.distanceToDoor(door, nun.x, nun.y) < 40) {
        this.setDoorOpen(door, true);

        if (dist < 520) this.say("Uma porta se abriu por perto...", 2500);
      }
    }

    // PERCEPCAO
    const visionRange =
      this.nunVisionRange +
      (this.playerRunning ? this.nunRunningVisionBonus : 0);
    const seesPlayer = this.nunCanSee(visionRange);
    const heardPlayer =
      this.playerRunning &&
      this.ventState === "none" &&
      dist <= this.nunHearingRange;

    if (seesPlayer) {
      if (this.nunState !== "chase") this.onNunSpotted();

      this.nunHunt = null;
      this.setNunState("chase");
      this.nunLastSeen = { x: px, y: py };
      this.nunLastSeenAt = now;
    } else if (this.nunState === "chase") {
      // perdeu o jogador de vista: vai ate onde viu por ultimo e procura
      if (now - this.nunLastSeenAt > 1400) {
        this.setNunState("search");
        this.nunSearchUntil = 0;
        this.setNunDestination(this.nunLastSeen.x, this.nunLastSeen.y);
      }
    } else if (heardPlayer && this.nunState === "patrol") {
      this.setNunState("investigate");
      this.setNunDestination(px, py);
    }

    // COMPORTAMENTO POR ESTADO
    switch (this.nunState) {
      case "chase": {
        const target = seesPlayer ? { x: px, y: py } : this.nunLastSeen;

        if (now >= this.nunRepathAt) {
          this.setNunDestination(target.x, target.y);
          this.nunRepathAt = now + 250;
        }

        const direct = seesPlayer && dist < 110;

        this.moveNun(this.nunChaseSpeed, direct ? target : null);
        break;
      }

      case "ventHunt": {
        // ela viu voce entrar: vai ate a ventilacao e, se nao te achar, confere a outra ponta
        const h = this.nunHunt;

        if (!h || now > h.expireAt) {
          this.nunHunt = null;
          this.setNunState("patrol");
          this.nunDest = null;
          break;
        }

        if (now >= this.nunRepathAt) {
          this.setNunDestination(h.target.x, h.target.y);
          this.nunRepathAt = now + 400;
        }

        this.moveNun(this.nunChaseSpeed);

        const dTarget = Phaser.Math.Distance.Between(
          nun.x,
          nun.y,
          h.target.x,
          h.target.y,
        );

        if (dTarget < 36 || (dTarget < 80 && this.nunArrived())) {
          if (h.stage === "toEntry") {
            const inside =
              this.ventState === "hidden" &&
              this.ventAt &&
              this.ventAt.pair === h.entry.pair &&
              this.ventAt.side === h.entry.side;

            if (inside) {
              this.finish(
                false,
                "A freira puxou você para fora da ventilação!",
              );
              break;
            }

            // voce ja rastejou: ela vai esperar na outra ponta
            const other = this.ventPartner(h.entry);

            h.stage = "toExit";
            h.target = { x: other.x, y: other.y };
            this.setNunDestination(other.x, other.y);
            this.nunRepathAt = now + 400;
          } else {
            // chegou na saida: fica ali parada, de olho
            this.nunHunt = null;
            this.setNunState("search");
            this.nunWaitUntil = now + 4500;
            this.nunSearchUntil = now + 8000;
            this.nunDest = null;
            this.stopNun();
          }
        }
        break;
      }

      case "investigate": {
        this.moveNun(this.nunInvestigateSpeed);

        if (this.nunArrived()) {
          this.setNunState("search");
          this.nunSearchUntil = now + 4500;
          this.nunWaitUntil = now + 700;
          this.nunDest = null;
        }
        break;
      }

      case "search": {
        if (this.nunSearchUntil === 0) {
          // ainda indo ao ultimo ponto visto
          this.moveNun(this.nunInvestigateSpeed);

          if (this.nunArrived()) {
            this.nunSearchUntil = now + 4500;
            this.nunWaitUntil = now + 700;
            this.nunDest = null;
          }
        } else if (now > this.nunSearchUntil) {
          this.setNunState("patrol");
          this.nunSearchUntil = 0;
          this.nunDest = null;
          this.nunWaitUntil = 0;
        } else if (now < this.nunWaitUntil) {
          this.stopNun();
        } else {
          if (!this.nunDest || this.nunArrived()) {
            if (this.nunDest) {
              this.nunDest = null;
              this.nunWaitUntil = now + Phaser.Math.Between(500, 1100);
              this.stopNun();
              break;
            }

            this.pickSearchSpot();
          }

          this.moveNun(this.nunWanderSpeed);
        }
        break;
      }

      default: {
        // patrol
        if (now < this.nunWaitUntil) {
          this.stopNun();
          break;
        }

        if (!this.nunDest) {
          this.pickPatrolTarget();
        } else if (this.nunArrived()) {
          this.nunDest = null;
          this.nunWaitUntil = now + Phaser.Math.Between(900, 2200);
          this.stopNun();
          break;
        }

        this.moveNun(this.nunWanderSpeed);
      }
    }

    // DETECTA SE ESTA PRESA NA PAREDE
    if (now > this.nunStuckCheckAt) {
      const moved = Phaser.Math.Distance.Between(
        nun.x,
        nun.y,
        this.nunLastPos.x,
        this.nunLastPos.y,
      );

      if (this.nunMoving && moved < 8) {
        if (this.nunState === "chase") {
          this.nunRepathAt = 0;
        } else if (this.nunState === "patrol") {
          this.nunDest = null;
          this.nunPath = [];
        } else {
          this.setNunDestination(
            this.nunDest ? this.nunDest.x : nun.x,
            this.nunDest ? this.nunDest.y : nun.y,
          );
        }
      }

      this.nunLastPos = { x: nun.x, y: nun.y };
      this.nunStuckCheckAt = now + 700;
    }

    // DIRECAO PARA ONDE ELA OLHA (acompanha o movimento)
    const v = nun.body.velocity;

    if (Math.hypot(v.x, v.y) > 10) {
      const target = Math.atan2(v.y, v.x);
      const diff = Phaser.Math.Angle.Wrap(target - this.nunFacing);
      const step = 6 * (delta / 1000);

      this.nunFacing += Phaser.Math.Clamp(diff, -step, step);
    }
  }

  // ---------------------------------------------------------------
  // LOOP PRINCIPAL
  // ---------------------------------------------------------------

  update(time, delta) {
    if (this.gameOver || !this.gameStarted) return;

    const dt = delta / 1000;
    const k = this.keys;
    let dx = 0;
    let dy = 0;

    if (k.A.isDown || k.LEFT.isDown) dx--;
    if (k.D.isDown || k.RIGHT.isDown) dx++;
    if (k.W.isDown || k.UP.isDown) dy--;
    if (k.S.isDown || k.DOWN.isDown) dy++;

    if (this.debugEnemyAI && this.debugCommandFocused) {
      dx = 0;
      dy = 0;
    }

    // dentro da ventilacao o jogador nao anda
    if (this.ventState !== "none") {
      dx = 0;
      dy = 0;
    }

    const moving = dx !== 0 || dy !== 0;
    const length = Math.hypot(dx, dy) || 1;

    // CORRIDA COM STAMINA
    if (this.staminaLocked && this.stamina > 30) this.staminaLocked = false;

    const running =
      k.SHIFT.isDown && moving && !this.staminaLocked && this.stamina > 0;

    if (running) {
      this.stamina = Math.max(0, this.stamina - 38 * dt);
      if (this.stamina <= 0) this.staminaLocked = true;
    } else {
      this.stamina = Math.min(100, this.stamina + (moving ? 14 : 26) * dt);
    }

    this.playerRunning = running;

    const movementSound = running ? this.runningSound : this.footstepSound;
    const otherMovementSound = running ? this.footstepSound : this.runningSound;
    if (moving) {
      if (otherMovementSound.isPlaying) otherMovementSound.stop();
      if (!movementSound.isPlaying) movementSound.play();
    } else {
      this.footstepSound.stop();
      this.runningSound.stop();
    }

    // Os sprites idle estao nomeados ao contrario da orientacao que mostram.
    const facingLeft = moving ? dx < 0 : Math.cos(this.playerFacingAngle) > 0;
    const direction = facingLeft ? "left" : "right";
    const animation = moving
      ? `mila-${running ? "run" : "walk"}-${direction}`
      : `mila-idle-${direction}`;
    if (this.playerSprite.anims.currentAnim?.key !== animation) {
      this.playerSprite.play(animation);
    }

    const speed = running ? this.runSpeed : this.walkSpeed;

    this.player.body.setVelocity((dx / length) * speed, (dy / length) * speed);

    // MIRA DA LANTERNA: mouse (se mexeu recentemente) ou direcao do movimento
    let targetAngle = null;

    if (!moving || time - this.lastPointerMoveAt < 2500) {
      const pointer = this.input.activePointer;
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

      if (
        Phaser.Math.Distance.Between(this.player.x, this.player.y, wp.x, wp.y) >
        12
      ) {
        targetAngle = Phaser.Math.Angle.Between(
          this.player.x,
          this.player.y,
          wp.x,
          wp.y,
        );
      }
    }

    if (targetAngle === null && moving) targetAngle = Math.atan2(dy, dx);

    if (targetAngle !== null) {
      const diff = Phaser.Math.Angle.Wrap(targetAngle - this.playerFacingAngle);
      const step = 10 * dt;

      this.playerFacingAngle += Phaser.Math.Clamp(diff, -step, step);
    }

    // VENTILACOES (ar) E DICA DE INTERACAO
    this.updateVent(time, dt);
    this.updateHint();

    // FREIRA
    this.updateNun(time, delta);
    if (this.debugEnemyAI) this.drawEnemyDebug(time);
    this.updateCats(time);

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

    if (this.statusUntil && time > this.statusUntil) {
      this.status.setVisible(false);
      this.statusUntil = 0;
    }
  }

  // FINAL DO JOGO
  finish(won, message) {
    if (this.gameOver) return;

    this.registry.set("enemyDifficulty", this.difficulty);

    this.gameOver = true;

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
      .rectangle(480, 280, 520, 230, 0x080808, 0.97)
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

    const restartButton = this.add
      .text(480, 335, "⟳  RECOMEÇAR", {
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
      this.scene.restart();
    });
  }
}

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
