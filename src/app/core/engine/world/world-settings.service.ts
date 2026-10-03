// RUTA: src/app/core/engine/world/world-settings.service.ts
// ACCIÓN: MODIFICAR

import { Injectable, signal } from '@angular/core';
import { Color3, Color4, HemisphericLight, Scene, Vector3 } from '@babylonjs/core';
import { 
  WorldSettings, 
  MissionUiSettings, 
  DEFAULT_WORLD_SETTINGS, 
  DEFAULT_MISSION_UI_SETTINGS, 
  VisualMode,
  GravityPreset,
  GRAVITY_PRESETS,
  DEFAULT_EDITOR_CAMERA_SETTINGS 
} from './world-settings.model';

@Injectable({ providedIn: 'root' })
export class WorldSettingsService {
  public settings = signal<WorldSettings>({ ...DEFAULT_WORLD_SETTINGS });
  public uiSettings = signal<MissionUiSettings>({ ...DEFAULT_MISSION_UI_SETTINGS });

  public loadFromDb(worldData: any, uiData: any): void {
    if (worldData) {
      const clearHex = worldData.clearColor?.length >= 7 ? worldData.clearColor.substring(0, 7) : DEFAULT_WORLD_SETTINGS.clearColor;
      const clearHexBW = worldData.clearColorBW?.length >= 7 ? worldData.clearColorBW.substring(0, 7) : DEFAULT_WORLD_SETTINGS.clearColorBW;

      let preset: GravityPreset = (worldData.gravityPreset as GravityPreset) || 'earth';
      if (!GRAVITY_PRESETS[preset]) preset = 'earth';

      let magnitude = Number(worldData.gravityMagnitude);
      if (!Number.isFinite(magnitude) || magnitude < 0) {
        magnitude = GRAVITY_PRESETS[preset].magnitude;
      }

      let dirX = Number(worldData.gravityVector?.x ?? 0);
      let dirY = Number(worldData.gravityVector?.y ?? -1);
      let dirZ = Number(worldData.gravityVector?.z ?? 0);

      if (preset !== 'custom') {
        const def = GRAVITY_PRESETS[preset];
        magnitude = def.magnitude;
        dirX = def.direction.x;
        dirY = def.direction.y;
        dirZ = def.direction.z;
      }

      const babylonY = (magnitude / 9.81) * -0.25;

      const loadedCamSettings = worldData.editorCameraSettings
        ? { ...DEFAULT_EDITOR_CAMERA_SETTINGS, ...worldData.editorCameraSettings }
        : { ...DEFAULT_EDITOR_CAMERA_SETTINGS };

      this.settings.set({
        visualMode: worldData.visualMode === 'bw' ? 'bw' : 'normal',
        clearColor: clearHex,
        clearColorBW: clearHexBW,
        gravityY: Number.isFinite(Number(worldData.gravityY)) ? Number(worldData.gravityY) : babylonY,
        gravityPreset: preset,
        gravityMagnitude: magnitude,
        gravityVector: { x: dirX, y: dirY, z: dirZ },
        ambientIntensity: Number.isFinite(Number(worldData.ambientIntensity)) ? Number(worldData.ambientIntensity) : DEFAULT_WORLD_SETTINGS.ambientIntensity,
        ambientDiffuse: worldData.ambientDiffuse || DEFAULT_WORLD_SETTINGS.ambientDiffuse,
        ambientGround: worldData.ambientGround || DEFAULT_WORLD_SETTINGS.ambientGround,
        ambientDirX: Number.isFinite(Number(worldData.ambientDirX)) ? Number(worldData.ambientDirX) : DEFAULT_WORLD_SETTINGS.ambientDirX,
        ambientDirY: Number.isFinite(Number(worldData.ambientDirY)) ? Number(worldData.ambientDirY) : DEFAULT_WORLD_SETTINGS.ambientDirY,
        ambientDirZ: Number.isFinite(Number(worldData.ambientDirZ)) ? Number(worldData.ambientDirZ) : DEFAULT_WORLD_SETTINGS.ambientDirZ,
        logicSettings: worldData.logicSettings || {},
        editorCameraSettings: loadedCamSettings
      });
    } else {
      this.settings.update(s => ({
        ...s,
        editorCameraSettings: { ...DEFAULT_EDITOR_CAMERA_SETTINGS }
      }));
    }

    if (uiData) {
      this.uiSettings.set({
        missionTitle: uiData.missionTitle || DEFAULT_MISSION_UI_SETTINGS.missionTitle,
        missionDescription: uiData.missionDescription || DEFAULT_MISSION_UI_SETTINGS.missionDescription,
        primaryColor: uiData.primaryColor || DEFAULT_MISSION_UI_SETTINGS.primaryColor,
        bgColor: uiData.bgColor || DEFAULT_MISSION_UI_SETTINGS.bgColor,
        bgOpacity: Number.isFinite(Number(uiData.bgOpacity)) ? Number(uiData.bgOpacity) : DEFAULT_MISSION_UI_SETTINGS.bgOpacity,
        overlayColor: uiData.overlayColor || DEFAULT_MISSION_UI_SETTINGS.overlayColor,
        overlayOpacity: Number.isFinite(Number(uiData.overlayOpacity)) ? Number(uiData.overlayOpacity) : DEFAULT_MISSION_UI_SETTINGS.overlayOpacity,
        blurIntensity: Number.isFinite(Number(uiData.blurIntensity)) ? Number(uiData.blurIntensity) : DEFAULT_MISSION_UI_SETTINGS.blurIntensity,
        borderRadius: Number.isFinite(Number(uiData.borderRadius)) ? Number(uiData.borderRadius) : DEFAULT_MISSION_UI_SETTINGS.borderRadius,
        textColor: uiData.textColor || DEFAULT_MISSION_UI_SETTINGS.textColor,
        loreQuote: uiData.loreQuote || DEFAULT_MISSION_UI_SETTINGS.loreQuote,
        loreAuthor: uiData.loreAuthor || DEFAULT_MISSION_UI_SETTINGS.loreAuthor,
        initialSequence: uiData.initialSequence || DEFAULT_MISSION_UI_SETTINGS.initialSequence,
        objetivos: Array.isArray(uiData.objetivos) ? uiData.objetivos : [],
        recompensas: Array.isArray(uiData.recompensas) ? uiData.recompensas : [],
        requisitos: Array.isArray(uiData.requisitos) ? uiData.requisitos : []
      });
    } else {
        this.uiSettings.set({ ...DEFAULT_MISSION_UI_SETTINGS });
    }
  }

