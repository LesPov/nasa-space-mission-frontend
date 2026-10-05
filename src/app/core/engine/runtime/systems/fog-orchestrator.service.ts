// file: src/app/core/engine/runtime/systems/fog-orchestrator.service.ts
import { Injectable, inject } from '@angular/core';
import { Scene, Color3, AbstractMesh } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { WorldSettingsService } from '../../world/world-settings.service';
import { FogRendererService } from './fog-renderer.service';
import { FogLevel } from '../../models/player-config.model';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { GameContextService } from '../../session/game-context.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameMode } from '../../session/game-mode.model';
import { ProfilerTogglesService } from '../../telemetry/profiler-toggles.service';
import { GameEntity } from '../../entities/game.entity';

@Injectable({ providedIn: 'root' })
export class FogOrchestratorService implements IUpdatable {
  public id = 'FogOrchestratorSystem';
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private worldSettingsSvc = inject(WorldSettingsService);
  private fogRenderer = inject(FogRendererService);
  private ownership = inject(CameraOwnershipService);
  private context = inject(GameContextService);
  private entityManager = inject(EntityManagerService);
  private toggles = inject(ProfilerTogglesService);

  private firstFrame = true;

  private curR = 0; 
  private curG = 0; 
  private curB = 0;
  private curStart = 500000; 
  private curEnd = 500000;

  private targetColorObj = new Color3(0, 0, 0);

  public forceSnapNextFrame(): void {
    this.firstFrame = true;
  }

  private hexToColor3(hex: string, result: Color3): void {
    const cleanHex = hex.replace('#', '');
    if (cleanHex.length !== 6 && cleanHex.length !== 3) return;
    if (cleanHex.length === 6) {
      result.r = parseInt(cleanHex.substring(0, 2), 16) / 255.0;
      result.g = parseInt(cleanHex.substring(2, 4), 16) / 255.0;
      result.b = parseInt(cleanHex.substring(4, 6), 16) / 255.0;
    }
  }

  public start(): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;
    
    this.curStart = scene.fogStart || 500000;
    this.curEnd = scene.fogEnd || 500000;
    this.firstFrame = true;
  }

  public stop(): void {
    this.firstFrame = true;
    this.fogRenderer.dispose();
  }
// En fog-orchestrator.service.ts
public prepareForTestLive(scene: Scene, targetEntity: GameEntity | null, isBW: boolean): void {
  this.firstFrame = true;
  if (!scene) return;

  const fog = targetEntity?.playerConfig?.fog;
  if (fog && fog.enabled) {
    const activeColorHex = isBW ? (fog.colorBW || '#888888') : (fog.color || '#0d1729');
    this.hexToColor3(activeColorHex, this.targetColorObj);
    
    scene.fogColor = this.targetColorObj;
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogEnabled = true;

    const renderMaxZ = Math.max(60.0, Number(fog.renderDistanceFPS) || 150.0);
    this.curStart = renderMaxZ * 0.35;
    this.curEnd = renderMaxZ;
    scene.fogStart = this.curStart;
    scene.fogEnd = this.curEnd;
  }
}
  public postUpdate(dtMs: number): void {
    const scene = this.motor3d.getScene();
    if (!scene) return;

    const isTransitioning = this.context.isTransitioning();
    const mode = this.context.mode();
    const isPlaying = this.context.isPlaying();
    const isFogDisabledTemp = this.context.isFogDisabled() || this.toggles.state.fogOff;

    if (mode === GameMode.EDITOR || isFogDisabledTemp) {
      scene.fogMode = Scene.FOGMODE_NONE;
      this.fogRenderer.hideAll();
      return;
    }

    const wSettings = this.worldSettingsSvc.settings();
    const isBW = wSettings.visualMode === 'bw';
    const globalClearHex = isBW ? wSettings.clearColorBW : wSettings.clearColor;

    this.hexToColor3(globalClearHex, this.targetColorObj);

    if (isTransitioning) {
      this.fogRenderer.renderFogWalls(scene, null, false, [], this.targetColorObj, globalClearHex, false, false, 0, 500000, true);
      return;
    }

    let targetEntity = this.context.activePlayerEntity();

    if (!targetEntity) {
      const entities = this.entityManager.getAllEntities();
      for (let i = 0; i < entities.length; i++) {
        if (entities[i].rol === 'player' || entities[i].hasComponent('characterConfig') || entities[i].rol === 'spawn_point') {
          targetEntity = entities[i];
          break;
        }
      }
    }

    const targetPlayer = (targetEntity?.view as AbstractMesh) || null;
    let shadowLimit = 500000;

    const isFPS = this.context.cameraView() === 'FPS';
    const lerpSpeed = isPlaying ? 0.35 : 0.05;

    let targetR = 0, targetG = 0, targetB = 0;
    let useFog = false;
    let activeLevels: FogLevel[] = [];

    // Determinación determinista de niebla
    if (targetEntity?.playerConfig?.fog?.enabled) {
      if (isPlaying || mode === GameMode.EDITING_IN_GAME || mode === GameMode.TEST_LIVE) {
        useFog = true;
      }
    }

    if (useFog && targetEntity?.playerConfig?.fog) {
      const fog = targetEntity.playerConfig.fog;
      const activeColorHex = isBW ? (fog.colorBW || '#888888') : (fog.color || '#0d1729');

      this.hexToColor3(activeColorHex, this.targetColorObj);
      targetR = this.targetColorObj.r;
      targetG = this.targetColorObj.g;
      targetB = this.targetColorObj.b;

      const rawDist = isBW 
        ? (isFPS ? fog.renderDistanceFpsBW : fog.renderDistanceTpsBW) 
        : (isFPS ? fog.renderDistanceFPS : fog.renderDistanceTPS);

      const renderMaxZ = Math.max(60.0, Number(rawDist) || 150.0);
      shadowLimit = renderMaxZ;
      activeLevels = isBW ? (isFPS ? fog.levelsFpsBW : fog.levelsTpsBW) : (isFPS ? fog.levelsFPS : fog.levelsTPS);

      // Fusión lineal exacta: el shader de niebla cubre los objetos hasta fundirlos completamente al llegar al corte
      this.curStart = renderMaxZ * 0.35;
      this.curEnd = renderMaxZ;
    } else {
      targetR = this.targetColorObj.r;
      targetG = this.targetColorObj.g;
      targetB = this.targetColorObj.b;
      this.curStart = 500000;
      this.curEnd = 500000;
    }

    if (this.firstFrame) {
      this.curR = targetR; 
      this.curG = targetG; 
      this.curB = targetB;
    } else {
      this.curR += (targetR - this.curR) * lerpSpeed;
      this.curG += (targetG - this.curG) * lerpSpeed;
      this.curB += (targetB - this.curB) * lerpSpeed;
    }

    scene.fogColor = new Color3(this.curR, this.curG, this.curB);
    scene.fogMode = useFog ? Scene.FOGMODE_LINEAR : Scene.FOGMODE_NONE;
    if (useFog) {
      scene.fogStart = this.curStart;
      scene.fogEnd = this.curEnd;
    }

    this.fogRenderer.renderFogWalls(
      scene, targetPlayer, useFog, activeLevels, 
      this.targetColorObj, globalClearHex, isFogDisabledTemp, 
      this.firstFrame, lerpSpeed, shadowLimit, false
    );

    this.firstFrame = false;
  }
}