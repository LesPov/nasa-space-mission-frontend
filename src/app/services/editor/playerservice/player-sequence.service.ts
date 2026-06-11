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

  public activeSequenceId: string | null = null;
  public activeSequenceIndex = 0;
  public activeSequenceElapsedMs = 0;
  public activeSequenceStepEntered = false;
  public sequenceJumpTriggered = false;
  
  public sequenceOrientationLocked = false;
  public lockedSequenceQuaternion: Quaternion | null = null;
  public lockedSequenceFPSRotation: Vector3 | null = null;
  public lockedSequenceTPSAlpha: number | null = null;
  public lockedSequenceTPSBeta: number | null = null;

  public resetearSecuencias(): void {
    this.activeSequenceId = null;
    this.activeSequenceIndex = 0;
    this.activeSequenceElapsedMs = 0;
    this.activeSequenceStepEntered = false;
    this.sequenceJumpTriggered = false;
    this.sequenceOrientationLocked = false;
    this.lockedSequenceQuaternion = null;
    this.lockedSequenceFPSRotation = null;
    this.lockedSequenceTPSAlpha = null;
    this.lockedSequenceTPSBeta = null;
  }

  private shouldLockOrientationForSequence(step: PlayerSequenceStep | null): boolean {
    if (!step) return false;
    return ['climbUp', 'climbFinish', 'hangIdle', 'vault', 'stepUp'].includes(step.action);
  }

  private captureSequenceOrientationState(jugador: Mesh): void {
    jugador.computeWorldMatrix(true);
    if (jugador.rotationQuaternion) this.lockedSequenceQuaternion = jugador.rotationQuaternion.clone();
    else {
      this.lockedSequenceQuaternion = Quaternion.FromEulerAngles(jugador.rotation.x, jugador.rotation.y, jugador.rotation.z);
      jugador.rotationQuaternion = this.lockedSequenceQuaternion.clone();
    }
    const fpsCam = this.motor3d.playerCameraFPS;
    this.lockedSequenceFPSRotation = fpsCam.rotation.clone();
    const tpsCam = this.motor3d.playerCameraTPS;
    this.lockedSequenceTPSAlpha = tpsCam.alpha;
    this.lockedSequenceTPSBeta = tpsCam.beta;
    this.sequenceOrientationLocked = true;
  }

  public applyLockedOrientationWhileSequence(jugador: Mesh): void {
    if (!this.sequenceOrientationLocked) return;
    if (this.lockedSequenceQuaternion) {
      jugador.rotationQuaternion = this.lockedSequenceQuaternion.clone();
      jugador.rotation.set(0, 0, 0);
    }
    const activeCamera = this.motor3d.scene.activeCamera;
    if (this.state.modoVistaPrueba === 'FPS' && activeCamera instanceof UniversalCamera && this.lockedSequenceFPSRotation) {
      activeCamera.rotation.copyFrom(this.lockedSequenceFPSRotation);
    }
    if (this.state.modoVistaPrueba === 'TPS' && this.lockedSequenceTPSAlpha !== null && this.lockedSequenceTPSBeta !== null) {
      this.motor3d.playerCameraTPS.alpha = this.lockedSequenceTPSAlpha;
      this.motor3d.playerCameraTPS.beta = this.lockedSequenceTPSBeta;
    }
  }

  public iniciarSecuenciaEnJuego(sequenceId: string, jugador: Mesh, config: PlayerRuntimeConfig): void {
    const seqs = config.sequences?.filter(s => !!s.enabled) || [];
    if (seqs.some(s => s.id === sequenceId)) {
      this.activeSequenceId = sequenceId;
      this.activeSequenceIndex = 0;
      this.activeSequenceElapsedMs = 0;
      this.activeSequenceStepEntered = true;
      if (!jugador.rotationQuaternion) {
        jugador.rotationQuaternion = Quaternion.FromEulerAngles(jugador.rotation.x, jugador.rotation.y, jugador.rotation.z);
        jugador.rotation.set(0, 0, 0);
      }
      this.captureSequenceOrientationState(jugador);
    }
  }

  public actualizarSecuencia(dtMs: number, jugador: Mesh, config: PlayerRuntimeConfig): SeqRuntime {
    const seqs = config.sequences?.filter(s => !!s.enabled) || [];
    let sequence: PlayerClipSequence | null = null;
    const metaActiveId = (config as any)?.activeSequenceId as string | undefined;
    
    if (metaActiveId) sequence = seqs.find(s => s.id === metaActiveId) || null;
    else if (this.activeSequenceId) sequence = seqs.find(s => s.id === this.activeSequenceId) || null;

    if (!sequence || !sequence.steps || sequence.steps.length === 0) {
      this.resetearSecuencias();
      return { step: null, lockInput: false, allowMovement: true, forceForwardWalk: false, forceForwardRun: false, forceJump: false, blend: config.blend.defaultBlend, loop: true, running: false, freezeOrientation: false };
    }

    if (this.activeSequenceId !== sequence.id) {
      this.activeSequenceId = sequence.id; this.activeSequenceIndex = 0; this.activeSequenceElapsedMs = 0; this.activeSequenceStepEntered = true; this.sequenceJumpTriggered = false;
    }

    const step = sequence.steps[Math.max(0, Math.min(this.activeSequenceIndex, sequence.steps.length - 1))] || null;
    if (!step) {
      this.sequenceOrientationLocked = false;
      return { step: null, lockInput: false, allowMovement: true, forceForwardWalk: false, forceForwardRun: false, forceJump: false, blend: config.blend.defaultBlend, loop: true, running: false, freezeOrientation: false };
    }

    if (this.activeSequenceStepEntered) {
      this.sequenceJumpTriggered = false;
      this.sequenceOrientationLocked = this.shouldLockOrientationForSequence(step);
      if (this.sequenceOrientationLocked) this.captureSequenceOrientationState(jugador);
      if (step.action === 'jumpStart') this.sequenceJumpTriggered = true;
      this.activeSequenceStepEntered = false;
    } else {
      this.sequenceOrientationLocked = this.shouldLockOrientationForSequence(step) || this.sequenceOrientationLocked;
    }

    const blend = typeof step.blend === 'number' ? step.blend : config.blend.defaultBlend;
    const loop = !!step.loop;
    const allowMovement = step.allowMovement !== false;
    const lockInput = !!step.lockInput;

    const lowerAction = step.action;
    const forceForwardWalk = allowMovement && lowerAction === 'walk';
    const forceForwardRun = allowMovement && lowerAction === 'run';
    const forceJump = this.sequenceJumpTriggered && lowerAction === 'jumpStart';

    this.activeSequenceElapsedMs += dtMs;
    if (this.activeSequenceElapsedMs >= Math.max(1, step.durationMs || 1)) {
      this.activeSequenceElapsedMs = 0;
      this.activeSequenceIndex++;
      if (this.activeSequenceIndex >= sequence.steps.length) {
        if (sequence.repeat) { this.activeSequenceIndex = 0; this.activeSequenceStepEntered = true; } 
        else { this.resetearSecuencias(); return { step, lockInput, allowMovement, forceForwardWalk, forceForwardRun, forceJump, blend, loop, running: false, freezeOrientation: false }; }
      } else this.activeSequenceStepEntered = true;
    }

    return { step, lockInput, allowMovement, forceForwardWalk, forceForwardRun, forceJump, blend, loop, running: true, freezeOrientation: this.sequenceOrientationLocked };
  }
}