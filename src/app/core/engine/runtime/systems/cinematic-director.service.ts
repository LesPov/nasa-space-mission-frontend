
import { Injectable, inject, signal } from '@angular/core';
import { Vector3, Quaternion, UniversalCamera, Matrix, StandardMaterial, Color3, Mesh, MeshBuilder, Tags } from '@babylonjs/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { CinematicSequence, CinematicKeyframe, CinematicTrack, OverlayValue } from '../../models/cinematic.model';
import { CameraOwnershipService, CameraOwner } from '../cameras/camera-ownership.service';
import { CameraFactoryService } from '../cameras/camera-factory.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { CinematicCurveEvaluator } from '../cinematics/cinematic-curve-evaluator';
import { CinematicActorResolverService } from '../cinematics/cinematic-actor-resolver.service';
import { CinematicCameraRegistryService } from '../cameras/cinematic-camera-registry.service';
import { ActiveCameraResolver } from '../cinematics/active-camera-resolver';
import { CinematicLogger } from '../cinematics/cinematic-logger';
import { GameContextService } from '../../session/game-context.service';
import { GameMode } from '../../session/game-mode.model';

export interface ActiveOverlayState {
  id: string;
  type: 'text' | 'image' | 'background';
  value: OverlayValue;
  opacity: number;
  tx: number;
  ty: number;
  scale: number;
  contentOpacity: number;
  contentTx: number;
  contentTy: number;
  contentScale: number;
}

@Injectable({ providedIn: 'root' })
export class CinematicDirectorService implements IUpdatable {
  public id = 'CinematicDirectorSystem';
  
  private ownership = inject(CameraOwnershipService);
  private cameraFactory = inject(CameraFactoryService);
  private actorResolver = inject(CinematicActorResolverService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private eventBus = inject(GameEventBusService);
  private cameraRegistry = inject(CinematicCameraRegistryService);
  private gameContext = inject(GameContextService);

  public activeSequence: CinematicSequence | null = null;
  public isPlaying = false;
  public currentTimeMs = 0;

  public fadeOpacity = signal<number>(0);
  public fadeColor = signal<string>('#000000');

  public activeOverlays = signal<ActiveOverlayState[]>([]);
  public overlayTransformTranslate = signal<{x: number, y: number}>({x: 0, y: 0});
  public overlayTransformScale = signal<number>(1);

  public previousCameraOwner: CameraOwner = 'NONE';
  public previousCamera: any = null;
  private cinematicCamera: UniversalCamera | null = null;
  private cinematicCameraMesh: Mesh | null = null;

  private lastEvaluatedTimeMs = 0;
  private lastDtMs = 16;
  private activeDialogueClipId: string | null = null;
  private lastActiveOverlays = new Set<string>();
  private lastActiveCameraId: string | null = null;

  public editorWantsCamera = false; 

  // 🔥 WARMUP POOL: Cero Allocations & FASE A (Visual Center)
  private static _sPos = Vector3.Zero();
  private static _ePos = Vector3.Zero();
  private static _globalSPos = Vector3.Zero();
  private static _globalEPos = Vector3.Zero();
  private static _finalPos = Vector3.Zero();
  private static _finalRot = Quaternion.Identity();
  private static _qStart = Quaternion.Identity();
  private static _qEnd = Quaternion.Identity();
  private static _tempDir = Vector3.Zero();
  private static _vStart = Vector3.Zero();
  private static _vEnd = Vector3.Zero();
  private static _forwardDir = new Vector3(0, 0, 1);
  private static _tempTargetCenter = Vector3.Zero(); 

  private savedActorStates = new Map<string, any>();

  constructor() {
    this.eventBus.events$.subscribe(event => {
      if (event.type === 'SequenceTriggered') { }
    });
  }

  private updateCinematicState(): void {
    this.gameContext.setCinematicState(
      this.isPlaying, 
      this.activeSequence ? this.activeSequence.id : null, 
      this.currentTimeMs
    );
  }

  private createCameraMesh(scene: any): Mesh {
    const node = MeshBuilder.CreateBox("cinematic_active_cam_body", { width: 0.4, height: 0.3, depth: 0.5 }, scene);
    const lens = MeshBuilder.CreateCylinder('lens', { height: 0.3, diameterTop: 0.3, diameterBottom: 0.15 }, scene);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.4;
    lens.parent = node;
    
    const mat = new StandardMaterial(`mat_active_cam`, scene);
    mat.diffuseColor = new Color3(0, 0.8, 1);
    mat.emissiveColor = new Color3(0, 0.2, 0.4);
    node.material = mat; 
    lens.material = mat;
    
    node.isPickable = false;
    lens.isPickable = false;
    
    Tags.AddTagsTo(node, "editor_only ignore_raycast");
    Tags.AddTagsTo(lens, "editor_only ignore_raycast");
    
    return node;
  }

  private getLookQuatToRef(pos: Vector3, target: Vector3, fallbackForward: Vector3, ref: Quaternion): void {
      target.subtractToRef(pos, CinematicDirectorService._tempDir);
      if (CinematicDirectorService._tempDir.lengthSquared() < 0.001) CinematicDirectorService._tempDir.copyFrom(fallbackForward);
      CinematicDirectorService._tempDir.normalize();
      
      const yaw = Math.atan2(CinematicDirectorService._tempDir.x, CinematicDirectorService._tempDir.z);
      const pitch = Math.atan2(-CinematicDirectorService._tempDir.y, Math.sqrt(CinematicDirectorService._tempDir.x * CinematicDirectorService._tempDir.x + CinematicDirectorService._tempDir.z * CinematicDirectorService._tempDir.z));
      
      Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, ref);
  }

