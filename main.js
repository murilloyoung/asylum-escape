class AsylumScene extends Phaser.Scene {
  constructor() {
    super("Asylum");
  }

  create() {
    this.gameOver = false;
    this.hasKey = false;

    this.mapWidth = 1800;
    this.mapHeight = 1200;

    this.nunState = "wander";
    this.nunLastSeenAt = 0;
    this.nunTarget = null;
    this.nunNextWanderAt = 0;
    this.nunWanderSpeed = 62;
    this.nunChaseSpeed = 105;
    this.nunDetectionRange = 300;

    this.playerFacingAngle = 0;
    this.lightRange = 430;
    this.lightHalfAngle = 0.48;
    this.lightRayCount = 140;

    this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);

    // CENARIO
    this.add.rectangle(900, 600, this.mapWidth, this.mapHeight, 0x292a25);

    const floorGrid = this.add.graphics();
    floorGrid.lineStyle(1, 0x414139, 0.35);

    for (let x = 0; x <= this.mapWidth; x += 64) {
      floorGrid.lineBetween(x, 0, x, this.mapHeight);
    }

    for (let y = 0; y <= this.mapHeight; y += 64) {
      floorGrid.lineBetween(0, y, this.mapWidth, y);
    }

    // PAREDES
    this.walls = [];

    const addWall = (x, y, w, h) => {
      const wall = this.add.rectangle(x, y, w, h, 0x555149);

      wall.setStrokeStyle(4, 0x191916);
      wall.setDepth(3);

      this.physics.add.existing(wall, true);
      this.walls.push(wall);

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

    // JOGADOR
    this.player = this.add.container(110, 250);

    this.player.add([
      this.add.ellipse(0, 16, 34, 14, 0x101010, 0.5),
      this.add.rectangle(-6, 22, 7, 20, 0x20242b),
      this.add.rectangle(6, 22, 7, 20, 0x20242b),
      this.add.rectangle(0, 0, 24, 34, 0x526f89),
      this.add.ellipse(0, -25, 21, 24, 0x191715),
      this.add.ellipse(0, -24, 15, 18, 0xd9b99a),
    ]);

    this.physics.add.existing(this.player);
    this.player.body.setSize(22, 30);
    this.player.body.setOffset(-11, -15);
    this.player.body.setCollideWorldBounds(true);

    // FREIRA
    this.nun = this.add.container(1550, 1000);

    this.nun.add([
      this.add.ellipse(0, 17, 40, 13, 0x000000, 0.4),
      this.add.ellipse(0, -27, 32, 39, 0x101014),
      this.add.triangle(0, 5, -12, -20, 12, -20, 0, 43, 0xd7d1c6),
      this.add.rectangle(0, 8, 4, 47, 0xaaa398),
      this.add.ellipse(0, -28, 18, 22, 0xc7b9a8),
      this.add.ellipse(-4, -28, 2.5, 3, 0x302925),
      this.add.ellipse(4, -28, 2.5, 3, 0x302925),
    ]);

    this.physics.add.existing(this.nun);
    this.nun.body.setSize(26, 38);
    this.nun.body.setOffset(-13, -19);
    this.nun.body.setCollideWorldBounds(true);
    this.nun.body.setMaxVelocity(130, 130);

    // COLISOES DAS PAREDES
    for (const wall of this.walls) {
      this.physics.add.collider(this.player, wall);
      this.physics.add.collider(this.nun, wall);
    }

    // PORTAS
    this.doors = [];

    const addDoor = (x, y, w, h, locked = false) => {
      const horizontal = w > h;

      // Porta normal: madeira.
      // Porta trancada: vermelho escuro.
      const door = this.add.rectangle(x, y, w, h, locked ? 0x792e32 : 0x966033);

      door.setStrokeStyle(4, locked ? 0xff5555 : 0xf0c778);

      door.setDepth(5);

      this.physics.add.existing(door, true);

      door.isLocked = locked;
      door.isOpen = false;
      door.decorations = [];

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

    // CHAVE EM LOCAL ALEATORIO
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

    const validKeySpots = keySpots.filter(
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

    const keySpot = Phaser.Utils.Array.GetRandom(
      validKeySpots.length ? validKeySpots : keySpots,
    );

    this.keyItem = this.add.star(keySpot.x, keySpot.y, 5, 7, 15, 0xe4c56a);

    this.keyItem.setDepth(4);
    this.physics.add.existing(this.keyItem, true);

    this.physics.add.overlap(this.player, this.keyItem, () => {
      if (this.hasKey || this.gameOver) return;

      this.hasKey = true;
      this.keyItem.destroy();

      this.status.setText("Você encontrou a chave! Encontre a saída.");
    });

    // SAIDA
    this.exit = this.add.rectangle(1690, 1080, 70, 90, 0x522d2d);

    this.exit.setStrokeStyle(4, 0x98756b);
    this.exit.setDepth(4);

    this.physics.add.existing(this.exit, true);

    this.physics.add.overlap(this.player, this.exit, () => {
      if (this.gameOver) return;

      if (this.hasKey) {
        this.finish(true);
      } else {
        this.status.setText("A saída está trancada. Encontre a chave.");
      }
    });

    // COLISAO COM A FREIRA
    this.physics.add.overlap(this.player, this.nun, () => this.finish(false));

    // CONTROLES
    this.keys = this.input.keyboard.addKeys(
      "W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,E",
    );

    // DIRECAO DA LANTERNA PELO MOUSE
    this.input.on("pointermove", (pointer) => {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

      const distance = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        worldPoint.x,
        worldPoint.y,
      );

      if (distance > 8) {
        this.playerFacingAngle = Phaser.Math.Angle.Between(
          this.player.x,
          this.player.y,
          worldPoint.x,
          worldPoint.y,
        );
      }
    });

    // TECLA E: ABRIR E FECHAR PORTAS
    this.input.keyboard.on("keydown-E", () => {
      if (this.gameOver) return;

      const door = this.getNearbyDoor(90);

      if (!door) {
        this.status.setText("Chegue perto de uma porta para usar E.");
        return;
      }

      // FECHAR PORTA
      if (door.isOpen) {
        door.isOpen = false;
        door.setVisible(true);
        door.body.enable = true;
        door.body.updateFromGameObject();

        for (const detail of door.decorations) {
          detail.setVisible(true);
        }

        this.status.setText("Você fechou a porta.");
        return;
      }

      // PORTA TRANCADA SEM CHAVE
      if (door.isLocked && !this.hasKey) {
        this.status.setText("Porta trancada! Você precisa da chave.");
        return;
      }

      // ABRIR PORTA
      door.isOpen = true;
      door.body.enable = false;
      door.setVisible(false);

      for (const detail of door.decorations) {
        detail.setVisible(false);
      }

      this.status.setText(
        door.isLocked
          ? "Você destrancou e abriu a porta."
          : "Você abriu a porta.",
      );
    });

    // CAMERA
    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // TEXTURA DA ILUMINACAO
    this.darkTexture = this.textures.createCanvas(
      "asylumDarkness",
      this.scale.width,
      this.scale.height,
    );

    this.darkContext = this.darkTexture.getContext();

    this.darkness = this.add.image(0, 0, "asylumDarkness");

    this.darkness.setOrigin(0, 0).setScrollFactor(0).setDepth(90);

    this.glow = this.add.graphics();
    this.glow.setScrollFactor(0).setDepth(89);

    // INTERFACE
    this.add
      .text(20, 15, "♥", {
        fontSize: "32px",
        color: "#e54444",
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.status = this.add
      .text(20, 60, "Encontre a chave e escape.", {
        fontSize: "16px",
        color: "#eeeeee",
        backgroundColor: "#111111dd",
        padding: { x: 9, y: 7 },
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.add
      .text(690, 20, "O ASILO", {
        fontFamily: "Georgia",
        fontSize: "28px",
        color: "#bb4545",
      })
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

    this.updateLighting();
  }

  // ENCONTRAR A PORTA MAIS PROXIMA
  getNearbyDoor(maxDistance = 90) {
    let nearest = null;
    let nearestDistance = maxDistance;

    for (const door of this.doors) {
      if (!door.active) continue;

      const distance = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        door.x,
        door.y,
      );

      if (distance <= nearestDistance) {
        nearest = door;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  // VERIFICAR OBSTACULOS DA LANTERNA
  isLightBlocked(x, y) {
    const obstacles = [
      ...this.walls,
      ...this.doors.filter((door) => !door.isOpen),
    ];

    for (const obj of obstacles) {
      if (!obj.active) continue;

      const left = obj.x - obj.width / 2;
      const right = obj.x + obj.width / 2;
      const top = obj.y - obj.height / 2;
      const bottom = obj.y + obj.height / 2;

      if (x >= left && x <= right && y >= top && y <= bottom) {
        return true;
      }
    }

    return false;
  }

  // CALCULAR ALCANCE DA LANTERNA
  castLightRay(angle, maxDistance) {
    const step = 4;

    for (let distance = 0; distance <= maxDistance; distance += step) {
      const x = this.player.x + Math.cos(angle) * distance;
      const y = this.player.y + Math.sin(angle) * distance;

      if (this.isLightBlocked(x, y)) {
        const safeDistance = Math.max(0, distance - step);

        return {
          x: this.player.x + Math.cos(angle) * safeDistance,
          y: this.player.y + Math.sin(angle) * safeDistance,
        };
      }
    }

    return {
      x: this.player.x + Math.cos(angle) * maxDistance,
      y: this.player.y + Math.sin(angle) * maxDistance,
    };
  }

  // LANTERNA DIRECIONAL COM SOMBRAS
  updateLighting() {
    if (!this.darkContext || !this.player) return;

    const ctx = this.darkContext;
    const width = this.scale.width;
    const height = this.scale.height;
    const camera = this.cameras.main;

    const angle = this.playerFacingAngle;
    const range = this.lightRange;
    const halfAngle = this.lightHalfAngle;

    const screenX = this.player.x - camera.scrollX;
    const screenY = this.player.y - camera.scrollY;

    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "rgba(0, 0, 0, 0.97)";
    ctx.fillRect(0, 0, width, height);

    const points = [];

    for (let i = 0; i <= this.lightRayCount; i++) {
      const rayAngle =
        angle - halfAngle + (i / this.lightRayCount) * halfAngle * 2;

      const hit = this.castLightRay(rayAngle, range);

      points.push({
        x: hit.x - camera.scrollX,
        y: hit.y - camera.scrollY,
      });
    }

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";

    ctx.beginPath();
    ctx.moveTo(screenX, screenY);

    for (const point of points) {
      ctx.lineTo(point.x, point.y);
    }

    ctx.closePath();
    ctx.clip();

    const gradient = ctx.createRadialGradient(
      screenX,
      screenY,
      8,
      screenX,
      screenY,
      range,
    );

    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(0.55, "rgba(0,0,0,1)");
    gradient.addColorStop(0.8, "rgba(0,0,0,0.85)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    ctx.globalCompositeOperation = "source-over";

    this.darkTexture.refresh();

    this.glow.clear();
    this.glow.fillStyle(0xffd98a, 0.1);
    this.glow.fillCircle(screenX, screenY, 22);
  }

  // ATUALIZACAO DO JOGO E IA DA FREIRA
  update() {
    if (this.gameOver) return;

    const k = this.keys;
    let dx = 0;
    let dy = 0;

    if (k.A.isDown || k.LEFT.isDown) dx--;
    if (k.D.isDown || k.RIGHT.isDown) dx++;
    if (k.W.isDown || k.UP.isDown) dy--;
    if (k.S.isDown || k.DOWN.isDown) dy++;

    const length = Math.hypot(dx, dy) || 1;
    const speed = k.SHIFT.isDown ? 210 : 145;

    this.player.body.setVelocity((dx / length) * speed, (dy / length) * speed);

    if (dx !== 0 || dy !== 0) {
      this.playerFacingAngle = Math.atan2(dy, dx);
    }

    // DICA DE INTERACAO COM A PORTA
    const nearbyDoor = this.getNearbyDoor(90);

    if (nearbyDoor) {
      this.doorHint.setText(
        nearbyDoor.isOpen
          ? "E — FECHAR PORTA"
          : nearbyDoor.isLocked && !this.hasKey
            ? "PORTA TRANCADA — ENCONTRE A CHAVE"
            : "E — ABRIR PORTA",
      );
    } else {
      this.doorHint.setText("");
    }

    const now = this.time.now;

    const distanceToPlayer = Phaser.Math.Distance.Between(
      this.nun.x,
      this.nun.y,
      this.player.x,
      this.player.y,
    );

    // PERSEGUICAO
    if (distanceToPlayer <= this.nunDetectionRange) {
      this.nunState = "chase";
      this.nunLastSeenAt = now;

      this.nunTarget = {
        x: this.player.x,
        y: this.player.y,
      };
    } else if (this.nunState === "chase" && now - this.nunLastSeenAt > 5000) {
      this.nunState = "wander";
      this.nunTarget = null;
      this.nunNextWanderAt = 0;
    }

    if (this.nunState === "chase" && this.nunTarget) {
      const angle = Phaser.Math.Angle.Between(
        this.nun.x,
        this.nun.y,
        this.nunTarget.x,
        this.nunTarget.y,
      );

      this.nun.body.setVelocity(
        Math.cos(angle) * this.nunChaseSpeed,
        Math.sin(angle) * this.nunChaseSpeed,
      );

      if (
        distanceToPlayer > this.nunDetectionRange &&
        Phaser.Math.Distance.Between(
          this.nun.x,
          this.nun.y,
          this.nunTarget.x,
          this.nunTarget.y,
        ) < 35
      ) {
        this.nunState = "wander";
        this.nunTarget = null;
        this.nunNextWanderAt = 0;
      }
    } else {
      // PATRULHA ALEATORIA
      if (
        !this.nunTarget ||
        now >= this.nunNextWanderAt ||
        Phaser.Math.Distance.Between(
          this.nun.x,
          this.nun.y,
          this.nunTarget.x,
          this.nunTarget.y,
        ) < 30
      ) {
        this.nunTarget = {
          x: Phaser.Math.Between(100, this.mapWidth - 100),
          y: Phaser.Math.Between(100, this.mapHeight - 100),
        };

        this.nunNextWanderAt = now + Phaser.Math.Between(1800, 4000);
      }

      const angle = Phaser.Math.Angle.Between(
        this.nun.x,
        this.nun.y,
        this.nunTarget.x,
        this.nunTarget.y,
      );

      this.nun.body.setVelocity(
        Math.cos(angle) * this.nunWanderSpeed,
        Math.sin(angle) * this.nunWanderSpeed,
      );
    }

    this.updateLighting();
  }

  // FINAL DO JOGO
  finish(won) {
    if (this.gameOver) return;

    this.gameOver = true;
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
      restartButton.setStyle({
        backgroundColor: "#a33b3b",
      });
    });

    restartButton.on("pointerout", () => {
      restartButton.setStyle({
        backgroundColor: "#762d2d",
      });
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
