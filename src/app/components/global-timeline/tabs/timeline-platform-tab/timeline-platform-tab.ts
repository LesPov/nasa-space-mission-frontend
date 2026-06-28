
import { Component, inject, effect, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { WorldSettingsService } from '../../../../core/engine/world/world-settings.service';

@Component({
  selector: 'app-timeline-platform-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './timeline-platform-tab.html',
  styleUrls: ['./timeline-platform-tab.css']
})
export class TimelinePlatformTab {
  public mapaSvc = inject(EditorMapaService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private cdr = inject(ChangeDetectorRef);

  public platformLogic = {
    initialVariables: [] as { key: string, value: string }[],
    objetivosLocales: '',
    recompensasLocales: ''
  };

  constructor() {
    effect(() => {
      this.mapaSvc.escenaIdActiva();
      this.cargarPlataformaLogic();
    });
  }

  cargarPlataformaLogic() {
    const sceneData = this.mapaSvc.escenaActualData();
    if (!sceneData || !sceneData.scene) return;

    const logic = sceneData.scene.environmentSettings?.logicSettings || {};
    this.platformLogic = {
      initialVariables: Array.isArray(logic.initialVariables) ? logic.initialVariables : [],
      objetivosLocales: Array.isArray(logic.objetivosLocales) ? logic.objetivosLocales.join('\n') : (logic.objetivosLocales || ''),
      recompensasLocales: Array.isArray(logic.recompensasLocales) ? logic.recompensasLocales.join('\n') : (logic.recompensasLocales || '')
    };

    this.cdr.detectChanges();
  }

  agregarVariableInicial() {
    this.platformLogic.initialVariables.push({ key: '', value: '' });
    this.persistPlatformLogic();
  }

  quitarVariableInicial(i: number) {
    this.platformLogic.initialVariables.splice(i, 1);
    this.persistPlatformLogic();
  }

  persistPlatformLogic() {
    const w = this.worldSettingsSvc.settings();
    const env = { ...w, logicSettings: { ...this.platformLogic } };
    (this.worldSettingsSvc as any).settings.set(env);
    this.mapaSvc.onMapChanged.next(); 
  }
}