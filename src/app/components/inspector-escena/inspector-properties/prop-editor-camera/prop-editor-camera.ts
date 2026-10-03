// RUTA: src/app/components/inspector-escena/inspector-properties/prop-editor-camera/prop-editor-camera.ts
// ACCIÓN: MODIFICAR

import { Component, inject, OnInit, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorCameraSettings, EDITOR_CAMERA_CALIBRATION } from '../../../../core/engine/world/world-settings.model';
import { EditorCameraSettingsService } from '../../../../services/editor/editor-camera-settings.service';
 
@Component({
  selector: 'app-prop-editor-camera',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-editor-camera.html',
  styleUrls: ['./prop-editor-camera.css']
})
export class PropEditorCamera implements OnInit {
  private settingsSvc = inject(EditorCameraSettingsService);

  public settings: EditorCameraSettings = { ...this.settingsSvc.settings() };

  // Constantes de rango calibradas para los sliders e inputs
  public readonly sliderMin = EDITOR_CAMERA_CALIBRATION.SLIDER_MIN;
  public readonly sliderMax = EDITOR_CAMERA_CALIBRATION.SLIDER_MAX;
  public readonly sliderStep = EDITOR_CAMERA_CALIBRATION.SLIDER_STEP;

  constructor() {
    // Sincronizar reactivamente los sliders del inspector si se cambia de plataforma
    effect(() => {
      const s = this.settingsSvc.settings();
      untracked(() => {
        this.settings = { ...s };
      });
    });
  }

  ngOnInit(): void {
    this.settings = { ...this.settingsSvc.settings() };
  }

  public onLiveChange(): void {
    this.settingsSvc.updateSettings(this.settings);
  }

  public resetDefaults(): void {
    this.settingsSvc.resetToDefaults();
    this.settings = { ...this.settingsSvc.settings() };
  }
}