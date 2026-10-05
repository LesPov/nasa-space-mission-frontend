
// file: src/app/core/engine/runtime/systems/player-sequence.service.ts
import { Injectable, inject } from '@angular/core';
import { Vector3, Quaternion } from '@babylonjs/core';
import { PlayerClipSequence, PlayerSequenceStep, cloneDefaultPlayerConfig } from '../../models/player-config.model';
import { GameStateService } from '../state/game-state.service';
import { GameEntity } from '../../entities/game.entity';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { Subscription } from 'rxjs';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { DynamicLightingSystem } from './lighting/dynamic-lighting.system';
import { EngineProfilerService } from '../../telemetry/engine-profiler.service';

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
  absoluteTimeMs?: number;
}

export interface ActiveSequenceDetail {
  sequenceId: string;
  entityUid: string;
  entityName: string;
  stepIndex: number;
  action: string;
  elapsedMs: number;
}

interface SequenceActionHandler {
  execute(
    step: PlayerSequenceStep, 
    entity: GameEntity, 
    entityManager: EntityManagerService, 
    dtMs: number, 
    dtFraction: number, 
    runtime: SeqRuntime, 
    dynamicLighting: DynamicLightingSystem,
    profiler?: EngineProfilerService
  ): void;
}

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
      
      let currentQuat: Quaternion;
      if (entity.transform.rotationQuaternion) {
        currentQuat = new Quaternion(
          entity.transform.rotationQuaternion.x, 
          entity.transform.rotationQuaternion.y, 
          entity.transform.rotationQuaternion.z, 
          entity.transform.rotationQuaternion.w
        );
      } else {
        currentQuat = Quaternion.FromEulerAngles(entity.transform.rotation.x, entity.transform.rotation.y, entity.transform.rotation.z);
      }
      
      const deltaQuat = Quaternion.FromEulerAngles(rx, ry, rz);
      currentQuat.multiplyInPlace(deltaQuat);
      
      if (entity.transform.rotationQuaternion) {
        entity.transform.rotationQuaternion.x = currentQuat.x;
        entity.transform.rotationQuaternion.y = currentQuat.y;
        entity.transform.rotationQuaternion.z = currentQuat.z;
        entity.transform.rotationQuaternion.w = currentQuat.w;
      } else {
        const newEuler = currentQuat.toEulerAngles();
        entity.transform.rotation.x = newEuler.x;
        entity.transform.rotation.y = newEuler.y;
        entity.transform.rotation.z = newEuler.z;
      }
      entity.isDirty = true;
    }
  },
  stopBaked: {
    execute: (step, entity) => {
      if (entity.playerRuntime) entity.playerRuntime.stopBakedRequested = true;
      entity.isDirty = true;
    }
  },
  playVideo: {
    execute: (step, entity, em) => {
      const videoName = step.clipOverride; 
      if (!videoName) return;
      const allEntities = em.getAllEntities();
      for (let i = 0; i < allEntities.length; i++) {
        if (allEntities[i].name === videoName && allEntities[i].mediaRuntime) {
          allEntities[i].mediaRuntime!.videoCommand = 'play';
          allEntities[i].isDirty = true;
          break;
        }
      }
    }
  },
  pauseVideo: {
    execute: (step, entity, em) => {
      const videoName = step.clipOverride; 
      if (!videoName) return;
      const allEntities = em.getAllEntities();
      for (let i = 0; i < allEntities.length; i++) {
        if (allEntities[i].name === videoName && allEntities[i].mediaRuntime) {
          allEntities[i].mediaRuntime!.videoCommand = 'pause';
          allEntities[i].isDirty = true;
          break;
        }
      }
    }
  },
  stopVideo: {
    execute: (step, entity, em) => {
      const videoName = step.clipOverride; 
      if (!videoName) return;
      const allEntities = em.getAllEntities();
      for (let i = 0; i < allEntities.length; i++) {
        if (allEntities[i].name === videoName && allEntities[i].mediaRuntime) {
          allEntities[i].mediaRuntime!.videoCommand = 'stop';
          allEntities[i].isDirty = true;
          break;
        }
      }
    }
  },
  lightOn: {
    execute: (step, entity, em, dtMs, dtFraction, runtime, dynLighting, profiler) => {
      if (!entity.light) return;
      if (entity.playerConfig?.animationEnabled?.lightOn === false) return;
      const prev = entity.light.renderIntensity;
      const targetIntensity = entity.light.intensity > 0 ? entity.light.intensity : 1.0;
      
      if (Math.abs((prev ?? 0) - targetIntensity) > 0.001) {
        entity.light.renderIntensity = targetIntensity;
        dynLighting.updateAssignedLightIntensity(entity.uid, targetIntensity);
        if (profiler) {
          profiler.recordTimelineEvent('SEQUENCE', 'SEQ_ACTION_LIGHT_ON', {
            lightUid: entity.uid,
            previousIntensity: prev,
            newIntensity: targetIntensity
          });
        }
      }
    }
  },
  lightOff: {
    execute: (step, entity, em, dtMs, dtFraction, runtime, dynLighting, profiler) => {
      if (!entity.light) return;
      if (entity.playerConfig?.animationEnabled?.lightOff === false) return;
      const prev = entity.light.renderIntensity;
      const targetIntensity = 0.0001;

      if (Math.abs((prev ?? 0) - targetIntensity) > 0.0001) {
        entity.light.renderIntensity = targetIntensity;
        dynLighting.updateAssignedLightIntensity(entity.uid, targetIntensity);
        if (profiler) {
          profiler.recordTimelineEvent('SEQUENCE', 'SEQ_ACTION_LIGHT_OFF', {
            lightUid: entity.uid,
            previousIntensity: prev,
            newIntensity: targetIntensity
          });
        }
      }
    }
  },
  lightPulse: {
    execute: (step, entity, em, dtMs, dtFraction, runtime, dynLighting) => {
      if (!entity.light) return;
      if (entity.playerConfig?.animationEnabled?.lightPulse === false) return;
      const freq = step.speedRatio || 1;
      const timeSec = runtime.absoluteTimeMs !== undefined ? (runtime.absoluteTimeMs / 1000) : (performance.now() / 1000);
      const newIntensity = entity.light.intensity * (0.5 + 0.5 * Math.sin(timeSec * Math.PI * 2 * freq));
      entity.light.renderIntensity = newIntensity;
      dynLighting.updateAssignedLightIntensity(entity.uid, newIntensity);
    }
  },
  lightFlicker: {
    execute: (step, entity, em, dtMs, dtFraction, runtime, dynLighting) => {
      if (!entity.light) return;
      if (entity.playerConfig?.animationEnabled?.lightFlicker === false) return;
      const freq = step.speedRatio || 1;
      const timeSec = runtime.absoluteTimeMs !== undefined ? (runtime.absoluteTimeMs / 1000) : (performance.now() / 1000);
      const rand = Math.abs(Math.sin(timeSec * 12.9898 + 78.233)) * 100;
      let targetIntensity = entity.light.intensity;
      if ((rand % 1) < (0.15 * freq)) {
        targetIntensity = ((rand % 2) > 1) ? entity.light.intensity : 0.0001;
      }
      entity.light.renderIntensity = targetIntensity;
      dynLighting.updateAssignedLightIntensity(entity.uid, targetIntensity);
    }
  }
};