  public takeOverCamera(prevOwner: CameraOwner, prevCam: any) {
      this.previousCameraOwner = prevOwner;
      this.previousCamera = prevCam;
      if (!this.cinematicCamera) {
         this.cinematicCamera = this.cameraFactory.getCamera('CINEMATIC', this.motor3d.getScene());
         this.cinematicCameraMesh = this.createCameraMesh(this.motor3d.getScene());
         this.cinematicCameraMesh.parent = this.cinematicCamera;
      }
      const canvas = this.motor3d.getEngine().getRenderingCanvas();
      this.ownership.setCamera('CINEMATIC_DIRECTOR', this.cinematicCamera!, canvas, false);
      CinematicLogger.logOwnership('CINEMATIC_DIRECTOR');
  }

  public releaseCamera() {
      if (this.ownership.getOwner() === 'CINEMATIC_DIRECTOR') {
         const canvas = this.motor3d.getEngine().getRenderingCanvas();
         this.ownership.setCamera(this.previousCameraOwner, this.previousCamera, canvas, true);
         CinematicLogger.logOwnership(this.previousCameraOwner);
      }
  }

  private loadSequence(sequence: CinematicSequence) {
      if (this.activeSequence?.id === sequence.id) return;
      
      this.activeSequence = sequence;
      this.currentTimeMs = 0;
      this.lastEvaluatedTimeMs = 0;
      this.activeDialogueClipId = null;
      this.lastActiveOverlays.clear();

      const uidsToPrefetch: string[] = [];
      sequence.tracks.forEach(t => {
        if ((t.type === 'actor' || t.type === 'object') && t.targetUid) uidsToPrefetch.push(t.targetUid);
        if (t.type === 'camera' && t.targetUid) uidsToPrefetch.push(t.targetUid); 
        t.keyframes.forEach(kf => {
           if (kf.value?.useLocalSpaceUid) uidsToPrefetch.push(kf.value.useLocalSpaceUid);
           if (kf.value?.targetUid) uidsToPrefetch.push(kf.value.targetUid);
           if (kf.value?.cameraTargetUid) uidsToPrefetch.push(kf.value.cameraTargetUid);
        });
      });
      this.actorResolver.prefetch(uidsToPrefetch);
      
      this.savedActorStates.clear();
      sequence.tracks.forEach(t => {
        if ((t.type === 'actor' || t.type === 'object') && t.targetUid) {
          const entity = this.actorResolver.resolve(t.targetUid);
          if (entity && !this.savedActorStates.has(t.targetUid)) {
             this.savedActorStates.set(t.targetUid, {
                position: { ...entity.transform.position },
                rotation: { ...entity.transform.rotation },
                rotationQuaternion: entity.transform.rotationQuaternion ? { ...entity.transform.rotationQuaternion } : null,
                scale: { ...entity.transform.scale }
             });
          }
        }
      });
  }

