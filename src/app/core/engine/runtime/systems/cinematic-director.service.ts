
import { Injectable, inject, signal } from '@angular/core';
import { Vector3, Quaternion, UniversalCamera, Matrix, StandardMaterial, Color3, Mesh, MeshBuilder, Tags } from '@babylonjs/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { CinematicSequence, CinematicKeyframe, CinematicTrack, OverlayValue } from '../../models/cinematic.model';
import { CameraOwnershipService, CameraOwner } from '../cameras/camera-ownership.service';
import { CameraFactoryService } from '../cameras/camera-factory.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { getMovementProfileForOwner } from '../movement/movement-profile.model';
import { CinematicCurveEvaluator } from '../cinematics/cinematic-curve-evaluator';
import { CinematicActorResolverService } from '../cinematics/cinematic-actor-resolver.service';
import { CinematicCameraRegistryService } from '../cameras/cinematic-camera-registry.service';
import { ActiveCameraResolver } from '../cinematics/active-camera-resolver';
import { CinematicLogger } from '../cinematics/cinematic-logger';

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
  private activeDialogueClipId: string | null = null;
  private lastActiveOverlays = new Set<string>();
  private lastActiveCameraId: string | null = null;

  public editorWantsCamera = false; 

  constructor() {
    this.eventBus.events$.subscribe(event => {
      if (event.type === 'SequenceTriggered') { }
    });
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

  private getLookQuat(pos: Vector3, target: Vector3, fallbackForward: Vector3): Quaternion {
      let dir = target.subtract(pos);
      if (dir.lengthSquared() < 0.001) dir = fallbackForward.clone();
      dir.normalize();
      
      const yaw = Math.atan2(dir.x, dir.z);
      const pitch = Math.atan2(-dir.y, Math.sqrt(dir.x * dir.x + dir.z * dir.z));
      
      return Quaternion.RotationYawPitchRoll(yaw, pitch, 0);
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

  public play(sequence: CinematicSequence): void {
    if (this.isPlaying && this.activeSequence?.id === sequence.id) return;
    
    CinematicLogger.logPlayback('PLAY', sequence.name);
    this.activeSequence = sequence;
    this.isPlaying = true;
    
    if (this.currentTimeMs >= sequence.durationMs) {
      this.currentTimeMs = 0;
    }
    this.lastEvaluatedTimeMs = this.currentTimeMs;
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
            entity.isCinematicControlled = true;
            if (entity.view) entity.view.checkCollisions = false;
        }
      }
    });

    this.eventBus.emit({ type: 'CinematicStarted', payload: { cinematicId: sequence.id } });
  }

  public pause(): void {
    this.isPlaying = false;
    CinematicLogger.logPlayback('PAUSE');
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
      }
      this.activeSequence = null;
    }

    this.actorResolver.clearCache(); 
    this.eventBus.emit({ type: 'CinematicStopped' });
  }

  public seek(timeMs: number): void {
    if (!this.activeSequence) return;
    CinematicLogger.logPlayback('SEEK', `${Math.round(timeMs)}ms`);
    this.currentTimeMs = Math.max(0, Math.min(timeMs, this.activeSequence.durationMs));
    this.lastEvaluatedTimeMs = this.currentTimeMs;
    
    if (!this.cinematicCamera) {
       this.cinematicCamera = this.cameraFactory.getCamera('CINEMATIC', this.motor3d.getScene());
       this.cinematicCameraMesh = this.createCameraMesh(this.motor3d.getScene());
       this.cinematicCameraMesh.parent = this.cinematicCamera;
    }
    if (this.cinematicCameraMesh) {
       this.cinematicCameraMesh.setEnabled(!this.editorWantsCamera);
    }
    
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

                this.evaluateTransformTrack(track, kf1, kf2, true, t, activeCameraId);
             } else if (track.type !== 'camera') {
                this.evaluateTransformTrack(track, kf1, kf2, false, t);
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
                  
                  // 🔥 ACTUALIZADO: Función genérica de interpolación con control independiente de earlyOut
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

                  // Animación del contenedor general (Fondo Local)
                  const containerAnim = calcAnim(
                      elapsed, dur, 0, 
                      kf.value.fadeInMs || 0, kf.value.fadeOutMs || 0, 
                      kf.value.animIn || 'FADE_IN', kf.value.animOut || 'FADE_OUT',
                      0 // El fondo usa la duración total completa
                  );
                  
                  // Propiedades independientes para el contenido visual (Imagen/Texto)
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
                      cEarlyOut // Descuenta milisegundos para que salga antes que el fondo
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
      else if (track.type === 'event' && !isScrubbing) {
         for (const kf of track.keyframes) {
             if (kf.timeMs > this.lastEvaluatedTimeMs && kf.timeMs <= this.currentTimeMs) {
                CinematicLogger.logPlayback('EVENT TRIGGERED', kf.value.eventName);
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

  private evaluateTransformTrack(track: CinematicTrack, kf1: CinematicKeyframe, kf2: CinematicKeyframe, isCamera: boolean, t: number, activeCameraId?: string): void {
      const val1 = kf1.value;
      const val2 = kf2.value;

      const sPos = new Vector3(val1.position?.x || 0, val1.position?.y || 0, val1.position?.z || 0);
      const ePos = new Vector3(val2.position?.x || 0, val2.position?.y || 0, val2.position?.z || 0);
      
      let globalSPos = sPos;
      let globalEPos = ePos;
      let baseMatrix = Matrix.Identity();

      if (val1.useLocalSpaceUid) {
          const baseEntity = this.actorResolver.resolve(val1.useLocalSpaceUid);
          if (baseEntity && baseEntity.view) {
              baseMatrix = baseEntity.view.getWorldMatrix();
              globalSPos = Vector3.TransformCoordinates(sPos, baseMatrix);
              globalEPos = Vector3.TransformCoordinates(ePos, baseMatrix);
          }
      }

      let moveMode = val1.movementMode || 'linear';
      let finalPos = Vector3.Lerp(globalSPos, globalEPos, t);
      const animationName = val1.animationName || 'idle';

      const targetUid = val1.targetUid || val1.cameraTargetUid || track.targetUid;
      const orientMode = val1.orientationMode || track.orientationMode || 'free';

      if (moveMode === 'hold') {
          finalPos = globalSPos; 
      } 
      else if (moveMode === 'orbit' && targetUid) {
          const targetEntity = this.actorResolver.resolve(targetUid);
          if (targetEntity && targetEntity.view) {
              const center = targetEntity.view.getAbsolutePosition();
              
              const vStart = globalSPos.subtract(center);
              const vEnd = globalEPos.subtract(center);
              
              const rStart = Math.sqrt(vStart.x * vStart.x + vStart.z * vStart.z);
              const rEnd = Math.sqrt(vEnd.x * vEnd.x + vEnd.z * vEnd.z);
              const currentRadius = rStart + (rEnd - rStart) * t;
              
              const currentY = globalSPos.y + (globalEPos.y - globalSPos.y) * t;
              
              const startAngle = Math.atan2(vStart.z, vStart.x);
              let endAngle = Math.atan2(vEnd.z, vEnd.x);
              
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
              
              finalPos = new Vector3(
                  center.x + Math.cos(currentAngle) * currentRadius,
                  currentY,
                  center.z + Math.sin(currentAngle) * currentRadius
              );
          }
      }

      let finalRot: Quaternion;

      if ((orientMode === 'lookAt' || moveMode === 'orbit') && targetUid) {
          const targetEntity = this.actorResolver.resolve(targetUid);
          if (targetEntity && targetEntity.view) {
              const targetPos = targetEntity.view.getAbsolutePosition();
              finalRot = this.getLookQuat(finalPos, targetPos, Vector3.Forward());
          } else {
              finalRot = Quaternion.Identity();
          }
      } else {
          const sRotE = new Vector3(val1.rotation?.x || 0, val1.rotation?.y || 0, val1.rotation?.z || 0);
          let qStart = Quaternion.FromEulerAngles(sRotE.x * Math.PI/180, sRotE.y * Math.PI/180, sRotE.z * Math.PI/180);
          if (val1.useLocalSpaceUid) qStart = Quaternion.FromRotationMatrix(baseMatrix.getRotationMatrix()).multiply(qStart);

          const eRotE = new Vector3(val2.rotation?.x || 0, val2.rotation?.y || 0, val2.rotation?.z || 0);
          let qEnd = Quaternion.FromEulerAngles(eRotE.x * Math.PI/180, eRotE.y * Math.PI/180, eRotE.z * Math.PI/180);
          if (val1.useLocalSpaceUid) qEnd = Quaternion.FromRotationMatrix(baseMatrix.getRotationMatrix()).multiply(qEnd);

          finalRot = moveMode === 'hold' ? qStart : Quaternion.Slerp(qStart, qEnd, t);
      }

      if (isCamera && this.cinematicCamera) {
          if (activeCameraId) {
              const camDef = this.cameraRegistry.getCamera(activeCameraId);
              if (camDef) {
                  this.cinematicCamera.position.set(camDef.position.x, camDef.position.y, camDef.position.z);
                  
                  if (camDef.cameraTargetUid) {
                      const targetEntity = this.actorResolver.resolve(camDef.cameraTargetUid);
                      if (targetEntity && targetEntity.view) {
                          const targetPos = targetEntity.view.getAbsolutePosition();
                          this.cinematicCamera.rotationQuaternion = this.getLookQuat(this.cinematicCamera.position, targetPos, Vector3.Forward());
                      } else {
                          this.cinematicCamera.rotationQuaternion = Quaternion.Identity();
                      }
                  } else {
                      const q = Quaternion.FromEulerAngles(camDef.rotation.x * Math.PI/180, camDef.rotation.y * Math.PI/180, camDef.rotation.z * Math.PI/180);
                      this.cinematicCamera.rotationQuaternion = q;
                  }

                  if (camDef.fov !== undefined) this.cinematicCamera.fov = camDef.fov;
                  return; 
              } else {
                  CinematicLogger.warn(`Cámara inexistente: No se encontró la cámara '${activeCameraId}'. Usando Interpolación fallback.`);
              }
          }

          let startFov = val1.fov !== undefined ? val1.fov : 0.8;
          let endFov = val2.fov !== undefined ? val2.fov : startFov;
          let currentFov = moveMode === 'hold' ? startFov : (startFov + (endFov - startFov) * t);
          
          if (currentFov < 0.1) currentFov = 0.1;
          if (currentFov > Math.PI) currentFov = Math.PI;

          this.cinematicCamera.fov = currentFov;
          this.cinematicCamera.position.copyFrom(finalPos);
          this.cinematicCamera.rotationQuaternion = finalRot;
      } 
      else if (!isCamera && track.targetUid) {
          const entity = this.actorResolver.resolve(track.targetUid);
          if (entity && entity.view) {
              entity.transform.position = { x: finalPos.x, y: finalPos.y, z: finalPos.z };
              
              if (entity.transform.rotationQuaternion) {
                  entity.transform.rotationQuaternion = { x: finalRot.x, y: finalRot.y, z: finalRot.z, w: finalRot.w };
              } else {
                  const euler = finalRot.toEulerAngles();
                  entity.transform.rotation = { x: euler.x, y: euler.y, z: euler.z };
              }
              
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