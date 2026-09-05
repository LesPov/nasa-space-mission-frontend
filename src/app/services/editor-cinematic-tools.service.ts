
import { Injectable, inject } from '@angular/core';
import { Vector3, Matrix, Quaternion } from '@babylonjs/core';
import { EntityManagerService } from '../core/engine/entities/entity-manager.service';
import { CinematicKeyframe, CinematicTrack } from '../core/engine/models/cinematic.model';
import { CinematicDirectorService } from '../core/engine/runtime/systems/cinematic-director.service';
import { ISceneAccess, SCENE_ACCESS_TOKEN } from '../core/engine/scene/scene-access.token';
import { EditorCinematicProxyService } from './editor-cinematic-proxy.service';
import { EditorMapaService } from './editor-mapa.service';
import { EditorCameraService } from './editor/editor-camera.service';
import { CinematicCameraRegistryService } from '../core/engine/runtime/cameras/cinematic-camera-registry.service';
import { CinematicCameraDefinition } from '../core/engine/models/cinematic-camera.model';

@Injectable({ providedIn: 'root' })
export class EditorCinematicToolsService {
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private cameraSvc = inject(EditorCameraService);
  private cinematicDirector = inject(CinematicDirectorService);
  private proxySvc = inject(EditorCinematicProxyService);
  private mapaSvc = inject(EditorMapaService);
  private cameraRegistry = inject(CinematicCameraRegistryService);

  public isInsideCamera = false;
  public activeCinematicCameraId: string | null = null;

  public setActiveCinematicCamera(id: string | null): void {
    this.activeCinematicCameraId = id;
  }

  public getActiveCinematicCamera(): CinematicCameraDefinition | null {
    if (!this.activeCinematicCameraId) return null;
    return this.cameraRegistry.getCamera(this.activeCinematicCameraId) || null;
  }

  public enfocarCamara(kf: CinematicKeyframe | null): void {
    if (kf && kf.value && kf.value.position) {
      const pos = new Vector3(kf.value.position.x, kf.value.position.y, kf.value.position.z);
      this.cameraSvc.enfocarCoordenadas(pos, 4);
    }
  }

  public entrarCamara(kf: CinematicKeyframe | null): void {
    if (kf && kf.value && kf.value.position && kf.value.rotation) {
      this.isInsideCamera = true;
      this.cinematicDirector.editorWantsCamera = true;
      
      this.proxySvc.setProxiesVisibility(false);
      
      const pos = new Vector3(kf.value.position.x, kf.value.position.y, kf.value.position.z);
      const rot = new Vector3(kf.value.rotation.x * Math.PI/180, kf.value.rotation.y * Math.PI/180, kf.value.rotation.z * Math.PI/180);
      const fov = kf.value.fov !== undefined ? kf.value.fov : 0.8;
      
      this.cameraSvc.transicionACamaraCinematica(pos, rot, fov, () => {
          this.cameraSvc.entrarCamaraFija(pos, rot, fov);
      });
    }
  }

  public salirCamara(): void {
    this.isInsideCamera = false;
    this.activeCinematicCameraId = null;
    this.cinematicDirector.editorWantsCamera = false;
    
    this.proxySvc.setProxiesVisibility(true);

    const editorCam = this.motor3dSvc.getEditorCamera();
    this.cameraSvc.transicionDesdeCamaraCinematica(editorCam, () => {
        this.cameraSvc.salirCamaraFija();
    });
  }

  public entrarCamaraCinematica(camDefId: string): void {
    const camDef = this.cameraRegistry.getCamera(camDefId);
    if (!camDef) return;

    this.isInsideCamera = true;
    this.cinematicDirector.editorWantsCamera = true;
    this.activeCinematicCameraId = camDef.id;
    
    this.proxySvc.setProxiesVisibility(false);

    const pos = new Vector3(camDef.position.x, camDef.position.y, camDef.position.z);
    const rot = new Vector3(camDef.rotation.x * Math.PI/180, camDef.rotation.y * Math.PI/180, camDef.rotation.z * Math.PI/180);
    const fov = camDef.fov !== undefined ? camDef.fov : 0.8;
    
    this.cameraSvc.transicionACamaraCinematica(pos, rot, fov, () => {
        this.cameraSvc.entrarCamaraFija(pos, rot, fov);
    });
  }

  public salirCamaraCinematica(): void {
    this.salirCamara(); 
  }

  public capturarPosRotCamaraCinematica(camDefId: string): void {
    const camDef = this.cameraRegistry.getCamera(camDefId);
    if (!camDef) return;
    
    const cam = this.motor3dSvc.getEditorCamera();
    if (cam) {
       const globalPos = cam.globalPosition;
       const dir = cam.getDirection(Vector3.Forward());
       const yaw = Math.atan2(dir.x, dir.z);
       const pitch = Math.atan2(-dir.y, Math.sqrt(dir.x*dir.x + dir.z*dir.z));
       
       camDef.position = { x: globalPos.x, y: globalPos.y, z: globalPos.z };
       camDef.rotation = { x: pitch * 180 / Math.PI, y: yaw * 180 / Math.PI, z: 0 };
       camDef.fov = cam.fov;
       
       this.cameraRegistry.registerCamera(camDef);
       this.mapaSvc.onMapChanged.next();
    }
  }

  public capturarPosRot(track: CinematicTrack | null, kf: CinematicKeyframe | null): void {
    if (!kf || !track) return;
    
    let pos = {x:0, y:0, z:0};
    let rot = {x:0, y:0, z:0};
    let fov: number | undefined = undefined;

    if (track.type === 'camera') {
        const cam = this.motor3dSvc.getEditorCamera();
        if (cam) {
           let globalPos = cam.globalPosition;
           
           if (kf.value?.useLocalSpaceUid) {
               const baseEntity = this.entityManager.getEntityByUid(kf.value.useLocalSpaceUid);
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
           
           // 🔥 FIX CRÍTICO FOV: Capturamos el FOV de la cámara del editor en el keyframe.
           fov = cam.fov;
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

    if (!kf.value) kf.value = {};
    kf.value.position = pos;
    kf.value.rotation = rot;
    if (fov !== undefined) kf.value.fov = fov;
    
    this.mapaSvc.onMapChanged.next();
  }
}