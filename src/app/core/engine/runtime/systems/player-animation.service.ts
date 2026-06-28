
import { Injectable, inject } from '@angular/core';
import { AnimationGroup, Scene, Mesh } from '@babylonjs/core';
import { PlayerRuntimeConfig, PlayerActionKey, PlayerSequenceStep, normalizeAnimBinding, cloneDefaultPlayerConfig } from '../../models/player-config.model';
import { EstadoFisico } from './player-physics.service';
import { SeqRuntime } from './player-sequence.service';
import { GameEntity } from '../../entities/game.entity';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';

export interface AnimState {
  animacionesJugador: AnimationGroup[];
  animActual: AnimationGroup | null;
  animIdle: AnimationGroup | null;
  animWalk: AnimationGroup | null;
  animRun: AnimationGroup | null;
  animJump: AnimationGroup | null;
  animJumpLoop: AnimationGroup | null;
  animFall: AnimationGroup | null;
  animLandSoft: AnimationGroup | null;
  animHardLanding: AnimationGroup | null;
  animClimb: AnimationGroup | null;
  animClimbFinish: AnimationGroup | null;
  animHangIdle: AnimationGroup | null;
  animVault: AnimationGroup | null;
  animStepUp: AnimationGroup | null;
  animRecover: AnimationGroup | null;
}

@Injectable({ providedIn: 'root' })
export class PlayerAnimationService implements IUpdatable {
  public id = 'PlayerAnimationSystem';
  private states = new Map<string, AnimState>();
  private entityManager = inject(EntityManagerService);

  public animationUpdate(dtMs: number): void {
    const characters = this.entityManager.getEntitiesWithComponent('characterConfig');

    for (const entity of characters) {
      const seqRuntime = entity.playerRuntime?.seqRuntime;
      const estadoFisico = entity.playerRuntime?.physicsState;
      if (seqRuntime && estadoFisico) {
        this.gestionarAnimaciones(entity, estadoFisico, seqRuntime);
      }
    }
  }

  private getState(entityUid: string): AnimState {
    if (!this.states.has(entityUid)) {
      this.states.set(entityUid, { 
        animacionesJugador: [], animActual: null, animIdle: null, animWalk: null, animRun: null, 
        animJump: null, animJumpLoop: null, animFall: null, animLandSoft: null, animHardLanding: null, 
        animClimb: null, animClimbFinish: null, animHangIdle: null, animVault: null, animStepUp: null, 
        animRecover: null 
      });
    }
    return this.states.get(entityUid)!;
  }

  private resolveAnimation(state: AnimState, binding: string | string[] | null, fallback: AnimationGroup | null): AnimationGroup | null {
    const names = normalizeAnimBinding(binding).map(v => v.toLowerCase());
    if (names.length === 0) return fallback;

    const exact = state.animacionesJugador.find(ag => names.some(n => ag.name.toLowerCase() === n));
    if (exact) return exact;

    const contains = state.animacionesJugador.find(ag => names.some(n => ag.name.toLowerCase().includes(n)));
    if (contains) return contains;

    return fallback;
  }

