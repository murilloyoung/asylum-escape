class AsylumScene extends Phaser.Scene {
  constructor() {
    super("Asylum");
  }

  create() {
    this.gameOver = false;
    this.hasKey = false;
    this.mapWidth = 1800;
    this.mapHeight = 1200;
    this.lightRadius = 175;

    this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);

    // =========================
    // CENÁRIO
    // =========================

    this.add.rectangle(900, 600, this.mapWidth, this.mapHeight, 0x292a25);

    const tiles = this.add.graphics();
    tiles.lineStyle(1, 0x414139, 0.45);

    for (let x = 0; x <= this.mapWidth; x += 64) {
      tiles.lineBetween(x, 0, x, this.mapHeight);
    }

    for (let y = 0; y <= this.mapHeight; y += 64) {
      tiles.lineBetween(0, y, this.mapWidth, y);
    }

    // =========================
    // PAREDES
    // =========================

    this.walls = [];

    const addWall = (x, y, w, h) => {
      const wall = this.add.rectangle(x, y, w, h, 0x555149);

      wall.setStrokeStyle(3, 0x292824);
      this.physics.add.existing(wall, true);
      this.walls.push(wall);
    };

    addWall(900, 10, 1800, 20);
    addWall(900, 1190, 1800, 20);
    addWall(10, 600, 20, 1200);
    addWall(1790, 600, 20, 1200);

    addWall(500, 180, 24, 300);
    addWall(500, 700, 24, 380);
    addWall(900, 180, 24, 300);
    addWall(900, 700, 24, 380);
    addWall(1300, 180, 24, 300);
    addWall(1300, 700, 24, 380);

    addWall(250, 400, 400, 24);
    addWall(750, 400, 300, 24);
    addWall(1150, 400, 300, 24);

    addWall(250, 850, 400, 24);
    addWall(750, 850, 300, 24);
    addWall(1150, 850, 300, 24);

    // Janelas
    for (const x of [250, 700, 1100, 1550]) {
      this.add.rectangle(x, 110, 90, 65, 0x08090b).setStrokeStyle(5, 0x777368);

      for (let i = -1; i <= 1; i++) {
        this.add.rectangle(x + i * 24, 110, 4, 58, 0x777368);
      }
    }

    // =========================
    // CRIANÇA
    // =========================

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

    // =========================
    // FREIRA
    // =========================

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

    // =========================
    // COLISÕES
    // =========================

    for (const wall of this.walls) {
      this.physics.add.collider(this.player, wall);
      this.physics.add.collider(this.nun, wall);
    }

    // =========================
    // CHAVE
    // =========================

    this.keyItem = this.add.star(1450, 250, 5, 7, 15, 0xe4c56a);

    this.physics.add.existing(this.keyItem, true);

    this.physics.add.overlap(this.player, this.keyItem, () => {
      if (this.hasKey || this.gameOver) return;

      this.hasKey = true;
      this.keyItem.destroy();

      this.status.setText("Você encontrou a chave! Encontre a saída.");
    });

    // =========================
    // SAÍDA
    // =========================

    this.exit = this.add.rectangle(1690, 1080, 70, 90, 0x522d2d);

    this.exit.setStrokeStyle(4, 0x98756b);
    this.physics.add.existing(this.exit, true);

    this.physics.add.overlap(this.player, this.exit, () => {
      if (this.gameOver) return;

      if (this.hasKey) {
        this.finish(true);
      } else {
        this.status.setText("A saída está trancada. Encontre a chave.");
      }
    });

    this.physics.add.overlap(this.player, this.nun, () => this.finish(false));

    // =========================
    // CONTROLES
    // =========================

    this.keys = this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT");

    // =========================
    // CÂMERA
    // =========================

    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    // =========================
    // ILUMINAÇÃO CORRIGIDA
    // =========================

    // A textura tem o mesmo tamanho da área visível.
    // O centro transparente é redesenhado a cada quadro.
    this.darkTexture = this.textures.createCanvas(
      "asylumDarkness",
      this.scale.width,
      this.scale.height,
    );

    this.darkContext = this.darkTexture.getContext();

    this.darkness = this.add.image(0, 0, "asylumDarkness");

    this.darkness.setOrigin(0, 0);
    this.darkness.setScrollFactor(0);
    this.darkness.setDepth(90);

    // Brilho sutil, sem a luz branca gigante.
    this.glow = this.add.graphics();
    this.glow.setScrollFactor(0);
    this.glow.setDepth(89);

    // =========================
    // INTERFACE
    // =========================

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

    this.updateLighting();
  }

  // =========================
  // LUZ: RECORTE TRANSPARENTE
  // =========================

  updateLighting() {
    if (!this.darkContext || !this.player) return;

    const ctx = this.darkContext;
    const width = this.scale.width;
    const height = this.scale.height;
    const camera = this.cameras.main;

    const x = this.player.x - camera.scrollX;
    const y = this.player.y - camera.scrollY;

    // Primeiro cobre a tela com escuridão.
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "rgba(0, 0, 0, 0.94)";
    ctx.fillRect(0, 0, width, height);

    // Apaga a escuridão gradualmente ao redor da criança.
    // destination-out cria transparência real.
    ctx.globalCompositeOperation = "destination-out";

    const gradient = ctx.createRadialGradient(x, y, 8, x, y, this.lightRadius);

    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(0.35, "rgba(0,0,0,0.98)");
    gradient.addColorStop(0.65, "rgba(0,0,0,0.78)");
    gradient.addColorStop(0.85, "rgba(0,0,0,0.35)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(
      x - this.lightRadius,
      y - this.lightRadius,
      this.lightRadius * 2,
      this.lightRadius * 2,
    );

    // Restaura a composição normal e atualiza a textura.
    ctx.globalCompositeOperation = "source-over";
    this.darkTexture.refresh();

    // Brilho dourado sutil na área iluminada.
    this.glow.clear();

    this.glow.fillStyle(0xffe4a8, 0.035);
    this.glow.fillCircle(x, y, this.lightRadius * 0.65);
  }

  // =========================
  // ATUALIZAÇÃO DO JOGO
  // =========================

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

    // Perseguição da freira.
    const angle = Phaser.Math.Angle.Between(
      this.nun.x,
      this.nun.y,
      this.player.x,
      this.player.y,
    );

    this.nun.body.setVelocity(Math.cos(angle) * 105, Math.sin(angle) * 105);

    this.updateLighting();
  }

  // =========================
  // FIM DE JOGO
  // =========================

  finish(won) {
    if (this.gameOver) return;

    this.gameOver = true;
    this.physics.pause();

    this.add
      .rectangle(480, 280, 520, 180, 0x080808, 0.96)
      .setScrollFactor(0)
      .setDepth(200);

    this.add
      .text(480, 260, won ? "VOCÊ ESCAPOU" : "FIM DE JOGO", {
        fontFamily: "Georgia",
        fontSize: "30px",
        color: won ? "#d8c18a" : "#d34b4b",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);

    this.add
      .text(480, 315, "Recarregue a página para jogar novamente.", {
        fontSize: "14px",
        color: "#eeeeee",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201);
  }
}

// =========================
// CONFIGURAÇÃO PHASER
// =========================

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
