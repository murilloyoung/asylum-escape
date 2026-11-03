import { createPlayer } from "./player.js";
import { createNun, chooseNunSpawn } from "./nun.js";

export const MAP_SIZE = Object.freeze({ width: 2400, height: 1600 });

// Posicoes fixas usadas em mais de um lugar (antes eram numeros soltos no codigo).
const EXIT_POS = Object.freeze({ x: 2290, y: 1470 });
const NUN_START = Object.freeze({ x: 1550, y: 1000 });
const OUTER_WALL = 20; // espessura das paredes externas

// Paredes: [centroX, centroY, largura, altura]
const WALLS = [
  // Paredes verticais das alas (x = 500, 900, 1300): trecho de cima e trecho de baixo.
  // O vao entre elas (y 480 -> 700) e fechado pelas portas verticais.
  ...[500, 900, 1300].flatMap((x) => [
    [x, 330, 24, 300],
    [x, 890, 24, 380],
  ]),
  [1900, 330, 24, 300],
  [1900, 890, 24, 380],

  // Divisorias horizontais superiores (y = 400).
  // CORRIGIDO: a primeira agora encosta na parede externa (antes comecava em x=50 e deixava 30px de fresta).
  [235, 400, 430, 24], // x 20 -> 450
  [750, 400, 300, 24], // x 600 -> 900
  [1150, 400, 300, 24], // x 1000 -> 1300

  // Divisorias horizontais do meio (y = 850).
  [235, 850, 430, 24], // x 20 -> 450 (mesma correcao)
  [750, 850, 300, 24],
  [1150, 850, 300, 24],

  // Ala sul.
  // CORRIGIDO: parede de y=1220 agora encosta na parede externa (antes comecava em x=40).
  [340, 1220, 640, 24], // x 20 -> 660
  [1150, 1220, 500, 24], // x 900 -> 1400
  [350, 1270, 24, 100], // y 1220 -> 1320
  [350, 1490, 24, 180], // y 1400 -> 1580
  [900, 1250, 24, 60], // y 1220 -> 1280
  [900, 1490, 24, 180], // y 1400 -> 1580
  [1500, 1250, 24, 60], // y 1220 -> 1280
  [1500, 1490, 24, 180], // y 1400 -> 1580
  [1850, 1220, 100, 24],
];

// Moveis: [x, y, frame do tileset]
const FURNITURE = [
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
];

const KEY_SPOTS = [
  [280, 260],
  [350, 600],
  [700, 260],
  [700, 600],
  [1100, 260],
  [1150, 600],
  [1500, 260],
  [1500, 700],
  [300, 1000],
  [700, 1000],
  [1100, 1000],
  [1450, 1000],
  [2080, 260],
  [2220, 980],
  [1840, 1420],
  [2200, 1420],
];

function shuffled(items) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateMapLayout() {
  return {
    width: MAP_SIZE.width,
    height: MAP_SIZE.height,
    walls: WALLS.map((wall) => wall.slice()),
    furniture: shuffled(FURNITURE).map((item) => item.slice()),
    keySpots: shuffled(KEY_SPOTS).map(([x, y]) => ({ x, y })),
  };
}

// Escolhe onde ficam a chave normal e a chave mestra.
// No multiplayer o cliente usa exatamente o que o host sorteou (setup.keys).
function pickKeySpots(scene, setup) {
  if (setup) {
    return { normal: setup.keys.normal, master: setup.keys.master };
  }

  const keySpots = scene.mapLayout.keySpots;
  const dist = Phaser.Math.Distance.Between;

  // So considera pontos alcancaveis sem passar por porta trancada.
  const reachable = scene.nav.reachable(scene.player.x, scene.player.y);
  const reachableSpots = keySpots.filter((spot) =>
    scene.nav.isReached(reachable, spot.x, spot.y),
  );
  const basePool = reachableSpots.length ? reachableSpots : keySpots;

  // Prefere pontos longe do jogador, da freira e da saida.
  const farSpots = basePool.filter(
    (spot) =>
      dist(spot.x, spot.y, scene.player.x, scene.player.y) > 260 &&
      dist(spot.x, spot.y, scene.nun.x, scene.nun.y) > 180 &&
      dist(spot.x, spot.y, EXIT_POS.x, EXIT_POS.y) > 180,
  );

  const available = (farSpots.length ? farSpots : basePool).slice();
  const normal = Phaser.Utils.Array.RemoveRandomElement(available);
  const master = available.length
    ? Phaser.Utils.Array.GetRandom(available)
    : normal;

  return { normal, master };
}

