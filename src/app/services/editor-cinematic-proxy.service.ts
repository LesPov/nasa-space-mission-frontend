
import { Injectable, inject } from '@angular/core';
import { Mesh, MeshBuilder, StandardMaterial, Color3, Tags, Vector3 } from '@babylonjs/core';
import { ISceneAccess, SCENE_ACCESS_TOKEN } from '../core/engine/scene/scene-access.token';
import { CinematicSequence } from '../core/engine/models/cinematic.model';
 
@Injectable({ providedIn: 'root' })
export class EditorCinematicProxyService {
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private cameraProxies: Mesh[] = [];

  public rebuild(sequence: CinematicSequence | null): void {
    this.clear();
    if (!sequence) return;
    const scene = this.motor3dSvc.getScene();
    if (!scene) return;

    sequence.tracks.forEach(track => {
      if (track.type === 'camera') {
        track.clips.forEach(clip => {
          const node = MeshBuilder.CreateBox(`proxy_cam_${clip.id}`, { width: 0.4, height: 0.3, depth: 0.5 }, scene);
          const lens = MeshBuilder.CreateCylinder('lens', { height: 0.3, diameterTop: 0.3, diameterBottom: 0.15 }, scene);
          lens.rotation.x = Math.PI / 2;
          lens.position.z = 0.4;
          lens.parent = node;
          
          const mat = new StandardMaterial('mat_proxy_cam', scene);
          mat.diffuseColor = new Color3(0, 0.5, 1);
          mat.emissiveColor = new Color3(0, 0.2, 0.5);
          node.material = mat; 
          lens.material = mat;

          node.isPickable = true;
          lens.isPickable = true;
          
          Tags.AddTagsTo(node, "editor_only cinematic_proxy");
          Tags.AddTagsTo(lens, "editor_only cinematic_proxy");
          
          node.position.set(clip.startPosition?.x || 0, clip.startPosition?.y || 0, clip.startPosition?.z || 0);
          
          const rx = (clip.startRotation?.x || 0) * Math.PI / 180;
          const ry = (clip.startRotation?.y || 0) * Math.PI / 180;
          const rz = (clip.startRotation?.z || 0) * Math.PI / 180;
          node.rotation.set(rx, ry, rz);

          this.cameraProxies.push(node);
        });
      }
    });
  }

  public clear(): void {
    this.cameraProxies.forEach(p => {
      if (!p.isDisposed()) p.dispose();
    });
    this.cameraProxies = [];
  }

  public getProxyById(clipId: string): any | null {
    const scene = this.motor3dSvc.getScene();
    if (!scene) return null;
    return scene.getMeshByName(`proxy_cam_${clipId}`) || null;
  }

  public renderScene(): void {
    this.motor3dSvc.getScene()?.render();
  }
}