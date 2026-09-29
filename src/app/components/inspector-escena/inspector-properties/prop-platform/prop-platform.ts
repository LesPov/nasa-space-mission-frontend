
import { Component, inject, effect, ChangeDetectorRef, untracked, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { WorldSettingsService } from '../../../../core/engine/world/world-settings.service';
import { EpisodiosService } from '../../../../services/api/episodios';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../../core/engine/scene/scene-access.token';

@Component({
  selector: 'app-prop-platform',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-platform.html',
  styleUrls: ['./prop-platform.css']
})
export class PropPlatform implements OnInit, OnDestroy {
  public mapaSvc = inject(EditorMapaService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private apiSvc = inject(EpisodiosService);
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private cdr = inject(ChangeDetectorRef);

  public sceneName = '';
  
  public gravityPreset = 'earth';
  public gravityMagnitude = 9.81;
  public gravedadY = -0.25;
  public gravityDirX = 0;
  public gravityDirY = -1;
  public gravityDirZ = 0;

  public platformLogic = {
    initialVariables: [] as { key: string, value: string }[],
    objetivosLocales: '',
    recompensasLocales: ''
  };

  private lastSceneId: number | null = null;
  private subs: Subscription[] = [];

  constructor() {
    // 🔥 Efecto Reactivo para sincronizar Plataforma Local con la selección sin cambiar de pestaña
    effect(() => {
      const sceneId = this.mapaSvc.escenaIdActiva();
      
      untracked(() => {
        if (sceneId !== this.lastSceneId) {
          this.lastSceneId = sceneId;
          setTimeout(() => {
            this.cargarDatos();
          }, 50);
        }
      });
    });
  }

  ngOnInit() {
    this.subs.push(
      this.mapaSvc.onMapChanged.subscribe(() => {
        this.cdr.detectChanges();
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  cargarDatos() {
    const sceneData = this.mapaSvc.escenaActualData();
    if (!sceneData || !sceneData.scene) return;

    // Sincroniza Identidad
    this.sceneName = sceneData.scene.name || 'Zona actual';

    // Sincroniza Gravedad
    const w = this.worldSettingsSvc.settings();
    this.gravityPreset = w.gravityPreset || 'earth';
    this.gravityMagnitude = w.gravityMagnitude ?? 9.81;
    this.gravedadY = w.gravityY ?? -0.25;
    this.gravityDirX = w.gravityVector?.x ?? 0;
    this.gravityDirY = w.gravityVector?.y ?? -1;
    this.gravityDirZ = w.gravityVector?.z ?? 0;

    // Sincroniza Variables Lógicas de Memoria
    const logic = sceneData.scene.environmentSettings?.logicSettings || {};
    this.platformLogic = {
      initialVariables: Array.isArray(logic.initialVariables) ? logic.initialVariables : [],
      objetivosLocales: Array.isArray(logic.objetivosLocales) ? logic.objetivosLocales.join('\n') : (logic.objetivosLocales || ''),
      recompensasLocales: Array.isArray(logic.recompensasLocales) ? logic.recompensasLocales.join('\n') : (logic.recompensasLocales || '')
    };

    this.cdr.detectChanges();
  }

  aplicarNombre() {
    const sceneData = this.mapaSvc.escenaActualData();
    if (sceneData && sceneData.scene) {
      sceneData.scene.name = this.sceneName;
      this.mapaSvc.setEscenaActualData(sceneData);
      
      // Auto-guardado en backend de nombre inmediato
      if (sceneData.scene.id) {
         this.apiSvc.actualizarPlataformaEscena(sceneData.scene.id, { name: this.sceneName }).subscribe();
      }
      this.mapaSvc.onMapChanged.next();
    }
  }

  onGravityPresetChange() {
    this.worldSettingsSvc.setGravityPreset(this.gravityPreset as any, this.gravityMagnitude);
    this.worldSettingsSvc.applyToScene(this.motor3dSvc.getScene(), (mode) => this.motor3dSvc.setVisualMode(mode));
    this.syncGravityFromSettings();
    this.mapaSvc.onMapChanged.next();
  }

  aplicarGravedadCustom() {
    if (this.gravityPreset === 'custom') {
      this.worldSettingsSvc.updateWorldSettings({
        gravityMagnitude: this.gravityMagnitude,
        gravityVector: { x: this.gravityDirX, y: this.gravityDirY, z: this.gravityDirZ }
      });
      this.worldSettingsSvc.applyToScene(this.motor3dSvc.getScene(), (mode) => this.motor3dSvc.setVisualMode(mode));
      this.syncGravityFromSettings();
      this.mapaSvc.onMapChanged.next();
    }
  }

  private syncGravityFromSettings() {
    const w = this.worldSettingsSvc.settings();
    this.gravityMagnitude = w.gravityMagnitude;
    this.gravedadY = w.gravityY;
    this.gravityDirX = w.gravityVector.x;
    this.gravityDirY = w.gravityVector.y;
    this.gravityDirZ = w.gravityVector.z;
    this.cdr.detectChanges();
  }

  // --- VARIABLES LÓGICAS ---
  get initialVariables() {
    return this.platformLogic.initialVariables;
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