
import { Injectable, inject } from '@angular/core';
import { DirectionalLight, Vector3, CascadedShadowGenerator, ShadowGenerator, AbstractMesh, Mesh, InstancedMesh, Tags } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { GameContextService } from '../../session/game-context.service';
import { GameEntity } from '../../entities/game.entity';
import { InteractableRulesService } from '../rules/interactable-rules.service';

@Injectable({ providedIn: 'root' })
export class ShadowOrchestratorService implements IUpdatable {
  public id = 'ShadowOrchestratorSystem';
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private ownership = inject(CameraOwnershipService);
  private worldSettings = inject(WorldSettingsService);
  private context = inject(GameContextService); 
  private interactRules = inject(InteractableRulesService); 

  private mainSun: DirectionalLight | null = null;
  private shadowGenerator: CascadedShadowGenerator | null = null;
  
  private static _fallbackPos = Vector3.Zero();
  private _tempOffset = Vector3.Zero();

  public profilerDisableShadows = false;

  public getProfilerMetrics() {
    let casters = 0;
    if (this.shadowGenerator && this.shadowGenerator.getShadowMap() && this.shadowGenerator.getShadowMap()?.renderList) {
        casters = this.shadowGenerator.getShadowMap()!.renderList!.length;
    }
    return {
        activeGenerators: this.shadowGenerator ? 1 : 0,
        totalCasters: casters,
        csmMaxZ: this.shadowGenerator?.shadowMaxZ || 0,
        csmCascades: this.shadowGenerator?.numCascades || 0
    };
  }

  // 🔥 NUEVO: Operación atómica de reconciliación para evitar acumulación tras Reload/Exit Live.
  public reconcileShadows(): void {
      this.stop();
      this.start();
  }

  private getReferencePosition(): Vector3 {
      const playerEntity = this.context.activePlayerEntity();
      if (playerEntity && playerEntity.view) {
          return playerEntity.view.getAbsolutePosition();
      }
      const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
      if (camera) return camera.globalPosition;
      return ShadowOrchestratorService._fallbackPos;
  }

  private isEligibleShadowCaster(e: GameEntity): boolean {
      if (!e.view) return false;
      const isManuallyHidden = !e.isCulled && (!e.view.isVisible || !e.view.isEnabled());
      if (isManuallyHidden) return false;

      if (e.type === 'image_plane' || e.type === 'bubble' || e.type === 'trigger' || e.type === 'trigger_compuesto') return false;
      if (e.type.startsWith('light_') && !e.visual?.assetId && !e.visual?.path) return false;
      if (e.characterConfig || e.rol === 'player' || e.rol === 'npc') return true;

      const renderableTypes = ['model', 'cube', 'sphere', 'cylinder', 'plane'];
      if (renderableTypes.includes(e.type) || !!e.visual?.assetId || !!e.visual?.path) {
          const isInteractable = this.interactRules.isInteractable(e);
          if (isInteractable) return true; 

          const radius = e.view.getBoundingInfo().boundingSphere.radiusWorld;
          const diag = radius * 2;
          
          if (diag < 0.6) return false;

          return true;
      }

      return false;
  }

  public start(): void {
      this.asignarObjetosASombrasDeLuces();
  }

  public stop(): void {
      if (this.mainSun) {
          this.mainSun.dispose();
          this.mainSun = null;
      }
      if (this.shadowGenerator) {
          this.shadowGenerator.dispose();
          this.shadowGenerator = null;
      }
  }

  public update(dtMs: number): void {
     const scene = this.motor3d.getScene();
     if (!scene || !this.mainSun) return;

     const refPos = this.getReferencePosition();
     if (Vector3.DistanceSquared(this.mainSun.position, refPos) > 25) {
         this.mainSun.position.copyFrom(refPos);
         this.mainSun.direction.scaleToRef(100, this._tempOffset);
         this.mainSun.position.subtractInPlace(this._tempOffset);
     }
  }

  private updateRenderListIfChanged(currentList: AbstractMesh[], newList: AbstractMesh[]): void {
      if (currentList.length === newList.length) {
          let isSame = true;
          for (let i = 0; i < newList.length; i++) {
              if (currentList[i] !== newList[i]) {
                  isSame = false;
                  break;
              }
          }
          if (isSame) return;
      }
      currentList.length = 0;
      for (let i = 0; i < newList.length; i++) {
          currentList.push(newList[i]);
      }
  }