  public play(sequence: CinematicSequence): void {
    if (this.isPlaying && this.activeSequence?.id === sequence.id) return;
    
    CinematicLogger.logPlayback('PLAY', sequence.name);
    
    this.loadSequence(sequence);

    this.isPlaying = true;
    if (this.currentTimeMs >= sequence.durationMs) {
      this.currentTimeMs = 0;
    }
    
    this.updateCinematicState();

    const hasCameraTrack = sequence.tracks.some(t => t.type === 'camera');
    if (hasCameraTrack) {
        if (!this.cinematicCamera) {
           this.cinematicCamera = this.cameraFactory.getCamera('CINEMATIC', this.motor3d.getScene());
           this.cinematicCameraMesh = this.createCameraMesh(this.motor3d.getScene());
           this.cinematicCameraMesh.parent = this.cinematicCamera;
        }
        
        if (this.ownership.getOwner() !== 'CINEMATIC_DIRECTOR') {
          if (this.ownership.getOwner() !== 'EDITOR' || this.editorWantsCamera) {
              this.takeOverCamera(this.ownership.getOwner(), this.ownership.getCamera());
          }
        }
        
        if (this.cinematicCameraMesh) {
            this.cinematicCameraMesh.setEnabled(!this.editorWantsCamera);
        }
    }

    sequence.tracks.forEach(t => {
      if ((t.type === 'actor' || t.type === 'object') && t.targetUid) {
        const entity = this.actorResolver.resolve(t.targetUid);
        if (entity) {
            entity.movementAuthority = 'CINEMATIC_FULL';
        }
      }
    });

    this.eventBus.emit({ type: 'CinematicStarted', payload: { cinematicId: sequence.id } });
  }

  public pause(): void {
    this.isPlaying = false;
    CinematicLogger.logPlayback('PAUSE');
    this.updateCinematicState();
  }

  public stop(): void {
    this.isPlaying = false;
    this.currentTimeMs = 0;
    this.lastEvaluatedTimeMs = 0;
    this.fadeOpacity.set(0);
    this.activeOverlays.set([]);
    this.overlayTransformTranslate.set({ x: 0, y: 0 });
    this.overlayTransformScale.set(1);
    this.lastActiveOverlays.clear();
    
    CinematicLogger.logPlayback('STOP');
    this.updateCinematicState();

    if (this.activeDialogueClipId) {
       this.eventBus.emit({ type: 'DialogueRequested', payload: { durationMs: 0 } });
       this.activeDialogueClipId = null;
    }

    if (this.cinematicCameraMesh) {
        this.cinematicCameraMesh.setEnabled(false);
    }

    if (this.activeSequence) {
      this.activeSequence.tracks.forEach(t => {
        if ((t.type === 'actor' || t.type === 'object') && t.targetUid) {
          const entity = this.actorResolver.resolve(t.targetUid);
          if (entity) {
             entity.movementAuthority = 'GAMEPLAY';
             if (entity.playerRuntime) {
                 entity.playerRuntime.cinematicAnimation = null;
                 entity.playerRuntime.cinematicClipOverride = null;
                 entity.playerRuntime.seqRuntime = null;
             }
          }
        }
      });

      this.savedActorStates.forEach((state, uid) => {
         const entity = this.actorResolver.resolve(uid);
         if (entity) {
            entity.transform.position = { ...state.position };
            entity.transform.rotation = { ...state.rotation };
            entity.transform.rotationQuaternion = state.rotationQuaternion ? { ...state.rotationQuaternion } : null;
            entity.transform.scale = { ...state.scale };
            entity.isDirty = true;
            entity.syncToView();
         }
      });
      this.savedActorStates.clear();

      if (this.ownership.getOwner() === 'CINEMATIC_DIRECTOR') {
         this.releaseCamera();
      }
      this.activeSequence = null;
    }

    this.actorResolver.clearCache(); 
    this.eventBus.emit({ type: 'CinematicStopped' });
  }

  public finish(): void {
    this.isPlaying = false;
    this.fadeOpacity.set(0);
    this.activeOverlays.set([]);
    this.overlayTransformTranslate.set({ x: 0, y: 0 });
    this.overlayTransformScale.set(1);
    this.lastActiveOverlays.clear();
    
    CinematicLogger.logPlayback('FINISH');
    this.updateCinematicState();

    if (this.activeDialogueClipId) {
       this.eventBus.emit({ type: 'DialogueRequested', payload: { durationMs: 0 } });
       this.activeDialogueClipId = null;
    }

    if (this.cinematicCameraMesh) {
        this.cinematicCameraMesh.setEnabled(false);
    }

    if (this.activeSequence) {
      this.activeSequence.tracks.forEach(t => {
        if ((t.type === 'actor' || t.type === 'object') && t.targetUid) {
          const entity = this.actorResolver.resolve(t.targetUid);
          if (entity) {
             entity.movementAuthority = 'GAMEPLAY';
             if (entity.playerRuntime) {
                 entity.playerRuntime.cinematicAnimation = null;
                 entity.playerRuntime.cinematicClipOverride = null;
                 entity.playerRuntime.seqRuntime = null;
             }
          }
        }
      });

      this.savedActorStates.clear(); 

      if (this.ownership.getOwner() === 'CINEMATIC_DIRECTOR') {
         this.releaseCamera();
      }
      this.activeSequence = null;
    }

    this.actorResolver.clearCache(); 
    this.eventBus.emit({ type: 'CinematicStopped' });
  }