@Injectable({ providedIn: 'root' })
export class PlayerSequenceService implements IUpdatable {
  public id = 'PlayerSequenceSystem';
  private gameState = inject(GameStateService);
  private eventBus = inject(GameEventBusService);
  private entityManager = inject(EntityManagerService);
  private context = inject(GameContextService);
  private dynamicLighting = inject(DynamicLightingSystem);
  private profiler = inject(EngineProfilerService);

  private eventSub!: Subscription;
  private isExecutionPaused = false;

  private activeSequences = new Map<string, {
    id: string;
    index: number;
    elapsedMs: number;
    stepEntered: boolean;
    jumpTriggered: boolean;
    orientationLocked: boolean;
    rotation: { x: number, y: number, z: number, w?: number } | null;
    cinematicTied: boolean;
  }>();

  constructor() {
    this.eventSub = this.eventBus.events$.subscribe(event => {
      if (event.type === 'SequenceTriggered') {
        this.buscarEIniciarSecuenciaPorId(event.payload.sequenceId);
      } else if (event.type === 'SequenceSyncRequested') {
        this.syncSequenceToTime(event.payload.sequenceId, event.payload.elapsedMs);
      } else if (event.type === 'CinematicStarted') {
        this.startAllAutoPlaySequences();
      } else if (event.type === 'CinematicStopped') {
        this.clearCinematicTiedSequences();
      } else if (event.type === 'CinematicSeeked') {
        this.syncAllAutoPlaySequences(event.payload.timeMs);
      }
    });
  }