export function buildMap(scene, { NavGrid, VENT_PAIRS }) {
  scene.physics.world.setBounds(0, 0, scene.mapWidth, scene.mapHeight);

  // PISO MONTADO COM OS QUATRO AZULEJOS LIMPOS DO TILESET.
  scene.add
    .tileSprite(
      scene.mapWidth / 2,
      scene.mapHeight / 2,
      scene.mapWidth,
      scene.mapHeight,
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
    scene.add.image(x, y, "insideTiles", "bloodFloor").setDepth(1);
  }

  // VENTILACOES: sem fisica, o jogador passa por cima.
  // Criadas antes do jogador e da freira (mesmo depth), entao ficam desenhadas abaixo deles.
  scene.createVentTexture();
  scene.vents = [];

  VENT_PAIRS.forEach((pair, index) => {
    pair.forEach((p, side) => {
      const img = scene.add
        .image(p.x, p.y, "ventilacao")
        .setDepth(scene.worldDepth(p.y));

      scene.vents.push({ pair: index, side, x: p.x, y: p.y, img });
    });
  });

  // PAREDES
  scene.walls = [];
  scene.wallRects = [];

  const addWall = (x, y, w, h) => {
    const wall = scene.add.tileSprite(x, y, w, h, "insideTiles", "wall");
    wall.setDepth(scene.worldDepth(y + h / 2));

    scene.physics.add.existing(wall, true);
    scene.walls.push(wall);
    scene.wallRects.push({
      left: x - w / 2,
      right: x + w / 2,
      top: y - h / 2,
      bottom: y + h / 2,
    });

    return wall;
  };

  // PAREDES EXTERNAS
  const halfWall = OUTER_WALL / 2;
  addWall(scene.mapWidth / 2, halfWall, scene.mapWidth, OUTER_WALL);
  addWall(scene.mapWidth / 2, scene.mapHeight - halfWall, scene.mapWidth, OUTER_WALL);
  addWall(halfWall, scene.mapHeight / 2, OUTER_WALL, scene.mapHeight);
  addWall(scene.mapWidth - halfWall, scene.mapHeight / 2, OUTER_WALL, scene.mapHeight);

  for (const [x, y, w, h] of scene.mapLayout.walls) addWall(x, y, w, h);

  // ANIMACOES DA MILA: os arquivos sao folhas horizontais de quadros 32x32.
  for (const [key, texture, frames, rate] of [
    ["mila-idle-left", "milaIdleLeft", 4, 4],
    ["mila-idle-right", "milaIdleRight", 4, 4],
    ["mila-walk-left", "milaWalkLeft", 6, 8],
    ["mila-walk-right", "milaWalkRight", 6, 8],
    ["mila-run-left", "milaRunLeft", 6, 12],
    ["mila-run-right", "milaRunRight", 6, 12],
  ]) {
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNumbers(texture, {
        start: 0,
        end: frames - 1,
      }),
      frameRate: rate,
      repeat: -1,
    });
  }

  // JOGADOR
  ({ player: scene.player, sprite: scene.playerSprite } = createPlayer(scene));

  // VILA (FREIRA): sprite sheet com quadros 32x36.
  ({ nun: scene.nun, sprite: scene.nunSprite } = createNun(
    scene,
    NUN_START.x,
    NUN_START.y,
  ));

  // Moveis e caixas distribuidos pelas alas, usando recortes do tileset.
  // As pecas bloqueiam a passagem e entram na navegacao da freira.
  scene.furnitureRects = [];
  scene.furniture = [];
  for (const [x, y, frame] of scene.mapLayout.furniture) {
    const furniture = scene.add.image(x, y, "insideTiles", frame);
    furniture.setDepth(scene.worldDepth(y + furniture.displayHeight / 2));
    scene.physics.add.existing(furniture, true);
    scene.physics.add.collider(scene.player, furniture);
    scene.physics.add.collider(scene.nun, furniture);
    scene.furniture.push(furniture);
    scene.furnitureRects.push({
      left: x - furniture.displayWidth / 2,
      right: x + furniture.displayWidth / 2,
      top: y - furniture.displayHeight / 2,
      bottom: y + furniture.displayHeight / 2,
    });
  }

  // COLISOES DAS PAREDES
  for (const wall of scene.walls) {
    scene.physics.add.collider(scene.player, wall);
    scene.physics.add.collider(scene.nun, wall);
  }

  // PORTAS
  scene.doors = [];

  const addDoor = (x, y, w, h, locked = false) => {
    const horizontal = w > h;

    // Porta normal: madeira. Porta trancada: vermelho escuro.
    const door = scene.add.rectangle(x, y, w, h, locked ? 0x792e32 : 0x966033);

    door.setStrokeStyle(4, locked ? 0xff5555 : 0xf0c778);
    door.setDepth(scene.worldDepth(y + h / 2));

    scene.physics.add.existing(door, true);

    door.doorIndex = scene.doors.length; // id usado para sincronizar portas no multiplayer
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
      scene.add
        .rectangle(x, y, Math.max(4, w - 12), Math.max(4, h - 12), 0x000000, 0)
        .setStrokeStyle(2, 0xd9ad6b),
    );

    // TABUAS DA MADEIRA
    for (const offset of [-5, 5]) {
      addDetail(
        horizontal
          ? scene.add.rectangle(x, y + offset, Math.max(2, w - 16), 2, 0x402719)
          : scene.add.rectangle(x + offset, y, 2, Math.max(2, h - 16), 0x402719),
      );
    }

    // MACANETA
    const handleX = horizontal ? x + w * 0.32 : x + 6;
    const handleY = horizontal ? y + 5 : y + h * 0.25;
    addDetail(scene.add.circle(handleX, handleY, 4, 0xffdf80));

    // CADEADO NAS PORTAS TRANCADAS
    if (locked) {
      const lock = scene.add.text(x, y, "🔒", {
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
    scene.physics.add.collider(scene.player, door);
    scene.physics.add.collider(scene.nun, door);

    scene.doors.push(door);

    return door;
  };

  // PORTAS VERTICAIS (vao de y 480 -> 700)
  addDoor(500, 590, 24, 220, false);
  addDoor(900, 590, 24, 220, true);
  addDoor(1300, 590, 24, 220, false);
  addDoor(1900, 590, 24, 220, false);

  // PORTAS HORIZONTAIS
  addDoor(525, 400, 150, 24, true);
  addDoor(950, 400, 100, 24, false);
  addDoor(525, 850, 150, 24, false);
  addDoor(950, 850, 100, 24, true);

  // Portas da ala sul, agora com as medidas exatas dos vaos entre as paredes.
  addDoor(780, 1220, 240, 24, false); // vao x 660 -> 900
  addDoor(350, 1360, 24, 80, false); // vao y 1320 -> 1400
  addDoor(900, 1340, 24, 120, false); // vao y 1280 -> 1400
  addDoor(1500, 1340, 24, 120, false); // vao y 1280 -> 1400

  scene.rebuildObstacles();

  // GRADE DE NAVEGACAO (pathfinding da freira e do gato)
  scene.nav = new NavGrid(
    scene.mapWidth,
    scene.mapHeight,
    32,
    scene.wallRects.concat(scene.furnitureRects),
    16,
  );

  for (const door of scene.doors) {
    scene.nav.addDoor(door, door.rect);
  }

  // Sorteia a freira sobre uma celula livre, longe do ponto inicial.
  // No multiplayer o cliente usa o ponto sorteado pelo host.
  const setup = scene.netSetup;
  const nunSpawn = setup ? setup.nun : chooseNunSpawn(scene);
  scene.nunSpawnSetup = nunSpawn;
  scene.nun.setPosition(nunSpawn.x, nunSpawn.y);
  // Cliente: a freira e so uma copia (host manda posicao e estado).
  if (scene.isClientMp) scene.nun.body.enable = false;
  scene.nun.setDepth(scene.worldDepth(nunSpawn.y));
  scene.nunLastPos = { x: nunSpawn.x, y: nunSpawn.y };

  // CHAVES EM LOCAIS ALEATORIOS (sempre alcancaveis sem passar por porta trancada)
  const { normal: normalKeySpot, master: masterKeySpot } = pickKeySpots(
    scene,
    setup,
  );
  scene.keySetup = { normal: normalKeySpot, master: masterKeySpot };
  scene.masterKeySpot = masterKeySpot;

  const addCollectibleKey = (spot, texture, which) => {
    const item = scene.add.image(spot.x, spot.y, texture);
    item
      .setDisplaySize(20, 42)
      .setDepth(scene.worldDepth(spot.y + item.displayHeight / 2));
    scene.physics.add.existing(item, true);
    scene.tweens.add({
      targets: item,
      angle: 360,
      duration: 4000,
      repeat: -1,
    });
    // a logica de coleta (chaves compartilhadas pela equipe) fica em scene.collectKey
    scene.physics.add.overlap(scene.player, item, () => {
      if (scene.gameOver || item.collected || scene.localDead) return;
      scene.collectKey(which);
    });
    return item;
  };

  scene.keyItem = addCollectibleKey(normalKeySpot, "chave", "normal");
  scene.masterKeyItem = addCollectibleKey(masterKeySpot, "chaveMestra", "master");
  scene.catGuideTarget = normalKeySpot;

  // UM UNICO GATO POR PARTIDA (no multiplayer o cliente copia o gato do host)
  scene.spawnSingleCat(setup ? setup.cat : null);

  // SAIDA
  scene.exit = scene.add.rectangle(EXIT_POS.x, EXIT_POS.y, 70, 90, 0x522d2d);
  scene.exit.setStrokeStyle(4, 0x98756b);
  scene.exit.setDepth(scene.worldDepth(EXIT_POS.y + 45));
  scene.physics.add.existing(scene.exit, true);

  scene.physics.add.overlap(scene.player, scene.exit, () => {
    if (scene.gameOver || scene.localDead) return;
    scene.onExitReached();
  });

  // COLISAO COM A FREIRA (no cliente o corpo da freira e desligado: o host decide)
  scene.physics.add.overlap(scene.player, scene.nun, () =>
    scene.onPlayerCaught(scene.localPlayerId()),
  );
}