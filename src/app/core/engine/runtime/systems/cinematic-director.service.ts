
import { Injectable, inject, signal } from '@angular/core';
import { Vector3, Quaternion, UniversalCamera, Matrix, ArcRotateCamera } from '@babylonjs/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { CinematicSequence, CinematicClip, CinematicEasing } from '../../models/cinematic.model';
import { CameraOwnershipService, CameraOwner } from '../cameras/camera-ownership.service';
import { CameraFactoryService } from '../cameras/camera-factory.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { Motor3dService } from '../../../../services/motor-3d.service';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { EditorCinematicService } from '../../../../services/editor/editor-cinematic.service';
import { getMovementProfileForOwner } from '../movement/movement-profile.model';

@Injectable({ providedIn: 'root' })
export class CinematicDirectorService implements IUpdatable {
  public id = 'CinematicDirectorSystem';
  
  private ownership = inject(CameraOwnershipService);
  private cameraFactory = inject(CameraFactoryService);
  private entityManager = inject(EntityManagerService);
  private motor3d = inject(Motor3dService);
  private eventBus = inject(GameEventBusService);
  private cinematicSvc = inject(EditorCinematicService);

  public activeSequence: CinematicSequence | null = null;
  public isPlaying = false;
  public currentTimeMs = 0;

  public fadeOpacity = signal<number>(0);
  public fadeColor = signal<string>('#000000');

  public previousCameraOwner: CameraOwner = 'NONE';
  public previousCamera: any = null;
  private cinematicCamera: UniversalCamera | null = null;

  private lastEvaluatedTimeMs = 0;
  private activeDialogueClipId: string | null = null;

  // 🔥 FIX: Variables necesarias para controlar intenciones desde el Editor
  public editorWantsCamera = false; 
  public get cinematicCameraRef() { return this.cinematicCamera; }

  constructor() {
    this.eventBus.events$.subscribe(event => {
      if (event.type === 'SequenceTriggered') {
        const cinematic = this.cinematicSvc.cinematics().find(c => c.id === event.payload.sequenceId);
        if (cinematic) {
           this.play(cinematic);
        }
      }
    });
  }

  private applyEasing(t: number, easing: CinematicEasing): number {
    t = Math.max(0, Math.min(1, t));
    switch (easing) {
      case 'linear': return t;
      case 'easeIn': return t * t;
      case 'easeOut': return t * (2 - t);
      case 'easeInOut': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      default: return t;
    }
  }

  private getLookQuat(pos: Vector3, target: Vector3, fallbackForward: Vector3): Quaternion {
      let dir = target.subtract(pos);
      if (dir.lengthSquared() < 0.001) dir = fallbackForward.clone();
      dir.normalize();
      
      const yaw = Math.atan2(dir.x, dir.z);
      const pitch = Math.atan2(-dir.y, Math.sqrt(dir.x * dir.x + dir.z * dir.z));
      
      return Quaternion.RotationYawPitchRoll(yaw, pitch, 0);
  }

  // 🔥 NUEVO: Función para delegar el control forzado desde UI
  public takeOverCamera(prevOwner: CameraOwner, prevCam: any) {
      this.previousCameraOwner = prevOwner;
      this.previousCamera = prevCam;
      if (!this.cinematicCamera) {
         this.cinematicCamera = this.cameraFactory.getCamera('CINEMATIC', this.motor3d.scene);
      }
      const canvas = this.motor3d.engine.getRenderingCanvas();
      this.ownership.setCamera('CINEMATIC_DIRECTOR', this.cinematicCamera!, canvas, false);
  }

  public releaseCamera() {
      if (this.ownership.getOwner() === 'CINEMATIC_DIRECTOR') {
         const canvas = this.motor3d.engine.getRenderingCanvas();
         this.ownership.setCamera(this.previousCameraOwner, this.previousCamera, canvas, true);
      }
  }

  public play(sequence: CinematicSequence): void {
    if (this.isPlaying && this.activeSequence?.id === sequence.id) return;
    
    this.activeSequence = sequence;
    this.isPlaying = true;
    
    if (this.currentTimeMs >= sequence.durationMs) {
      this.currentTimeMs = 0;
    }
    this.lastEvaluatedTimeMs = this.currentTimeMs;
    this.activeDialogueClipId = null;

    const hasCameraTrack = sequence.tracks.some(t => t.type === 'camera');
    if (hasCameraTrack && this.ownership.getOwner() !== 'CINEMATIC_DIRECTOR') {
      // 🔥 FIX: Solo robamos cámara de edición si se solicitó explícitamente, pero en Gameplay sí la secuestramos
      if (this.ownership.getOwner() !== 'EDITOR' || this.editorWantsCamera) {
          this.takeOverCamera(this.ownership.getOwner(), this.ownership.getCamera());
      }
    }

    sequence.tracks.forEach(t => {
      if (t.type === 'actor' && t.targetUid) {
        const entity = this.entityManager.getEntityByUid(t.targetUid);
        if (entity) {
            entity.isCinematicControlled = true;
            if (entity.view) entity.view.checkCollisions = false;
        }
      }
    });

    this.eventBus.emit({ type: 'CinematicStarted', payload: { cinematicId: sequence.id } });
  }

