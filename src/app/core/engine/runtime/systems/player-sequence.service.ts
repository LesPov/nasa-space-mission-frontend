
import { Injectable, inject } from '@angular/core';
import { Vector3, Quaternion } from '@babylonjs/core';
import { PlayerClipSequence, PlayerSequenceStep, cloneDefaultPlayerConfig } from '../../models/player-config.model';
import { GameStateService } from '../state/game-state.service';
import { GameEntity } from '../../entities/game.entity';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { Subscription } from 'rxjs';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';

export interface SeqRuntime {
  step: PlayerSequenceStep | null;
  lockInput: boolean;
  allowMovement: boolean;
  forceForwardWalk: boolean;
  forceForwardRun: boolean;
  forceJump: boolean; 
  blend: number;
  loop: boolean;
  running: boolean;
  freezeOrientation: boolean;
  rootMotion: Vector3;
}

interface SequenceActionHandler {
    execute(step: PlayerSequenceStep, entity: GameEntity, entityManager: EntityManagerService, dtMs: number, dtFraction: number, runtime: SeqRuntime): void;
}

// 🔥 ECS PURO: Desacoplado 100% de Babylon.js
const ActionHandlers: Record<string, SequenceActionHandler> = {
    procMove: {
        execute: (step, entity, em, dtMs, dtFraction) => {
            const dx = (step.procX || 0) * dtFraction;
            const dy = (step.procY || 0) * dtFraction;
            const dz = (step.procZ || 0) * dtFraction;
            entity.transform.position.x += dx;
            entity.transform.position.y += dy;
            entity.transform.position.z += dz;
            entity.isDirty = true;
        }
    },
    procRotate: {
        execute: (step, entity, em, dtMs, dtFraction) => {
            const rx = (step.procX || 0) * (Math.PI / 180) * dtFraction;
            const ry = (step.procY || 0) * (Math.PI / 180) * dtFraction;
            const rz = (step.procZ || 0) * (Math.PI / 180) * dtFraction;
            
            // Usamos Quaternion matemáticamente puro para evitar Gimbal Lock sin tocar la vista
            const currentQuat = Quaternion.FromEulerAngles(entity.transform.rotation.x, entity.transform.rotation.y, entity.transform.rotation.z);
            const deltaQuat = Quaternion.FromEulerAngles(rx, ry, rz);
            currentQuat.multiplyInPlace(deltaQuat);
            
            const newEuler = currentQuat.toEulerAngles();
            entity.transform.rotation.x = newEuler.x;
            entity.transform.rotation.y = newEuler.y;
            entity.transform.rotation.z = newEuler.z;
            entity.isDirty = true;
        }
    },
    stopBaked: {
        execute: (step, entity) => {
            entity.playerRuntime.stopBakedRequested = true;
            entity.isDirty = true;
        }
    },
    playVideo: {
        execute: (step, entity, em) => {
            const videoName = step.clipOverride; 
            if (!videoName) return;
            const target = em.getAllEntities().find(e => e.name === videoName);
            if (target && target.mediaRuntime) {
                target.mediaRuntime.videoCommand = 'play';
                target.isDirty = true;
            }
        }
    },
    pauseVideo: {
        execute: (step, entity, em) => {
            const videoName = step.clipOverride; 
            if (!videoName) return;
            const target = em.getAllEntities().find(e => e.name === videoName);
            if (target && target.mediaRuntime) {
                target.mediaRuntime.videoCommand = 'pause';
                target.isDirty = true;
            }
        }
    },
    stopVideo: {
        execute: (step, entity, em) => {
            const videoName = step.clipOverride; 
            if (!videoName) return;
            const target = em.getAllEntities().find(e => e.name === videoName);
            if (target && target.mediaRuntime) {
                target.mediaRuntime.videoCommand = 'stop';
                target.isDirty = true;
            }
        }
    },
    lightOn: {
        execute: (step, entity) => {
            if (!entity.light || !entity.lightRuntime) return;
            entity.lightRuntime.currentIntensity = entity.light.intensity > 0 ? entity.light.intensity : 1.0;
            entity.isDirty = true;
        }
    },
    lightOff: {
        execute: (step, entity) => {
            if (!entity.light || !entity.lightRuntime) return;
            entity.lightRuntime.currentIntensity = 0;
            entity.isDirty = true;
        }
    },
    lightPulse: {
        execute: (step, entity) => {
            if (!entity.light || !entity.lightRuntime) return;
            const freq = step.speedRatio || 1;
            const timeSec = performance.now() / 1000;
            entity.lightRuntime.currentIntensity = entity.light.intensity * (0.5 + 0.5 * Math.sin(timeSec * Math.PI * 2 * freq));
            entity.isDirty = true;
        }
    },
    lightFlicker: {
        execute: (step, entity) => {
            if (!entity.light || !entity.lightRuntime) return;
            const freq = step.speedRatio || 1;
            if (Math.random() < (0.1 * freq)) {
                entity.lightRuntime.currentIntensity = Math.random() > 0.5 ? entity.light.intensity : 0;
                entity.isDirty = true;
            }
        }
    }
};

