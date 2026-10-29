// Criacao do jogador e movimento (andar, correr, stamina, mira da lanterna).
export function createPlayer(scene) {
  // No multiplayer cada jogador nasce em um ponto proprio (slot) perto do inicio.
  const slot = scene.mpSlot || 0;
  const player = scene.add.container(
    110 + (slot % 2) * 40,
    250 + Math.floor(slot / 2) * 40,
  );
  player.setDepth(scene.characterDepth);

  const sprite = scene.add
    .sprite(0, 0, "milaIdleRight")
    .setOrigin(0.5, 0.5)
    .setScale(1.5);
  player.add(sprite);

  scene.physics.add.existing(player);
  player.body.setSize(22, 30);
  player.body.setOffset(-11, -15);
  player.body.setCollideWorldBounds(true);

  return { player, sprite };
}

export function installPlayerMethods(Scene) {
  const Methods = class {
    updatePlayer(time, delta) {
      // multiplayer: jogador capturado vira espectador
      if (this.localDead) {
        this.footstepSound.stop();
        this.runningSound.stop();
        this.playerRunning = false;
        return;
      }

      const dt = delta / 1000;
      const k = this.keys;
      let dx = 0;
      let dy = 0;

      // digitando no console de debug: o jogador nao se mexe
      if (!this.debugCommandFocused) {
        if (k.A.isDown || k.LEFT.isDown) dx--;
        if (k.D.isDown || k.RIGHT.isDown) dx++;
        if (k.W.isDown || k.UP.isDown) dy--;
        if (k.S.isDown || k.DOWN.isDown) dy++;
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
        k.SHIFT.isDown &&
        !this.debugCommandFocused &&
        moving &&
        !this.staminaLocked &&
        this.stamina > 0;

      if (running) {
        this.stamina = Math.max(0, this.stamina - 38 * dt);
        if (this.stamina <= 0) this.staminaLocked = true;
      } else {
        this.stamina = Math.min(100, this.stamina + (moving ? 14 : 26) * dt);
      }

      this.playerRunning = running;

      const movementSound = running ? this.runningSound : this.footstepSound;
      const otherSound = running ? this.footstepSound : this.runningSound;
      if (moving) {
        if (otherSound.isPlaying) otherSound.stop();
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
          Phaser.Math.Distance.Between(this.player.x, this.player.y, wp.x, wp.y) > 12
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
    }
  };

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
