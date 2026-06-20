
import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { WorldSettingsService } from '../../../../core/engine/world/world-settings.service';

@Component({
  selector: 'app-prop-mission',
  standalone: true, 
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-mission.html',
  styleUrls: ['./prop-mission.css']
})
export class PropMission implements OnInit, OnDestroy {
  public editorSvc = inject(EditorMapaService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  public uiSettings: any = {};

  ngOnInit() {
    this.leerEstadoActual();
    
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => {})
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  leerEstadoActual() {
    const s = this.worldSettingsSvc.uiSettings();
    this.uiSettings = {
      ...s,
      objetivos: s.objetivos.join('\n'),
      recompensas: s.recompensas.join('\n')
    };

    this.cdr.detectChanges();
  }

  aplicarCambios() {
    const objStr = typeof this.uiSettings.objetivos === 'string' ? this.uiSettings.objetivos : (this.uiSettings.objetivos as any).join('\n');
    const recStr = typeof this.uiSettings.recompensas === 'string' ? this.uiSettings.recompensas : (this.uiSettings.recompensas as any).join('\n');

    const objetivosArray = objStr.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    const recompensasArray = recStr.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);

    const newSettings = {
      ...this.uiSettings,
      bgOpacity: Number(this.uiSettings.bgOpacity),
      overlayOpacity: Number(this.uiSettings.overlayOpacity),
      blurIntensity: Number(this.uiSettings.blurIntensity),
      borderRadius: Number(this.uiSettings.borderRadius),
      objetivos: objetivosArray,
      recompensas: recompensasArray
    };

    this.worldSettingsSvc.updateUiSettings(newSettings);

    const epiData = this.editorSvc.episodioActualData();
    if (epiData) {
      epiData.uiSettings = newSettings;
    }

    this.editorSvc.triggerUpdate(); 
  }
}