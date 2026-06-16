import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import {
  PlayerRuntimeConfig,
  cloneDefaultPlayerConfig,
  mergePlayerConfig,
  FogLevel
} from '../../../../services/editor/player-config.model';

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

  private editorSvc = inject(EditorMapaService);

  acordeonesPlayer: Record<string, boolean> = {
    movement: true,
    jump: false,
    fog: true,
    camera: false,
    selection: false,
    physics: false,
    animEnabled: false
  };

  playerConfig: PlayerRuntimeConfig = cloneDefaultPlayerConfig();

  activeFogMode: 'FPS' | 'TPS' | 'FPS_BW' | 'TPS_BW' = 'FPS';
  activeFogLevel: number = 0;

  selectionRange: SelectionRangeConfig = {
    fpsAdminMax: 500000, 
    fpsUserMax: 3
  };

  ngOnInit() {
    const meta = this.objeto.metadata || {};
    this.playerConfig = mergePlayerConfig(meta.playerConfig || null);

    const storedSelection =
      meta.playerConfig?.selectionRange ||
      meta.selectionRange ||
      {};

    this.selectionRange = {
      fpsAdminMax: this.normalizarNumero(storedSelection.fpsAdminMax, 500000), 
      fpsUserMax: this.normalizarNumero(storedSelection.fpsUserMax, 3)
    };

    (this.playerConfig as any).selectionRange = {
      fpsAdminMax: this.selectionRange.fpsAdminMax,
      fpsUserMax: this.selectionRange.fpsUserMax
    };

    this.sincronizarFogCompat();
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
    return null;
  }

  getGlobalFogColor(): string {
    const fog = this.playerConfig.fog;
    if (this.activeFogMode.includes('BW')) return fog.colorBW || '#555555';
    return fog.color || '#0d1729';
  }

  setGlobalFogColor(val: string): void {
    const fog = this.playerConfig.fog;
    if (this.activeFogMode.includes('BW')) fog.colorBW = val;
    else fog.color = val;
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

  private normalizarNumero(valor: any, fallback: number): number {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  private normalizarOffset(valor: any, fallback: number): number {
    const n = Number(valor);
    return Number.isFinite(n) ? n : fallback;
  }

  private sincronizarFogCompat(): void {
    const fog: any = this.playerConfig.fog || {};

    fog.enabled = !!fog.enabled;
    fog.fogMode = fog.fogMode === 'exp' || fog.fogMode === 'exp2' ? fog.fogMode : 'linear';

    fog.color = typeof fog.color === 'string' ? fog.color : '#0d1729';
    fog.colorBW = typeof fog.colorBW === 'string' ? fog.colorBW : '#555555';

    fog.renderDistanceFPS = this.normalizarNumero(fog.renderDistanceFPS, 100000);
    fog.renderDistanceTPS = this.normalizarNumero(fog.renderDistanceTPS, 100000);
    fog.renderDistanceFpsBW = this.normalizarNumero(fog.renderDistanceFpsBW, 100000);
    fog.renderDistanceTpsBW = this.normalizarNumero(fog.renderDistanceTpsBW, 100000);

    const defaultLayers = [5, 35, 100, 100, 35, 5];
    const defaultHeights = [100, 100, 100, 100, 100, 100]; // 🔥 Inicialización de alturas

    const ensureThicknessAndOffset = (levels: any[], defaultsThick: number[], defaultOffset: number) => {
      if (!levels) return;
      levels.forEach((l, i) => {
        l.thickness = this.normalizarNumero(l.thickness, defaultsThick[i] ?? 10);
        l.offsetY = this.normalizarOffset(l.offsetY, defaultOffset);
        if (!l.layerOpacities || l.layerOpacities.length !== 6) {
          l.layerOpacities = [...defaultLayers];
        }
        // 🔥 Asignar arreglo de Alturas Individuales si no existe
        if (!l.layerHeights || l.layerHeights.length !== 6) {
          l.layerHeights = [...defaultHeights];
        }
      });
    };
    
    const defaultT = [5, 10, 20, 40, 80];
    ensureThicknessAndOffset(fog.levelsFPS, defaultT, 0);
    ensureThicknessAndOffset(fog.levelsTPS, defaultT, 0);
    ensureThicknessAndOffset(fog.levelsFpsBW, defaultT, 0);
    ensureThicknessAndOffset(fog.levelsTpsBW, defaultT, 0);

    this.playerConfig.fog = fog;
  }

  toggleAcordeon(s: string) {
    this.acordeonesPlayer[s] = !this.acordeonesPlayer[s];
  }

  aplicarPlayerConfig() {
    if (!this.objeto.metadata) this.objeto.metadata = {};

    const selectionPayload = {
      fpsAdminMax: this.normalizarNumero(this.selectionRange.fpsAdminMax, 500000), 
      fpsUserMax: this.normalizarNumero(this.selectionRange.fpsUserMax, 3)
    };

    this.selectionRange.fpsAdminMax = selectionPayload.fpsAdminMax;
    this.selectionRange.fpsUserMax = selectionPayload.fpsUserMax;

    (this.playerConfig as any).selectionRange = { ...selectionPayload };

    this.sincronizarFogCompat();

    this.objeto.metadata.playerConfig = JSON.parse(JSON.stringify(this.playerConfig));
    this.objeto.metadata.selectionRange = JSON.parse(JSON.stringify(selectionPayload));

    this.editorSvc.triggerUpdate();
  }

  cambiarHabilitadoAnim(actionKey: string, value: boolean) {
    (this.playerConfig.animationEnabled as any)[actionKey] = value;
    this.aplicarPlayerConfig();
  }

  restaurarPlayerConfigDefault() {
    this.playerConfig = cloneDefaultPlayerConfig();
    this.selectionRange = {
      fpsAdminMax: 500000,
      fpsUserMax: 3
    };
    (this.playerConfig as any).selectionRange = {
      fpsAdminMax: 500000,
      fpsUserMax: 3
    };
    this.sincronizarFogCompat();
    this.aplicarPlayerConfig();
  }
}
