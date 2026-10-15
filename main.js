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

  isFree(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;

    const i = cy * this.cols + cx;
    if (this.blocked[i]) return false;

    const doors = this.cellDoors.get(i);
    if (doors) {
      for (const d of doors) {
        if (!d.isOpen && d.isLocked) return false;
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

  nearestFree(x, y, maxRing = 8) {
    const { cx, cy } = this.toCell(x, y);

    if (this.isFree(cx, cy)) return { cx, cy };

    for (let r = 1; r <= maxRing; r++) {
      let best = null;
      let bestD = Infinity;

      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.isFree(cx + dx, cy + dy)) continue;

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

  canStep(cx, cy, dx, dy) {
    if (!this.isFree(cx + dx, cy + dy)) return false;

    // sem cortar quina de parede na diagonal
    if (dx !== 0 && dy !== 0) {
      if (!this.isFree(cx + dx, cy) || !this.isFree(cx, cy + dy)) return false;
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

  findPath(sx, sy, tx, ty) {
    const start = this.nearestFree(sx, sy);
    const goal = this.nearestFree(tx, ty);

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
        if (!this.canStep(cx, cy, dx, dy)) continue;

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
    this.load.image("insideTiles", "assets/mapa/Inside_C.png");
    this.load.image("chave", "assets/mapa/itens/chave.png");
    this.load.image("chaveMestra", "assets/mapa/itens/chaveMestra.png");
  }

  create() {
    this.gameOver = false;
    this.hasKey = false;
    this.hasMasterKey = false;

    this.mapWidth = 1800;
    this.mapHeight = 1200;

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

    // LANTERNA
    this.lightRange = 430;
    this.lightHalfAngle = 0.48;
    this.lightRayCount = 90;
    this.ambientRange = 100;
    this.lightDipUntil = 0;
    this.statusUntil = 0;

    this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);

    // PISO MONTADO COM OS QUATRO AZULEJOS LIMPOS DO TILESET.
    this.add
      .tileSprite(900, 600, this.mapWidth, this.mapHeight, "insideTiles", "floor")
      .setDepth(0);
    for (const [x, y] of [[780, 690], [1390, 690], [280, 1040], [1540, 1030]]) {
      this.add.image(x, y, "insideTiles", "bloodFloor").setDepth(1);
    }

    // PAREDES
    this.walls = [];
    this.wallRects = [];

    const addWall = (x, y, w, h) => {
      const wall = this.add.tileSprite(x, y, w, h, "insideTiles", "wall");
      wall.setDepth(3);

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
    addWall(900, 10, 1800, 20);
    addWall(900, 1190, 1800, 20);
    addWall(10, 600, 20, 1200);
    addWall(1790, 600, 20, 1200);

    // PAREDES VERTICAIS
    for (const x of [500, 900, 1300]) {
      addWall(x, 330, 24, 300);
      addWall(x, 890, 24, 380);
    }

    // PAREDES HORIZONTAIS
    addWall(250, 400, 400, 24);
    addWall(750, 400, 300, 24);
    addWall(1150, 400, 300, 24);

    addWall(250, 850, 400, 24);
    addWall(750, 850, 300, 24);
    addWall(1150, 850, 300, 24);

    // JANELAS
    for (const x of [250, 700, 1100, 1550]) {
      this.add
        .rectangle(x, 110, 90, 65, 0x08090b)
        .setStrokeStyle(5, 0x777368)
        .setDepth(2);

      for (let i = -1; i <= 1; i++) {
        this.add.rectangle(x + i * 24, 110, 4, 58, 0x777368).setDepth(2);
      }
    }

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
    this.nunSprite = this.add.sprite(0, 0, "freira", 0).setScale(1.5);
    this.nun.add(this.nunSprite);

    this.physics.add.existing(this.nun);
    this.nun.body.setSize(26, 38);
    this.nun.body.setOffset(-13, -19);
    this.nun.body.setCollideWorldBounds(true);
    this.nun.body.setMaxVelocity(220, 220);

    // Moveis e caixas distribuidos pelas alas, usando recortes do tileset.
    for (const [x, y, frame] of [
      [180, 315, "bedA"],
      [640, 315, "bedB"],
      [1060, 315, "bedA"],
      [1480, 315, "bedB"],
      [370, 700, "locker"],
      [820, 700, "locker"],
      [1240, 700, "locker"],
      [330, 1040, "crateA"],
      [760, 1040, "crateB"],
      [1160, 1040, "crateA"],
    ]) {
      this.add.image(x, y, "insideTiles", frame).setDepth(2);
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
      door.setDepth(5);

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

      const addDetail = (obj, depth = 6) => {
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
        lock.setDepth(7);
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

    // PORTAS HORIZONTAIS
    addDoor(525, 400, 150, 24, true);
    addDoor(950, 400, 100, 24, false);
    addDoor(525, 850, 150, 24, false);
    addDoor(950, 850, 100, 24, true);

    this.rebuildObstacles();

    // GRADE DE NAVEGACAO (pathfinding da freira)
    this.nav = new NavGrid(
      this.mapWidth,
      this.mapHeight,
      32,
      this.wallRects,
      16,
    );

    for (const door of this.doors) {
      this.nav.addDoor(door, door.rect);
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
        Phaser.Math.Distance.Between(spot.x, spot.y, 1690, 1080) > 180,
    );

    const availableKeySpots = (
      validKeySpots.length ? validKeySpots : reachableSpots.length ? reachableSpots : keySpots
    ).slice();
    const normalKeySpot = Phaser.Utils.Array.RemoveRandomElement(availableKeySpots);
    const masterKeySpot = Phaser.Utils.Array.GetRandom(availableKeySpots);

    const addCollectibleKey = (spot, texture, onCollect) => {
      const item = this.add.image(spot.x, spot.y, texture);
      item.setDisplaySize(20, 42).setDepth(4);
      this.physics.add.existing(item, true);
      this.tweens.add({ targets: item, angle: 360, duration: 4000, repeat: -1 });
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
      this.normalKeyIndicator.setVisible(true);
      this.nunChaseSpeed = this.nunChaseSpeedWithKey;
      this.say("Voce encontrou a chave das portas! A freira ouviu o barulho...", 5000);
      if (this.nunState === "patrol") {
        this.setNunState("investigate");
        this.setNunDestination(this.player.x, this.player.y);
      }
    });

    this.masterKeyItem = addCollectibleKey(masterKeySpot, "chaveMestra", () => {
      this.hasMasterKey = true;
      this.masterKeyIndicator.setVisible(true);
      this.say("Voce encontrou a chave mestra. Agora alcance a saida!", 5000);
    });
    // SAIDA
    this.exit = this.add.rectangle(1690, 1080, 70, 90, 0x522d2d);

    this.exit.setStrokeStyle(4, 0x98756b);
    this.exit.setDepth(4);

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
      "W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,E",
    );

    this.normalKeyIndicator = this.add
      .image(84, 30, "chave")
      .setDisplaySize(16, 36)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);
    this.masterKeyIndicator = this.add
      .image(112, 30, "chaveMestra")
      .setDisplaySize(16, 36)
      .setScrollFactor(0)
      .setDepth(100)
      .setVisible(false);

    // O MOUSE MANDA NA LANTERNA QUANDO ESTA SENDO USADO
    this.input.on("pointermove", () => {
      this.lastPointerMoveAt = this.time.now;
    });

    // TECLA E: ABRIR E FECHAR PORTAS
    this.input.keyboard.on("keydown-E", () => this.interactWithDoor());

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

    this.status = this.add
      .text(20, 60, "", {
        fontSize: "16px",
        color: "#eeeeee",
        backgroundColor: "#111111dd",
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
      .text(480, 510, "", {
        fontSize: "16px",
        color: "#ffffff",
        backgroundColor: "#111111dd",
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(110);

    this.say("Encontre a chave e escape.", 6000);
    this.drawStamina();
    this.updateLighting(0, 0);
  }

  // ---------------------------------------------------------------
  // UTILIDADES
  // ---------------------------------------------------------------

  say(text, duration = 3500) {
    this.status.setText(text).setVisible(true);
    this.statusUntil = this.time.now + duration;
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

    // CONE LARGO E SUAVE (penumbra), CONE CENTRAL FORTE E LUZ AMBIENTE
    const soft = this.buildVisibility(
      angle,
      half * 1.35,
      range * 0.92,
      60,
      camera,
    );
    const core = this.buildVisibility(
      angle,
      half,
      range,
      this.lightRayCount,
      camera,
    );
    const ambient = this.buildVisibility(
      0,
      Math.PI,
      this.ambientRange * flicker,
      56,
      camera,
    );

    ctx.globalCompositeOperation = "destination-out";

    this.carveLight(sx, sy, soft, range * 0.92, 8, 0.5);
    this.carveLight(sx, sy, core, range, 8, 1);
    this.carveLight(sx, sy, ambient, this.ambientRange * flicker, 6, 0.8);

    // TOM QUENTE DA LANTERNA
    ctx.globalCompositeOperation = "source-over";
    this.tintLight(sx, sy, core, range);

    this.darkTexture.refresh();
  }

  // ---------------------------------------------------------------
  // FREIRA
  // ---------------------------------------------------------------

  setNunState(state) {
    if (this.nunState === state) return;

    this.nunState = state;

    // destaca a freira em vermelho enquanto ela persegue a personagem
    this.nunSprite.setTint(state === "chase" ? 0xffb0b0 : 0xffffff);
  }

  // calcula o caminho ate o destino
  setNunDestination(x, y) {
    this.nunDest = { x, y };

    const path = this.nav.findPath(this.nun.x, this.nun.y, x, y);

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
    this.cameras.main.shake(220, 0.006);
  }

  updateNun(now, delta) {
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
    const visionRange = this.playerRunning ? 430 : 330;
    const seesPlayer = this.nunCanSee(visionRange);
    const heardPlayer = this.playerRunning && dist <= 380;

    if (seesPlayer) {
      if (this.nunState !== "chase") this.onNunSpotted();

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
    if (this.gameOver) return;

    const dt = delta / 1000;
    const k = this.keys;
    let dx = 0;
    let dy = 0;

    if (k.A.isDown || k.LEFT.isDown) dx--;
    if (k.D.isDown || k.RIGHT.isDown) dx++;
    if (k.W.isDown || k.UP.isDown) dy--;
    if (k.S.isDown || k.DOWN.isDown) dy++;

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

    const facingLeft = dx !== 0 ? dx < 0 : Math.cos(this.playerFacingAngle) < 0;
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

    if (time - this.lastPointerMoveAt < 2500) {
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

    // DICA DE INTERACAO COM A PORTA
    const nearbyDoor = this.getNearbyDoor(55);

    if (nearbyDoor) {
      this.doorHint.setText(
        nearbyDoor.isOpen
          ? "E — FECHAR PORTA"
          : nearbyDoor.isLocked && !this.hasKey
            ? "PORTA TRANCADA - ENCONTRE A CHAVE COMUM"
            : "E — ABRIR PORTA",
      );
    } else {
      this.doorHint.setText("");
    }

    // FREIRA
    this.updateNun(time, delta);

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

    if (this.statusUntil && time > this.statusUntil) {
      this.status.setVisible(false);
      this.statusUntil = 0;
    }
  }

  // FINAL DO JOGO
  finish(won) {
    if (this.gameOver) return;

    this.gameOver = true;
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
        won ? "Você conseguiu fugir do asilo!" : "A freira capturou você...",
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
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },

  scene: [AsylumScene],
};

new Phaser.Game(config);
