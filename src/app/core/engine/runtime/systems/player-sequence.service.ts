import { Injectable, inject, Injector } from '@angular/core';
import { Mesh, Quaternion, Vector3, Light, StandardMaterial, VideoTexture, Color3 } from '@babylonjs/core';
import { GameSession } from '../game-session';
import { Motor3dService } from '../../../../services/motor-3d.service';
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
    execute(step: PlayerSequenceStep, entity: GameEntity, motor3d: Motor3dService, dtMs: number, dtFraction: number, runtime: SeqRuntime): void;
}

const ActionHandlers: Record<string, SequenceActionHandler> = {
    procMove: {
        execute: (step, entity, motor3d, dtMs, dtFraction) => {
            const mesh = entity.view as Mesh;
            if (!mesh) return;
            const dx = (step.procX || 0) * dtFraction;
            const dy = (step.procY || 0) * dtFraction;
            const dz = (step.procZ || 0) * dtFraction;
            mesh.position.addInPlaceFromFloats(dx, dy, dz);
        }
    },
    procRotate: {
        execute: (step, entity, motor3d, dtMs, dtFraction) => {
            const mesh = entity.view as Mesh;
            if (!mesh) return;
            const rx = (step.procX || 0) * (Math.PI / 180) * dtFraction;
            const ry = (step.procY || 0) * (Math.PI / 180) * dtFraction;
            const rz = (step.procZ || 0) * (Math.PI / 180) * dtFraction;
            if (mesh.rotationQuaternion) {
                mesh.rotationQuaternion.multiplyInPlace(Quaternion.FromEulerAngles(rx, ry, rz));
            } else {
                mesh.rotation.addInPlaceFromFloats(rx, ry, rz);
            }
        }
    },
    stopBaked: {
        execute: (step, entity, motor3d) => {
            const mesh = entity.view as Mesh;
            if (!mesh) return;
            const myAnimNames = entity.animationNames || [];
            motor3d.scene.animationGroups.forEach(ag => {
                if (myAnimNames.includes(ag.name) && ag.isPlaying) {
                    const isTargetingMe = ag.targetedAnimations?.some((ta:any) => {
                        let current: any = ta.target;
                        while(current) {
                            if (current === mesh) return true;
                            current = current.parent;
                        }
                        return false;
                    });
                    if (isTargetingMe) ag.stop();
                }
            });
        }
    },
    playVideo: {
        execute: (step, entity, motor3d) => {
            const videoName = step.clipOverride; 
            if (!videoName) return;
            const videoMesh = motor3d.scene.getMeshByName(videoName);
            if (videoMesh && videoMesh.material instanceof StandardMaterial) {
                const texture = videoMesh.material.diffuseTexture;
                if (texture && texture instanceof VideoTexture) {
                    texture.video.play();
                    videoMesh.material.emissiveColor = new Color3(0.4, 0.4, 0.4); 
                }
            }
        }
    },
    pauseVideo: {
        execute: (step, entity, motor3d) => {
            const videoName = step.clipOverride; 
            if (!videoName) return;
            const videoMesh = motor3d.scene.getMeshByName(videoName);
            if (videoMesh && videoMesh.material instanceof StandardMaterial) {
                const texture = videoMesh.material.diffuseTexture;
                if (texture && texture instanceof VideoTexture) {
                    texture.video.pause();
                    videoMesh.material.emissiveColor = new Color3(0.2, 0.2, 0.2); 
                }
            }
        }
    },
    stopVideo: {
        execute: (step, entity, motor3d) => {
            const videoName = step.clipOverride; 
            if (!videoName) return;
            const videoMesh = motor3d.scene.getMeshByName(videoName);
            if (videoMesh && videoMesh.material instanceof StandardMaterial) {
                const texture = videoMesh.material.diffuseTexture;
                if (texture && texture instanceof VideoTexture) {
                    texture.video.pause();
                    texture.video.currentTime = 0; 
                    videoMesh.material.emissiveColor = new Color3(0, 0, 0); 
                }
            }
        }
    },
    lightOn: {
        execute: (step, entity, motor3d) => {
            if (!entity.type.startsWith('light_') || !entity.view) return;
            const light = entity.view.getDescendants(false).find(c => c instanceof Light) as Light;
            if (light) light.intensity = entity.light?.intensity ?? 1.0;
        }
    },
    lightOff: {
        execute: (step, entity, motor3d) => {
            if (!entity.type.startsWith('light_') || !entity.view) return;
            const light = entity.view.getDescendants(false).find(c => c instanceof Light) as Light;
            if (light) light.intensity = 0;
        }
    },
    lightPulse: {
        execute: (step, entity, motor3d) => {
            if (!entity.type.startsWith('light_') || !entity.view) return;
            const light = entity.view.getDescendants(false).find(c => c instanceof Light) as Light;
            if (light) {
                const freq = step.speedRatio || 1;
                const timeSec = performance.now() / 1000;
                light.intensity = (entity.light?.intensity ?? 1.0) * (0.5 + 0.5 * Math.sin(timeSec * Math.PI * 2 * freq));
            }
        }
    },
    lightFlicker: {
        execute: (step, entity, motor3d) => {
            if (!entity.type.startsWith('light_') || !entity.view) return;
            const light = entity.view.getDescendants(false).find(c => c instanceof Light) as Light;
            if (light) {
                const freq = step.speedRatio || 1;
                if (Math.random() < (0.1 * freq)) {
                    light.intensity = Math.random() > 0.5 ? (entity.light?.intensity ?? 1.0) : 0;
                }
            }
        }
    }
};

