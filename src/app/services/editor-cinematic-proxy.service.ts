
import { Injectable, inject } from '@angular/core';
import { Mesh, MeshBuilder, StandardMaterial, Color3, Tags, Vector3, Scene, Quaternion } from '@babylonjs/core';
import { ISceneAccess, SCENE_ACCESS_TOKEN } from '../core/engine/scene/scene-access.token';
import { CinematicSequence } from '../core/engine/models/cinematic.model';
import { CinematicCameraRegistryService } from '../core/engine/runtime/cameras/cinematic-camera-registry.service';
import { EntityManagerService } from '../core/engine/entities/entity-manager.service';
 
@Injectable({ providedIn: 'root' })
export class EditorCinematicProxyService {
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private cameraRegistry = inject(CinematicCameraRegistryService);
  private entityManager = inject(EntityManagerService);
  
  private cameraProxies: Mesh[] = [];
  private reusableCameraProxies: Mesh[] = [];
  
  // 🔥 Optimización 0-allocations para LookAt proxy
  private static _tempTargetCenter = Vector3.Zero();

  private getLookQuat(pos: Vector3, target: Vector3, fallbackForward: Vector3): Quaternion {
    let dir = target.subtract(pos);
    if (dir.lengthSquared() < 0.001) dir = fallbackForward.clone();
    dir.normalize();
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = Math.atan2(-dir.y, Math.sqrt(dir.x * dir.x + dir.z * dir.z));
    return Quaternion.RotationYawPitchRoll(yaw, pitch, 0);
  }

  public rebuild(sequence: CinematicSequence | null): void {
    this.clear();
    const scene = this.motor3dSvc.getScene();
    if (!scene) return;

    if (sequence) {
      sequence.tracks.forEach(track => {
        if (track.type === 'camera') {
          track.keyframes.forEach(kf => {
             let rot = kf.value.rotation;
             const targetUid = kf.value.targetUid || kf.value.cameraTargetUid || track.targetUid;
             
             if (targetUid && (kf.value.orientationMode === 'lookAt' || kf.value.movementMode === 'orbit')) {
                 const targetEnt = this.entityManager.getEntityByUid(targetUid);
                 if (targetEnt && targetEnt.view) {
                     // 🔥 FASE A: Apuntar el proxy de cámara al Visual Center (Pecho), no a los pies
                     targetEnt.getVisualCenterAbsoluteToRef(EditorCinematicProxyService._tempTargetCenter);
                     const targetPos = EditorCinematicProxyService._tempTargetCenter;
                     const pos = new Vector3(kf.value.position.x, kf.value.position.y, kf.value.position.z);
                     const quat = this.getLookQuat(pos, targetPos, Vector3.Forward());
                     const euler = quat.toEulerAngles();
                     rot = { x: euler.x * 180 / Math.PI, y: euler.y * 180 / Math.PI, z: 0 };
                 }
             }

             this.cameraProxies.push(this.createCameraProxyMesh(scene, `proxy_cam_${kf.id}`, kf.value.position, rot, new Color3(0, 0.5, 1)));
          });
        }
      });
    }

    const reusableCameras = this.cameraRegistry.listCameras();
    reusableCameras.forEach(camDef => {
       let rot = camDef.rotation;
       if (camDef.cameraTargetUid) {
           const targetEnt = this.entityManager.getEntityByUid(camDef.cameraTargetUid);
           if (targetEnt && targetEnt.view) {
               targetEnt.getVisualCenterAbsoluteToRef(EditorCinematicProxyService._tempTargetCenter);
               const targetPos = EditorCinematicProxyService._tempTargetCenter;
               const pos = new Vector3(camDef.position.x, camDef.position.y, camDef.position.z);
               const quat = this.getLookQuat(pos, targetPos, Vector3.Forward());
               const euler = quat.toEulerAngles();
               rot = { x: euler.x * 180 / Math.PI, y: euler.y * 180 / Math.PI, z: 0 };
           }
       }
       this.reusableCameraProxies.push(this.createCameraProxyMesh(scene, `proxy_reusable_cam_${camDef.id}`, camDef.position, rot, new Color3(0.5, 0, 1)));
    });
  }

  private createCameraProxyMesh(scene: Scene, name: string, posDef: any, rotDef: any, color: Color3): Mesh {
    const node = MeshBuilder.CreateBox(name, { width: 0.4, height: 0.3, depth: 0.5 }, scene);
    const lens = MeshBuilder.CreateCylinder('lens', { height: 0.3, diameterTop: 0.3, diameterBottom: 0.15 }, scene);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.4;
    lens.parent = node;
    
    const pivot = MeshBuilder.CreatePolyhedron('pivot', { type: 1, size: 0.12 }, scene);
    pivot.rotation.x = Math.PI / 4;
    pivot.parent = node;
    
    const mat = new StandardMaterial(`mat_${name}`, scene);
    mat.diffuseColor = color;
    mat.emissiveColor = color.scale(0.5);
    node.material = mat; 
    lens.material = mat;

    const pivotMat = new StandardMaterial(`mat_pivot_${name}`, scene);
    pivotMat.diffuseColor = new Color3(1, 0.8, 0); 
    pivotMat.emissiveColor = new Color3(1, 0.8, 0);
    pivotMat.wireframe = true;
    pivotMat.disableLighting = true;
    pivot.material = pivotMat;

    node.isPickable = true;
    lens.isPickable = true;
    pivot.isPickable = false; 
    
    Tags.AddTagsTo(node, "editor_only cinematic_proxy");
    Tags.AddTagsTo(lens, "editor_only cinematic_proxy");
    Tags.AddTagsTo(pivot, "editor_only cinematic_proxy_pivot ignore_raycast");
    
    node.position.set(posDef?.x || 0, posDef?.y || 0, posDef?.z || 0);
    
    const rx = (rotDef?.x || 0) * Math.PI / 180;
    const ry = (rotDef?.y || 0) * Math.PI / 180;
    const rz = (rotDef?.z || 0) * Math.PI / 180;
    node.rotation.set(rx, ry, rz);

    return node;
  }

  public setProxiesVisibility(visible: boolean): void {
      this.cameraProxies.forEach(p => { if (p && !p.isDisposed()) p.setEnabled(visible); });
      this.reusableCameraProxies.forEach(p => { if (p && !p.isDisposed()) p.setEnabled(visible); });
  }

  public clear(): void {
    this.cameraProxies.forEach(p => { if (!p.isDisposed()) p.dispose(); });
    this.cameraProxies = [];
    
    this.reusableCameraProxies.forEach(p => { if (!p.isDisposed()) p.dispose(); });
    this.reusableCameraProxies = [];
  }

  public getProxyById(id: string): any | null {
    const scene = this.motor3dSvc.getScene();
    if (!scene) return null;
    return scene.getMeshByName(`proxy_cam_${id}`) || scene.getMeshByName(`proxy_reusable_cam_${id}`) || null;
  }

  public renderScene(): void {
    this.motor3dSvc.getScene()?.render();
  }
}