  public seek(timeMs: number, cinematic?: CinematicSequence): void {
    if (cinematic) this.loadSequence(cinematic);
    if (!this.activeSequence) return;
    
    CinematicLogger.logPlayback('SEEK', `${Math.round(timeMs)}ms`);
    this.currentTimeMs = Math.max(0, Math.min(timeMs, this.activeSequence.durationMs));
    this.lastEvaluatedTimeMs = this.currentTimeMs; 
    
    this.updateCinematicState();

    this.activeSequence.tracks.forEach(t => {
      if ((t.type === 'actor' || t.type === 'object') && t.targetUid) {
        const entity = this.actorResolver.resolve(t.targetUid);
        if (entity) {
            entity.movementAuthority = 'CINEMATIC_FULL';
        }
      }
    });

    if (!this.cinematicCamera) {
       this.cinematicCamera = this.cameraFactory.getCamera('CINEMATIC', this.motor3d.getScene());
       this.cinematicCameraMesh = this.createCameraMesh(this.motor3d.getScene());
       this.cinematicCameraMesh.parent = this.cinematicCamera;
    }
    if (this.cinematicCameraMesh) {
       this.cinematicCameraMesh.setEnabled(!this.editorWantsCamera);
    }
    
    this.evaluateFrame(0, true);
    this.eventBus.emit({ type: 'CinematicSeeked', payload: { timeMs: this.currentTimeMs } });
  }

  public update(dtMs: number): void {
    if (!this.isPlaying || !this.activeSequence) return;

    this.currentTimeMs += dtMs;
    this.lastDtMs = dtMs;

    if (this.currentTimeMs >= this.activeSequence.durationMs) {
       this.currentTimeMs = this.activeSequence.durationMs;
       this.updateCinematicState();
       this.evaluateFrame(dtMs, false);
       
       const mode = this.gameContext.mode();
       if (mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME) {
           this.pause(); 
       } else {
           this.finish();  
       }
       return;
    }

    this.updateCinematicState();
    this.evaluateFrame(dtMs, false);
    this.lastEvaluatedTimeMs = this.currentTimeMs;
  }

