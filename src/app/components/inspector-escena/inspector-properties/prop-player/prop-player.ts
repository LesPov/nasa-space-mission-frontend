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

  indices12Capas = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

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
    if (this.activeFogMode.includes('BW')) return fog.colorBW || '#888888';
    return fog.color || '#64748b'; 
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

    fog.color = typeof fog.color === 'string' ? fog.color : '#64748b';
    fog.colorBW = typeof fog.colorBW === 'string' ? fog.colorBW : '#888888';

    fog.renderDistanceFPS = this.normalizarNumero(fog.renderDistanceFPS, 250); 
    fog.renderDistanceTPS = this.normalizarNumero(fog.renderDistanceTPS, 250);
    fog.renderDistanceFpsBW = this.normalizarNumero(fog.renderDistanceFpsBW, 250);
    fog.renderDistanceTpsBW = this.normalizarNumero(fog.renderDistanceTpsBW, 250);

    const defaultLayers12 = [2, 5, 10, 20, 35, 55, 75, 90, 100, 100, 100, 100];
    const defaultHeights12 = [30, 40, 50, 60, 70, 80, 90, 100, 100, 100, 100, 100]; 
    const defaultD = [8, 25, 60, 120, 200]; 
    const defaultH = [5, 12, 25, 45, 80];   
    const defaultT = [10, 20, 40, 60, 100]; 

    const ensurePerfectFog = (levels: any[]) => {
      if (!levels) return;
      levels.forEach((l, i) => {
        l.distance = this.normalizarNumero(l.distance, defaultD[i]);
        l.height = this.normalizarNumero(l.height, defaultH[i]);
        l.thickness = this.normalizarNumero(l.thickness, defaultT[i]);
        l.offsetY = this.normalizarOffset(l.offsetY, 0);
        l.opacity = this.normalizarNumero(l.opacity, i === 0 ? 30 : (i === 4 ? 100 : 50 + (i*10)));
        
        if (!l.layerOpacities || l.layerOpacities.length !== 12) {
          l.layerOpacities = [...defaultLayers12];
        }
        if (!l.layerHeights || l.layerHeights.length !== 12) {
          l.layerHeights = [...defaultHeights12];
        }
      });
    };
    
    ensurePerfectFog(fog.levelsFPS);
    ensurePerfectFog(fog.levelsTPS);
    ensurePerfectFog(fog.levelsFpsBW);
    ensurePerfectFog(fog.levelsTpsBW);

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

  // 🔥 EVENTO DE CLICKS PARA LAS 12 CAPAS (Izquierdo suma, Derecho Resta)
  ajustarCapa(lvl: FogLevel, tipo: 'opacity' | 'height', index: number, cantidad: number, event: MouseEvent) {
    event.preventDefault(); // Previene que salga el menú contextual feo del navegador
    
    if (tipo === 'opacity') {
      let val = (lvl.layerOpacities![index] ?? 0) + cantidad;
      val = Math.max(0, Math.min(100, val));
      lvl.layerOpacities![index] = val;
    } else {
      let val = (lvl.layerHeights![index] ?? 100) + cantidad;
      val = Math.max(0, Math.min(100, val));
      lvl.layerHeights![index] = val;
    }
    this.aplicarPlayerConfig();
  }

  // 🔥 RESTABLECER TODOS LOS ANILLOS A LA CONFIGURACIÓN SILENT HILL
  restaurarTodaLaNiebla() {
    const fog = this.playerConfig.fog;
    fog.enabled = true;
    fog.color = '#64748b';
    fog.colorBW = '#888888';
    fog.renderDistanceFPS = 250;
    fog.renderDistanceTPS = 250;
    fog.renderDistanceFpsBW = 250;
    fog.renderDistanceTpsBW = 250;

    const defaultLayers12 = [2, 5, 10, 20, 35, 55, 75, 90, 100, 100, 100, 100];
    const defaultHeights12 = [30, 40, 50, 60, 70, 80, 90, 100, 100, 100, 100, 100]; 
    const defaultD = [8, 25, 60, 120, 200]; 
    const defaultH = [5, 12, 25, 45, 80];   
    const defaultT = [10, 20, 40, 60, 100]; 

    const resetArray = (arr: FogLevel[]) => {
      arr.forEach((l, i) => {
        l.distance = defaultD[i];
        l.height = defaultH[i];
        l.thickness = defaultT[i];
        l.offsetY = 0;
        l.opacity = i === 0 ? 30 : (i === 4 ? 100 : 50 + (i*10));
        l.layerOpacities = [...defaultLayers12];
        l.layerHeights = [...defaultHeights12];
        l.color = undefined;
      });
    };

    resetArray(fog.levelsFPS);
    resetArray(fog.levelsTPS);
    resetArray(fog.levelsFpsBW);
    resetArray(fog.levelsTpsBW);

    this.aplicarPlayerConfig();
  }

  restaurarPlayerConfigDefault() {
    this.playerConfig = cloneDefaultPlayerConfig();
    this.selectionRange = { fpsAdminMax: 500000, fpsUserMax: 3 };
    (this.playerConfig as any).selectionRange = { fpsAdminMax: 500000, fpsUserMax: 3 };
    this.restaurarTodaLaNiebla(); 
  }
}