@Injectable({ providedIn: 'root' })
export class PlayerSequenceService implements IUpdatable {
  public id = 'PlayerSequenceSystem';
  private gameState = inject(GameStateService);
  private eventBus = inject(GameEventBusService);
  private entityManager = inject(EntityManagerService);

  private eventSub!: Subscription;

  private activeSequences = new Map<string, {
    id: string;
    index: number;
    elapsedMs: number;
    stepEntered: boolean;
    jumpTriggered: boolean;
    orientationLocked: boolean;
    rotation: { x: number, y: number, z: number } | null;
  }>();

  constructor() {
    this.eventSub = this.eventBus.events$.subscribe(event => {
      if (event.type === 'SequenceTriggered') {
        this.buscarEIniciarSecuenciaPorId(event.payload.sequenceId);
      }
    });
  }

  public physicsUpdate(dtMs: number): void {
    const entities = this.entityManager.getAllEntities();
    for (const entity of entities) {
        if (entity.playerConfig?.sequences && entity.playerConfig.sequences.length > 0) {
            entity.playerRuntime.seqRuntime = this.actualizarSecuencia(dtMs, entity);
        } else if (!entity.playerRuntime.seqRuntime) {
            entity.playerRuntime.seqRuntime = this.getDefaultRuntime(entity);
        }
    }
  }

  public resetearSecuencias(): void {
    this.activeSequences.clear();
  }

  public detenerSecuencia(entityUid: string): void {
    this.activeSequences.delete(entityUid);
  }

  private getSeqState(entityUid: string) {
    if (!this.activeSequences.has(entityUid)) {
      this.activeSequences.set(entityUid, {
        id: '', index: 0, elapsedMs: 0, stepEntered: false,
        jumpTriggered: false, orientationLocked: false, rotation: null
      });
    }
    return this.activeSequences.get(entityUid)!;
  }

  private shouldLockOrientationForSequence(step: PlayerSequenceStep | null): boolean {
    if (!step) return false;
    return ['climbUp', 'climbFinish', 'hangIdle', 'vault', 'stepUp'].includes(step.action);
  }

  private captureSequenceOrientationState(entity: GameEntity, state: any): void {
    state.rotation = { ...entity.transform.rotation };
    state.orientationLocked = true;
  }

  private buscarEIniciarSecuenciaPorId(sequenceId: string): void {
    let found = false;
    const allEntities = this.entityManager.getAllEntities();

    for (const e of allEntities) {
      if (e.playerConfig && e.playerConfig.sequences) {
        const hasSeq = e.playerConfig.sequences.some((s: any) => s.id === sequenceId);
        if (hasSeq) {
          found = true;
          this.iniciarSecuenciaEnJuego(sequenceId, e);
        }
      }
    }

    if (!found) {
      console.warn(`⚠️ Se intentó iniciar la secuencia [${sequenceId}] pero ninguna entidad en la escena la posee.`);
    }
  }

  public iniciarSecuenciaEnJuego(sequenceId: string, entity: GameEntity): void {
    const config = entity.playerConfig || cloneDefaultPlayerConfig();

    const seqs = config.sequences?.filter(s => !!s.enabled) || [];
    const seqToRun = seqs.find(s => s.id === sequenceId);
    
    if (seqToRun) {
      if (!this.gameState.evaluateAllConditions(seqToRun.conditions)) {
          return;
      }

      const state = this.getSeqState(entity.uid);
      if (state.id === sequenceId) return;

      state.id = sequenceId;
      state.index = 0;
      state.elapsedMs = 0;
      state.stepEntered = true;
      state.jumpTriggered = false;

      this.captureSequenceOrientationState(entity, state);
    }
  }
  
  private getDefaultRuntime(entity: GameEntity): SeqRuntime {
    const config = entity.playerConfig || cloneDefaultPlayerConfig();
    return { 
        step: null, lockInput: false, allowMovement: true, forceForwardWalk: false, 
        forceForwardRun: false, forceJump: false, blend: config.blend.defaultBlend, 
        loop: true, running: false, freezeOrientation: false, rootMotion: Vector3.Zero() 
    };
  }

