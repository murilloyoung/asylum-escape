export const CAT_AI_DIFFICULTY = 10; // mantido por compatibilidade (nao e usado neste arquivo)

const CAT_REPATH_INTERVAL = 250;
const CAT_AUDIBLE_RADIUS = 160;
const CAT_SCARE_RADIUS = 210; // distancia da freira que assusta o gato
const CAT_FLEE_MS = 700; // quanto tempo continua fugindo depois de assustado
const CAT_FLEE_DISTANCE = 250;
const CAT_FLEE_SPEED = 125;
const CAT_WALK_SPEED = 72;
const CAT_GUIDE_REACH = 58; // perto o bastante do alvo para parar e arranhar
const CAT_WAYPOINT_REACH = 12;
const CAT_WORLD_MARGIN = 24;
// Se a fuga em linha reta (oposta a freira) nao tem caminho, tenta desviar em angulos diferentes.
const CAT_FLEE_ANGLE_OFFSETS = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8];
const CAT_SKINS = ["catGrey", "catGinger", "catMilena"];
const CAT_ANIM_LAYOUT = {
  idle: { row: 0, frames: 4, rate: 4 },
  walk: { row: 1, frames: 6, rate: 8 },
  run: { row: 2, frames: 6, rate: 12 },
  scratch: { row: 3, frames: 6, rate: 8 },
};

// Escolhe para onde o gato foge. Tenta primeiro direto para longe da freira;
// se esse destino nao tem caminho (parede, canto), tenta angulos vizinhos.
function pickFleeRoute(scene, cat) {
  const base = Phaser.Math.Angle.Between(
    scene.nun.x,
    scene.nun.y,
    cat.x,
    cat.y,
  );
  let fallback = null;

  for (const offset of CAT_FLEE_ANGLE_OFFSETS) {
    const angle = base + offset;
    const dest = {
      x: Phaser.Math.Clamp(
        cat.x + Math.cos(angle) * CAT_FLEE_DISTANCE,
        CAT_WORLD_MARGIN,
        scene.mapWidth - CAT_WORLD_MARGIN,
      ),
      y: Phaser.Math.Clamp(
        cat.y + Math.sin(angle) * CAT_FLEE_DISTANCE,
        CAT_WORLD_MARGIN,
        scene.mapHeight - CAT_WORLD_MARGIN,
      ),
    };
    const path = scene.nav.findPath(cat.x, cat.y, dest.x, dest.y, true);
    if (path && path.length) return { dest, path };
    if (!fallback) fallback = { dest, path: [] };
  }

  return fallback;
}

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

    // forced: { skin, x, y } vindo do host (multiplayer), para todos verem o mesmo gato.
    spawnSingleCat(forced = null) {
      if (!this.cats) this.cats = [];

      // CORRIGIDO: ao reiniciar a partida a instancia da cena e reaproveitada e this.cats
      // continuava com o gato da partida anterior (ja destruido). A checagem de "ja existe
      // um gato" devolvia esse gato morto e nenhum gato novo era criado.
      this.cats = this.cats.filter((c) => c.active);

      // Nunca mais de um gato vivo na cena.
      if (this.cats.length > 0) return this.cats[0];

      // CORRIGIDO: o cooldown guarda um instante de this.time.now, que volta a zero quando
      // a cena reinicia. Um valor antigo (ex.: 300000) deixava o gato mudo por minutos.
      this.catSoundCooldown = 0;

      const skin = forced
        ? forced.skin
        : Phaser.Utils.Array.GetRandom(CAT_SKINS);
      this.createCatAnimations(skin);

      // Candidatos: pontos de patrulha alcancaveis, longe do jogador e da freira.
      let spot;
      if (forced) {
        spot = { x: forced.x, y: forced.y };
      } else {
        const dist = Phaser.Math.Distance.Between;
        const reachable = this.nav.reachable(this.player.x, this.player.y);
        const all = ENEMY_DIFFICULTY.patrolPoints || [];
        const reached = all.filter((p) =>
          this.nav.isReached(reachable, p.x, p.y),
        );
        const far = reached.filter(
          (p) =>
            dist(p.x, p.y, this.player.x, this.player.y) > 300 &&
            dist(p.x, p.y, this.nun.x, this.nun.y) > 200,
        );
        const pool = far.length ? far : reached.length ? reached : all;

        if (pool.length) {
          spot = Phaser.Utils.Array.GetRandom(pool);
        } else {
          // CORRIGIDO: sem pontos de patrulha, GetRandom devolvia null e o spawn quebrava.
          console.warn(
            "[cat] sem pontos de patrulha; gato nasce perto do jogador",
          );
          spot = { x: this.player.x + 120, y: this.player.y };
        }
      }
      this.catSetup = { skin, x: spot.x, y: spot.y };

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
      cat.netTarget = { x: spot.x, y: spot.y };
      // Cliente do multiplayer: o gato e so uma copia do que o host simula.
      if (this.isClientMp) cat.body.enable = false;
      this.cats.push(cat);
      return cat;
    }

    updateCats(now) {
      for (const cat of this.cats) {
        // CORRIGIDO: ignora gato destruido (reinicio de partida) em vez de quebrar no cat.body.
        if (!cat.active || !cat.body) continue;

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

        if (distanceToNun < CAT_SCARE_RADIUS) cat.fleeUntil = now + CAT_FLEE_MS;
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
          this.catAngrySound?.play();
          this.catSoundCooldown = now + 900;
          cat.angryPlayed = true;
        }
        if (!fleeing) cat.angryPlayed = false;
        cat.wasScared = fleeing;

        if (!fleeing && now >= cat.meowAt) {
          if (playerCanHearCat && now >= this.catSoundCooldown) {
            this.catMeowSound?.play();
            this.catSoundCooldown = now + 500;
            cat.meowAt = now + Phaser.Math.Between(7000, 13000);
          } else {
            cat.meowAt = now + 500;
          }
        }

        if (now >= cat.repathAt) {
          let path = null;
          if (fleeing) {
            const route = pickFleeRoute(this, cat);
            cat.dest = route.dest;
            path = route.path;
          } else {
            cat.dest = this.catGuideTarget;
            path = cat.dest
              ? this.nav.findPath(cat.x, cat.y, cat.dest.x, cat.dest.y, true)
              : null;
          }
          cat.path = path || [];
          cat.repathAt = now + CAT_REPATH_INTERVAL;
        }

        const atGuide =
          !fleeing &&
          cat.dest &&
          Phaser.Math.Distance.Between(cat.x, cat.y, cat.dest.x, cat.dest.y) <
            CAT_GUIDE_REACH;
        if (atGuide) {
          cat.body.setVelocity(0, 0);
          if (!cat.scratchPlaying && now >= cat.scratchAt) {
            if (playerCanHearCat) this.catScratchSound?.play();
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
          ) < CAT_WAYPOINT_REACH
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

        const angle = Phaser.Math.Angle.Between(
          cat.x,
          cat.y,
          target.x,
          target.y,
        );
        const speed = fleeing ? CAT_FLEE_SPEED : CAT_WALK_SPEED;
        const vx = Math.cos(angle) * speed;
        cat.body.setVelocity(vx, Math.sin(angle) * speed);
        if (Math.abs(vx) > 5) cat.sprite.setFlipX(vx < 0);
      }
    }

    isPlayerFollowingCat() {
      const playerVelocity = this.player.body.velocity;
      const playerSpeed = Math.hypot(playerVelocity.x, playerVelocity.y);
      if (playerSpeed < 25) return false;

      return this.cats.some((cat) => {
        if (!cat.active || !cat.body) return false;
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
