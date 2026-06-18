
import { Injectable, inject, Injector } from '@angular/core';
import { Mesh, Quaternion, Vector3, UniversalCamera, Light, StandardMaterial, VideoTexture, Color3 } from '@babylonjs/core';
import { GameSession } from '../game-session';
import { Motor3dService } from '../../../services/motor-3d.service';
import { PlayerClipSequence, PlayerSequenceStep, cloneDefaultPlayerConfig } from '../models/player-config.model';
import { GameStateService } from '../state/game-state.service';
import { GameEntity } from '../entities/game.entity';

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
}

@Injectable({ providedIn: 'root' })
export class PlayerSequenceService {
  private motor3d = inject(Motor3dService);
  private gameState = inject(GameStateService);
  private injector = inject(Injector);

  // 🔥 FIX DE DEPENDENCIA CIRCULAR: Getter Lazy
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

  public lockedSequenceFPSRotation: Vector3 | null = null;
  public lockedSequenceTPSAlpha: number | null = null;
  public lockedSequenceTPSBeta: number | null = null;

  public resetearSecuencias(): void {
    this.activeSequences.clear();
    this.lockedSequenceFPSRotation = null;
    this.lockedSequenceTPSAlpha = null;
    this.lockedSequenceTPSBeta = null;
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

  private captureSequenceOrientationState(jugador: Mesh, state: any, isPlayer: boolean): void {
    jugador.computeWorldMatrix(true);
    if (jugador.rotationQuaternion) {
        state.quaternion = jugador.rotationQuaternion.clone();
    } else {
        state.quaternion = Quaternion.FromEulerAngles(jugador.rotation.x, jugador.rotation.y, jugador.rotation.z);
        jugador.rotationQuaternion = state.quaternion.clone();
    }
    
    if (isPlayer) {
        const fpsCam = this.motor3d.playerCameraFPS;
        this.lockedSequenceFPSRotation = fpsCam.rotation.clone();
        const tpsCam = this.motor3d.playerCameraTPS;
        this.lockedSequenceTPSAlpha = tpsCam.alpha;
        this.lockedSequenceTPSBeta = tpsCam.beta;
    }
    state.orientationLocked = true;
  }

  public applyLockedOrientationWhileSequence(entity: GameEntity): void {
    const jugador = entity.view as Mesh;
    if (!jugador) return;
    
    const state = this.getSeqState(entity.uid);
    if (!state.orientationLocked) return;

    if (state.quaternion) {
      jugador.rotationQuaternion = state.quaternion.clone();
      jugador.rotation.set(0, 0, 0);
    }
    
    const activePlayer = this.session.activePlayerEntity();
    if (activePlayer && activePlayer.uid === entity.uid) {
        const activeCamera = this.motor3d.scene.activeCamera;
        if (this.session.cameraView() === 'FPS' && activeCamera instanceof UniversalCamera && this.lockedSequenceFPSRotation) {
          activeCamera.rotation.copyFrom(this.lockedSequenceFPSRotation);
        }
        if (this.session.cameraView() === 'TPS' && this.lockedSequenceTPSAlpha !== null && this.lockedSequenceTPSBeta !== null) {
          this.motor3d.playerCameraTPS.alpha = this.lockedSequenceTPSAlpha;
          this.motor3d.playerCameraTPS.beta = this.lockedSequenceTPSBeta;
        }
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
          console.log(`[Narrativa] Secuencia ${sequenceId} omitida (No cumple requisitos).`);
          return;
      }

      const state = this.getSeqState(entity.uid);
      state.id = sequenceId;
      state.index = 0;
      state.elapsedMs = 0;
      state.stepEntered = true;
      state.jumpTriggered = false;

      if (!jugador.rotationQuaternion) {
        jugador.rotationQuaternion = Quaternion.FromEulerAngles(jugador.rotation.x, jugador.rotation.y, jugador.rotation.z);
        jugador.rotation.set(0, 0, 0);
      }
      const isPlayer = this.session.activePlayerEntity()?.uid === entity.uid;
      this.captureSequenceOrientationState(jugador, state, isPlayer);
    }
  }

