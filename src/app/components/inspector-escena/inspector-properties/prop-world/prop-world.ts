
// file: src/app/components/inspector-escena/inspector-properties/prop-world/prop-world.ts
import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject, effect, untracked, Injectable } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../../core/engine/world/world-settings.service';
import { VisualMode } from '../../../../core/engine/world/world-settings.model';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../../core/engine/scene/scene-access.token';
import { TransformMutatorService } from '../../../../services/editor/mutators/transform-mutator.service';
import { AbstractMesh } from '@babylonjs/core';
import { ShadowOrchestratorService } from '../../../../core/engine/runtime/shadows/shadow-orchestrator.service';

@Injectable({ providedIn: 'root' })
@Component({
  selector: 'app-prop-world',
  standalone: true, 
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-world.html',
  styleUrls: ['./prop-world.css']
})
export class PropWorld implements OnInit, OnDestroy {
  public editorSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private transformMutator = inject(TransformMutatorService);
  private shadowOrchestrator = inject(ShadowOrchestratorService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  clearColorHex = '#0d1729';
  clearColorHexBW = '#555555';

  ambientIntensity = 0.6;
  ambientColorHex = '#ffffff';
  groundColorHex = '#333333';
  ambientDirX = 0;
  ambientDirY = 1;
  ambientDirZ = 0;

  sunEnabled = true;
  visualMode: VisualMode = 'normal';

  private lastSceneId: number | null = null;

  constructor() {
    effect(() => {
      const sceneId = this.editorSvc.escenaIdActiva();
      
      untracked(() => {
        if (sceneId !== this.lastSceneId) {
          this.lastSceneId = sceneId;
          setTimeout(() => {
            this.leerEstadoActual();
          }, 50);
        }
      });
    });
  }

  ngOnInit() {
    this.leerEstadoActual();
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => {
        this.cdr.detectChanges();
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  leerEstadoActual() {
    const w = this.worldSettingsSvc.settings();

    this.clearColorHex = w.clearColor;
    this.clearColorHexBW = w.clearColorBW;
    this.visualMode = w.visualMode;
    this.ambientIntensity = w.ambientIntensity;
    this.ambientColorHex = w.ambientDiffuse;
    this.groundColorHex = w.ambientGround;
    this.ambientDirX = w.ambientDirX;
    this.ambientDirY = w.ambientDirY;
    this.ambientDirZ = w.ambientDirZ;
    this.sunEnabled = w.sunEnabled !== false;

    this.cdr.detectChanges();
  }

  aplicarSol() {
    this.worldSettingsSvc.updateWorldSettings({ sunEnabled: this.sunEnabled });
    this.shadowOrchestrator.reconcileShadows();
    this.editorSvc.onMapChanged.next();
  }

  aplicarModoVisualCambiado() {
    this.worldSettingsSvc.updateWorldSettings({ visualMode: this.visualMode });
    this.worldSettingsSvc.applyToScene(this.motor3dSvc.getScene(), (mode) => this.motor3dSvc.setVisualMode(mode));

    this.entityManager.getAllEntities().forEach(entity => {
      if (entity.view) {
        this.transformMutator.aplicarVisuales(entity.view as AbstractMesh, entity.visual);
      }
    });

    this.editorSvc.onMapChanged.next();
  }

  aplicarFondo() {
    this.worldSettingsSvc.updateWorldSettings({
      clearColor: this.clearColorHex,
      clearColorBW: this.clearColorHexBW
    });
    this.worldSettingsSvc.applyToScene(this.motor3dSvc.getScene(), (mode) => this.motor3dSvc.setVisualMode(mode));
    this.editorSvc.onMapChanged.next();
  }

  aplicarIluminacion() {
    this.worldSettingsSvc.updateWorldSettings({
      ambientIntensity: this.ambientIntensity,
      ambientDiffuse: this.ambientColorHex,
      ambientGround: this.groundColorHex,
      ambientDirX: this.ambientDirX,
      ambientDirY: this.ambientDirY,
      ambientDirZ: this.ambientDirZ
    });
    this.worldSettingsSvc.applyToScene(this.motor3dSvc.getScene(), (mode) => this.motor3dSvc.setVisualMode(mode));
    this.editorSvc.onMapChanged.next();
  }
}