  public setGravityPreset(preset: GravityPreset, customMagnitude?: number): void {
    if (!GRAVITY_PRESETS[preset]) return;
    
    if (preset === 'custom') {
      const mag = customMagnitude !== undefined && Number.isFinite(customMagnitude) && customMagnitude >= 0 ? customMagnitude : 9.81;
      const babylonY = (mag / 9.81) * -0.25;
      this.settings.update(s => ({
        ...s,
        gravityPreset: 'custom',
        gravityMagnitude: mag,
        gravityY: babylonY,
        gravityVector: { x: 0, y: -1, z: 0 }
      }));
    } else {
      const def = GRAVITY_PRESETS[preset];
      this.settings.update(s => ({
        ...s,
        gravityPreset: preset,
        gravityMagnitude: def.magnitude,
        gravityY: def.babylonScale,
        gravityVector: { ...def.direction }
      }));
    }
  }

  public updateWorldSettings(partial: Partial<WorldSettings>): void {
    this.settings.update(s => {
      const next = { ...s, ...partial };
      if (partial.gravityMagnitude !== undefined && next.gravityPreset === 'custom') {
        next.gravityY = (next.gravityMagnitude / 9.81) * -0.25;
      }
      return next;
    });
  }

  public updateUiSettings(partial: Partial<MissionUiSettings>): void {
    this.uiSettings.update(s => ({ ...s, ...partial }));
  }

  public applyToScene(scene: Scene, setVisualModeFn: (mode: VisualMode) => void): void {
    if (!scene) return;
    const w = this.settings();
    const ui = this.uiSettings();

    scene.metadata = {
      ...(scene.metadata || {}),
      globalVisualMode: w.visualMode,
      globalClearColor: w.clearColor,
      globalClearColorBW: w.clearColorBW,
      gravityPreset: w.gravityPreset,
      gravityMagnitude: w.gravityMagnitude,
      gravityVector: w.gravityVector,
      uiSettings: ui,
      logicSettings: w.logicSettings || {},
      editorCameraSettings: w.editorCameraSettings || { ...DEFAULT_EDITOR_CAMERA_SETTINGS }
    };

    scene.ambientColor = new Color3(1, 1, 1); 

    let ambient = scene.lights.find(l => l.name === 'ambientLight') as HemisphericLight;
    if (!ambient) {
      ambient = new HemisphericLight('ambientLight', new Vector3(w.ambientDirX, w.ambientDirY, w.ambientDirZ), scene);
    }
    
    ambient.direction = new Vector3(w.ambientDirX, w.ambientDirY, w.ambientDirZ);
    ambient.intensity = w.ambientIntensity;
    ambient.diffuse = Color3.FromHexString(w.ambientDiffuse);
    ambient.groundColor = Color3.FromHexString(w.ambientGround);
    ambient.specular = new Color3(0, 0, 0);

    const activeClear = w.visualMode === 'bw' ? w.clearColorBW : w.clearColor;
    scene.clearColor = Color4.FromHexString(activeClear + 'ff');
    
    const gY = w.gravityVector.y * Math.abs(w.gravityY);
    const gX = w.gravityVector.x * Math.abs(w.gravityY);
    const gZ = w.gravityVector.z * Math.abs(w.gravityY);
    scene.gravity = new Vector3(gX, gY, gZ);

    setVisualModeFn(w.visualMode);

    if (!scene.environmentTexture) {
      scene.createDefaultEnvironment({ createSkybox: false, createGround: false, enableGroundShadow: false, setupImageProcessing: false });
    }
    
    const oldGlobal = scene.lights.find(l => l.name === 'globalLight');
    if (oldGlobal) oldGlobal.dispose();
  }
}