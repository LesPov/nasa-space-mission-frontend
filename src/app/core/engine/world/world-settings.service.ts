

import { Injectable, signal } from '@angular/core';
import { Color3, Color4, HemisphericLight, Scene, Vector3 } from '@babylonjs/core';
import { WorldSettings, MissionUiSettings, DEFAULT_WORLD_SETTINGS, DEFAULT_MISSION_UI_SETTINGS, VisualMode } from './world-settings.model';

@Injectable({ providedIn: 'root' })
export class WorldSettingsService {
  public settings = signal<WorldSettings>({ ...DEFAULT_WORLD_SETTINGS });
  public uiSettings = signal<MissionUiSettings>({ ...DEFAULT_MISSION_UI_SETTINGS });

  public loadFromDb(worldData: any, uiData: any): void {
    if (worldData) {
      const clearHex = worldData.clearColor?.length >= 7 ? worldData.clearColor.substring(0, 7) : DEFAULT_WORLD_SETTINGS.clearColor;
      const clearHexBW = worldData.clearColorBW?.length >= 7 ? worldData.clearColorBW.substring(0, 7) : DEFAULT_WORLD_SETTINGS.clearColorBW;

      this.settings.set({
        visualMode: worldData.visualMode === 'bw' ? 'bw' : 'normal',
        clearColor: clearHex,
        clearColorBW: clearHexBW,
        gravityY: Number.isFinite(Number(worldData.gravityY)) ? Number(worldData.gravityY) : DEFAULT_WORLD_SETTINGS.gravityY,
        ambientIntensity: Number.isFinite(Number(worldData.ambientIntensity)) ? Number(worldData.ambientIntensity) : DEFAULT_WORLD_SETTINGS.ambientIntensity,
        ambientDiffuse: worldData.ambientDiffuse || DEFAULT_WORLD_SETTINGS.ambientDiffuse,
        ambientGround: worldData.ambientGround || DEFAULT_WORLD_SETTINGS.ambientGround,
        ambientDirX: Number.isFinite(Number(worldData.ambientDirX)) ? Number(worldData.ambientDirX) : DEFAULT_WORLD_SETTINGS.ambientDirX,
        ambientDirY: Number.isFinite(Number(worldData.ambientDirY)) ? Number(worldData.ambientDirY) : DEFAULT_WORLD_SETTINGS.ambientDirY,
        ambientDirZ: Number.isFinite(Number(worldData.ambientDirZ)) ? Number(worldData.ambientDirZ) : DEFAULT_WORLD_SETTINGS.ambientDirZ,
        logicSettings: worldData.logicSettings || {}
      });
    }

    if (uiData) {
      this.uiSettings.set({
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
        requisitos: Array.isArray(uiData.requisitos) ? uiData.requisitos : [] // 🔥 ADDED
      });
    }
  }

  public updateWorldSettings(partial: Partial<WorldSettings>): void {
    this.settings.update(s => ({ ...s, ...partial }));
  }

  public updateUiSettings(partial: Partial<MissionUiSettings>): void {
    this.uiSettings.update(s => ({ ...s, ...partial }));
  }

  public applyToScene(scene: Scene, setVisualModeFn: (mode: VisualMode) => void): void {
    if (!scene) return;
    const w = this.settings();
    const ui = this.uiSettings();

    // Sincronizar metadata para lecturas cruzadas en el ecosistema Babylon
    scene.metadata = {
      ...(scene.metadata || {}),
      globalVisualMode: w.visualMode,
      globalClearColor: w.clearColor,
      globalClearColorBW: w.clearColorBW,
      uiSettings: ui,
      logicSettings: w.logicSettings || {}
    };

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
    scene.gravity = new Vector3(0, w.gravityY, 0);

    setVisualModeFn(w.visualMode);

    if (!scene.environmentTexture) {
      scene.createDefaultEnvironment({ createSkybox: false, createGround: false, enableGroundShadow: false, setupImageProcessing: false });
    }
    
    const oldGlobal = scene.lights.find(l => l.name === 'globalLight');
    if (oldGlobal) oldGlobal.dispose();
    const oldSun = scene.lights.find(l => l.name === 'sunLight');
    if (oldSun) oldSun.dispose();
  }
}
