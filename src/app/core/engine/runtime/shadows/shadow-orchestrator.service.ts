// file: src/app/core/engine/runtime/shadows/shadow-orchestrator.service.ts
import { Injectable, inject } from '@angular/core';
import { DirectionalLight, Vector3, CascadedShadowGenerator, Scene, AbstractMesh, Mesh, InstancedMesh, Tags, RenderTargetTexture, Matrix } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { GameContextService } from '../../session/game-context.service';
import { GameEntity } from '../../entities/game.entity';
import { InteractableRulesService } from '../rules/interactable-rules.service';
import { ShadowQualityService } from './shadow-quality.service';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { GameMode } from '../../session/game-mode.model';

@Injectable({ providedIn: 'root' })
export class ShadowOrchestratorService implements IUpdatable {
  public id = 'ShadowOrchestratorSystem';
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private ownership = inject(CameraOwnershipService);
  private worldSettings = inject(WorldSettingsService);
  private context = inject(GameContextService);
  private interactRules = inject(InteractableRulesService);
  private shadowQualitySvc = inject(ShadowQualityService);
  private eventBus = inject(GameEventBusService);

  private mainSun: DirectionalLight | null = null;
  private shadowGenerator: CascadedShadowGenerator | null = null;
  private currentScene: Scene | null = null;

  private static _fallbackPos = Vector3.Zero();
  private _tempOffset = Vector3.Zero();
  private lastSunAnchorPos = new Vector3(-99999, -99999, -99999);
  private lastSunDir = Vector3.Zero();

  private lastCamMatrix = Matrix.Identity();
  private framesSinceLastCSMMove = 0;

  public profilerDisableShadows = false;
  private forceRebuild = false;
  private rebuildCooldownTimer = 0;

  constructor() {
    this.eventBus.events$.subscribe(e => {
      if (e.type === 'RuntimeVisibilityBatchChanged') {
        this.forceRebuild = true;
      }
    });
  }

  public getFastMetrics() {
    let casters = 0;
    if (this.shadowGenerator && this.isSunActive()) {
      const sm = this.shadowGenerator.getShadowMap();
      if (sm && sm.renderList) casters = sm.renderList.length;
    }
    return {
      activeGenerators: (this.shadowGenerator && this.isSunActive()) ? 1 : 0,
      totalCasters: casters,
      csmMaxZ: (this.shadowGenerator && this.isSunActive()) ? this.shadowGenerator.shadowMaxZ : 0,
      csmCascades: (this.shadowGenerator && this.isSunActive()) ? this.shadowGenerator.numCascades : 0
    };
  }

  private isSunActive(): boolean {
    const w = this.worldSettings.settings();
    return w.sunEnabled !== false && !this.profilerDisableShadows;
  }

  public reconcileShadows(): void {
    this.asignarObjetosASombrasDeLuces();
    this.invalidateShadowMap();
  }

  public invalidateShadowMap(): void {
    if (this.shadowGenerator) {
      const sm = this.shadowGenerator.getShadowMap();
      if (sm) {
        sm.resetRefreshCounter();
      }
    }
  }

  private getReferencePosition(): Vector3 {
    const mode = this.context.mode();
    const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;

    const playerEntity = this.context.activePlayerEntity();
    if (playerEntity && playerEntity.view && !playerEntity.view.isDisposed()) {
      return playerEntity.view.getAbsolutePosition();
    }

    if (isEditor) {
      const actors = this.entityManager.getAllEntities();
      const primaryActor = actors.find(e => e.rol === 'player' || e.rol === 'spawn_point' || e.hasComponent('characterConfig'));
      if (primaryActor && primaryActor.view && !primaryActor.view.isDisposed()) {
        return primaryActor.view.getAbsolutePosition();
      }
      return ShadowOrchestratorService._fallbackPos;
    }

    const camera = this.ownership.getCamera();
    if (camera) return camera.globalPosition;
    return ShadowOrchestratorService._fallbackPos;
  }

  private isEligibleShadowCaster(e: GameEntity): boolean {
    if (!e.view) return false;
    if (e.isManuallyHidden) return false;

    if (e.type === 'image_plane' || e.type === 'bubble' || e.type === 'trigger' || e.type === 'trigger_compuesto') return false;
    if (e.type.startsWith('light_') && !e.visual?.assetId && !e.visual?.path) return false;
    if (e.characterConfig || e.rol === 'player' || e.rol === 'npc') return true;

    const renderableTypes = ['model', 'cube', 'sphere', 'cylinder', 'plane'];
    if (renderableTypes.includes(e.type) || !!e.visual?.assetId || !!e.visual?.path) {
      if (this.interactRules.isInteractable(e)) return true;

      e.view.computeWorldMatrix(true);
      const bounds = e.view.getHierarchyBoundingVectors(true);
      const diag = Vector3.Distance(bounds.min, bounds.max);

      if (diag < 0.1) return false;
      return true;
    }
    return false;
  }

  public start(): void {
    this.asignarObjetosASombrasDeLuces();
  }

  public stop(): void {}

  public dispose(): void {
    if (this.mainSun) {
      this.mainSun.dispose();
      this.mainSun = null;
    }
    if (this.shadowGenerator) {
      this.shadowGenerator.dispose();
      this.shadowGenerator = null;
    }
    this.currentScene = null;
    this.lastSunAnchorPos.set(-99999, -99999, -99999);
  }

  public update(dtMs: number): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    if (!this.isSunActive()) {
      if (this.mainSun && this.mainSun.isEnabled()) {
        this.mainSun.setEnabled(false);
      }
      return;
    } else {
      if (this.mainSun && !this.mainSun.isEnabled()) {
        this.mainSun.setEnabled(true);
      }
    }

