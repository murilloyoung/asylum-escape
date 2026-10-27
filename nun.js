// Criação e posicionamento da freira.
export function chooseNunSpawn(scene, minDistance = 700) {
  const candidates = [];
  const reachable = scene.nav.reachable(scene.player.x, scene.player.y);
  for (let y = 80; y < scene.mapHeight - 80; y += 80) {
    for (let x = 80; x < scene.mapWidth - 80; x += 80) {
      const cell = scene.nav.toCell(x, y);
      if (!scene.nav.isReached(reachable, x, y) || !scene.nav.isFree(cell.cx, cell.cy)) continue;
      if (Phaser.Math.Distance.Between(x, y, scene.player.x, scene.player.y) >= minDistance) candidates.push({x,y});
    }
  }
  return candidates.length ? Phaser.Utils.Array.GetRandom(candidates) : {x:1550,y:1000};
}
export function createNun(scene, x, y) {
  const nun = scene.add.container(x, y).setDepth(scene.characterDepth);
  const sprite = scene.add.sprite(0, 0, "freira", 0).setScale(1.5);
  nun.add(sprite);
  scene.physics.add.existing(nun);
  nun.body.setSize(26, 38).setOffset(-13, -19).setCollideWorldBounds(true);
  nun.body.setMaxVelocity(220, 220);
  return {nun, sprite};
}
export function installNunMethods(Scene, ENEMY_DIFFICULTY) {
  const Methods = class {
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
    this.nunSprite.setTint(pursuing ? 0xffb0b0 : 0xffffff);
  }

  // calcula o caminho ate o destino
  setNunDestination(x, y) {
    // Ajusta o destino para o centro da celula livre mais proxima.
    // Assim o A* sempre termina exatamente no destino e nunArrived() funciona,
    // mesmo quando o ponto original cai numa celula bloqueada (perto de parede/movel).
    const snapped = this.nav.nearestFree(x, y);
    if (snapped) {
      const c = this.nav.center(snapped.cx, snapped.cy);
      x = c.x;
      y = c.y;
    }

    this.nunDest = { x, y };

    // Dificuldade baixa: deslocamento direto, sem A*.
    const usePath = this.pathfindingBlend > 0.01;
    if (!usePath) {
      this.nunPath = [];
      this.nunPathFailed = false;
      return;
    }

    const path = this.nav.findPath(this.nun.x, this.nun.y, x, y);

    this.nunPathFailed = !path;
    this.nunPath = path || [];
  }

  nunArrived() {
    if (this.nunPath.length > 0) return false;
    if (!this.nunDest) return true;

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

  // Segue A* quando habilitado; dificuldade baixa usa deslocamento direto.
  moveNun(speed, directTarget = null) {
    let target = directTarget;

    if (!target) {
      if (
        this.pathfindingBlend >= 0.99 &&
        this.nunPath.length === 0 &&
        !this.nunPathFailed &&
        this.nunDest &&
        Phaser.Math.Distance.Between(
          this.nun.x,
          this.nun.y,
          this.nunDest.x,
          this.nunDest.y,
        ) > 24
      ) {
        this.setNunDestination(this.nunDest.x, this.nunDest.y);
      }

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
        (this.nunPathFailed || this.pathfindingBlend < 0.99) &&
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

  moveNunAdaptive(speed, target) {
    const blend = this.pathfindingBlend || 0;
    if (blend <= 0.01) {
      this.moveNun(speed, target);
      return;
    }

    while (
      this.nunPath.length > 1 &&
      Phaser.Math.Distance.Between(
        this.nun.x,
        this.nun.y,
        this.nunPath[0].x,
        this.nunPath[0].y,
      ) < 12
    ) {
      this.nunPath.shift();
    }

    const waypoint = this.nunPath[0] || target;
    const directAngle = Phaser.Math.Angle.Between(
      this.nun.x,
      this.nun.y,
      target.x,
      target.y,
    );
    const pathAngle = Phaser.Math.Angle.Between(
      this.nun.x,
      this.nun.y,
      waypoint.x,
      waypoint.y,
    );
    const vx =
      Math.cos(directAngle) * (1 - blend) + Math.cos(pathAngle) * blend;
    const vy =
      Math.sin(directAngle) * (1 - blend) + Math.sin(pathAngle) * blend;
    const length = Math.hypot(vx, vy) || 1;
    this.nun.body.setVelocity((vx / length) * speed, (vy / length) * speed);
    this.nunMoving = true;
  }

  // a freira enxerga: alcance, cone de visao (ou muito perto) e linha de visao livre
  nunDetectsFlashlight() {
    if (!this.flashlightOn || this.ventState !== "none") return false;

    const dx = this.nun.x - this.player.x;
    const dy = this.nun.y - this.player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > this.lightRange) return false;

    const angleToNun = Math.atan2(dy, dx);
    const diff = Math.abs(
      Phaser.Math.Angle.Wrap(angleToNun - this.playerFacingAngle),
    );
    return (
      diff <= this.lightHalfAngle &&
      this.hasLineOfSight(this.player.x, this.player.y, this.nun.x, this.nun.y)
    );
  }

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
    const pool = ENEMY_DIFFICULTY.patrolPoints.filter((point) => {
      const { cx, cy } = this.nav.toCell(point.x, point.y);
      return (
        this.nav.isReached(visited, point.x, point.y) &&
        Phaser.Math.Distance.Between(point.x, point.y, this.nun.x, this.nun.y) >
          220 &&
        this.nav.isFree(cx, cy)
      );
    });
    if (!pool.length) return;
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
    const nun = this.nun;
    const tune = this.adaptiveTuning;
    const px = this.player.x;
    const py = this.player.y;
    const dist = Phaser.Math.Distance.Between(nun.x, nun.y, px, py);

    const wanderSpeed = tune.wanderSpeed;
    const investigateSpeed = tune.investigateSpeed;
    const chaseSpeed =
      tune.chaseSpeed + (this.hasKey ? tune.chaseSpeedWithKeyBonus : 0);

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
      tune.visionRange + (this.playerRunning ? tune.runningVisionBonus : 0);
    const seesPlayer =
      this.nunCanSee(visionRange) || this.nunDetectsFlashlight();
    const heardPlayer =
      this.playerRunning &&
      this.ventState === "none" &&
      dist <= tune.hearingRange;

    if (seesPlayer) {
      if (this.nunState !== "chase") {
        this.onNunSpotted();
        this.nunChaseStartedAt = now;
        this.nunNearMissCounted = false;
      }

      this.nunHunt = null;
      this.setNunState("chase");
      this.nunLastSeen = { x: px, y: py };
      this.nunLastSeenAt = now;
    } else if (this.nunState === "chase") {
      // perdeu o jogador de vista: vai ate onde viu por ultimo e procura
      if (now - this.nunLastSeenAt > tune.chaseMemoryMs) {
        this.difficultyEscapes++;
        this.changeDifficulty(ENEMY_DIFFICULTY.escapeGain);
        if (
          !this.nunNearMissCounted &&
          now - this.nunChaseStartedAt >= ENEMY_DIFFICULTY.chaseEndNearMissMs
        ) {
          this.difficultyNearMisses++;
          this.changeDifficulty(-ENEMY_DIFFICULTY.nearMissLoss);
        }
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
          this.nunRepathAt = now + tune.repathMs;
        }

        if (
          seesPlayer &&
          dist <= ENEMY_DIFFICULTY.nearMissDistance &&
          !this.nunNearMissCounted
        ) {
          this.nunNearMissCounted = true;
          this.difficultyNearMisses++;
          this.changeDifficulty(-ENEMY_DIFFICULTY.nearMissLoss);
        }
        this.moveNunAdaptive(chaseSpeed, target);
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
          this.nunRepathAt = now + tune.repathMs;
        }

        this.moveNun(chaseSpeed);

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
            this.nunWaitUntil = now + tune.patrolWaitMs;
            this.nunSearchUntil = now + tune.searchDurationMs;
            this.nunDest = null;
            this.stopNun();
          }
        }
        break;
      }

      case "investigate": {
        this.moveNun(investigateSpeed);

        if (this.nunArrived()) {
          this.setNunState("search");
          this.nunSearchUntil = now + tune.searchDurationMs;
          this.nunWaitUntil = now + tune.patrolWaitMs * 0.35;
          this.nunDest = null;
        }
        break;
      }

      case "search": {
        if (this.nunSearchUntil === 0) {
          // ainda indo ao ultimo ponto visto
          this.moveNun(investigateSpeed);

          if (this.nunArrived()) {
            this.nunSearchUntil = now + tune.searchDurationMs;
            this.nunWaitUntil = now + tune.patrolWaitMs * 0.35;
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
              const wait = tune.patrolWaitMs;
              this.nunWaitUntil =
                now + wait * Phaser.Math.FloatBetween(0.65, 1.35);
              this.stopNun();
              break;
            }

            this.pickSearchSpot();
          }

          this.moveNun(wanderSpeed);
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
          const wait = tune.patrolWaitMs;
          this.nunWaitUntil = now + wait * Phaser.Math.FloatBetween(0.65, 1.35);
          this.stopNun();
          break;
        }

        this.moveNun(wanderSpeed);
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