  public sincronizarAnimaciones(scene: Scene, entity: GameEntity): void {
    const state = this.getState(entity.uid);
    const obj = entity.view as Mesh;
    const config = entity.playerConfig || cloneDefaultPlayerConfig();

    if (!obj) return;
    
    state.animacionesJugador = [];
    const metadataNames: string[] = entity.animationNames || [];
    
    const isTargetingObj = (ag: AnimationGroup) => {
        if (!ag.targetedAnimations) return false;
        return ag.targetedAnimations.some((ta) => {
            let current: any = ta.target;
            while(current) {
                if (current === obj) return true;
                current = current.parent;
            }
            return false;
        });
    };

    if (metadataNames.length > 0) {
      state.animacionesJugador = scene.animationGroups.filter(ag => 
          metadataNames.includes(ag.name) && isTargetingObj(ag)
      );
    }
    
    if (state.animacionesJugador.length === 0) {
      state.animacionesJugador = scene.animationGroups.filter(isTargetingObj);
    }

    const anims = config.animations;

    state.animIdle = this.resolveAnimation(state, anims.idle, null);
    state.animWalk = this.resolveAnimation(state, anims.walk, state.animIdle);
    state.animRun = this.resolveAnimation(state, anims.run, state.animWalk); 
    state.animJump = this.resolveAnimation(state, anims.jumpStart, state.animIdle);
    state.animJumpLoop = this.resolveAnimation(state, anims.jumpLoop, state.animJump);
    state.animFall = this.resolveAnimation(state, anims.fall, state.animJumpLoop || state.animJump);
    state.animLandSoft = this.resolveAnimation(state, anims.landSoft, state.animIdle);
    state.animHardLanding = this.resolveAnimation(state, anims.landHard, state.animLandSoft || state.animIdle);
    state.animClimb = this.resolveAnimation(state, anims.climbUp, state.animIdle);
    state.animClimbFinish = this.resolveAnimation(state, anims.climbFinish, state.animClimb);
    state.animHangIdle = this.resolveAnimation(state, anims.hangIdle, state.animClimb);
    state.animVault = this.resolveAnimation(state, anims.vault, state.animJump);
    state.animStepUp = this.resolveAnimation(state, anims.stepUp, state.animClimbFinish || state.animIdle);
    state.animRecover = this.resolveAnimation(state, anims.recover, state.animIdle);

    if (state.animWalk) state.animWalk.speedRatio = 1.0;
    if (state.animRun) state.animRun.speedRatio = 1.0;
  }

  private isActionEnabled(action: PlayerActionKey, config: PlayerRuntimeConfig): boolean {
    return config.animationEnabled?.[action] !== false;
  }

  private getAnimationForAction(state: AnimState, action: PlayerActionKey): AnimationGroup | null {
    switch (action) {
      case 'idle': return state.animIdle;
      case 'walk': return state.animWalk || state.animIdle;
      case 'run': return state.animRun || state.animWalk || state.animIdle;
      case 'jumpStart': return state.animJump || state.animJumpLoop || state.animIdle;
      case 'jumpLoop': return state.animJumpLoop || state.animJump || state.animIdle;
      case 'fall': return state.animFall || state.animJumpLoop || state.animJump || state.animIdle;
      case 'landSoft': return state.animLandSoft || state.animIdle;
      case 'landHard': return state.animHardLanding || state.animLandSoft || state.animIdle;
      case 'climbUp': return state.animClimb || state.animIdle;
      case 'climbFinish': return state.animClimbFinish || state.animClimb || state.animIdle;
      case 'hangIdle': return state.animHangIdle || state.animClimb || state.animIdle;
      case 'vault': return state.animVault || state.animJump || state.animIdle;
      case 'stepUp': return state.animStepUp || state.animClimbFinish || state.animIdle;
      case 'recover': return state.animRecover || state.animIdle;
      default: return null;
    }
  }

  public resolveSequenceStepAnimation(entity: GameEntity, step: PlayerSequenceStep): AnimationGroup | null {
    const state = this.getState(entity.uid);
    const clipOverride = (step.clipOverride || '').trim();
    
    if (clipOverride.toLowerCase() === 'none' || step.action === 'stopBaked') {
        return null;
    }

    if (clipOverride) {
      const exact = state.animacionesJugador.find(ag => ag.name.toLowerCase() === clipOverride.toLowerCase());
      if (exact) return exact;
      const contains = state.animacionesJugador.find(ag => ag.name.toLowerCase().includes(clipOverride.toLowerCase()));
      if (contains) return contains;
    }
    return this.getAnimationForAction(state, step.action);
  }

  public playAnim(entity: GameEntity, anim: AnimationGroup | null, loop: boolean, blendingSpeed: number = 0.05): void {
    const state = this.getState(entity.uid);
    if (!anim) {
      state.animacionesJugador.forEach(a => a.stop());
      state.animActual = null;
      return;
    }

    if (state.animActual === anim) {
      if (anim.isPlaying) return;
      anim.reset();
    } else {
      state.animacionesJugador.forEach(a => { if (a !== anim) a.stop(); });
      anim.reset();
      state.animActual = anim;
    }

    anim.enableBlending = blendingSpeed > 0;
    anim.blendingSpeed = blendingSpeed;
    anim.play(loop);
  }