  private evaluateFrame(dtMs: number, isScrubbing: boolean): void {
    if (!this.activeSequence) return;

    let hasDialogueThisFrame = false;
    let currentFade = 0;
    let fadeCol = '#000000';
    
    let activeElements: ActiveOverlayState[] = [];

    const activeCamRes = ActiveCameraResolver.resolve(this.activeSequence, this.currentTimeMs);
    const activeCameraTrack = activeCamRes?.track;
    const activeCameraId = activeCamRes?.cameraId;

    if (this.lastActiveCameraId !== activeCameraId) {
        CinematicLogger.logActiveCamera(activeCameraId || 'None');
        this.lastActiveCameraId = activeCameraId || null;
    }

    this.activeSequence.tracks.forEach(track => {
      
      if (track.type === 'camera' || track.type === 'actor' || track.type === 'object') {
          const evalResult = CinematicCurveEvaluator.evaluateTrack(track, this.currentTimeMs);
          if (evalResult) {
             const { kf1, kf2, t } = evalResult;
             if (track === activeCameraTrack) {
                if (kf1.value.fadeMode === 'fadeIn') currentFade = 1.0 - t; 
                else if (kf1.value.fadeMode === 'fadeOut') currentFade = t;
                else if (kf1.value.fadeMode === 'holdBlack') currentFade = 1.0;

                this.evaluateTransformTrack(track, kf1, kf2, true, t, activeCameraId, isScrubbing);
             } else if (track.type !== 'camera') {
                this.evaluateTransformTrack(track, kf1, kf2, false, t, undefined, isScrubbing);
             }
          }
      } 
      else if (track.type === 'text' || track.type === 'image' || track.type === 'overlay' || track.type === 'background') {
          for (const kf of track.keyframes) {
              const start = kf.timeMs;
              const dur = kf.value.durationMs || 0;
              const end = start + dur;

              if (this.currentTimeMs >= start && this.currentTimeMs <= end) {
                  const elapsed = this.currentTimeMs - start;
                  
                  const calcAnim = (elapsedTime: number, durTotal: number, delayIn: number, fIn: number, fOut: number, aIn: string, aOut: string, earlyOut: number = 0) => {
                      let o = 1, x = 0, y = 0, s = 1;
                      const actualEnd = durTotal - earlyOut;

                      if (elapsedTime < delayIn || elapsedTime > actualEnd) {
                          o = 0;
                      } else if (fIn > 0 && elapsedTime < delayIn + fIn) {
                          const p = (elapsedTime - delayIn) / fIn;
                          if (!aIn || aIn === 'FADE_IN') o *= p;
                          else if (aIn === 'SLIDE_UP') { y = (1-p)*100; o *= p; }
                          else if (aIn === 'SLIDE_DOWN') { y = -(1-p)*100; o *= p; }
                          else if (aIn === 'SLIDE_LEFT') { x = (1-p)*100; o *= p; }
                          else if (aIn === 'SLIDE_RIGHT') { x = -(1-p)*100; o *= p; }
                          else if (aIn === 'SCALE_IN') { s *= p; o *= p; }
                          else if (aIn === 'INSTANT') o = 1;
                      } else if (fOut > 0 && elapsedTime > actualEnd - fOut) {
                          const p = (actualEnd - elapsedTime) / fOut;
                          if (!aOut || aOut === 'FADE_OUT') o *= p;
                          else if (aOut === 'SLIDE_UP') { y = -(1-p)*100; o *= p; }
                          else if (aOut === 'SLIDE_DOWN') { y = (1-p)*100; o *= p; }
                          else if (aOut === 'SLIDE_LEFT') { x = -(1-p)*100; o *= p; }
                          else if (aOut === 'SLIDE_RIGHT') { x = (1-p)*100; o *= p; }
                          else if (aOut === 'SCALE_OUT') { s *= p; o *= p; }
                          else if (aOut === 'ZOOM_THROUGH') {
                              s *= 1 + ((1 - p) * 19); 
                              o *= p;
                          }
                          else if (aOut === 'INSTANT') o = 1;
                      }
                      return { o, x, y, s };
                  };

                  const containerAnim = calcAnim(
                      elapsed, dur, 0, 
                      kf.value.fadeInMs || 0, kf.value.fadeOutMs || 0, 
                      kf.value.animIn || 'FADE_IN', kf.value.animOut || 'FADE_OUT',
                      0 
                  );
                  
                  const cDelay = kf.value.contentDelayMs || 0;
                  const cEarlyOut = kf.value.contentEarlyOutMs || 0;
                  const cFadeIn = kf.value.contentFadeInMs !== undefined ? kf.value.contentFadeInMs : (kf.value.fadeInMs || 0);
                  const cFadeOut = kf.value.contentFadeOutMs !== undefined ? kf.value.contentFadeOutMs : (kf.value.fadeOutMs || 0);
                  const cAnimIn = kf.value.contentAnimIn || kf.value.animIn || 'FADE_IN';
                  const cAnimOut = kf.value.contentAnimOut || kf.value.animOut || 'FADE_OUT';

                  const contentAnim = calcAnim(
                      elapsed, dur, cDelay, 
                      cFadeIn, cFadeOut, 
                      cAnimIn, cAnimOut,
                      cEarlyOut
                  );
                  
                  let realType = track.type;
                  if (realType === 'overlay') {
                      realType = kf.value.image ? 'image' : 'text';
                  }

                  activeElements.push({
                      id: kf.id,
                      type: realType as 'text' | 'image' | 'background',
                      value: kf.value,
                      opacity: containerAnim.o,
                      tx: containerAnim.x,
                      ty: containerAnim.y,
                      scale: containerAnim.s,
                      contentOpacity: contentAnim.o,
                      contentTx: contentAnim.x,
                      contentTy: contentAnim.y,
                      contentScale: contentAnim.s
                  });

                  if (!this.lastActiveOverlays.has(kf.id)) {
                      CinematicLogger.logOverlay('show', kf.value.title || kf.value.image || kf.id);
                  }
                  break; 
              }
          }
      }
      else if (track.type === 'dialogue' && !isScrubbing) {
         for (const kf of track.keyframes) {
             if (kf.value.durationMs) {
                const isInside = this.currentTimeMs >= kf.timeMs && this.currentTimeMs <= (kf.timeMs + kf.value.durationMs);
                if (isInside) {
                    hasDialogueThisFrame = true;
                    if (this.activeDialogueClipId !== kf.id) {
                       this.activeDialogueClipId = kf.id;
                       this.eventBus.emit({ 
                         type: 'DialogueRequested', 
                         payload: { actor: kf.value.actorName, text: kf.value.text, durationMs: kf.value.durationMs } 
                       });
                    }
                    break;
                }
             }
         }
      }
      else if (track.type === 'event') {
         for (const kf of track.keyframes) {
             if (isScrubbing) {
                 if (kf.timeMs <= this.currentTimeMs) {
                     try {
                         const payloadStr = kf.value.eventPayload || '{}';
                         const payload = typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr;
                         if (payload && payload.sequenceId) {
                             const elapsed = this.currentTimeMs - kf.timeMs;
                             this.eventBus.emit({ type: 'SequenceSyncRequested', payload: { sequenceId: payload.sequenceId, elapsedMs: elapsed } });
                         }
                     } catch(e) {}
                 }
             } else {
                 if (kf.timeMs > this.lastEvaluatedTimeMs && kf.timeMs <= this.currentTimeMs) {
                     CinematicLogger.logPlayback('EVENT TRIGGERED', kf.value.eventName);
                     try {
                         const payloadStr = kf.value.eventPayload || '{}';
                         const payload = typeof payloadStr === 'string' ? JSON.parse(payloadStr) : payloadStr;
                         const evtName = kf.value.eventName || 'SequenceTriggered';
                         this.eventBus.emit({ type: evtName as any, payload });
                     } catch(e) {}
                 }
             }
         }
      }
    });

    this.fadeOpacity.set(currentFade);
    this.fadeColor.set(fadeCol);
    
    const currentActiveIds = new Set(activeElements.map(e => e.id));
    this.lastActiveOverlays.forEach(id => {
       if (!currentActiveIds.has(id)) {
           CinematicLogger.logOverlay('hide', id);
       }
    });
    this.lastActiveOverlays = currentActiveIds;
    this.activeOverlays.set(activeElements);

    if (!hasDialogueThisFrame && this.activeDialogueClipId && !isScrubbing) {
        this.activeDialogueClipId = null;
        this.eventBus.emit({ type: 'DialogueRequested', payload: { durationMs: 0 } });
    }
  }

