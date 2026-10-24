export const CAT_AI_DIFFICULTY = 10;
const CAT_REPATH_INTERVAL = 250;
const CAT_AUDIBLE_RADIUS = 160;
const CAT_SKINS = ["catGrey", "catGinger", "catMilena"];
const CAT_ANIM_LAYOUT = {
  idle: { row: 0, frames: 4, rate: 4 }, walk: { row: 1, frames: 6, rate: 8 },
  run: { row: 2, frames: 6, rate: 12 }, scratch: { row: 3, frames: 6, rate: 8 },
};

export function installCatMethods(Scene, ENEMY_DIFFICULTY) {
  const Methods = class {
  createCatAnimations(skin) {
    const cols = Math.max(
      1,
      Math.floor(this.textures.get(skin).getSourceImage().width / 32),
    );

    for (const [name, def] of Object.entries(CAT_ANIM_LAYOUT)) {
      const key = `${skin}-${name}`;
      if (this.anims.exists(key)) continue;

      const start = def.row * cols;
      const end = start + Math.min(def.frames, cols) - 1;

      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(skin, { start, end }),
        frameRate: def.rate,
        repeat: name === "scratch" ? 0 : -1,
      });
    }
  }

  spawnSingleCat() {
    // Garantia: nunca mais de um gato vivo na cena.
    if (this.cats.length > 0) return this.cats[0];

    const skin = Phaser.Utils.Array.GetRandom(CAT_SKINS);
    this.createCatAnimations(skin);

    // Candidatos: pontos de patrulha alcancaveis, longe do jogador e da freira.
    const reachable = this.nav.reachable(this.player.x, this.player.y);
    const all = ENEMY_DIFFICULTY.patrolPoints;
    const far = all.filter(
      (p) =>
        this.nav.isReached(reachable, p.x, p.y) &&
        Phaser.Math.Distance.Between(p.x, p.y, this.player.x, this.player.y) >
          300 &&
        Phaser.Math.Distance.Between(p.x, p.y, this.nun.x, this.nun.y) > 200,
    );
    const reached = all.filter((p) => this.nav.isReached(reachable, p.x, p.y));
    const pool = far.length ? far : reached.length ? reached : all;
    const spot = Phaser.Utils.Array.GetRandom(pool);

    const now = this.time.now;
    const cat = this.add.container(spot.x, spot.y);
    cat.sprite = this.add.sprite(0, 0, skin, 0).setScale(1.2);
    cat.add(cat.sprite);
    cat.setDepth(this.worldDepth(spot.y));

    this.physics.add.existing(cat);
    cat.body.setSize(18, 14);
    cat.body.setOffset(-9, -7);
    cat.body.setCollideWorldBounds(true);

    cat.path = [];
    cat.dest = null;
    cat.repathAt = 0;
    cat.fleeUntil = 0;
    cat.meowAt = now + Phaser.Math.Between(4000, 9000);
    cat.scratchAt = now + Phaser.Math.Between(3000, 6000);
    cat.scratchPlaying = false;
    cat.angryPlayed = false;
    cat.wasScared = false;
    cat.skin = skin;
    cat.idleAnimation = `${skin}-idle`;
    cat.walkAnimation = `${skin}-walk`;
    cat.runAnimation = `${skin}-run`;
    cat.scratchAnimation = `${skin}-scratch`;

    // Ao terminar de arranhar, volta ao idle ate o proximo arranhao.
    cat.sprite.on("animationcomplete", (anim) => {
      if (anim.key === cat.scratchAnimation) cat.scratchPlaying = false;
    });

    for (const wall of this.walls) this.physics.add.collider(cat, wall);
    for (const piece of this.furniture) this.physics.add.collider(cat, piece);
    for (const door of this.doors) this.physics.add.collider(cat, door);

    cat.sprite.play(cat.idleAnimation);
    this.cats.push(cat);
    return cat;
  }

  updateCats(now) {
    for (const cat of this.cats) {
      cat.setDepth(this.worldDepth(cat.y));

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
      if (fleeing && !cat.wasScared) {
        if (cat.scratchPlaying) cat.sprite.stop();
        cat.scratchPlaying = false;
        cat.repathAt = 0;
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
          cat.dest = {
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
        if (!cat.scratchPlaying && now >= cat.scratchAt) {
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
      const catSpeed = fleeing ? 125 : 72;
      const vx = Math.cos(angle) * catSpeed;
      cat.body.setVelocity(vx, Math.sin(angle) * catSpeed);
      if (Math.abs(vx) > 5) cat.sprite.setFlipX(vx < 0);
    }
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

  // ---------------------------------------------------------------
  // VENTILACOES (atalho entre salas + esconderijo)
  // ---------------------------------------------------------------


  };

  // Copia os metodos para o prototype da cena (class body nao precisa de virgulas).
  for (const name of Object.getOwnPropertyNames(Methods.prototype)) {
    if (name !== "constructor") {
      Object.defineProperty(
        Scene.prototype,
        name,
        Object.getOwnPropertyDescriptor(Methods.prototype, name),
      );
    }
  }
}
