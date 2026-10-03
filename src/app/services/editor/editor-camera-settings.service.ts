// RUTA: src/app/services/editor/editor-camera-settings.service.ts
// ACCIÓN: MODIFICAR

import { Injectable, signal, inject, effect, untracked } from '@angular/core';
import { 
  EditorCameraSettings, 
  DEFAULT_EDITOR_CAMERA_SETTINGS 
} from '../../core/engine/world/world-settings.model';
import { WorldSettingsService } from '../../core/engine/world/world-settings.service';
import { EditorMapaService } from '../editor-mapa.service';

@Injectable({ providedIn: 'root' })
export class EditorCameraSettingsService {
  private worldSettingsSvc = inject(WorldSettingsService);
  private mapaSvc = inject(EditorMapaService);

  public readonly settings = signal<EditorCameraSettings>({ ...DEFAULT_EDITOR_CAMERA_SETTINGS });

  constructor() {
    // Escucha reactiva unidireccional: al cambiar de escena o cargarse desde la DB,
    // se leen los ajustes de la plataforma activa sin generar ciclo de inyección
    effect(() => {
      const currentWorld = this.worldSettingsSvc.settings();
      const loaded = currentWorld.editorCameraSettings;
      
      untracked(() => {
        if (loaded) {
          this.loadSettings(loaded);
        }
      });
    });
  }

  public loadSettings(loaded?: Partial<EditorCameraSettings> | null): void {
    // Ampliación del rango hasta 15.0 para admitir configuraciones de usuario extremas sin recortar
    const merged: EditorCameraSettings = {
      orbitSensitivity: this.sanitize(loaded?.orbitSensitivity, DEFAULT_EDITOR_CAMERA_SETTINGS.orbitSensitivity, 0.1, 15.0),
      zoomSensitivity: this.sanitize(loaded?.zoomSensitivity, DEFAULT_EDITOR_CAMERA_SETTINGS.zoomSensitivity, 0.1, 15.0),
      panSensitivity: this.sanitize(loaded?.panSensitivity, DEFAULT_EDITOR_CAMERA_SETTINGS.panSensitivity, 0.1, 15.0),
      navigationSpeed: this.sanitize(loaded?.navigationSpeed, DEFAULT_EDITOR_CAMERA_SETTINGS.navigationSpeed, 0.1, 15.0),
      minDistance: this.sanitize(loaded?.minDistance, DEFAULT_EDITOR_CAMERA_SETTINGS.minDistance, 0.1, 50.0),
      maxDistance: this.sanitize(loaded?.maxDistance, DEFAULT_EDITOR_CAMERA_SETTINGS.maxDistance, 50.0, 100000.0),
      inertia: this.sanitize(loaded?.inertia, DEFAULT_EDITOR_CAMERA_SETTINGS.inertia, 0.0, 0.95)
    };

    this.settings.set(merged);
  }

  public updateSettings(partial: Partial<EditorCameraSettings>): void {
    this.settings.update(curr => {
      const updated: EditorCameraSettings = {
        orbitSensitivity: partial.orbitSensitivity !== undefined 
          ? this.sanitize(partial.orbitSensitivity, curr.orbitSensitivity, 0.1, 15.0) 
          : curr.orbitSensitivity,
        zoomSensitivity: partial.zoomSensitivity !== undefined 
          ? this.sanitize(partial.zoomSensitivity, curr.zoomSensitivity, 0.1, 15.0) 
          : curr.zoomSensitivity,
        panSensitivity: partial.panSensitivity !== undefined 
          ? this.sanitize(partial.panSensitivity, curr.panSensitivity, 0.1, 15.0) 
          : curr.panSensitivity,
        navigationSpeed: partial.navigationSpeed !== undefined 
          ? this.sanitize(partial.navigationSpeed, curr.navigationSpeed, 0.1, 15.0) 
          : curr.navigationSpeed,
        minDistance: partial.minDistance !== undefined 
          ? this.sanitize(partial.minDistance, curr.minDistance, 0.1, 50.0) 
          : curr.minDistance,
        maxDistance: partial.maxDistance !== undefined 
          ? this.sanitize(partial.maxDistance, curr.maxDistance, 50.0, 100000.0) 
          : curr.maxDistance,
        inertia: partial.inertia !== undefined 
          ? this.sanitize(partial.inertia, curr.inertia, 0.0, 0.95) 
          : curr.inertia
      };

      // Persistir de inmediato en la configuración de la escena activa
      this.worldSettingsSvc.updateWorldSettings({ editorCameraSettings: updated });
      return updated;
    });

    // Notificar al mapa para autoguardar con debounce
    this.mapaSvc.onMapChanged.next();
  }

  public resetToDefaults(): void {
    this.updateSettings({ ...DEFAULT_EDITOR_CAMERA_SETTINGS });
  }

  private sanitize(val: any, fallback: number, min: number, max: number): number {
    const n = Number(val);
    if (!Number.isFinite(n) || isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }
}