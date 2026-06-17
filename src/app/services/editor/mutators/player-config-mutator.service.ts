
import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { EditorMapaService } from '../../editor-mapa.service';
import { FogLevel, PlayerRuntimeConfig, cloneDefaultPlayerConfig } from '../player-config.model';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class PlayerConfigMutatorService {
  private editorSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService); // 🔥

  public aplicarPlayerConfig(objeto: AbstractMesh, playerConfig: PlayerRuntimeConfig, selectionRange: any): void {
    if (!objeto.metadata) objeto.metadata = {};
    
    this.sincronizarFogCompat(playerConfig);

    objeto.metadata.playerConfig = JSON.parse(JSON.stringify(playerConfig));
    objeto.metadata.selectionRange = JSON.parse(JSON.stringify(selectionRange));

    // 🔥 Sincronizar con la entidad
    const entity = this.entityManager.getEntityByMesh(objeto);
    if (entity) {
       entity.syncFromMetadata();
    }

    this.editorSvc.triggerUpdate();
  }

  public restaurarNieblaSilentHill(playerConfig: PlayerRuntimeConfig): void {
    const fog = playerConfig.fog;
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
  }

  private normalizarNumero(valor: any, fallback: number): number {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  private normalizarOffset(valor: any, fallback: number): number {
    const n = Number(valor);
    return Number.isFinite(n) ? n : fallback;
  }

  private sincronizarFogCompat(playerConfig: PlayerRuntimeConfig): void {
    const fog: any = playerConfig.fog || {};

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

    playerConfig.fog = fog;
  }
}