  public actualizarSecuencia(dtMs: number, entity: GameEntity): SeqRuntime {
    const jugador = entity.view as Mesh;
    const config = entity.playerConfig || cloneDefaultPlayerConfig();

    const seqs = config.sequences?.filter(s => !!s.enabled) || [];
    const state = this.getSeqState(entity.uid);
    let sequence: PlayerClipSequence | null = null;
    
    const metaActiveId = (config as any)?.activeSequenceId as string | undefined;
    
    if (metaActiveId) sequence = seqs.find(s => s.id === metaActiveId) || null;
    else if (state.id) sequence = seqs.find(s => s.id === state.id) || null;

    if (!sequence || !sequence.steps || sequence.steps.length === 0) {
      state.id = '';
      return { step: null, lockInput: false, allowMovement: true, forceForwardWalk: false, forceForwardRun: false, forceJump: false, blend: config.blend.defaultBlend, loop: true, running: false, freezeOrientation: false };
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
                return { step: null, lockInput: false, allowMovement: true, forceForwardWalk: false, forceForwardRun: false, forceJump: false, blend: config.blend.defaultBlend, loop: true, running: false, freezeOrientation: false };
            }
        }
        step = sequence.steps[state.index] || null;
        state.stepEntered = true;
        state.elapsedMs = 0;
    }

    if (!step) {
      state.orientationLocked = false;
      return { step: null, lockInput: false, allowMovement: true, forceForwardWalk: false, forceForwardRun: false, forceJump: false, blend: config.blend.defaultBlend, loop: true, running: false, freezeOrientation: false };
    }

    if (state.stepEntered) {
      state.jumpTriggered = false;
      state.orientationLocked = this.shouldLockOrientationForSequence(step);
      if (jugador && state.orientationLocked) {
        const isPlayer = this.session.activePlayerEntity()?.uid === entity.uid;
        this.captureSequenceOrientationState(jugador, state, isPlayer);
      }
      if (step.action === 'jumpStart') state.jumpTriggered = true;
      
      if (step.action === 'playVideo' || step.action === 'pauseVideo' || step.action === 'stopVideo') {
          const videoName = step.clipOverride; 
          if (videoName) {
              const videoMesh = this.motor3d.scene.getMeshByName(videoName);
              if (videoMesh && videoMesh.material instanceof StandardMaterial) {
                  const texture = videoMesh.material.diffuseTexture;
                  if (texture && texture instanceof VideoTexture) {
                      if (step.action === 'playVideo') {
                          texture.video.play();
                          videoMesh.material.emissiveColor = new Color3(0.4, 0.4, 0.4); 
                      }
                      if (step.action === 'pauseVideo') {
                          texture.video.pause();
                          videoMesh.material.emissiveColor = new Color3(0.2, 0.2, 0.2); 
                      }
                      if (step.action === 'stopVideo') { 
                          texture.video.pause(); 
                          texture.video.currentTime = 0; 
                          videoMesh.material.emissiveColor = new Color3(0, 0, 0); 
                      }
                  }
              }
          }
      }

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
      if (step.action === 'stopBaked' || step.clipOverride === 'none') {
          const myAnimNames = entity.animationNames || [];
          this.motor3d.scene.animationGroups.forEach(ag => {
              if (myAnimNames.includes(ag.name)) {
                  if (ag.isPlaying) {
                      const isTargetingMe = ag.targetedAnimations?.some((ta:any) => {
                          let current: any = ta.target;
                          while(current) {
                              if (current === jugador) return true;
                              current = current.parent;
                          }
                          return false;
                      });
                      if (isTargetingMe) {
                          ag.stop();
                      }
                  }
              }
          });
      }

      if (step.action === 'procMove' || step.action === 'procRotate') {
          const durMs = Math.max(1, step.durationMs || 1000);
          const dtFraction = dtMs / durMs; 
          
          if (step.action === 'procRotate') {
              const rx = (step.procX || 0) * (Math.PI / 180) * dtFraction;
              const ry = (step.procY || 0) * (Math.PI / 180) * dtFraction;
              const rz = (step.procZ || 0) * (Math.PI / 180) * dtFraction;
              
              if (jugador.rotationQuaternion) {
                  const deltaQ = Quaternion.FromEulerAngles(rx, ry, rz);
                  jugador.rotationQuaternion = jugador.rotationQuaternion.multiply(deltaQ);
              } else {
                  jugador.rotation.x += rx;
                  jugador.rotation.y += ry;
                  jugador.rotation.z += rz;
              }
          }
          
          if (step.action === 'procMove') {
              const dx = (step.procX || 0) * dtFraction;
              const dy = (step.procY || 0) * dtFraction;
              const dz = (step.procZ || 0) * dtFraction;
              jugador.position.x += dx;
              jugador.position.y += dy;
              jugador.position.z += dz;
          }
      }

      if (entity.type.startsWith('light_')) {
          const light = jugador.getDescendants(false).find(c => c instanceof Light) as Light;
          if (light && typeof light.intensity !== 'undefined') {
              const baseIntensity = entity.light?.intensity ?? 1.0;
              
              if (step.action === 'lightOn') {
                  light.intensity = baseIntensity;
              } else if (step.action === 'lightOff') {
                  light.intensity = 0;
              } else if (step.action === 'lightPulse') {
                  const freq = step.speedRatio || 1;
                  const timeSec = performance.now() / 1000;
                  light.intensity = baseIntensity * (0.5 + 0.5 * Math.sin(timeSec * Math.PI * 2 * freq));
              } else if (step.action === 'lightFlicker') {
                  const freq = step.speedRatio || 1;
                  if (Math.random() < (0.1 * freq)) {
                      light.intensity = Math.random() > 0.5 ? baseIntensity : 0;
                  }
              } else {
                  light.intensity = baseIntensity;
              }
          }
      }
    }

    const blend = typeof step.blend === 'number' ? step.blend : config.blend.defaultBlend;
    const loop = !!step.loop;
    const allowMovement = step.allowMovement !== false;
    const lockInput = !!step.lockInput;

    const lowerAction = step.action;
    const forceForwardWalk = allowMovement && lowerAction === 'walk';
    const forceForwardRun = allowMovement && lowerAction === 'run';
    const forceJump = state.jumpTriggered && lowerAction === 'jumpStart';

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
            return { step, lockInput, allowMovement, forceForwardWalk, forceForwardRun, forceJump, blend, loop, running: false, freezeOrientation: false }; 
        }
      } else {
          state.stepEntered = true;
      }
    }

    return { step, lockInput, allowMovement, forceForwardWalk, forceForwardRun, forceJump, blend, loop, running: true, freezeOrientation: state.orientationLocked };
  }
}