  public asignarObjetosASombrasDeLuces(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    if (!this.mainSun || this.mainSun.isDisposed()) {
       const w = this.worldSettings.settings();
       this.mainSun = new DirectionalLight('sunLight', new Vector3(w.ambientDirX, w.ambientDirY, w.ambientDirZ).normalize(), scene);
       this.mainSun.intensity = 0.8;
       this.mainSun.position = new Vector3(0, 100, 0);
    } else {
       const w = this.worldSettings.settings();
       this.mainSun.direction.copyFromFloats(w.ambientDirX, w.ambientDirY, w.ambientDirZ).normalize();
    }

    if (!this.shadowGenerator) {
       const isEditor = this.context.mode() === 'EDITOR';
       const shadowRes = isEditor ? 1024 : 2048; 

       this.shadowGenerator = new CascadedShadowGenerator(shadowRes, this.mainSun);
       this.shadowGenerator.numCascades = 2;
       this.shadowGenerator.shadowMaxZ = 35; 
       
       this.shadowGenerator.cascadeBlendPercentage = 0.1; 
       this.shadowGenerator.lambda = 0.65; 
       this.shadowGenerator.usePercentageCloserFiltering = true;
       this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
       this.shadowGenerator.bias = 0.0012;
       this.shadowGenerator.normalBias = 0.012;
       this.shadowGenerator.setDarkness(0.35);
       this.shadowGenerator.autoCalcDepthBounds = false; 
       this.shadowGenerator.stabilizeCascades = true; 
    }

    const renderList = this.shadowGenerator.getShadowMap()?.renderList;
    if (renderList) {
        if (this.profilerDisableShadows) {
            renderList.length = 0;
            return;
        }

        const newRenderList: AbstractMesh[] = [];
        const entities = this.entityManager.getAllEntities();

        for (let i = 0; i < entities.length; i++) {
           const e = entities[i];
           if (this.isEligibleShadowCaster(e) && e.view) {
               const processMeshForShadows = (m: AbstractMesh) => {
                   if (m.isDisposed()) return; // 🔥 FIX: Prevención contra fugas
                   const isManuallyHidden = !e.isCulled && (!m.isVisible || !m.isEnabled());
                   if (!isManuallyHidden && !Tags.MatchesQuery(m, "editor_only || fog_element || debug_element || light_visual || proxy_collider || ignore_raycast")) {
                       let isValidCaster = false;
                       if (m.getClassName() === "InstancedMesh") {
                           const source = (m as InstancedMesh).sourceMesh;
                           if (source && source.getTotalVertices() > 0) {
                               isValidCaster = true;
                               if (!source.receiveShadows) source.receiveShadows = true;
                           }
                       } else if (m.getClassName() === "Mesh") {
                           if ((m as Mesh).getTotalVertices() > 0) {
                               isValidCaster = true;
                               m.receiveShadows = true;
                           }
                       }
                       if (isValidCaster) {
                           newRenderList.push(m);
                       }
                   }
               };

               processMeshForShadows(e.view);
               e.view.getChildMeshes(false).forEach(processMeshForShadows);
           } else if (e.view) {
               if (e.view.isDisposed()) continue; // 🔥 FIX: Prevención contra fugas
               if (!Tags.MatchesQuery(e.view, "light_visual || debug_element || proxy_collider")) {
                   if (e.view.getClassName() === "Mesh") e.view.receiveShadows = true;
                   e.view.getChildMeshes(false).forEach(cm => {
                       if (cm.isDisposed()) return;
                       if (!Tags.MatchesQuery(cm, "light_visual || debug_element || proxy_collider")) {
                           if (cm.getClassName() === "InstancedMesh" && (cm as InstancedMesh).sourceMesh) {
                               (cm as InstancedMesh).sourceMesh.receiveShadows = true;
                           } else if (cm.getClassName() === "Mesh") {
                               cm.receiveShadows = true;
                           }
                       }
                   });
               }
           }
        }
        
        this.updateRenderListIfChanged(renderList, newRenderList);
    }
  }
}