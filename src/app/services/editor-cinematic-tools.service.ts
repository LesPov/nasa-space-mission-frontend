import { Injectable, inject } from '@angular/core';
import { Vector3, Matrix, Quaternion } from '@babylonjs/core';
import { EntityManagerService } from '../core/engine/entities/entity-manager.service';
import { CinematicClip, CinematicTrack } from '../core/engine/models/cinematic.model';
import { CinematicDirectorService } from '../core/engine/runtime/systems/cinematic-director.service';
import { ISceneAccess, SCENE_ACCESS_TOKEN } from '../core/engine/scene/scene-access.token';
import { EditorCinematicProxyService } from './editor-cinematic-proxy.service';
import { EditorMapaService } from './editor-mapa.service';
import { EditorCameraService } from './editor/editor-camera.service';
 
@Injectable({ providedIn: 'root' })
export class EditorCinematicToolsService {
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private cameraSvc = inject(EditorCameraService);
  private cinematicDirector = inject(CinematicDirectorService);
  private proxySvc = inject(EditorCinematicProxyService);
  private mapaSvc = inject(EditorMapaService);

  public isInsideCamera = false;

  public enfocarCamara(clip: CinematicClip | null): void {
    if (clip && clip.startPosition) {
      const pos = new Vector3(clip.startPosition.x, clip.startPosition.y, clip.startPosition.z);
      this.cameraSvc.enfocarCoordenadas(pos, 4);
    }
  }

  public entrarCamara(clip: CinematicClip | null): void {
    if (clip && clip.startPosition && clip.startRotation) {
      this.isInsideCamera = true;
      this.cinematicDirector.editorWantsCamera = true;
      
      const pos = new Vector3(clip.startPosition.x, clip.startPosition.y, clip.startPosition.z);
      const rot = new Vector3(clip.startRotation.x * Math.PI/180, clip.startRotation.y * Math.PI/180, clip.startRotation.z * Math.PI/180);
      
      this.cameraSvc.transicionACamaraCinematica(pos, rot, clip.startFov, () => {
          this.cameraSvc.entrarCamaraFija(pos, rot, clip.startFov);
      });
    }
  }

  public salirCamara(): void {
    this.isInsideCamera = false;
    this.cinematicDirector.editorWantsCamera = false;
    
    const editorCam = this.motor3dSvc.getEditorCamera();
    this.cameraSvc.transicionDesdeCamaraCinematica(editorCam, () => {
        this.cameraSvc.salirCamaraFija();
    });
  }

  public capturarPosRot(track: CinematicTrack | null, clip: CinematicClip | null, isStart: boolean): void {
    if (!clip || !track) return;
    
    let pos = {x:0, y:0, z:0};
    let rot = {x:0, y:0, z:0};

    if (track.type === 'camera') {
        const cam = this.motor3dSvc.getEditorCamera();
        if (cam) {
           let globalPos = cam.globalPosition;
           
           if (clip.useLocalSpaceUid) {
               const baseEntity = this.entityManager.getEntityByUid(clip.useLocalSpaceUid);
               if (baseEntity && baseEntity.view) {
                   const inv = Matrix.Invert(baseEntity.view.getWorldMatrix());
                   const localPos = Vector3.TransformCoordinates(globalPos, inv);
                   pos = {x: localPos.x, y: localPos.y, z: localPos.z};
               }
           } else {
               pos = {x: globalPos.x, y: globalPos.y, z: globalPos.z};
           }

           const dir = cam.getDirection(Vector3.Forward());
           const yaw = Math.atan2(dir.x, dir.z);
           const pitch = Math.atan2(-dir.y, Math.sqrt(dir.x*dir.x + dir.z*dir.z));
           rot = {x: pitch * 180 / Math.PI, y: yaw * 180 / Math.PI, z: 0};
        }
    } else if (track.type === 'actor') {
        const entity = this.entityManager.getEntityByUid(track.targetUid || '');
        if (entity && entity.view) {
           pos = {x: entity.transform.position.x, y: entity.transform.position.y, z: entity.transform.position.z};
           
           if (entity.transform.rotationQuaternion) {
               const q = new Quaternion(
                   entity.transform.rotationQuaternion.x, 
                   entity.transform.rotationQuaternion.y, 
                   entity.transform.rotationQuaternion.z, 
                   entity.transform.rotationQuaternion.w
               );
               const euler = q.toEulerAngles();
               rot = { x: euler.x * 180 / Math.PI, y: euler.y * 180 / Math.PI, z: euler.z * 180 / Math.PI };
           } else {
               rot = {
                   x: entity.transform.rotation.x * 180 / Math.PI, 
                   y: entity.transform.rotation.y * 180 / Math.PI, 
                   z: entity.transform.rotation.z * 180 / Math.PI
               };
           }
        }
    }

    if (isStart) {
        clip.startPosition = pos;
        clip.startRotation = rot;
    } else {
        clip.endPosition = pos;
        clip.endRotation = rot;
    }
    
    this.mapaSvc.onMapChanged.next();
  }
}