    if (!this.mainSun || !this.shadowGenerator) return;

    if (this.rebuildCooldownTimer > 0) {
      this.rebuildCooldownTimer -= dtMs;
    }

    if (this.forceRebuild && this.rebuildCooldownTimer <= 0) {
      this.asignarObjetosASombrasDeLuces();
      this.forceRebuild = false;
      this.rebuildCooldownTimer = 150; 
    }

    const refPos = this.getReferencePosition();
    const hasMovedSignificantly = Vector3.DistanceSquared(this.lastSunAnchorPos, refPos) > 16.0;

    if (hasMovedSignificantly) {
      this.mainSun.position.copyFrom(refPos);
      this.mainSun.direction.scaleToRef(100, this._tempOffset);
      this.mainSun.position.subtractInPlace(this._tempOffset);
      this.lastSunAnchorPos.copyFrom(refPos);
    }

    const shadowMap = this.shadowGenerator.getShadowMap();
    if (shadowMap) {
      let camMoved = false;
      const activeCam = scene.activeCamera;
      if (activeCam) {
        const currentMat = activeCam.getViewMatrix();
        if (!currentMat.equals(this.lastCamMatrix)) {
          camMoved = true;
          this.lastCamMatrix.copyFrom(currentMat);
        }
      }

      const isMoving = hasMovedSignificantly || camMoved || this.forceRebuild;

      if (isMoving) {
        this.framesSinceLastCSMMove = 0;
        shadowMap.refreshRate = 1;
      } else {
        this.framesSinceLastCSMMove++;
        if (this.framesSinceLastCSMMove === 2) {
          shadowMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
          shadowMap.resetRefreshCounter();
        }
      }
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
    this.invalidateShadowMap();
  }

  public asignarObjetosASombrasDeLuces(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    if (this.currentScene !== scene) {
      this.dispose();
      this.currentScene = scene;
    }

    const w = this.worldSettings.settings();
    const sunWanted = w.sunEnabled !== false && !this.profilerDisableShadows;

    if (!sunWanted) {
      if (this.mainSun) this.mainSun.setEnabled(false);
      if (this.shadowGenerator) {
        const sm = this.shadowGenerator.getShadowMap();
        if (sm?.renderList) sm.renderList.length = 0;
      }
      return;
    }

    const newDir = new Vector3(w.ambientDirX, w.ambientDirY, w.ambientDirZ).normalize();

    if (!this.mainSun || this.mainSun.isDisposed()) {
      this.mainSun = new DirectionalLight('sunLight', newDir, scene);
      this.mainSun.intensity = 0.8;
      this.mainSun.position = new Vector3(0, 100, 0);
      this.lastSunDir.copyFrom(newDir);
    } else {
      if (!this.mainSun.isEnabled()) this.mainSun.setEnabled(true);
      if (Vector3.DistanceSquared(this.lastSunDir, newDir) > 0.0001) {
        this.mainSun.direction.copyFrom(newDir);
        this.lastSunDir.copyFrom(newDir);
        this.invalidateShadowMap();
      }
    }

    if (!this.shadowGenerator) {
      const config = this.shadowQualitySvc.getDirectionalConfig();

      this.shadowGenerator = new CascadedShadowGenerator(config.resolution, this.mainSun);
      this.shadowGenerator.numCascades = Math.min(3, config.cascades ?? 3);
      this.shadowGenerator.shadowMaxZ = 45;

      this.shadowGenerator.cascadeBlendPercentage = 0.1;
      this.shadowGenerator.lambda = 0.65;
      this.shadowGenerator.usePercentageCloserFiltering = true;
      this.shadowGenerator.filteringQuality = config.filteringQuality;
      this.shadowGenerator.bias = 0.001;
      this.shadowGenerator.normalBias = 0.008;
      this.shadowGenerator.setDarkness(0.35);
      this.shadowGenerator.autoCalcDepthBounds = true;
      this.shadowGenerator.stabilizeCascades = true;
    }

    const renderList = this.shadowGenerator.getShadowMap()?.renderList;
    if (renderList) {
      const newRenderList: AbstractMesh[] = [];
      const entities = this.entityManager.getAllEntities();

      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (this.isEligibleShadowCaster(e) && e.view) {
          const processMeshForShadows = (m: AbstractMesh) => {
            if (m.isDisposed()) return;

            if (!e.isManuallyHidden && !Tags.MatchesQuery(m, 'editor_only || fog_element || debug_element || light_visual || proxy_collider || ignore_raycast')) {
              let isValidCaster = false;
              if (m.getClassName() === 'InstancedMesh') {
                const source = (m as InstancedMesh).sourceMesh;
                if (source && source.getTotalVertices() > 0) {
                  isValidCaster = true;
                  if (!source.receiveShadows) source.receiveShadows = true;
                }
              } else if (m.getClassName() === 'Mesh') {
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
          if (e.view.isDisposed()) continue;
          if (!Tags.MatchesQuery(e.view, 'light_visual || debug_element || proxy_collider')) {
            if (e.view.getClassName() === 'Mesh') e.view.receiveShadows = true;
            e.view.getChildMeshes(false).forEach(cm => {
              if (cm.isDisposed()) return;
              if (!Tags.MatchesQuery(cm, 'light_visual || debug_element || proxy_collider')) {
                if (cm.getClassName() === 'InstancedMesh' && (cm as InstancedMesh).sourceMesh) {
                  (cm as InstancedMesh).sourceMesh.receiveShadows = true;
                } else if (cm.getClassName() === 'Mesh') {
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