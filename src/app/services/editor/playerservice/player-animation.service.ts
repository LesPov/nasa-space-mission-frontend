import { Injectable } from '@angular/core';
import { AnimationGroup, Scene } from '@babylonjs/core';
import { PlayerRuntimeConfig, normalizeAnimBinding, PlayerActionKey, PlayerSequenceStep } from '../player-config.model';
import { EstadoFisico } from './player-physics.service';
import { SeqRuntime } from './player-sequence.service';

@Injectable({ providedIn: 'root' })
export class PlayerAnimationService {
  public animacionesJugador: AnimationGroup[] = [];
  public animActual: AnimationGroup | null = null;

  private animIdle: AnimationGroup | null = null;
  private animWalk: AnimationGroup | null = null;
  private animRun: AnimationGroup | null = null;
  private animJump: AnimationGroup | null = null;
  private animJumpLoop: AnimationGroup | null = null;
  private animFall: AnimationGroup | null = null;
  private animLandSoft: AnimationGroup | null = null;
  private animHardLanding: AnimationGroup | null = null;
  private animClimb: AnimationGroup | null = null;
  private animClimbFinish: AnimationGroup | null = null;
  private animHangIdle: AnimationGroup | null = null;
  private animVault: AnimationGroup | null = null;
  private animStepUp: AnimationGroup | null = null;
  private animRecover: AnimationGroup | null = null;

  private resolveAnimation(binding: string | string[] | null, fallback: AnimationGroup | null): AnimationGroup | null {
    const names = normalizeAnimBinding(binding).map(v => v.toLowerCase());
    if (names.length === 0) return fallback;

    const exact = this.animacionesJugador.find(ag => names.some(n => ag.name.toLowerCase() === n));
    if (exact) return exact;

    const contains = this.animacionesJugador.find(ag => names.some(n => ag.name.toLowerCase().includes(n)));
    if (contains) return contains;

    return fallback;
  }

  public sincronizarAnimaciones(scene: Scene, obj: any, config: PlayerRuntimeConfig): void {
    this.animacionesJugador = [];
    const metadataNames: string[] = obj.metadata?.animationNames || [];
    
    if (metadataNames.length > 0) {
      this.animacionesJugador = scene.animationGroups.filter(ag => metadataNames.includes(ag.name));
    }
    if (this.animacionesJugador.length === 0) {
      this.animacionesJugador = scene.animationGroups.filter((ag: AnimationGroup) =>
        ag.targetedAnimations.some((ta) => ta.target.parent === obj || ta.target === obj)
      );
    }

    const anims = config.animations;

    this.animIdle = this.resolveAnimation(anims.idle, null);
    this.animWalk = this.resolveAnimation(anims.walk, this.animIdle);
    this.animRun = this.resolveAnimation(anims.run, this.animWalk);
    this.animJump = this.resolveAnimation(anims.jumpStart, this.animIdle);
    this.animJumpLoop = this.resolveAnimation(anims.jumpLoop, this.animJump);
    this.animFall = this.resolveAnimation(anims.fall, this.animJumpLoop || this.animJump);
    this.animLandSoft = this.resolveAnimation(anims.landSoft, this.animIdle);
    this.animHardLanding = this.resolveAnimation(anims.landHard, this.animLandSoft || this.animIdle);
    this.animClimb = this.resolveAnimation(anims.climbUp, this.animIdle);
    this.animClimbFinish = this.resolveAnimation(anims.climbFinish, this.animClimb);
    this.animHangIdle = this.resolveAnimation(anims.hangIdle, this.animClimb);
    this.animVault = this.resolveAnimation(anims.vault, this.animJump);
    this.animStepUp = this.resolveAnimation(anims.stepUp, this.animClimbFinish || this.animIdle);
    this.animRecover = this.resolveAnimation(anims.recover, this.animIdle);

    if (this.animWalk) this.animWalk.speedRatio = 1.0;
    if (this.animRun) this.animRun.speedRatio = 1.0;
  }

  private isActionEnabled(action: PlayerActionKey, config: PlayerRuntimeConfig): boolean {
    return config.animationEnabled?.[action] !== false;
  }

