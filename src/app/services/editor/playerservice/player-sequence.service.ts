// ========================================================================
// ARCHIVO: src/app/services/editor/playerservice/player-sequence.service.ts
// ========================================================================
import { Injectable, inject } from '@angular/core';
import { Mesh, Quaternion, Vector3, AbstractMesh, UniversalCamera } from '@babylonjs/core';
import { EditorStateService } from '../editor-state.service';
import { Motor3dService } from '../../motor-3d.service';
import { PlayerClipSequence, PlayerSequenceStep, PlayerRuntimeConfig } from '../player-config.model';

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
  private state = inject(EditorStateService);
  private motor3d = inject(Motor3dService);

  // 🔥 Usamos un Map para llevar el control de secuencias de MÚLTIPLES objetos a la vez
  private activeSequences = new Map<number, {
    id: string;
    index: number;
    elapsedMs: number;
    stepEntered: boolean;
    jumpTriggered: boolean;
    orientationLocked: boolean;
    quaternion: Quaternion | null;
  }>();

  // Guardamos rotación de cámaras separadas (esto solo aplica al Jugador principal)
  public lockedSequenceFPSRotation: Vector3 | null = null;
  public lockedSequenceTPSAlpha: number | null = null;
  public lockedSequenceTPSBeta: number | null = null;

  public resetearSecuencias(): void {
    this.activeSequences.clear();
    this.lockedSequenceFPSRotation = null;
    this.lockedSequenceTPSAlpha = null;
    this.lockedSequenceTPSBeta = null;
  }

  private getSeqState(mesh: Mesh) {
    if (!this.activeSequences.has(mesh.uniqueId)) {
      this.activeSequences.set(mesh.uniqueId, {
        id: '',
        index: 0,
        elapsedMs: 0,
        stepEntered: false,
        jumpTriggered: false,
        orientationLocked: false,
        quaternion: null
      });
    }
    return this.activeSequences.get(mesh.uniqueId)!;
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
    
    // Si es el jugador activo, bloqueamos la cámara también
    if (this.state.jugadorActivo === jugador) {
        const fpsCam = this.motor3d.playerCameraFPS;
        this.lockedSequenceFPSRotation = fpsCam.rotation.clone();
        const tpsCam = this.motor3d.playerCameraTPS;
        this.lockedSequenceTPSAlpha = tpsCam.alpha;
        this.lockedSequenceTPSBeta = tpsCam.beta;
    }
    state.orientationLocked = true;
  }

  public applyLockedOrientationWhileSequence(jugador: Mesh): void {
    const state = this.getSeqState(jugador);
    if (!state.orientationLocked) return;

    if (state.quaternion) {
      jugador.rotationQuaternion = state.quaternion.clone();
      jugador.rotation.set(0, 0, 0);
    }
    
    // Si es el jugador principal, bloqueamos cámara
    if (this.state.jugadorActivo === jugador) {
        const activeCamera = this.motor3d.scene.activeCamera;
        if (this.state.modoVistaPrueba === 'FPS' && activeCamera instanceof UniversalCamera && this.lockedSequenceFPSRotation) {
          activeCamera.rotation.copyFrom(this.lockedSequenceFPSRotation);
        }
        if (this.state.modoVistaPrueba === 'TPS' && this.lockedSequenceTPSAlpha !== null && this.lockedSequenceTPSBeta !== null) {
          this.motor3d.playerCameraTPS.alpha = this.lockedSequenceTPSAlpha;
          this.motor3d.playerCameraTPS.beta = this.lockedSequenceTPSBeta;
        }
    }
  }

  public iniciarSecuenciaEnJuego(sequenceId: string, jugador: Mesh, config: PlayerRuntimeConfig): void {
    const seqs = config.sequences?.filter(s => !!s.enabled) || [];
    if (seqs.some(s => s.id === sequenceId)) {
      const state = this.getSeqState(jugador);
      state.id = sequenceId;
      state.index = 0;
      state.elapsedMs = 0;
      state.stepEntered = true;
      if (!jugador.rotationQuaternion) {
        jugador.rotationQuaternion = Quaternion.FromEulerAngles(jugador.rotation.x, jugador.rotation.y, jugador.rotation.z);
        jugador.rotation.set(0, 0, 0);
      }
      this.captureSequenceOrientationState(jugador, state);
    }
  }

  public actualizarSecuencia(dtMs: number, jugador: Mesh, config: PlayerRuntimeConfig): SeqRuntime {
    const seqs = config.sequences?.filter(s => !!s.enabled) || [];
    const state = this.getSeqState(jugador);
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

    const step = sequence.steps[Math.max(0, Math.min(state.index, sequence.steps.length - 1))] || null;
    if (!step) {
      state.orientationLocked = false;
      return { step: null, lockInput: false, allowMovement: true, forceForwardWalk: false, forceForwardRun: false, forceJump: false, blend: config.blend.defaultBlend, loop: true, running: false, freezeOrientation: false };
    }

    if (state.stepEntered) {
      state.jumpTriggered = false;
      state.orientationLocked = this.shouldLockOrientationForSequence(step);
      if (state.orientationLocked) this.captureSequenceOrientationState(jugador, state);
      if (step.action === 'jumpStart') state.jumpTriggered = true;
      state.stepEntered = false;
    } else {
      state.orientationLocked = this.shouldLockOrientationForSequence(step) || state.orientationLocked;
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
            state.id = ''; // Terminó la secuencia
            return { step, lockInput, allowMovement, forceForwardWalk, forceForwardRun, forceJump, blend, loop, running: false, freezeOrientation: false }; 
        }
      } else {
          state.stepEntered = true;
      }
    }

    return { step, lockInput, allowMovement, forceForwardWalk, forceForwardRun, forceJump, blend, loop, running: true, freezeOrientation: state.orientationLocked };
  }
}