  public pauseExecution(): void {
    this.isExecutionPaused = true;
  }

  public resumeExecution(): void {
    this.isExecutionPaused = false;
  }

  public getActiveSequencesCount(): number {
    return this.activeSequences.size;
  }

  public getActiveSequencesDetails(): ActiveSequenceDetail[] {
    const details: ActiveSequenceDetail[] = [];
    for (const [entityUid, state] of this.activeSequences.entries()) {
      const entity = this.entityManager.getEntityByUid(entityUid);
      const seq = entity?.playerConfig?.sequences?.find(s => s.id === state.id);
      const step = seq?.steps?.[state.index];
      details.push({
        sequenceId: state.id,
        entityUid,
        entityName: entity?.name || entityUid,
        stepIndex: state.index,
        action: step?.action || 'idle',
        elapsedMs: Math.round(state.elapsedMs)
      });
    }
    return details;
  }

  public evaluateCinematicAction(entity: GameEntity, step: PlayerSequenceStep, dtMs: number, absoluteTimeMs: number): void {
    const defaultRuntime = this.getDefaultRuntime(entity);
    const runtime: SeqRuntime = { ...defaultRuntime, step, running: true, absoluteTimeMs };
    const config = entity.playerConfig || cloneDefaultPlayerConfig();

    runtime.loop = !!step.loop;
    runtime.allowMovement = step.allowMovement !== false;
    runtime.lockInput = !!step.lockInput;
    runtime.blend = typeof step.blend === 'number' ? step.blend : config.blend.defaultBlend;
    
    const lowerAction = step.action;
    runtime.forceForwardWalk = runtime.allowMovement && lowerAction === 'walk';
    runtime.forceForwardRun = runtime.allowMovement && lowerAction === 'run';
    runtime.forceJump = lowerAction === 'jumpStart';

    const handler = ActionHandlers[step.action];
    if (handler) {
      const durMs = Math.max(1, step.durationMs || 1000);
      handler.execute(step, entity, this.entityManager, dtMs, dtMs / durMs, runtime, this.dynamicLighting, this.profiler);
    }

    const soY = step.offsetY || 0;
    const soF = step.offsetForward || 0;
    if (soY !== 0 || soF !== 0) {
      const durSec = Math.max(0.001, step.durationMs / 1000);
      const dtSec = dtMs / 1000;
      runtime.rootMotion.y = (soY / durSec) * dtSec;
      runtime.rootMotion.z = (soF / durSec) * dtSec;
    }

    if (entity.playerRuntime) {
      entity.playerRuntime.seqRuntime = runtime;
    }
  }

  public startAllAutoPlaySequences(): void {
    const allEntities = this.entityManager.getAllEntities();
    for (let i = 0; i < allEntities.length; i++) {
      const entity = allEntities[i];
      if (entity.playerConfig && entity.playerConfig.sequences) {
        const autoSeq = entity.playerConfig.sequences.find((s: any) => s.autoPlay);
        if (autoSeq) {
          this.iniciarSecuenciaEnJuego(autoSeq.id, entity);
          const state = this.getSeqState(entity.uid);
          state.cinematicTied = true;
        }
      }
    }
  }

  public queueAutoPlaySequencesStaggered(): void {
    const allEntities = this.entityManager.getAllEntities();
    let delayMs = 0;

    for (let i = 0; i < allEntities.length; i++) {
      const entity = allEntities[i];
      if (entity.playerConfig && entity.playerConfig.sequences) {
        const autoSeq = entity.playerConfig.sequences.find((s: any) => s.autoPlay);
        if (autoSeq) {
          const targetEntity = entity;
          const targetSeqId = autoSeq.id;
          
          setTimeout(() => {
            if (this.context.isPlaying()) {
              this.iniciarSecuenciaEnJuego(targetSeqId, targetEntity);
            }
          }, delayMs);

          delayMs += 80; // Escalonamiento de 80ms entre inicios de secuencia
        }
      }
    }
  }

  public syncAllAutoPlaySequences(elapsedMs: number): void {
    const allEntities = this.entityManager.getAllEntities();
    for (let i = 0; i < allEntities.length; i++) {
      const entity = allEntities[i];
      if (entity.playerConfig && entity.playerConfig.sequences) {
        const autoSeq = entity.playerConfig.sequences.find((s: any) => s.autoPlay);
        if (autoSeq) {
          this.evaluateSequenceAbsolute(entity, autoSeq, elapsedMs);
        }
      }
    }
  }