@Injectable({ providedIn: 'root' })
export class PlayerSequenceService implements IUpdatable {
  public id = 'PlayerSequenceSystem';
  private motor3d = inject(Motor3dService);
  private gameState = inject(GameStateService);
  private eventBus = inject(GameEventBusService);
  private entityManager = inject(EntityManagerService);
  private injector = inject(Injector);

  private eventSub!: Subscription;

  private get session(): GameSession { 
    return this.injector.get(GameSession); 
  }

  private activeSequences = new Map<string, {
    id: string;
    index: number;
    elapsedMs: number;
    stepEntered: boolean;
    jumpTriggered: boolean;
    orientationLocked: boolean;
    quaternion: Quaternion | null;
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
        jumpTriggered: false, orientationLocked: false, quaternion: null
      });
    }
    return this.activeSequences.get(entityUid)!;
  }

  private shouldLockOrientationForSequence(step: PlayerSequenceStep | null): boolean {
    if (!step) return false;
    return ['climbUp', 'climbFinish', 'hangIdle', 'vault', 'stepUp'].includes(step.action);
  }

  private captureSequenceOrientationState(jugador: Mesh, state: any): void {
    jugador.computeWorldMatrix(true);
    if (jugador.rotationQuaternion) {
        state.quaternion = jugador.rotationQuaternion.clone();
    } else {
        state.quaternion = Quaternion.FromEulerAngles(jugador.rotation.x, jugador.rotation.y, jugador.rotation.z);
        jugador.rotationQuaternion = state.quaternion.clone();
    }
    state.orientationLocked = true;
  }

  public applyLockedOrientationWhileSequence(entity: GameEntity): void {
    const jugador = entity.view as Mesh;
    if (!jugador) return;
    
    const state = this.getSeqState(entity.uid);
    if (!state.orientationLocked) return;

    if (state.quaternion) {
      if (!jugador.rotationQuaternion) {
        jugador.rotationQuaternion = state.quaternion.clone();
      } else {
        jugador.rotationQuaternion.copyFrom(state.quaternion);
      }
      jugador.rotation.set(0, 0, 0);
    }
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
    const jugador = entity.view as Mesh;
    if (!jugador) return;
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

      if (!jugador.rotationQuaternion) {
        jugador.rotationQuaternion = Quaternion.FromEulerAngles(jugador.rotation.x, jugador.rotation.y, jugador.rotation.z);
        jugador.rotation.set(0, 0, 0);
      }
      this.captureSequenceOrientationState(jugador, state);
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
    const jugador = entity.view as Mesh;
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
      if (jugador && state.orientationLocked) {
        this.captureSequenceOrientationState(jugador, state);
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

    if (jugador) {
        if (step.clipOverride === 'none') {
            ActionHandlers['stopBaked']?.execute(step, entity, this.motor3d, dtMs, 0, runtime);
        }
        const handler = ActionHandlers[step.action];
        if (handler) {
            const durMs = Math.max(1, step.durationMs || 1000);
            handler.execute(step, entity, this.motor3d, dtMs, dtMs / durMs, runtime);
        }
        
        const soY = step.offsetY || 0;
        const soF = step.offsetForward || 0;
        if (soY !== 0 || soF !== 0) {
            const durSec = Math.max(0.001, step.durationMs / 1000);
            const dtSec = dtMs / 1000;
            runtime.rootMotion.y = (soY / durSec) * dtSec;
            runtime.rootMotion.z = (soF / durSec) * dtSec;
        }
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