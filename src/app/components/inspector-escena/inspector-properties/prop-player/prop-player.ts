
import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import {
  PlayerRuntimeConfig,
  cloneDefaultPlayerConfig,
  mergePlayerConfig
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
  styleUrls: ['../inspector-properties.css']
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

  private normalizarNumero(valor: any, fallback: number): number {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  private sincronizarFogCompat(): void {
    const fog: any = this.playerConfig.fog || {};

    fog.enabled = !!fog.enabled;
    fog.fogMode = fog.fogMode === 'exp' || fog.fogMode === 'exp2' ? fog.fogMode : 'linear';
    fog.density = this.normalizarNumero(fog.density, 0.01);
    
    fog.fogShape = fog.fogShape || 'cylinder';
    fog.fogHeightY = this.normalizarNumero(fog.fogHeightY, 4.0);
    fog.fogFalloffY = this.normalizarNumero(fog.fogFalloffY, 1.5);
    
    fog.offsetX = this.normalizarNumero(fog.offsetX, 0);
    fog.offsetY = this.normalizarNumero(fog.offsetY, 0);
    fog.offsetZ = this.normalizarNumero(fog.offsetZ, 0);

    fog.color = typeof fog.color === 'string' ? fog.color : '#0d1729';
    fog.colorBW = typeof fog.colorBW === 'string' ? fog.colorBW : '#555555';

    // Normal
    fog.startFPS = this.normalizarNumero(fog.startFPS, 0);
    fog.endFPS = this.normalizarNumero(fog.endFPS, 50000);
    fog.startTPS = this.normalizarNumero(fog.startTPS, 5);
    fog.endTPS = this.normalizarNumero(fog.endTPS, 50000);

    fog.renderDistanceFPS = this.normalizarNumero(fog.renderDistanceFPS, 100000);
    fog.renderDistanceTPS = this.normalizarNumero(fog.renderDistanceTPS, 100000);

    fog.densityStartFPS = this.normalizarNumero(fog.densityStartFPS ?? fog.densityFPS ?? fog.densityFps, 0);
    fog.densityEndFPS = this.normalizarNumero(fog.densityEndFPS, 100);
    fog.densityStartTPS = this.normalizarNumero(fog.densityStartTPS ?? fog.densityTPS ?? fog.densityTps, 0);
    fog.densityEndTPS = this.normalizarNumero(fog.densityEndTPS, 100);

    // 🔥 BLANCO Y NEGRO: Herencia automática para evitar colapsos
    fog.startFpsBW = this.normalizarNumero(fog.startFpsBW ?? fog.startFPS, 0);
    fog.endFpsBW = this.normalizarNumero(fog.endFpsBW ?? fog.endFPS, 50000);
    fog.startTpsBW = this.normalizarNumero(fog.startTpsBW ?? fog.startTPS, 5);
    fog.endTpsBW = this.normalizarNumero(fog.endTpsBW ?? fog.endTPS, 50000);

    fog.renderDistanceFpsBW = this.normalizarNumero(fog.renderDistanceFpsBW ?? fog.renderDistanceFPS, 100000);
    fog.renderDistanceTpsBW = this.normalizarNumero(fog.renderDistanceTpsBW ?? fog.renderDistanceTPS, 100000);

    fog.densityStartFpsBW = this.normalizarNumero(fog.densityStartFpsBW ?? fog.densityStartFPS, 0);
    fog.densityEndFpsBW = this.normalizarNumero(fog.densityEndFpsBW ?? fog.densityEndFPS, 100);
    fog.densityStartTpsBW = this.normalizarNumero(fog.densityStartTpsBW ?? fog.densityStartTPS, 0);
    fog.densityEndTpsBW = this.normalizarNumero(fog.densityEndTpsBW ?? fog.densityEndTPS, 100);

    fog.fogHeightYBW = this.normalizarNumero(fog.fogHeightYBW ?? fog.fogHeightY, 4.0);
    fog.fogFalloffYBW = this.normalizarNumero(fog.fogFalloffYBW ?? fog.fogFalloffY, 1.5);

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