  public physicsUpdate(dtMs: number): void {
    if (this.isExecutionPaused || this.activeSequences.size === 0) return;

    let effectiveDt = dtMs;

    if (this.context.engineState() === 'PAUSED' && !this.context.isCinematicPlaying()) {
      effectiveDt = 0;
    }
    if (this.context.activeCinematicId() && !this.context.isCinematicPlaying()) {
      effectiveDt = 0;
    }

    for (const [entityUid] of this.activeSequences.entries()) {
      const entity = this.entityManager.getEntityByUid(entityUid);
      if (!entity) {
        this.activeSequences.delete(entityUid);
        continue;
      }

      if (entity.movementAuthority === 'CINEMATIC_LOCOMOTION' || entity.movementAuthority === 'CINEMATIC_FULL') {
        continue;
      }

      if (entity.playerConfig?.sequences && entity.playerConfig.sequences.length > 0) {
        const runtime = this.actualizarSecuencia(effectiveDt, entity);
        if (entity.playerRuntime) {
          entity.playerRuntime.seqRuntime = runtime;
        }
      }
    }
  }

  public resetearSecuencias(): void {
    this.activeSequences.clear();
    this.isExecutionPaused = false;
  }

  public detenerSecuencia(entityUid: string): void {
    this.activeSequences.delete(entityUid);
  }

  private clearCinematicTiedSequences(): void {
    for (const [uid, state] of this.activeSequences.entries()) {
      if (state.cinematicTied) {
        this.activeSequences.delete(uid);
        
        if (this.context.isPlaying()) {
          const entity = this.entityManager.getEntityByUid(uid);
          if (entity && entity.playerConfig && entity.playerConfig.sequences) {
            const autoSeq = entity.playerConfig.sequences.find(s => s.autoPlay);
            if (autoSeq) {
              this.iniciarSecuenciaEnJuego(autoSeq.id, entity);
            }
          }
        }
      }
    }
  }

  private getSeqState(entityUid: string) {
    if (!this.activeSequences.has(entityUid)) {
      this.activeSequences.set(entityUid, {
        id: '', index: 0, elapsedMs: 0, stepEntered: false,
        jumpTriggered: false, orientationLocked: false, rotation: null, cinematicTied: false
      });
    }
    return this.activeSequences.get(entityUid)!;
  }

  private shouldLockOrientationForSequence(step: PlayerSequenceStep | null): boolean {
    if (!step) return false;
    return ['climbUp', 'climbFinish', 'hangIdle', 'vault', 'stepUp'].includes(step.action);
  }

  private captureSequenceOrientationState(entity: GameEntity, state: any): void {
    if (entity.transform.rotationQuaternion) {
      state.rotation = { ...entity.transform.rotationQuaternion };
    } else {
      state.rotation = { ...entity.transform.rotation };
    }
    state.orientationLocked = true;
  }

  private buscarEIniciarSecuenciaPorId(sequenceId: string): void {
    const allEntities = this.entityManager.getAllEntities();
    for (let i = 0; i < allEntities.length; i++) {
      const e = allEntities[i];
      if (e.playerConfig && e.playerConfig.sequences) {
        const hasSeq = e.playerConfig.sequences.some((s: any) => s.id === sequenceId);
        if (hasSeq) {
          this.iniciarSecuenciaEnJuego(sequenceId, e);
        }
      }
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
      state.cinematicTied = this.context.isCinematicPlaying(); 

      this.profiler.recordTimelineEvent('SEQUENCE', 'SEQUENCE_STARTED', {
        sequenceId,
        entityUid: entity.uid,
        entityName: entity.name,
        stepCount: seqToRun.steps.length
      });

      this.captureSequenceOrientationState(entity, state);
    }
  }

  public syncSequenceToTime(sequenceId: string, elapsedMs: number): void {
    const allEntities = this.entityManager.getAllEntities();
    for (const entity of allEntities) {
      if (entity.playerConfig && entity.playerConfig.sequences) {
        const seq = entity.playerConfig.sequences.find((s: any) => s.id === sequenceId);
        if (seq) {
          this.evaluateSequenceAbsolute(entity, seq, elapsedMs);
        }
      }
    }
  }

