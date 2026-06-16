import { Component, Input, OnInit, inject } from '@angular/core'; 
import { CommonModule } from '@angular/common'; 
import { FormsModule } from '@angular/forms'; 
import { AbstractMesh } from '@babylonjs/core'; 
import { EditorMapaService } from '../../../../services/editor-mapa.service'; 
import { PlayerRuntimeConfig, cloneDefaultPlayerConfig, mergePlayerConfig } from '../../../../services/editor/player-config.model';

interface SelectionRangeConfig { fpsAdminMax: number; fpsUserMax: number; }

@Component({ 
  selector: 'app-prop-player', 
  standalone: true, 
  imports: [CommonModule, FormsModule], 
  templateUrl: './prop-player.html', 
  styleUrls: ['../inspector-properties.css'] 
}) 
export class PropPlayer implements OnInit { 
  @Input() objeto!: AbstractMesh;

  private editorSvc = inject(EditorMapaService);

  acordeonesPlayer: Record<string, boolean> = { movement: true, jump: false, fog: true, camera: false, selection: false, physics: false, animEnabled: false }; 
  playerConfig: PlayerRuntimeConfig = cloneDefaultPlayerConfig(); 
  selectionRange: SelectionRangeConfig = { fpsAdminMax: 500000, fpsUserMax: 3 };

  ngOnInit() { 
    const meta = this.objeto.metadata || {}; 
    
    // Guardamos el fog crudo ANTES de que mergePlayerConfig lo limpie
    const rawFog = meta.playerConfig?.fog ? JSON.parse(JSON.stringify(meta.playerConfig.fog)) : {};
    
    this.playerConfig = mergePlayerConfig(meta.playerConfig || null);

    // Reinyectamos el fog crudo para que no se pierdan los campos nuevos
    this.playerConfig.fog = { ...this.playerConfig.fog, ...rawFog };

    const storedSelection = meta.playerConfig?.selectionRange || meta.selectionRange || {};
    this.selectionRange = {
      fpsAdminMax: this.normalizarNumero(storedSelection.fpsAdminMax, 500000), 
      fpsUserMax: this.normalizarNumero(storedSelection.fpsUserMax, 3)
    };
    
    (this.playerConfig as any).selectionRange = { fpsAdminMax: this.selectionRange.fpsAdminMax, fpsUserMax: this.selectionRange.fpsUserMax };

    this.sincronizarFogCompat();
  }

  private normalizarNumero(valor: any, fallback: number): number { 
    const n = Number(valor); return Number.isFinite(n) ? n : fallback; 
  }