  private evaluateTransformTrack(track: CinematicTrack, kf1: CinematicKeyframe, kf2: CinematicKeyframe, isCamera: boolean, t: number, activeCameraId?: string, isScrubbing: boolean = false): void {
      const val1 = kf1.value;
      const applyPosition = true; 

      if (track.type === 'actor' && track.targetUid) {
          const entity = this.actorResolver.resolve(track.targetUid);
          if (entity) {
              entity.movementAuthority = 'CINEMATIC_FULL';
          }
      } else if (!isCamera && track.targetUid) {
          const entity = this.actorResolver.resolve(track.targetUid);
          if (entity) {
              entity.movementAuthority = 'CINEMATIC_FULL';
          }
      }

      CinematicDirectorService._sPos.set(val1.position?.x || 0, val1.position?.y || 0, val1.position?.z || 0);
      CinematicDirectorService._ePos.set(kf2.value.position?.x || 0, kf2.value.position?.y || 0, kf2.value.position?.z || 0);
      
      let baseMatrix = null;
      let useGlobal = false;

      if (val1.useLocalSpaceUid) {
          const baseEntity = this.actorResolver.resolve(val1.useLocalSpaceUid);
          if (baseEntity && baseEntity.view) {
              baseMatrix = baseEntity.view.getWorldMatrix();
              Vector3.TransformCoordinatesToRef(CinematicDirectorService._sPos, baseMatrix, CinematicDirectorService._globalSPos);
              Vector3.TransformCoordinatesToRef(CinematicDirectorService._ePos, baseMatrix, CinematicDirectorService._globalEPos);
              useGlobal = true;
          }
      }

      const pStart = useGlobal ? CinematicDirectorService._globalSPos : CinematicDirectorService._sPos;
      const pEnd = useGlobal ? CinematicDirectorService._globalEPos : CinematicDirectorService._ePos;

      let moveMode = val1.movementMode || 'linear';
      Vector3.LerpToRef(pStart, pEnd, t, CinematicDirectorService._finalPos);

      const targetUid = val1.targetUid || val1.cameraTargetUid || track.targetUid;
      const orientMode = val1.orientationMode || track.orientationMode || 'free';

      if (moveMode === 'hold') {
          CinematicDirectorService._finalPos.copyFrom(pStart);
      } 
      else if (moveMode === 'orbit' && targetUid) {
          const targetEntity = this.actorResolver.resolve(targetUid);
          if (targetEntity && targetEntity.view) {
              targetEntity.getVisualCenterAbsoluteToRef(CinematicDirectorService._tempTargetCenter);
              const center = CinematicDirectorService._tempTargetCenter;
              
              pStart.subtractToRef(center, CinematicDirectorService._vStart);
              pEnd.subtractToRef(center, CinematicDirectorService._vEnd);
              
              const rStart = Math.sqrt(CinematicDirectorService._vStart.x * CinematicDirectorService._vStart.x + CinematicDirectorService._vStart.z * CinematicDirectorService._vStart.z);
              const rEnd = Math.sqrt(CinematicDirectorService._vEnd.x * CinematicDirectorService._vEnd.x + CinematicDirectorService._vEnd.z * CinematicDirectorService._vEnd.z);
              const currentRadius = rStart + (rEnd - rStart) * t;
              
              const currentY = pStart.y + (pEnd.y - pStart.y) * t;
              
              const startAngle = Math.atan2(CinematicDirectorService._vStart.z, CinematicDirectorService._vStart.x);
              let endAngle = Math.atan2(CinematicDirectorService._vEnd.z, CinematicDirectorService._vEnd.x);
              
              let baseDiff = endAngle - startAngle;
              if (baseDiff > Math.PI) baseDiff -= Math.PI * 2;
              if (baseDiff < -Math.PI) baseDiff += Math.PI * 2;

              const turns = val1.orbitTurns || 0;
              const dirMultiplier = val1.orbitDirection === 'counter_clockwise' ? -1 : 1;

              if (turns === 0) {
                  if (dirMultiplier === 1 && baseDiff < 0) baseDiff += Math.PI * 2;
                  if (dirMultiplier === -1 && baseDiff > 0) baseDiff -= Math.PI * 2;
              }

              const totalAngleDelta = baseDiff + (turns * Math.PI * 2 * dirMultiplier);
              const currentAngle = startAngle + (totalAngleDelta * t);
              
              CinematicDirectorService._finalPos.set(
                  center.x + Math.cos(currentAngle) * currentRadius,
                  currentY,
                  center.z + Math.sin(currentAngle) * currentRadius
              );
          }
      }

      if ((orientMode === 'lookAt' || moveMode === 'orbit') && targetUid) {
          const targetEntity = this.actorResolver.resolve(targetUid);
          if (targetEntity && targetEntity.view) {
              targetEntity.getVisualCenterAbsoluteToRef(CinematicDirectorService._tempTargetCenter);
              const targetPos = CinematicDirectorService._tempTargetCenter;
              const sourcePos = applyPosition ? CinematicDirectorService._finalPos : 
                  (track.targetUid ? (this.actorResolver.resolve(track.targetUid)?.view?.getAbsolutePosition() || CinematicDirectorService._finalPos) : CinematicDirectorService._finalPos);
              
              this.getLookQuatToRef(sourcePos, targetPos, CinematicDirectorService._forwardDir, CinematicDirectorService._finalRot);
          } else {
              CinematicDirectorService._finalRot.copyFromFloats(0,0,0,1);
          }
      } else {
          Quaternion.FromEulerAnglesToRef(
              (val1.rotation?.x || 0) * Math.PI/180, 
              (val1.rotation?.y || 0) * Math.PI/180, 
              (val1.rotation?.z || 0) * Math.PI/180,
              CinematicDirectorService._qStart
          );
          if (baseMatrix) {
              const baseRot = Quaternion.FromRotationMatrix(baseMatrix.getRotationMatrix());
              baseRot.multiplyToRef(CinematicDirectorService._qStart, CinematicDirectorService._qStart);
          }

          Quaternion.FromEulerAnglesToRef(
              (kf2.value.rotation?.x || 0) * Math.PI/180, 
              (kf2.value.rotation?.y || 0) * Math.PI/180, 
              (kf2.value.rotation?.z || 0) * Math.PI/180,
              CinematicDirectorService._qEnd
          );
          if (baseMatrix) {
              const baseRot = Quaternion.FromRotationMatrix(baseMatrix.getRotationMatrix());
              baseRot.multiplyToRef(CinematicDirectorService._qEnd, CinematicDirectorService._qEnd);
          }

          if (moveMode === 'hold') {
              CinematicDirectorService._finalRot.copyFrom(CinematicDirectorService._qStart);
          } else {
              Quaternion.SlerpToRef(CinematicDirectorService._qStart, CinematicDirectorService._qEnd, t, CinematicDirectorService._finalRot);
          }
      }

      if (isCamera && this.cinematicCamera) {
          if (!this.cinematicCamera.rotationQuaternion) {
              this.cinematicCamera.rotationQuaternion = new Quaternion();
          }

          if (activeCameraId) {
              const camDef = this.cameraRegistry.getCamera(activeCameraId);
              if (camDef) {
                  this.cinematicCamera.position.set(camDef.position.x, camDef.position.y, camDef.position.z);
                  
                  if (camDef.cameraTargetUid) {
                      const targetEntity = this.actorResolver.resolve(camDef.cameraTargetUid);
                      if (targetEntity && targetEntity.view) {
                          targetEntity.getVisualCenterAbsoluteToRef(CinematicDirectorService._tempTargetCenter);
                          const targetPos = CinematicDirectorService._tempTargetCenter;
                          this.getLookQuatToRef(this.cinematicCamera.position, targetPos, CinematicDirectorService._forwardDir, CinematicDirectorService._finalRot);
                          this.cinematicCamera.rotationQuaternion.copyFrom(CinematicDirectorService._finalRot);
                      } else {
                          this.cinematicCamera.rotationQuaternion.copyFromFloats(0,0,0,1);
                      }
                  } else {
                      Quaternion.FromEulerAnglesToRef(camDef.rotation.x * Math.PI/180, camDef.rotation.y * Math.PI/180, camDef.rotation.z * Math.PI/180, this.cinematicCamera.rotationQuaternion);
                  }

                  if (camDef.fov !== undefined) this.cinematicCamera.fov = camDef.fov;
                  return; 
              }
          }

          let startFov = val1.fov !== undefined ? val1.fov : 0.8;
          let endFov = kf2.value.fov !== undefined ? kf2.value.fov : startFov;
          let currentFov = moveMode === 'hold' ? startFov : (startFov + (endFov - startFov) * t);
          
          if (currentFov < 0.1) currentFov = 0.1;
          if (currentFov > Math.PI) currentFov = Math.PI;

          this.cinematicCamera.fov = currentFov;
          this.cinematicCamera.position.copyFrom(CinematicDirectorService._finalPos);
          this.cinematicCamera.rotationQuaternion.copyFrom(CinematicDirectorService._finalRot);
      } 
      else if (!isCamera && track.targetUid) {
          const entity = this.actorResolver.resolve(track.targetUid);
          if (entity && entity.view) {
              if (applyPosition) {
                  entity.transform.position = { x: CinematicDirectorService._finalPos.x, y: CinematicDirectorService._finalPos.y, z: CinematicDirectorService._finalPos.z };
                  entity.view.position.copyFrom(CinematicDirectorService._finalPos);
              }
              
              if (entity.transform.rotationQuaternion) {
                  entity.transform.rotationQuaternion = { x: CinematicDirectorService._finalRot.x, y: CinematicDirectorService._finalRot.y, z: CinematicDirectorService._finalRot.z, w: CinematicDirectorService._finalRot.w };
              } else {
                  const euler = CinematicDirectorService._finalRot.toEulerAngles();
                  entity.transform.rotation = { x: euler.x, y: euler.y, z: euler.z };
              }
              
              if (!entity.view.rotationQuaternion) entity.view.rotationQuaternion = new Quaternion();
              entity.view.rotationQuaternion.copyFrom(CinematicDirectorService._finalRot);
              
              entity.view.computeWorldMatrix(true);
              
              // 🔥 FIX 2: Marcamos la entidad como sucia para asegurar perfecta coherencia de los demás sistemas
              entity.isDirty = true;
              
              if (entity.playerRuntime) {
                  entity.playerRuntime.cinematicAnimation = val1.action || val1.animationName || 'idle';
                  entity.playerRuntime.cinematicClipOverride = val1.clipOverride || null;
              }
          }
      }
  }
}