  private getAnimationForAction(action: PlayerActionKey): AnimationGroup | null {
    switch (action) {
      case 'idle': return this.animIdle;
      case 'walk': return this.animWalk || this.animIdle;
      case 'run': return this.animRun || this.animWalk || this.animIdle;
      case 'jumpStart': return this.animJump || this.animJumpLoop || this.animIdle;
      case 'jumpLoop': return this.animJumpLoop || this.animJump || this.animIdle;
      case 'fall': return this.animFall || this.animJumpLoop || this.animJump || this.animIdle;
      case 'landSoft': return this.animLandSoft || this.animIdle;
      case 'landHard': return this.animHardLanding || this.animLandSoft || this.animIdle;
      case 'climbUp': return this.animClimb || this.animIdle;
      case 'climbFinish': return this.animClimbFinish || this.animClimb || this.animIdle;
      case 'hangIdle': return this.animHangIdle || this.animClimb || this.animIdle;
      case 'vault': return this.animVault || this.animJump || this.animIdle;
      case 'stepUp': return this.animStepUp || this.animClimbFinish || this.animIdle;
      case 'recover': return this.animRecover || this.animIdle;
      default: return this.animIdle;
    }
  }

  public resolveSequenceStepAnimation(step: PlayerSequenceStep): AnimationGroup | null {
    const clipOverride = (step.clipOverride || '').trim();
    if (clipOverride) {
      const exact = this.animacionesJugador.find(ag => ag.name.toLowerCase() === clipOverride.toLowerCase());
      if (exact) return exact;
      const contains = this.animacionesJugador.find(ag => ag.name.toLowerCase().includes(clipOverride.toLowerCase()));
      if (contains) return contains;
    }
    return this.getAnimationForAction(step.action);
  }

  public playAnim(anim: AnimationGroup | null, loop: boolean, blendingSpeed: number = 0.05): void {
    if (!anim) {
      this.animacionesJugador.forEach(a => a.stop());
      this.animActual = null;
      return;
    }

    if (this.animActual === anim) {
      if (anim.isPlaying) return;
      anim.reset();
    } else {
      this.animacionesJugador.forEach(a => { if (a !== anim) a.stop(); });
      anim.reset();
      this.animActual = anim;
    }

    anim.enableBlending = blendingSpeed > 0;
    anim.blendingSpeed = blendingSpeed;
    anim.play(loop);
  }

  public detenerTodas(): void {
    if (this.animActual) {
      this.animActual.stop();
      this.animActual = null;
    }
    this.animacionesJugador.forEach(a => a.stop());
  }

  public reproducirIdle(): void {
    this.playAnim(this.animIdle, true);
  }

  public gestionarAnimaciones(estadoFisico: EstadoFisico, seqRuntime: SeqRuntime, config: PlayerRuntimeConfig): void {
    if (seqRuntime.running && seqRuntime.step) {
      const override = this.resolveSequenceStepAnimation(seqRuntime.step);
      if (override) {
        override.speedRatio = seqRuntime.step.speedRatio || 1;
        this.playAnim(override, seqRuntime.loop, seqRuntime.blend);
        return;
      }
    }

    if (estadoFisico.isHardLanding) {
      if (this.isActionEnabled('landHard', config)) this.playAnim(this.animHardLanding || this.animLandSoft || this.animIdle, false, 0.1);
      else this.playAnim(this.animIdle, true, 0.1);
    } else if (estadoFisico.isRecoveringFromFall) {
      if (this.isActionEnabled('recover', config)) this.playAnim(this.animRecover || this.animIdle, false, 0.05);
      else this.playAnim(this.animIdle, true, 0.05);
    } else if (estadoFisico.isJumping || estadoFisico.isFalling) {
      if (estadoFisico.isFalling) {
        if (this.isActionEnabled('fall', config)) this.playAnim(this.animFall || this.animJumpLoop || this.animJump || this.animIdle, false, 0.08);
        else this.playAnim(this.animIdle, true, 0.08);
      } else {
        if (this.isActionEnabled('jumpStart', config)) this.playAnim(this.animJump || this.animJumpLoop || this.animIdle, false, 0.08);
        else this.playAnim(this.animIdle, true, 0.08);
      }
    } else {
      const finalBlendSpeed = config.blend.defaultBlend ?? 0.1;
      if (estadoFisico.isMoving) {
        if (estadoFisico.isRunning) {
          if (this.isActionEnabled('run', config)) this.playAnim(this.animRun || this.animWalk || this.animIdle, true, finalBlendSpeed);
          else this.playAnim(this.animIdle, true, finalBlendSpeed);
        } else {
          if (this.isActionEnabled('walk', config)) this.playAnim(this.animWalk || this.animIdle, true, finalBlendSpeed);
          else this.playAnim(this.animIdle, true, finalBlendSpeed);
        }
      } else {
        if (this.isActionEnabled('idle', config)) this.playAnim(this.animIdle, true, finalBlendSpeed);
        else this.playAnim(null, true, finalBlendSpeed);
      }
    }
  }
}