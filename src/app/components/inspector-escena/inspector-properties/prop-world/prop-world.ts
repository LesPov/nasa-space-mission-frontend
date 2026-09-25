import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AbstractMesh } from '@babylonjs/core';
import { Subscription } from 'rxjs';

import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../../core/engine/world/world-settings.service';
import { VisualMode, GravityPreset, GRAVITY_PRESETS } from '../../../../core/engine/world/world-settings.model';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../../core/engine/scene/scene-access.token';
import { TransformMutatorService } from '../../../../services/editor/mutators/transform-mutator.service';

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

  gravedadY = -0.25;
  gravityPreset: GravityPreset = 'earth';
  gravityMagnitude = 9.81;
  gravityDirX = 0;
  gravityDirY = -1;
  gravityDirZ = 0;

  visualMode: VisualMode = 'normal';

  ngOnInit() {
    this.leerEstadoActual();
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => this.leerEstadoActual())
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
    this.gravedadY = w.gravityY;

    this.gravityPreset = w.gravityPreset || 'earth';
    this.gravityMagnitude = w.gravityMagnitude !== undefined ? w.gravityMagnitude : 9.81;
    this.gravityDirX = w.gravityVector?.x ?? 0;
    this.gravityDirY = w.gravityVector?.y ?? -1;
    this.gravityDirZ = w.gravityVector?.z ?? 0;

    this.cdr.detectChanges();
  }

  onGravityPresetChange() {
    this.worldSettingsSvc.setGravityPreset(this.gravityPreset, this.gravityMagnitude);
    const updated = this.worldSettingsSvc.settings();
    this.gravityMagnitude = updated.gravityMagnitude;
    this.gravedadY = updated.gravityY;
    this.gravityDirX = updated.gravityVector.x;
    this.gravityDirY = updated.gravityVector.y;
    this.gravityDirZ = updated.gravityVector.z;

    this.worldSettingsSvc.applyToScene(this.motor3dSvc.getScene(), (mode) => this.motor3dSvc.setVisualMode(mode));
    this.editorSvc.onMapChanged.next();
  }

  aplicarGravedadCustom() {
    if (this.gravityPreset !== 'custom') return;
    
    let mag = Number(this.gravityMagnitude);
    if (!Number.isFinite(mag) || mag < 0) mag = 9.81;
    this.gravityMagnitude = mag;

    const babylonY = (mag / 9.81) * -0.25;
    this.gravedadY = babylonY;

    this.worldSettingsSvc.updateWorldSettings({
      gravityPreset: 'custom',
      gravityMagnitude: mag,
      gravityY: babylonY,
      gravityVector: { x: this.gravityDirX, y: this.gravityDirY, z: this.gravityDirZ }
    });

    this.worldSettingsSvc.applyToScene(this.motor3dSvc.getScene(), (mode) => this.motor3dSvc.setVisualMode(mode));
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