  public pause(): void {
    this.isPlaying = false;
  }

  public stop(): void {
    this.isPlaying = false;
    this.currentTimeMs = 0;
    this.lastEvaluatedTimeMs = 0;
    this.fadeOpacity.set(0);
    
    if (this.activeDialogueClipId) {
       this.eventBus.emit({ type: 'DialogueRequested', payload: { durationMs: 0 } });
       this.activeDialogueClipId = null;
    }

    if (this.activeSequence) {
      this.activeSequence.tracks.forEach(t => {
        if (t.type === 'actor' && t.targetUid) {
          const entity = this.entityManager.getEntityByUid(t.targetUid);
          if (entity) {
             entity.isCinematicControlled = false;
             if (entity.playerRuntime) entity.playerRuntime.cinematicAnimation = null;
             
             if (entity.view && entity.playerConfig) {
                 const profile = getMovementProfileForOwner(this.ownership.getOwner());
                 entity.view.checkCollisions = profile.collisionsEnabled;
             }
          }
        }
      });

      if (this.ownership.getOwner() === 'CINEMATIC_DIRECTOR') {
         this.releaseCamera();
         if (this.previousCameraOwner === 'PLAYER_TPS' && this.previousCamera) {
             const tpsCam = this.previousCamera as ArcRotateCamera;
             tpsCam.rebuildAnglesAndRadius();
         }
      }
      this.activeSequence = null;
    }

    this.eventBus.emit({ type: 'CinematicStopped' });
  }

  public seek(timeMs: number): void {
    if (!this.activeSequence) return;
    this.currentTimeMs = Math.max(0, Math.min(timeMs, this.activeSequence.durationMs));
    this.lastEvaluatedTimeMs = this.currentTimeMs;
    this.evaluateFrame(0, true);
  }

  public update(dtMs: number): void {
    if (!this.isPlaying || !this.activeSequence) return;

    this.currentTimeMs += dtMs;

    if (this.currentTimeMs >= this.activeSequence.durationMs) {
       this.currentTimeMs = this.activeSequence.durationMs;
       this.evaluateFrame(dtMs, false);
       this.stop();
       return;
    }

    this.evaluateFrame(dtMs, false);
    this.lastEvaluatedTimeMs = this.currentTimeMs;
  }

  private evaluateFrame(dtMs: number, isScrubbing: boolean): void {
    if (!this.activeSequence) return;

    let hasDialogueThisFrame = false;
    let currentFade = 0;
    let fadeCol = '#000000';

    this.activeSequence.tracks.forEach(track => {
      let activeClip: CinematicClip | null = null;
      let holdStateClip: CinematicClip | null = null; 

      for (let i = 0; i < track.clips.length; i++) {
         const clip = track.clips[i];
         const endTime = clip.startTimeMs + clip.durationMs;
         
         if (this.currentTimeMs >= clip.startTimeMs && this.currentTimeMs <= endTime) {
            activeClip = clip;
            break;
         } else if (this.currentTimeMs > endTime) {
            holdStateClip = clip; 
         }
      }

      if (!activeClip && !holdStateClip && track.clips.length > 0) {
         holdStateClip = track.clips[0];
      }

      if (track.type === 'camera') {
        const rawT = activeClip && activeClip.durationMs > 0 ? (this.currentTimeMs - activeClip.startTimeMs) / activeClip.durationMs : 1;
        const t = this.applyEasing(rawT, activeClip?.easing || 'linear');

        if (activeClip) {
           if (activeClip.fadeMode === 'fadeIn') currentFade = 1.0 - t; 
           else if (activeClip.fadeMode === 'fadeOut') currentFade = t;
           else if (activeClip.fadeMode === 'holdBlack') currentFade = 1.0;
        } else if (holdStateClip) {
           if (holdStateClip.fadeMode === 'fadeOut' || holdStateClip.fadeMode === 'holdBlack') currentFade = 1.0;
        }

        this.evaluateTransformTrack(track, activeClip, holdStateClip, true, t);
      } 
      else if (track.type === 'actor') {
        this.evaluateTransformTrack(track, activeClip, holdStateClip, false, activeClip && activeClip.durationMs > 0 ? this.applyEasing((this.currentTimeMs - activeClip.startTimeMs) / activeClip.durationMs, activeClip.easing || 'linear') : 1);
      } 
      else if (track.type === 'dialogue' && !isScrubbing) {
         if (activeClip) {
            hasDialogueThisFrame = true;
            if (this.activeDialogueClipId !== activeClip.id) {
               this.activeDialogueClipId = activeClip.id;
               this.eventBus.emit({ 
                 type: 'DialogueRequested', 
                 payload: { actor: activeClip.actorName, text: activeClip.text, durationMs: activeClip.durationMs } 
               });
            }
         }
      }
      else if (track.type === 'event' && !isScrubbing) {
         if (activeClip && this.lastEvaluatedTimeMs < activeClip.startTimeMs && this.currentTimeMs >= activeClip.startTimeMs) {
             console.log('[CinematicDirector] Evento disparado:', activeClip.eventName);
         }
      }
    });

    this.fadeOpacity.set(currentFade);
    this.fadeColor.set(fadeCol);

    if (!hasDialogueThisFrame && this.activeDialogueClipId && !isScrubbing) {
        this.activeDialogueClipId = null;
        this.eventBus.emit({ type: 'DialogueRequested', payload: { durationMs: 0 } });
    }
  }

