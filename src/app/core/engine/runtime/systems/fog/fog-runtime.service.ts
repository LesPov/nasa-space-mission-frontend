// file: src/app/core/engine/runtime/systems/fog/fog-runtime.service.ts
import { Injectable, inject, signal, Injector } from '@angular/core';
import { PlayerFogConfig, FogLevel, cloneDefaultPlayerConfig } from '../../../models/player-config.model';
import { GameEntity } from '../../../entities/game.entity';
import { GameContextService } from '../../../session/game-context.service';
import { FogRendererService } from '../fog-renderer.service';
import { FogOrchestratorService } from '../fog-orchestrator.service';
import { EditorMapaService } from '../../../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class FogRuntimeService {
  private context = inject(GameContextService);
  private fogRenderer = inject(FogRendererService);
  private mapaSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService);
  private injector = inject(Injector);

  private _fogOrchestrator: FogOrchestratorService | null = null;
  private get fogOrchestrator(): FogOrchestratorService {
    if (!this._fogOrchestrator) {
      this._fogOrchestrator = this.injector.get(FogOrchestratorService);
    }
    return this._fogOrchestrator;
  }

  private runtimeConfigSignal = signal<PlayerFogConfig | null>(null);
  public readonly activeFogConfig = this.runtimeConfigSignal.asReadonly();

  private isLiveModified = signal<boolean>(false);
  public readonly hasLiveChanges = this.isLiveModified.asReadonly();

  private currentTargetUidSignal = signal<string | null>(null);
  public readonly currentTargetUid = this.currentTargetUidSignal.asReadonly();

  private isLiveEditingActive = false;
  private editingDebounceTimer: any = null;

  public isLiveEditing(): boolean {
    return this.isLiveEditingActive;
  }

  public hasActiveConfig(): boolean {
    return this.runtimeConfigSignal() !== null;
  }

  public getRuntimeConfig(): PlayerFogConfig | null {
    return this.runtimeConfigSignal();
  }

  public initForEntity(entity: GameEntity | null): void {
    if (!entity) {
      this.clear();
      return;
    }

    if (this.currentTargetUidSignal() === entity.uid && this.runtimeConfigSignal() !== null) {
      return;
    }

    this.currentTargetUidSignal.set(entity.uid);

    if (!entity.playerConfig || !entity.playerConfig.fog) {
      const defaultConf = cloneDefaultPlayerConfig().fog;
      this.runtimeConfigSignal.set(structuredClone(defaultConf));
    } else {
      this.runtimeConfigSignal.set(structuredClone(entity.playerConfig.fog));
    }

    this.isLiveModified.set(false);
    this.fogRenderer.invalidateCache();
    this.fogOrchestrator.forceSnapNextFrame();
  }

  public initForTestLive(playerEntity: GameEntity | null): void {
    this.initForEntity(playerEntity);
  }

  public clear(): void {
    this.runtimeConfigSignal.set(null);
    this.currentTargetUidSignal.set(null);
    this.isLiveModified.set(false);
    this.isLiveEditingActive = false;
    if (this.editingDebounceTimer) {
      clearTimeout(this.editingDebounceTimer);
      this.editingDebounceTimer = null;
    }
    this.fogRenderer.invalidateCache();
  }

  private notifyChange(): void {
    this.isLiveModified.set(true);
    this.isLiveEditingActive = true;

    if (this.editingDebounceTimer) {
      clearTimeout(this.editingDebounceTimer);
    }
    this.editingDebounceTimer = setTimeout(() => {
      this.isLiveEditingActive = false;
    }, 250);

    this.fogRenderer.invalidateCache();
    this.fogOrchestrator.forceSnapNextFrame();
  }

  public updateProperty<K extends keyof PlayerFogConfig>(key: K, value: PlayerFogConfig[K]): void {
    const current = this.runtimeConfigSignal();
    if (!current) return;

    const next = structuredClone(current);
    next[key] = value;
    this.runtimeConfigSignal.set(next);
    this.notifyChange();
  }

  public updateLevel(
    mode: 'FPS' | 'TPS' | 'FPS_BW' | 'TPS_BW', 
    levelIndex: number, 
    partial: Partial<FogLevel>
  ): void {
    const current = this.runtimeConfigSignal();
    if (!current) return;

    const next = structuredClone(current);
    let levels: FogLevel[];

    switch (mode) {
      case 'FPS': levels = next.levelsFPS; break;
      case 'TPS': levels = next.levelsTPS; break;
      case 'FPS_BW': levels = next.levelsFpsBW; break;
      case 'TPS_BW': levels = next.levelsTpsBW; break;
    }

    if (levels && levels[levelIndex]) {
      Object.assign(levels[levelIndex], partial);
      this.runtimeConfigSignal.set(next);
      this.notifyChange();
    }
  }

  public updateLayerOpacity(
    mode: 'FPS' | 'TPS' | 'FPS_BW' | 'TPS_BW',
    levelIndex: number,
    layerIndex: number,
    value: number
  ): void {
    const current = this.runtimeConfigSignal();
    if (!current) return;

    const next = structuredClone(current);
    let levels: FogLevel[];

    switch (mode) {
      case 'FPS': levels = next.levelsFPS; break;
      case 'TPS': levels = next.levelsTPS; break;
      case 'FPS_BW': levels = next.levelsFpsBW; break;
      case 'TPS_BW': levels = next.levelsTpsBW; break;
    }

    if (levels && levels[levelIndex]) {
      const lvl = levels[levelIndex];
      if (!lvl.layerOpacities) {
        lvl.layerOpacities = [2, 5, 10, 20, 35, 55, 75, 90, 100, 100, 100, 100];
      }
      lvl.layerOpacities[layerIndex] = Math.max(0, Math.min(100, value));
      this.runtimeConfigSignal.set(next);
      this.notifyChange();
    }
  }

  public updateLayerHeight(
    mode: 'FPS' | 'TPS' | 'FPS_BW' | 'TPS_BW',
    levelIndex: number,
    layerIndex: number,
    value: number
  ): void {
    const current = this.runtimeConfigSignal();
    if (!current) return;

    const next = structuredClone(current);
    let levels: FogLevel[];

    switch (mode) {
      case 'FPS': levels = next.levelsFPS; break;
      case 'TPS': levels = next.levelsTPS; break;
      case 'FPS_BW': levels = next.levelsFpsBW; break;
      case 'TPS_BW': levels = next.levelsTpsBW; break;
    }

    if (levels && levels[levelIndex]) {
      const lvl = levels[levelIndex];
      if (!lvl.layerHeights) {
        lvl.layerHeights = [30, 40, 50, 60, 70, 80, 90, 100, 100, 100, 100, 100];
      }
      lvl.layerHeights[layerIndex] = Math.max(0, Math.min(100, value));
      this.runtimeConfigSignal.set(next);
      this.notifyChange();
    }
  }

  public saveToEntity(entity: GameEntity | null): boolean {
    const currentRuntime = this.runtimeConfigSignal();
    if (!currentRuntime || !entity) return false;

    if (!entity.playerConfig) {
      entity.playerConfig = cloneDefaultPlayerConfig();
    }

    entity.playerConfig.fog = structuredClone(currentRuntime);
    entity.isDirty = true;

    if (entity.authoringBackup) {
      entity.createAuthoringBackup();
    }

    this.isLiveModified.set(false);
    this.mapaSvc.onMapChanged.next();
    return true;
  }

  public resetToAuthoring(entity: GameEntity | null): void {
    if (!entity || !entity.playerConfig?.fog) {
      const def = cloneDefaultPlayerConfig().fog;
      this.runtimeConfigSignal.set(structuredClone(def));
    } else {
      this.runtimeConfigSignal.set(structuredClone(entity.playerConfig.fog));
    }
    this.isLiveModified.set(false);
    this.notifyChange();
  }
}