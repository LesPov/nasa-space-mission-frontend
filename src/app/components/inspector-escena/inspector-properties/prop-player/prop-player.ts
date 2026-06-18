
import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { PlayerRuntimeConfig, cloneDefaultPlayerConfig, mergePlayerConfig, FogLevel } from '../../../../core/engine/models/player-config.model';
import { PlayerConfigMutatorService } from '../../../../services/editor/mutators/player-config-mutator.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';

interface SelectionRangeConfig {
  fpsAdminMax: number;
  fpsUserMax: number;
}

@Component({
  selector: 'app-prop-player',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-player.html',
  styleUrls: ['./prop-player.css', '../inspector-properties.css']
})
export class PropPlayer implements OnInit {
  @Input() objeto!: AbstractMesh;

  private playerConfigMutator = inject(PlayerConfigMutatorService);
  private entityManager = inject(EntityManagerService);

  acordeonesPlayer: Record<string, boolean> = {
    movement: true, jump: false, fog: true, camera: false, selection: false, physics: false, animEnabled: false
  };

  playerConfig: PlayerRuntimeConfig = cloneDefaultPlayerConfig();
  activeFogMode: 'FPS' | 'TPS' | 'FPS_BW' | 'TPS_BW' = 'FPS';
  activeFogLevel: number = 0;
  indices12Capas = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

  selectionRange: SelectionRangeConfig = { fpsAdminMax: 500000, fpsUserMax: 3 };

  ngOnInit() {
    const entity = this.entityManager.getEntityByMesh(this.objeto);
    if (!entity) return;

    this.playerConfig = mergePlayerConfig(entity.playerConfig || null);

    const storedSelection = entity.selectionRange || {};
    this.selectionRange = {
      fpsAdminMax: Number.isFinite(Number(storedSelection.fpsAdminMax)) ? Number(storedSelection.fpsAdminMax) : 500000, 
      fpsUserMax: Number.isFinite(Number(storedSelection.fpsUserMax)) ? Number(storedSelection.fpsUserMax) : 3
    };

    this.aplicarPlayerConfig();
  }

  get currentFogLevel(): FogLevel | null {
    if (!this.playerConfig?.fog) return null;
    const fog = this.playerConfig.fog;
    switch(this.activeFogMode) {
      case 'FPS': return fog.levelsFPS[this.activeFogLevel];
      case 'TPS': return fog.levelsTPS[this.activeFogLevel];
      case 'FPS_BW': return fog.levelsFpsBW[this.activeFogLevel];
      case 'TPS_BW': return fog.levelsTpsBW[this.activeFogLevel];
    }
  }

  getGlobalFogColor(): string {
    const fog = this.playerConfig.fog;
    return this.activeFogMode.includes('BW') ? (fog.colorBW || '#888888') : (fog.color || '#64748b'); 
  }

  setGlobalFogColor(val: string): void {
    const fog = this.playerConfig.fog;
    if (this.activeFogMode.includes('BW')) fog.colorBW = val; else fog.color = val;
    this.aplicarPlayerConfig();
  }

  getGlobalRenderDist(): number {
    const fog = this.playerConfig.fog;
    switch(this.activeFogMode) {
      case 'FPS': return fog.renderDistanceFPS;
      case 'TPS': return fog.renderDistanceTPS;
      case 'FPS_BW': return fog.renderDistanceFpsBW;
      case 'TPS_BW': return fog.renderDistanceTpsBW;
    }
  }

  setGlobalRenderDist(val: number): void {
    const fog = this.playerConfig.fog;
    switch(this.activeFogMode) {
      case 'FPS': fog.renderDistanceFPS = val; break;
      case 'TPS': fog.renderDistanceTPS = val; break;
      case 'FPS_BW': fog.renderDistanceFpsBW = val; break;
      case 'TPS_BW': fog.renderDistanceTpsBW = val; break;
    }
    this.aplicarPlayerConfig();
  }

  toggleAcordeon(s: string) { this.acordeonesPlayer[s] = !this.acordeonesPlayer[s]; }

  aplicarPlayerConfig() {
    this.playerConfigMutator.aplicarPlayerConfig(this.objeto, this.playerConfig, this.selectionRange);
  }

  cambiarHabilitadoAnim(actionKey: string, value: boolean) {
    (this.playerConfig.animationEnabled as any)[actionKey] = value;
    this.aplicarPlayerConfig();
  }

  ajustarCapa(lvl: FogLevel, tipo: 'opacity' | 'height', index: number, cantidad: number, event: MouseEvent) {
    event.preventDefault(); 
    if (tipo === 'opacity') {
      let val = (lvl.layerOpacities![index] ?? 0) + cantidad;
      lvl.layerOpacities![index] = Math.max(0, Math.min(100, val));
    } else {
      let val = (lvl.layerHeights![index] ?? 100) + cantidad;
      lvl.layerHeights![index] = Math.max(0, Math.min(100, val));
    }
    this.aplicarPlayerConfig();
  }

  restaurarTodaLaNiebla() {
    this.playerConfigMutator.restaurarNieblaSilentHill(this.playerConfig);
    this.aplicarPlayerConfig();
  }

  restaurarPlayerConfigDefault() {
    this.playerConfig = cloneDefaultPlayerConfig();
    this.selectionRange = { fpsAdminMax: 500000, fpsUserMax: 3 };
    this.restaurarTodaLaNiebla(); 
  }
}