  public evaluateSequenceAbsolute(entity: GameEntity, seq: PlayerClipSequence, elapsedMs: number): SeqRuntime {
    const defaultRuntime = this.getDefaultRuntime(entity);
    if (!seq.steps || seq.steps.length === 0) return defaultRuntime;

    let totalSeqTime = seq.steps.reduce((sum, s) => sum + Math.max(1, s.durationMs || 1000), 0);
    let timeRemaining = elapsedMs;

    if (totalSeqTime > 0 && seq.repeat) {
      timeRemaining = timeRemaining % totalSeqTime;
    } else if (timeRemaining >= totalSeqTime) {
      timeRemaining = totalSeqTime;
      const lastStep = seq.steps[seq.steps.length - 1];
      const r: SeqRuntime = { ...defaultRuntime, step: lastStep, absoluteTimeMs: elapsedMs, running: false };
      
      const handler = ActionHandlers[lastStep.action];
      if (handler) {
        handler.execute(lastStep, entity, this.entityManager, 0, 1.0, r, this.dynamicLighting, this.profiler);
      }
      
      const stateEnd = this.getSeqState(entity.uid);
      stateEnd.id = seq.id;
      stateEnd.index = seq.steps.length - 1;
      stateEnd.elapsedMs = lastStep.durationMs || 1000;
      stateEnd.stepEntered = false;
      return r;
    }

    let targetStep = seq.steps[0];
    let stepElapsed = 0;
    let stepIndex = 0;

    for (let i = 0; i < seq.steps.length; i++) {
      const step = seq.steps[i];
      const dur = Math.max(1, step.durationMs || 1000);
      if (timeRemaining < dur) { 
        targetStep = step;
        stepElapsed = timeRemaining;
        stepIndex = i;
        break;
      }
      timeRemaining -= dur;
    }

    const state = this.getSeqState(entity.uid);
    state.id = seq.id;
    state.index = stepIndex;
    state.elapsedMs = stepElapsed;
    state.stepEntered = false; 

    const runtime: SeqRuntime = { ...defaultRuntime, step: targetStep, absoluteTimeMs: elapsedMs, running: true };
    const durStep = Math.max(1, targetStep.durationMs || 1000);
    const handler = ActionHandlers[targetStep.action];
    if (handler) {
      handler.execute(targetStep, entity, this.entityManager, 0, stepElapsed / durStep, runtime, this.dynamicLighting, this.profiler);
    }

    return runtime;
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
      this.activeSequences.delete(entity.uid);
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
          this.activeSequences.delete(entity.uid);
          return defaultRuntime;
        }
      }
      step = sequence.steps[state.index] || null;
      state.stepEntered = true;
      state.elapsedMs = 0;
    }

    if (!step) {
      state.orientationLocked = false;
      this.activeSequences.delete(entity.uid);
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

      this.profiler.recordTimelineEvent('SEQUENCE', 'SEQ_STEP_ENTERED', {
        sequenceId: sequence.id,
        entityUid: entity.uid,
        stepIndex: state.index,
        action: step.action
      });

      state.stepEntered = false;
    } else {
      state.orientationLocked = this.shouldLockOrientationForSequence(step) || state.orientationLocked;
    }

    if (step.clipOverride === 'none') {
      ActionHandlers['stopBaked']?.execute(step, entity, this.entityManager, dtMs, 0, runtime, this.dynamicLighting, this.profiler);
    }
    
    if (state.cinematicTied) runtime.absoluteTimeMs = this.context.cinematicTimeMs();

    const handler = ActionHandlers[step.action];
    if (handler) {
      const durMs = Math.max(1, step.durationMs || 1000);
      handler.execute(step, entity, this.entityManager, dtMs, dtMs / durMs, runtime, this.dynamicLighting, this.profiler);
    }
    
    const soY = step.offsetY || 0;
    const soF = step.offsetForward || 0;
    if (soY !== 0 || soF !== 0) {
      const durSec = Math.max(0.001, step.durationMs / 1000);
      const dtSec = dtMs / 1000;
      runtime.rootMotion.y = (soY / durSec) * dtSec;
      runtime.rootMotion.z = (soF / durSec) * dtSec;
    }

    if (state.orientationLocked && state.rotation) {
      if (state.rotation.w !== undefined) {
        entity.transform.rotationQuaternion = { ...state.rotation } as any;
      } else {
        entity.transform.rotation = { ...state.rotation } as any;
      }
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
          this.activeSequences.delete(entity.uid);
          this.profiler.recordTimelineEvent('SEQUENCE', 'SEQUENCE_COMPLETED', {
            sequenceId: sequence.id,
            entityUid: entity.uid
          });
        }
      } else {
        state.stepEntered = true;
      }
    }

    return runtime;
  }
}