
import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { EditorMapaService } from '../../editor-mapa.service';
import { FogLevel, PlayerRuntimeConfig } from '../../../core/engine/models/player-config.model';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { SelectionRangeDto } from '../../../core/engine/models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class PlayerConfigMutatorService {
  private mapaSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService); 

  public aplicarPlayerConfig(objeto: AbstractMesh, playerConfig: PlayerRuntimeConfig, selectionRange: SelectionRangeDto): void {
    this.sincronizarFogCompat(playerConfig);
    
    // 🔥 Sincronizar Culling Fallback
    const culling: any = playerConfig.culling || {};
    culling.enabled = culling.enabled ?? true;
    culling.cullDistance = this.normalizarNumero(culling.cullDistance, 150);
    culling.fadeMargin = this.normalizarNumero(culling.fadeMargin, 30);
    playerConfig.culling = culling;

    const entity = this.entityManager.getEntityByMesh(objeto);
    if (entity) {
       entity.playerConfig = JSON.parse(JSON.stringify(playerConfig));
       entity.selectionRange = JSON.parse(JSON.stringify(selectionRange));
       
       // 🔥 FIX 1: Garantiza que, si el Inspector de Jugador cambia los Ojos (fpsEyeLevel), 
       // la caja magenta (Gizmo/camOffset) acompañe y no se desincronice.
       if (!entity.camOffset) entity.camOffset = { x: 0, y: 1.6, z: 0 };
       if (entity.playerConfig) {
           entity.camOffset.y = entity.playerConfig.camera.fpsEyeLevel;
       }

       entity.isDirty = true;
    }

    this.mapaSvc.onMapChanged.next();
  }

  public restaurarNieblaSilentHill(playerConfig: PlayerRuntimeConfig): void {
    const fog = playerConfig.fog;
    fog.enabled = true;
    fog.color = '#64748b';
    fog.colorBW = '#888888';
    fog.renderDistanceFPS = 150; 
    fog.renderDistanceTPS = 150;
    fog.renderDistanceFpsBW = 150;
    fog.renderDistanceTpsBW = 150;

    const defaultLayers12 = [2, 5, 10, 20, 35, 55, 75, 90, 100, 100, 100, 100];
    const defaultHeights12 = [30, 40, 50, 60, 70, 80, 90, 100, 100, 100, 100, 100]; 
    
    const defaultD = [15, 45, 90]; 
    const defaultH = [10, 25, 60];   
    const defaultT = [15, 30, 60]; 

    const resetArray = (arr: FogLevel[]) => {
      arr.length = 3; 
      arr.forEach((l, i) => {
        if (!l) arr[i] = {} as any;
        arr[i].distance = defaultD[i];
        arr[i].height = defaultH[i];
        arr[i].thickness = defaultT[i];
        arr[i].offsetY = 0;
        arr[i].opacity = i === 0 ? 15 : (i === 1 ? 50 : 100);
        arr[i].layerOpacities = [...defaultLayers12];
        arr[i].layerHeights = [...defaultHeights12];
        arr[i].color = undefined;
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

    fog.renderDistanceFPS = this.normalizarNumero(fog.renderDistanceFPS, 150); 
    fog.renderDistanceTPS = this.normalizarNumero(fog.renderDistanceTPS, 150);
    fog.renderDistanceFpsBW = this.normalizarNumero(fog.renderDistanceFpsBW, 150);
    fog.renderDistanceTpsBW = this.normalizarNumero(fog.renderDistanceTpsBW, 150);

    const defaultLayers12 = [2, 5, 10, 20, 35, 55, 75, 90, 100, 100, 100, 100];
    const defaultHeights12 = [30, 40, 50, 60, 70, 80, 90, 100, 100, 100, 100, 100]; 
    const defaultD = [15, 45, 90]; 
    const defaultH = [10, 25, 60];   
    const defaultT = [15, 30, 60]; 

    const ensurePerfectFog = (levels: any[]) => {
      if (!levels) return;
      levels.length = Math.min(levels.length, 3);
      
      for(let i = 0; i < 3; i++) {
        if (!levels[i]) levels[i] = {};
        const l = levels[i];
        l.distance = this.normalizarNumero(l.distance, defaultD[i]);
        l.height = this.normalizarNumero(l.height, defaultH[i]);
        l.thickness = this.normalizarNumero(l.thickness, defaultT[i]);
        l.offsetY = this.normalizarOffset(l.offsetY, 0);
        l.opacity = this.normalizarNumero(l.opacity, i === 0 ? 15 : (i === 1 ? 50 : 100));
        
        if (!l.layerOpacities || l.layerOpacities.length !== 12) {
          l.layerOpacities = [...defaultLayers12];
        }
        if (!l.layerHeights || l.layerHeights.length !== 12) {
          l.layerHeights = [...defaultHeights12];
        }
      }
    };
    
    ensurePerfectFog(fog.levelsFPS);
    ensurePerfectFog(fog.levelsTPS);
    ensurePerfectFog(fog.levelsFpsBW);
    ensurePerfectFog(fog.levelsTpsBW);

    playerConfig.fog = fog;
  }
}