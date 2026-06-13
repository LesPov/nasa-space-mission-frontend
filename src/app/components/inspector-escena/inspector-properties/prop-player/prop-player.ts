
// src/app/components/inspector-escena/inspector-properties/prop-player/prop-player.ts
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
    fog: false,
    camera: false,
    selection: false,
    physics: false,
    animEnabled: false
  };

  playerConfig: PlayerRuntimeConfig = cloneDefaultPlayerConfig();

  selectionRange: SelectionRangeConfig = {
    fpsAdminMax: 10000,
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
      fpsAdminMax: this.normalizarNumero(storedSelection.fpsAdminMax, 10000),
      fpsUserMax: this.normalizarNumero(storedSelection.fpsUserMax, 3)
    };

    (this.playerConfig as any).selectionRange = {
      fpsAdminMax: this.selectionRange.fpsAdminMax,
      fpsUserMax: this.selectionRange.fpsUserMax
    };
  }

  private normalizarNumero(valor: any, fallback: number): number {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  toggleAcordeon(s: string) {
    this.acordeonesPlayer[s] = !this.acordeonesPlayer[s];
  }

  aplicarPlayerConfig() {
    if (!this.objeto.metadata) this.objeto.metadata = {};

    const selectionPayload = {
      fpsAdminMax: this.normalizarNumero(this.selectionRange.fpsAdminMax, 10000),
      fpsUserMax: this.normalizarNumero(this.selectionRange.fpsUserMax, 3)
    };

    this.selectionRange.fpsAdminMax = selectionPayload.fpsAdminMax;
    this.selectionRange.fpsUserMax = selectionPayload.fpsUserMax;

    (this.playerConfig as any).selectionRange = { ...selectionPayload };

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
      fpsAdminMax: 10000,
      fpsUserMax: 3
    };
    (this.playerConfig as any).selectionRange = {
      fpsAdminMax: 10000,
      fpsUserMax: 3
    };
    this.aplicarPlayerConfig();
  }
}