  private evaluateTransformTrack(track: import('../../models/cinematic.model').CinematicTrack, activeClip: CinematicClip | null, holdClip: CinematicClip | null, isCamera: boolean, t: number): void {
      
      let finalPos: Vector3;
      let finalRot: Quaternion;
      let animationName: string | null = null;

      const clipContext = activeClip || holdClip;
      if (!clipContext) return;

      const sPos = new Vector3(clipContext.startPosition?.x || 0, clipContext.startPosition?.y || 0, clipContext.startPosition?.z || 0);
      const ePos = new Vector3(clipContext.endPosition?.x || 0, clipContext.endPosition?.y || 0, clipContext.endPosition?.z || 0);
      
      let globalSPos = sPos;
      let globalEPos = ePos;
      let baseMatrix = Matrix.Identity();

      if (clipContext.useLocalSpaceUid) {
          const baseEntity = this.entityManager.getEntityByUid(clipContext.useLocalSpaceUid);
          if (baseEntity && baseEntity.view) {
              baseMatrix = baseEntity.view.getWorldMatrix();
              globalSPos = Vector3.TransformCoordinates(sPos, baseMatrix);
              globalEPos = Vector3.TransformCoordinates(ePos, baseMatrix);
          }
      }

      if (activeClip) {
         finalPos = Vector3.Lerp(globalSPos, globalEPos, t);
         animationName = activeClip.animationName || 'idle';
      } else {
         const isAfter = this.currentTimeMs > holdClip!.startTimeMs;
         finalPos = isAfter ? globalEPos : globalSPos;
         animationName = 'idle';
      }

      if (isCamera && clipContext.cameraTargetUid) {
          const targetEntity = this.entityManager.getEntityByUid(clipContext.cameraTargetUid);
          if (targetEntity && targetEntity.view) {
              const targetPos = targetEntity.view.getAbsolutePosition();
              finalRot = this.getLookQuat(finalPos, targetPos, Vector3.Forward());
          } else {
              finalRot = Quaternion.Identity();
          }
      } else {
          const sRotE = new Vector3(clipContext.startRotation?.x || 0, clipContext.startRotation?.y || 0, clipContext.startRotation?.z || 0);
          const eRotE = new Vector3(clipContext.endRotation?.x || 0, clipContext.endRotation?.y || 0, clipContext.endRotation?.z || 0);
          
          let qStart = Quaternion.FromEulerAngles(sRotE.x * Math.PI/180, sRotE.y * Math.PI/180, sRotE.z * Math.PI/180);
          let qEnd = Quaternion.FromEulerAngles(eRotE.x * Math.PI/180, eRotE.y * Math.PI/180, eRotE.z * Math.PI/180);

          if (clipContext.useLocalSpaceUid) {
              const baseRot = Quaternion.FromRotationMatrix(baseMatrix.getRotationMatrix());
              qStart = baseRot.multiply(qStart);
              qEnd = baseRot.multiply(qEnd);
          }
          
          if (activeClip) {
             finalRot = Quaternion.Slerp(qStart, qEnd, t);
          } else {
             const isAfter = this.currentTimeMs > holdClip!.startTimeMs;
             finalRot = isAfter ? qEnd : qStart;
          }
      }

      if (isCamera && this.cinematicCamera) {
          this.cinematicCamera.position.copyFrom(finalPos);
          this.cinematicCamera.rotationQuaternion = finalRot;
      } 
      else if (!isCamera && track.targetUid) {
          const entity = this.entityManager.getEntityByUid(track.targetUid);
          if (entity && entity.view) {
              entity.transform.position = { x: finalPos.x, y: finalPos.y, z: finalPos.z };
              const euler = finalRot.toEulerAngles();
              entity.transform.rotation = { x: euler.x, y: euler.y, z: euler.z };
              
              entity.view.position.copyFrom(finalPos);
              entity.view.rotationQuaternion = finalRot;
              entity.view.computeWorldMatrix(true);
              
              if (entity.playerRuntime) {
                  entity.playerRuntime.cinematicAnimation = animationName;
              }
          }
      }
  }
}