  private sincronizarFogCompat(): void { 
    const fog: any = this.playerConfig.fog || {};

    fog.enabled = !!fog.enabled;
    fog.fogMode = fog.fogMode === 'exp' || fog.fogMode === 'exp2' ? fog.fogMode : 'linear';
    fog.density = this.normalizarNumero(fog.density, 0.01);
    fog.fogShape = fog.fogShape || 'cylinder';

    fog.offsetXFPS = this.normalizarNumero(fog.offsetXFPS ?? fog.offsetX, 0);
    fog.offsetYFPS = this.normalizarNumero(fog.offsetYFPS ?? fog.offsetY, 0);
    fog.offsetZFPS = this.normalizarNumero(fog.offsetZFPS ?? fog.offsetZ, 0);

    fog.offsetXTPS = this.normalizarNumero(fog.offsetXTPS ?? fog.offsetX, 0);
    fog.offsetYTPS = this.normalizarNumero(fog.offsetYTPS ?? fog.offsetY, 0);
    fog.offsetZTPS = this.normalizarNumero(fog.offsetZTPS ?? fog.offsetZ, 0);

    // 🔥 COLORES SILENT HILL POR DEFECTO
    fog.color = typeof fog.color === 'string' ? fog.color : '#6b6b6b';
    fog.colorStart = typeof fog.colorStart === 'string' ? fog.colorStart : '#8c8c8c';
    fog.colorMedio1 = typeof fog.colorMedio1 === 'string' ? fog.colorMedio1 : '#6b6b6b';
    fog.colorMedio2 = typeof fog.colorMedio2 === 'string' ? fog.colorMedio2 : '#4d4d4d';
    fog.colorEnd = typeof fog.colorEnd === 'string' ? fog.colorEnd : '#2e2e2e';

    fog.colorBW = typeof fog.colorBW === 'string' ? fog.colorBW : '#555555';
    fog.colorStartBW = typeof fog.colorStartBW === 'string' ? fog.colorStartBW : '#8c8c8c';
    fog.colorMedio1BW = typeof fog.colorMedio1BW === 'string' ? fog.colorMedio1BW : '#6b6b6b';
    fog.colorMedio2BW = typeof fog.colorMedio2BW === 'string' ? fog.colorMedio2BW : '#4d4d4d';
    fog.colorEndBW = typeof fog.colorEndBW === 'string' ? fog.colorEndBW : '#2e2e2e';

    // 🔥 DISTANCIAS SILENT HILL POR DEFECTO
    fog.startFPS = this.normalizarNumero(fog.startFPS, 8);
    fog.medio1FPS = this.normalizarNumero(fog.medio1FPS, 25);
    fog.medio2FPS = this.normalizarNumero(fog.medio2FPS, 50);
    fog.endFPS = this.normalizarNumero(fog.endFPS, 75);

    fog.startTPS = this.normalizarNumero(fog.startTPS, 10);
    fog.medio1TPS = this.normalizarNumero(fog.medio1TPS, 30);
    fog.medio2TPS = this.normalizarNumero(fog.medio2TPS, 55);
    fog.endTPS = this.normalizarNumero(fog.endTPS, 80);

    // 🔥 CORTE DE RENDER (Solución a los objetos que aparecen de golpe)
    fog.renderDistanceFPS = this.normalizarNumero(fog.renderDistanceFPS, 250);
    fog.renderDistanceTPS = this.normalizarNumero(fog.renderDistanceTPS, 250);

    // 🔥 OPACIDADES (Difuminado suave)
    fog.densityStartFPS = this.normalizarNumero(fog.densityStartFPS, 0);
    fog.densityMedio1FPS = this.normalizarNumero(fog.densityMedio1FPS, 35);
    fog.densityMedio2FPS = this.normalizarNumero(fog.densityMedio2FPS, 80);
    fog.densityEndFPS = this.normalizarNumero(fog.densityEndFPS, 100);

    fog.densityStartTPS = this.normalizarNumero(fog.densityStartTPS, 0);
    fog.densityMedio1TPS = this.normalizarNumero(fog.densityMedio1TPS, 35);
    fog.densityMedio2TPS = this.normalizarNumero(fog.densityMedio2TPS, 80);
    fog.densityEndTPS = this.normalizarNumero(fog.densityEndTPS, 100);

    // 🔥 ALTURAS (Para ocultar base de edificios y dejar ver las puntas)
    fog.fogHeightYStartFPS = this.normalizarNumero(fog.fogHeightYStartFPS, 15.0);
    fog.fogHeightYMedio1FPS = this.normalizarNumero(fog.fogHeightYMedio1FPS, 25.0);
    fog.fogHeightYMedio2FPS = this.normalizarNumero(fog.fogHeightYMedio2FPS, 40.0);
    fog.fogHeightYEndFPS = this.normalizarNumero(fog.fogHeightYEndFPS, 60.0);

    fog.fogHeightYStartTPS = this.normalizarNumero(fog.fogHeightYStartTPS, 15.0);
    fog.fogHeightYMedio1TPS = this.normalizarNumero(fog.fogHeightYMedio1TPS, 25.0);
    fog.fogHeightYMedio2TPS = this.normalizarNumero(fog.fogHeightYMedio2TPS, 40.0);
    fog.fogHeightYEndTPS = this.normalizarNumero(fog.fogHeightYEndTPS, 60.0);

    // 🔥 SUAVIZADO/FALLOFF (Que no parezca un techo plano, sino humo hacia el cielo)
    fog.fogFalloffYStartFPS = this.normalizarNumero(fog.fogFalloffYStartFPS, 5.0);
    fog.fogFalloffYMedio1FPS = this.normalizarNumero(fog.fogFalloffYMedio1FPS, 8.0);
    fog.fogFalloffYMedio2FPS = this.normalizarNumero(fog.fogFalloffYMedio2FPS, 12.0);
    fog.fogFalloffYEndFPS = this.normalizarNumero(fog.fogFalloffYEndFPS, 20.0);

    fog.fogFalloffYStartTPS = this.normalizarNumero(fog.fogFalloffYStartTPS, 5.0);
    fog.fogFalloffYMedio1TPS = this.normalizarNumero(fog.fogFalloffYMedio1TPS, 8.0);
    fog.fogFalloffYMedio2TPS = this.normalizarNumero(fog.fogFalloffYMedio2TPS, 12.0);
    fog.fogFalloffYEndTPS = this.normalizarNumero(fog.fogFalloffYEndTPS, 20.0);

    // BLANCO Y NEGRO (Copiamos la misma lógica perfecta)
    fog.startFpsBW = this.normalizarNumero(fog.startFpsBW, 8);
    fog.medio1FpsBW = this.normalizarNumero(fog.medio1FpsBW, 25);
    fog.medio2FpsBW = this.normalizarNumero(fog.medio2FpsBW, 50);
    fog.endFpsBW = this.normalizarNumero(fog.endFpsBW, 75);

    fog.startTpsBW = this.normalizarNumero(fog.startTpsBW, 10);
    fog.medio1TpsBW = this.normalizarNumero(fog.medio1TpsBW, 30);
    fog.medio2TpsBW = this.normalizarNumero(fog.medio2TpsBW, 55);
    fog.endTpsBW = this.normalizarNumero(fog.endTpsBW, 80);

    fog.renderDistanceFpsBW = this.normalizarNumero(fog.renderDistanceFpsBW ?? fog.renderDistanceFPS, 250);
    fog.renderDistanceTpsBW = this.normalizarNumero(fog.renderDistanceTpsBW ?? fog.renderDistanceTPS, 250);

    fog.densityStartFpsBW = this.normalizarNumero(fog.densityStartFpsBW, 0);
    fog.densityMedio1FpsBW = this.normalizarNumero(fog.densityMedio1FpsBW, 35);
    fog.densityMedio2FpsBW = this.normalizarNumero(fog.densityMedio2FpsBW, 80);
    fog.densityEndFpsBW = this.normalizarNumero(fog.densityEndFpsBW, 100);

    fog.densityStartTpsBW = this.normalizarNumero(fog.densityStartTpsBW, 0);
    fog.densityMedio1TpsBW = this.normalizarNumero(fog.densityMedio1TpsBW, 35);
    fog.densityMedio2TpsBW = this.normalizarNumero(fog.densityMedio2TpsBW, 80);
    fog.densityEndTpsBW = this.normalizarNumero(fog.densityEndTpsBW, 100);

    fog.fogHeightYStartFpsBW = this.normalizarNumero(fog.fogHeightYStartFpsBW, 15.0);
    fog.fogHeightYMedio1FpsBW = this.normalizarNumero(fog.fogHeightYMedio1FpsBW, 25.0);
    fog.fogHeightYMedio2FpsBW = this.normalizarNumero(fog.fogHeightYMedio2FpsBW, 40.0);
    fog.fogHeightYEndFpsBW = this.normalizarNumero(fog.fogHeightYEndFpsBW, 60.0);

    fog.fogHeightYStartTpsBW = this.normalizarNumero(fog.fogHeightYStartTpsBW, 15.0);
    fog.fogHeightYMedio1TpsBW = this.normalizarNumero(fog.fogHeightYMedio1TpsBW, 25.0);
    fog.fogHeightYMedio2TpsBW = this.normalizarNumero(fog.fogHeightYMedio2TpsBW, 40.0);
    fog.fogHeightYEndTpsBW = this.normalizarNumero(fog.fogHeightYEndTpsBW, 60.0);

    fog.fogFalloffYStartFpsBW = this.normalizarNumero(fog.fogFalloffYStartFpsBW, 5.0);
    fog.fogFalloffYMedio1FpsBW = this.normalizarNumero(fog.fogFalloffYMedio1FpsBW, 8.0);
    fog.fogFalloffYMedio2FpsBW = this.normalizarNumero(fog.fogFalloffYMedio2FpsBW, 12.0);
    fog.fogFalloffYEndFpsBW = this.normalizarNumero(fog.fogFalloffYEndFpsBW, 20.0);

    fog.fogFalloffYStartTpsBW = this.normalizarNumero(fog.fogFalloffYStartTpsBW, 5.0);
    fog.fogFalloffYMedio1TpsBW = this.normalizarNumero(fog.fogFalloffYMedio1TpsBW, 8.0);
    fog.fogFalloffYMedio2TpsBW = this.normalizarNumero(fog.fogFalloffYMedio2TpsBW, 12.0);
    fog.fogFalloffYEndTpsBW = this.normalizarNumero(fog.fogFalloffYEndTpsBW, 20.0);

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
    this.selectionRange = { fpsAdminMax: 500000, fpsUserMax: 3 }; 
    (this.playerConfig as any).selectionRange = { fpsAdminMax: 500000, fpsUserMax: 3 };
    this.sincronizarFogCompat(); 
    this.aplicarPlayerConfig(); 
  } 
}