  public actualizarSecuencia(dtMs: number, entity: GameEntity): SeqRuntime {
    const config = entity.playerConfig || cloneDefaultPlayerConfig();
    const defaultRuntime = this.getDefaultRuntime(entity);

    const seqs = config.sequences?.filter(s => !!s.enabled) || [];
    const state = this.getSeqState(entity.uid);
    let sequence: PlayerClipSequence | null = null;
    
    const metaActiveId = (config as any)?.activeSequenceId as string | undefined;
    
    if (metaActiveId) sequence = seqs.find(s => s.id === metaActiveId) || null;
    else if (state.id) sequence = seqs.find(s => s.id === state.id) || null;

    if (!sequence || !sequence.steps || sequence.steps.length === 0) {
      state.id = '';
      return defaultRuntime;
    }

    if (state.id !== sequence.id) {
      state.id = sequence.id; 
      state.index = 0; 
      state.elapsedMs = 0; 
      state.stepEntered = true; 
      state.jumpTriggered = false;
    }

    let step = sequence.steps[Math.max(0, Math.min(state.index, sequence.steps.length - 1))] || null;

    let loopSafeguard = 0;
    while (step && !this.gameState.evaluateAllConditions(step.conditions)) {
        state.index++;
        if (state.index >= sequence.steps.length) {
            if (sequence.repeat && loopSafeguard < sequence.steps.length) {
                state.index = 0;
                loopSafeguard++;
            } else {
                state.id = '';
                return defaultRuntime;
            }
        }
        step = sequence.steps[state.index] || null;
        state.stepEntered = true;
        state.elapsedMs = 0;
    }

    if (!step) {
      state.orientationLocked = false;
      return defaultRuntime;
    }

    const runtime: SeqRuntime = { ...defaultRuntime, step, running: true };

    if (state.stepEntered) {
      state.jumpTriggered = false;
      state.orientationLocked = this.shouldLockOrientationForSequence(step);
      
      if (state.orientationLocked) {
        this.captureSequenceOrientationState(entity, state);
      }

      if (step.action === 'jumpStart') state.jumpTriggered = true;
      
      if (step.stateMutations) {
          this.gameState.applyMutations(step.stateMutations);
      }
      if (step.action === 'setState' && step.stateKey) {
          this.gameState.setVar(step.stateKey, step.stateValue);
      }

      state.stepEntered = false;
    } else {
      state.orientationLocked = this.shouldLockOrientationForSequence(step) || state.orientationLocked;
    }

    // 🔥 ECS PURO: Manejadores de acciones operan sobre entidades y componentes.
    if (step.clipOverride === 'none') {
        ActionHandlers['stopBaked']?.execute(step, entity, this.entityManager, dtMs, 0, runtime);
    }
    
    const handler = ActionHandlers[step.action];
    if (handler) {
        const durMs = Math.max(1, step.durationMs || 1000);
        handler.execute(step, entity, this.entityManager, dtMs, dtMs / durMs, runtime);
    }
    
    const soY = step.offsetY || 0;
    const soF = step.offsetForward || 0;
    if (soY !== 0 || soF !== 0) {
        const durSec = Math.max(0.001, step.durationMs / 1000);
        const dtSec = dtMs / 1000;
        runtime.rootMotion.y = (soY / durSec) * dtSec;
        runtime.rootMotion.z = (soF / durSec) * dtSec;
    }

    // Congelamiento de rotación si la animación lo solicita
    if (state.orientationLocked && state.rotation) {
        entity.transform.rotation = { ...state.rotation };
        entity.isDirty = true;
    }

    runtime.blend = typeof step.blend === 'number' ? step.blend : config.blend.defaultBlend;
    runtime.loop = !!step.loop;
    runtime.allowMovement = step.allowMovement !== false;
    runtime.lockInput = !!step.lockInput;
    runtime.freezeOrientation = state.orientationLocked;

    const lowerAction = step.action;
    runtime.forceForwardWalk = runtime.allowMovement && lowerAction === 'walk';
    runtime.forceForwardRun = runtime.allowMovement && lowerAction === 'run';
    runtime.forceJump = state.jumpTriggered && lowerAction === 'jumpStart';

    state.elapsedMs += dtMs;
    
    if (state.elapsedMs >= Math.max(1, step.durationMs || 1)) {
      state.elapsedMs = 0;
      state.index++;
      if (state.index >= sequence.steps.length) {
        if (sequence.repeat) { 
            state.index = 0; 
            state.stepEntered = true; 
        } else { 
            state.id = ''; 
            runtime.running = false; 
        }
      } else {
          state.stepEntered = true;
      }
    }

    return runtime;
  }
}