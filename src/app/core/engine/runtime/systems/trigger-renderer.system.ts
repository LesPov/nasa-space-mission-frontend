
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { Vector3, MeshBuilder, LinesMesh, Color4, AbstractMesh } from '@babylonjs/core';
import { GameContextService } from '../../session/game-context.service';
import { GameEntity } from '../../entities/game.entity';
import { EditorMapaService } from '../../../../services/editor-mapa.service';

@Injectable({ providedIn: 'root' })
export class TriggerRendererSystem implements IUpdatable {
  public id = 'TriggerRendererSystem';
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private context = inject(GameContextService);
  private mapaSvc = inject(EditorMapaService);

  private debugLinesMesh: LinesMesh | null = null;
  private lastTriggerCount = -1;
  private forceRebuild = true;

  constructor() {
    this.mapaSvc.onGizmoDrag.subscribe(() => { this.forceRebuild = true; });
    this.mapaSvc.onMapChanged.subscribe(() => { this.forceRebuild = true; });
  }

  public postUpdate(dtMs: number): void {
    const isDebugMode = this.context.isDebugMode();
    
    if (!isDebugMode) {
      if (this.debugLinesMesh && this.debugLinesMesh.isVisible) {
         this.debugLinesMesh.isVisible = false;
      }
      return;
    }

    const triggers = this.entityManager.getAllEntities().filter(e => e.type === 'trigger' || e.type === 'trigger_compuesto');

    let shouldRebuild = this.forceRebuild || triggers.length !== this.lastTriggerCount;

    if (!shouldRebuild) {
      for (let i = 0; i < triggers.length; i++) {
        if (triggers[i].isDirty) {
          shouldRebuild = true;
          break;
        }
      }
    }

    if (shouldRebuild) {
      this.rebuild(triggers);
      this.forceRebuild = false;
      this.lastTriggerCount = triggers.length;
    }

    if (this.debugLinesMesh && !this.debugLinesMesh.isVisible) {
       this.debugLinesMesh.isVisible = true;
    }
  }

  private rebuild(triggers: GameEntity[]) {
    if (this.debugLinesMesh) {
      this.debugLinesMesh.dispose();
      this.debugLinesMesh = null;
    }

    if (triggers.length === 0) return;

    const globalLines: Vector3[][] = [];
    const globalColors: Color4[][] = [];

    for (const entity of triggers) {
      const isComp = entity.type === 'trigger_compuesto';
      const actionT = entity.trigger?.actionType || 'show_message';
      
      let r = 0, g = 1, b = 0; 
      if (!isComp) {
        if (actionT === 'change_scene') { r = 1; g = 0; b = 0; } 
        else { r = 1; g = 0; b = 1; } 
      } else {
        r = 0; g = 0.5; b = 1; 
      }
      const c4 = new Color4(r, g, b, 1.0);

      const meshes: AbstractMesh[] = [];
      if (entity.view) {
         if (isComp) {
             entity.view.getChildMeshes(false).forEach((m: AbstractMesh) => meshes.push(m));
             if (entity.view.getTotalVertices() > 0) meshes.push(entity.view as AbstractMesh);
         } else {
             meshes.push(entity.view as AbstractMesh);
         }
      }

      const entityEdges: [Vector3, Vector3][] = [];

      for (const mesh of meshes) {
        mesh.computeWorldMatrix(true);
        const boundingInfo = mesh.getBoundingInfo();
        const min = boundingInfo.boundingBox.minimum;
        const max = boundingInfo.boundingBox.maximum;
        const mat = mesh.getWorldMatrix();

        const cornersLocal = [
          new Vector3(min.x, min.y, min.z),
          new Vector3(max.x, min.y, min.z),
          new Vector3(max.x, max.y, min.z),
          new Vector3(min.x, max.y, min.z),
          new Vector3(min.x, min.y, max.z),
          new Vector3(max.x, min.y, max.z),
          new Vector3(max.x, max.y, max.z),
          new Vector3(min.x, max.y, max.z)
        ];

        const cw = cornersLocal.map(c => Vector3.TransformCoordinates(c, mat));

        const edges = [
          [cw[0], cw[1]], [cw[1], cw[2]], [cw[2], cw[3]], [cw[3], cw[0]],
          [cw[4], cw[5]], [cw[5], cw[6]], [cw[6], cw[7]], [cw[7], cw[4]],
          [cw[0], cw[4]], [cw[1], cw[5]], [cw[2], cw[6]], [cw[3], cw[7]]
        ];

        edges.forEach(e => entityEdges.push([e[0], e[1]]));
      }

      const EPSILON = 0.01;
      const filteredEdges: [Vector3, Vector3][] = [];

      for (let i = 0; i < entityEdges.length; i++) {
         const edge = entityEdges[i];
         const midPoint = Vector3.Center(edge[0], edge[1]);

         let isInternal = false;
         if (isComp) {
             for (const mesh of meshes) {
                 const invMat = mesh.getWorldMatrix().clone().invert();
                 const localMid = Vector3.TransformCoordinates(midPoint, invMat);
                 const min = mesh.getBoundingInfo().boundingBox.minimum;
                 const max = mesh.getBoundingInfo().boundingBox.maximum;

                 if (localMid.x > min.x + EPSILON && localMid.x < max.x - EPSILON &&
                     localMid.y > min.y + EPSILON && localMid.y < max.y - EPSILON &&
                     localMid.z > min.z + EPSILON && localMid.z < max.z - EPSILON) {
                     isInternal = true;
                     break;
                 }
             }
         }

         if (isInternal) continue;

         let isDuplicate = false;
         for (let j = 0; j < filteredEdges.length; j++) {
             const fEdge = filteredEdges[j];
             const d1 = Vector3.DistanceSquared(edge[0], fEdge[0]) + Vector3.DistanceSquared(edge[1], fEdge[1]);
             const d2 = Vector3.DistanceSquared(edge[0], fEdge[1]) + Vector3.DistanceSquared(edge[1], fEdge[0]);
             if (d1 < 0.001 || d2 < 0.001) {
                 isDuplicate = true;
                 break;
             }
         }

         if (!isDuplicate) {
             filteredEdges.push(edge);
             globalLines.push([edge[0], edge[1]]);
             globalColors.push([c4, c4]);
         }
      }
    }

    if (globalLines.length > 0) {
        const scene = this.motor3d.getScene();
        this.debugLinesMesh = MeshBuilder.CreateLineSystem("global_trigger_debug", {
            lines: globalLines,
            colors: globalColors,
            updatable: false
        }, scene);
        this.debugLinesMesh.isPickable = false;
        this.debugLinesMesh.alwaysSelectAsActiveMesh = true; 
    }
  }
}