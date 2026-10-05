// file: src/app/components/inspector-escena/inspector-properties/prop-fog/prop-fog.ts
import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { FogRuntimeService } from '../../../../core/engine/runtime/systems/fog/fog-runtime.service';
import { GameContextService } from '../../../../core/engine/session/game-context.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { PlayerFogConfig, FogLevel, cloneDefaultPlayerConfig } from '../../../../core/engine/models/player-config.model';
import { GameMode } from '../../../../core/engine/session/game-mode.model';
import { GameEntity } from '../../../../core/engine/entities/game.entity';
import { PlayerConfigMutatorService } from '../../../../services/editor/mutators/player-config-mutator.service';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { AbstractMesh } from '@babylonjs/core';

@Component({
  selector: 'app-prop-fog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-fog.html',
  styleUrls: ['./prop-fog.css']
})
export class PropFogComponent implements OnInit, OnDestroy {
  public fogRuntime = inject(FogRuntimeService);
  public gameContext = inject(GameContextService);
  public stateSvc = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);
  private mutator = inject(PlayerConfigMutatorService);
  private cdr = inject(ChangeDetectorRef);

  public activeFogMode: 'FPS' | 'TPS' | 'FPS_BW' | 'TPS_BW' = 'FPS';
  public activeRingIndex = 0;
  public indices12 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  public statusMessage = '';

  private currentEntityUid: string | null = null;

  get isLiveMode(): boolean {
    const m = this.gameContext.mode();
    return m === GameMode.TEST_LIVE || m === GameMode.EDITING_IN_GAME;
  }

  get isBWMode(): boolean {
    return this.activeFogMode.includes('BW');
  }

  get hasChanges(): boolean {
    return this.fogRuntime.hasLiveChanges();
  }

  get targetEntity(): GameEntity | null {
    const sel = this.stateSvc.objetoSeleccionado() as AbstractMesh | null;
    if (sel) {
      const e = this.entityManager.getEntityByMesh(sel);
      if (e && (e.characterConfig || e.rol === 'player' || e.rol === 'npc' || e.rol === 'spawn_point')) {
        return e;
      }
    }

    let p = this.gameContext.activePlayerEntity();
    if (!p) {
      const all = this.entityManager.getAllEntities();
      p = all.find(e => e.rol === 'player' || e.hasComponent('characterConfig') || e.rol === 'spawn_point') || null;
    }
    return p;
  }

  get fogConfig(): PlayerFogConfig {
    if (this.isLiveMode && this.fogRuntime.hasActiveConfig()) {
      return this.fogRuntime.getRuntimeConfig()!;
    }
    const e = this.targetEntity;
    return e?.playerConfig?.fog || cloneDefaultPlayerConfig().fog;
  }

  get currentLevel(): FogLevel | null {
    const cfg = this.fogConfig;
    let list: FogLevel[];
    switch (this.activeFogMode) {
      case 'FPS': list = cfg.levelsFPS; break;
      case 'TPS': list = cfg.levelsTPS; break;
      case 'FPS_BW': list = cfg.levelsFpsBW; break;
      case 'TPS_BW': list = cfg.levelsTpsBW; break;
    }
    return (list && list[this.activeRingIndex]) ? list[this.activeRingIndex] : null;
  }

  ngOnInit(): void {
    if (this.gameContext.cameraView() === 'TPS') {
      this.activeFogMode = 'TPS';
    } else {
      this.activeFogMode = 'FPS';
    }
    this.syncEntityContext();
  }

  public syncEntityContext(): void {
    const ent = this.targetEntity;
    if (ent && this.currentEntityUid !== ent.uid) {
      this.currentEntityUid = ent.uid;
      if (this.isLiveMode) {
        this.fogRuntime.initForEntity(ent);
      }
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy(): void {}

  public setFogEnabled(val: boolean): void {
    this.syncEntityContext();
    if (this.isLiveMode) {
      this.fogRuntime.updateProperty('enabled', val);
    } else {
      const p = this.targetEntity;
      if (p && p.playerConfig) {
        p.playerConfig.fog.enabled = val;
        p.isDirty = true;
        this.mutator.aplicarPlayerConfig(p.view as any, p.playerConfig, p.selectionRange);
      }
    }
    this.cdr.detectChanges();
  }

  public getGlobalColor(): string {
    const cfg = this.fogConfig;
    return this.isBWMode ? (cfg.colorBW || '#888888') : (cfg.color || '#64748b');
  }

  public setGlobalColor(val: string): void {
    this.syncEntityContext();
    const prop = this.isBWMode ? 'colorBW' : 'color';
    if (this.isLiveMode) {
      this.fogRuntime.updateProperty(prop, val);
    } else {
      const p = this.targetEntity;
      if (p && p.playerConfig) {
        p.playerConfig.fog[prop] = val;
        p.isDirty = true;
        this.mutator.aplicarPlayerConfig(p.view as any, p.playerConfig, p.selectionRange);
      }
    }
  }

  public getRenderDistance(): number {
    const cfg = this.fogConfig;
    switch (this.activeFogMode) {
      case 'FPS': return cfg.renderDistanceFPS;
      case 'TPS': return cfg.renderDistanceTPS;
      case 'FPS_BW': return cfg.renderDistanceFpsBW;
      case 'TPS_BW': return cfg.renderDistanceTpsBW;
    }
  }

  public setRenderDistance(val: number): void {
    this.syncEntityContext();
    const num = Number(val) || 150;
    let prop: keyof PlayerFogConfig;
    switch (this.activeFogMode) {
      case 'FPS': prop = 'renderDistanceFPS'; break;
      case 'TPS': prop = 'renderDistanceTPS'; break;
      case 'FPS_BW': prop = 'renderDistanceFpsBW'; break;
      case 'TPS_BW': prop = 'renderDistanceTpsBW'; break;
    }

    if (this.isLiveMode) {
      this.fogRuntime.updateProperty(prop, num);
    } else {
      const p = this.targetEntity;
      if (p && p.playerConfig) {
        (p.playerConfig.fog as any)[prop] = num;
        p.isDirty = true;
        this.mutator.aplicarPlayerConfig(p.view as any, p.playerConfig, p.selectionRange);
      }
    }
  }

  public onLevelPropChange(prop: keyof FogLevel, val: any): void {
    this.syncEntityContext();
    if (this.isLiveMode) {
      this.fogRuntime.updateLevel(this.activeFogMode, this.activeRingIndex, { [prop]: val });
    } else {
      const lvl = this.currentLevel;
      if (lvl) {
        (lvl as any)[prop] = val;
        const p = this.targetEntity;
        if (p && p.playerConfig) {
          p.isDirty = true;
          this.mutator.aplicarPlayerConfig(p.view as any, p.playerConfig, p.selectionRange);
        }
      }
    }
  }

  public ajustarCapa(lvl: FogLevel, tipo: 'opacity' | 'height', index: number, cantidad: number, event: MouseEvent): void {
    event.preventDefault();
    this.syncEntityContext();
    if (tipo === 'opacity') {
      const currentVal = (lvl.layerOpacities && lvl.layerOpacities[index] !== undefined) ? lvl.layerOpacities[index] : 100;
      const nextVal = Math.max(0, Math.min(100, currentVal + cantidad));
      if (this.isLiveMode) {
        this.fogRuntime.updateLayerOpacity(this.activeFogMode, this.activeRingIndex, index, nextVal);
      } else {
        if (!lvl.layerOpacities) lvl.layerOpacities = [2, 5, 10, 20, 35, 55, 75, 90, 100, 100, 100, 100];
        lvl.layerOpacities[index] = nextVal;
        this.onLevelPropChange('layerOpacities', lvl.layerOpacities);
      }
    } else {
      const currentVal = (lvl.layerHeights && lvl.layerHeights[index] !== undefined) ? lvl.layerHeights[index] : 100;
      const nextVal = Math.max(0, Math.min(100, currentVal + cantidad));
      if (this.isLiveMode) {
        this.fogRuntime.updateLayerHeight(this.activeFogMode, this.activeRingIndex, index, nextVal);
      } else {
        if (!lvl.layerHeights) lvl.layerHeights = [30, 40, 50, 60, 70, 80, 90, 100, 100, 100, 100, 100];
        lvl.layerHeights[index] = nextVal;
        this.onLevelPropChange('layerHeights', lvl.layerHeights);
      }
    }
    this.cdr.detectChanges();
  }

  public resetAnillo(idx: number): void {
    this.syncEntityContext();
    const defaults = cloneDefaultPlayerConfig().fog;
    let list: FogLevel[];
    switch (this.activeFogMode) {
      case 'FPS': list = defaults.levelsFPS; break;
      case 'TPS': list = defaults.levelsTPS; break;
      case 'FPS_BW': list = defaults.levelsFpsBW; break;
      case 'TPS_BW': list = defaults.levelsTpsBW; break;
    }
    const defLevel = list[idx] || list[0];
    if (this.isLiveMode) {
      this.fogRuntime.updateLevel(this.activeFogMode, idx, structuredClone(defLevel));
    } else {
      const current = this.currentLevel;
      if (current) {
        Object.assign(current, structuredClone(defLevel));
        const p = this.targetEntity;
        if (p && p.playerConfig) {
          p.isDirty = true;
          this.mutator.aplicarPlayerConfig(p.view as any, p.playerConfig, p.selectionRange);
        }
      }
    }
    this.statusMessage = `Anillo ${idx + 1} restablecido`;
    setTimeout(() => this.statusMessage = '', 2000);
  }

  public restaurarValoresSilentHill(): void {
    this.syncEntityContext();
    const def = cloneDefaultPlayerConfig();
    this.mutator.restaurarNieblaSilentHill(def);

    if (this.isLiveMode) {
      this.fogRuntime.updateProperty('levelsFPS', structuredClone(def.fog.levelsFPS));
      this.fogRuntime.updateProperty('levelsTPS', structuredClone(def.fog.levelsTPS));
      this.fogRuntime.updateProperty('levelsFpsBW', structuredClone(def.fog.levelsFpsBW));
      this.fogRuntime.updateProperty('levelsTpsBW', structuredClone(def.fog.levelsTpsBW));
      this.fogRuntime.updateProperty('color', def.fog.color);
      this.fogRuntime.updateProperty('colorBW', def.fog.colorBW);
    } else {
      const p = this.targetEntity;
      if (p && p.playerConfig) {
        this.mutator.restaurarNieblaSilentHill(p.playerConfig);
        p.isDirty = true;
        this.mutator.aplicarPlayerConfig(p.view as any, p.playerConfig, p.selectionRange);
      }
    }
    this.statusMessage = 'Preset Silent Hill restaurado';
    setTimeout(() => this.statusMessage = '', 2500);
  }

  public guardarEnMapa(): void {
    const p = this.targetEntity;
    const ok = this.fogRuntime.saveToEntity(p);
    if (ok) {
      this.statusMessage = `✅ Niebla de "${p?.name || 'Entidad'}" guardada`;
    } else {
      this.statusMessage = '⚠️ No se pudo guardar: entidad no disponible';
    }
    setTimeout(() => this.statusMessage = '', 3000);
  }

  public descartarCambios(): void {
    const p = this.targetEntity;
    this.fogRuntime.resetToAuthoring(p);
    this.statusMessage = 'Cambios en vivo descartados';
    setTimeout(() => this.statusMessage = '', 2000);
  }
}