  public detenerTodasGlobal(): void {
    this.states.forEach(state => {
      if (state.animActual) { state.animActual.stop(); state.animActual = null; }
      state.animacionesJugador.forEach(a => a.stop());
    });
  }

  public limpiarEstados(): void {
    this.states.clear();
  }

  public detenerTodas(entity: GameEntity): void {
    const state = this.getState(entity.uid);
    if (state.animActual) {
      state.animActual.stop();
      state.animActual = null;
    }
    state.animacionesJugador.forEach(a => a.stop());
  }

  public reproducirIdle(entity: GameEntity): void {
    const state = this.getState(entity.uid);
    this.playAnim(entity, state.animIdle, true);
  }

  public gestionarAnimaciones(entity: GameEntity, estadoFisico: EstadoFisico, seqRuntime: SeqRuntime): void {
    const state = this.getState(entity.uid);
    const config = entity.playerConfig || cloneDefaultPlayerConfig();
    
    if (entity.isCinematicControlled) {
        const animKey = entity.playerRuntime?.cinematicAnimation || 'idle';
        const targetAnim = this.getAnimationForAction(state, animKey as PlayerActionKey);
        this.playAnim(entity, targetAnim, true, 0.1);
        return;
    }

    if (seqRuntime && seqRuntime.running && seqRuntime.step) {
      if (seqRuntime.step.clipOverride === 'none' || seqRuntime.step.action === 'stopBaked') {
          this.playAnim(entity, null, false, seqRuntime.blend);
          return;
      }

      const override = this.resolveSequenceStepAnimation(entity, seqRuntime.step);
      if (override) {
        override.speedRatio = seqRuntime.step.speedRatio || 1;
        this.playAnim(entity, override, seqRuntime.loop, seqRuntime.blend);
        return;
      }
    }

    if (estadoFisico.isHardLanding) {
      if (this.isActionEnabled('landHard', config)) this.playAnim(entity, state.animHardLanding || state.animLandSoft || state.animIdle, false, 0.1);
      else this.playAnim(entity, state.animIdle, true, 0.1);
    } else if (estadoFisico.isRecoveringFromFall) {
      if (this.isActionEnabled('recover', config)) this.playAnim(entity, state.animRecover || state.animIdle, false, 0.05);
      else this.playAnim(entity, state.animIdle, true, 0.05);
    } else if (estadoFisico.isJumping || estadoFisico.isFalling) {
      if (estadoFisico.isFalling) {
        if (this.isActionEnabled('fall', config)) this.playAnim(entity, state.animFall || state.animJumpLoop || state.animJump || state.animIdle, false, 0.08);
        else this.playAnim(entity, state.animIdle, true, 0.08);
      } else {
        if (this.isActionEnabled('jumpStart', config)) this.playAnim(entity, state.animJump || state.animJumpLoop || state.animIdle, false, 0.08);
        else this.playAnim(entity, state.animIdle, true, 0.08);
      }
    } else {
      const finalBlendSpeed = config.blend.defaultBlend ?? 0.1;
      
      if (estadoFisico.isMoving) {
        if (estadoFisico.isRunning) {
          if (this.isActionEnabled('run', config)) this.playAnim(entity, state.animRun || state.animWalk || state.animIdle, true, finalBlendSpeed);
          else this.playAnim(entity, state.animIdle, true, finalBlendSpeed);
        } else {
          if (this.isActionEnabled('walk', config)) this.playAnim(entity, state.animWalk || state.animIdle, true, finalBlendSpeed);
          else this.playAnim(entity, state.animIdle, true, finalBlendSpeed);
        }
      } else {
        if (this.isActionEnabled('idle', config)) this.playAnim(entity, state.animIdle, true, finalBlendSpeed);
        else this.playAnim(entity, null, true, finalBlendSpeed);
      }
    }
  }
}
