import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { WorldSettingsService } from '../../../../core/engine/world/world-settings.service';
import { 
  MissionProfileDto, 
  CreateMissionProfileDto, 
  SpacecraftComponentDto,
  MissionStatus
} from '../../../../core/engine/models/api-dto.model';
import { EpisodiosService } from '../../../../services/api/episodios';

@Component({
  selector: 'app-prop-mission',
  standalone: true, 
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-mission.html',
  styleUrls: ['../inspector-properties.css']
})
export class PropMission implements OnInit, OnDestroy {
  public editorSvc = inject(EditorMapaService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private epiApiSvc = inject(EpisodiosService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];
  
  private episodeSaveSubject = new Subject<void>();

  public seccionActiva: 'mission' | 'ui' | 'metadata' | 'aerospace' = 'mission';

  public missionProfile: MissionProfileDto | null = null;
  public cargandoProfile = false;
  public statusMensaje = '';

  public uiSettings: any = {};
  public episodeTitle = '';
  public episodeDescription = '';
  public sceneName = '';

  private lastSceneId: number | null = null;

  get currentEpisode() {
    return this.editorSvc.episodioActualData();
  }

  get currentScene() {
    return this.editorSvc.escenaActualData();
  }

  get currentEpisodeId(): number | null {
    return this.currentEpisode?.id || null;
  }

  constructor() {
    // 🔥 EFECTO REACTIVO 1: Actualización instantánea al cambiar de Plataforma (Escena)
    // El 'effect' de Angular se ejecutará automáticamente si this.editorSvc.escenaIdActiva() cambia.
    effect(() => {
      const sceneId = this.editorSvc.escenaIdActiva();
      
      untracked(() => {
        if (sceneId !== this.lastSceneId) {
          this.lastSceneId = sceneId;
          
          // Damos un respiro asíncrono de 50ms para que el CoreSceneLoaderService
          // haya finalizado por completo la carga de datos en el WorldSettingsService
          setTimeout(() => {
            this.leerMetadataEpisodio();
            this.leerEstadoUI();
            this.cargarPerfilMision();
          }, 50);
        }
      });
    });
  }

  ngOnInit() {
    // Nota: Las lecturas iniciales ahora están orquestadas por el effect() superior
    
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => {
         // Mantener la reactividad ante otras mutaciones menores sin resetear el binding de inputs
         this.cdr.detectChanges();
      }),
      
      this.episodeSaveSubject.pipe(
        debounceTime(1000)
      ).subscribe(() => {
        this.guardarMetadataEpisodioEnBackend();
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  public leerMetadataEpisodio() {
    const ep = this.currentEpisode;
    if (ep) {
        this.episodeTitle = ep.title || '';
        this.episodeDescription = ep.description || '';
    }
    
    const sc = this.currentScene;
    if (sc) {
        this.sceneName = sc.scene?.name || 'Zona actual';
    }
    this.cdr.detectChanges();
  }

  public aplicarMetadataEpisodio() {
    const ep = this.currentEpisode;
    if (ep) {
        ep.title = this.episodeTitle;
        ep.description = this.episodeDescription;
        this.editorSvc.setEpisodioActualData(ep);
        
        this.episodeSaveSubject.next();
    }
  }

  private guardarMetadataEpisodioEnBackend() {
      const epId = this.currentEpisodeId;
      if (!epId) return;

      this.epiApiSvc.actualizarEpisodio(epId, {
          title: this.episodeTitle,
          description: this.episodeDescription
      }).subscribe({
          next: () => console.log('Metadata del episodio guardada.'),
          error: (e) => console.error('Error guardando metadata del episodio', e)
      });
  }

  public cargarPerfilMision() {
    const epId = this.currentEpisodeId;
    if (!epId) return;

    this.cargandoProfile = true;
    this.epiApiSvc.obtenerMissionProfile(epId).subscribe({
      next: (profile) => {
        this.missionProfile = profile;
        this.cargandoProfile = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.missionProfile = null;
        this.cargandoProfile = false;
        this.cdr.detectChanges();
      }
    });
  }

  public inicializarPerfilPorDefecto() {
    const epId = this.currentEpisodeId;
    if (!epId) return;

    const defaultProfile: CreateMissionProfileDto = {
      missionName: this.currentEpisode?.title || 'Misión Exploratoria',
      missionCode: `MIS-${epId.toString().padStart(3, '0')}`,
      description: 'Misión de exploración orbital y despliegue técnico.',
      missionStatus: 'PLANNING',
      currentPhase: 'Fase Inicial de Ingeniería',
      completionPercentage: 0,
      assignedBudget: 50000000,
      spentBudget: 0,
      spacecraftName: 'Orbital Scout-I',
      spacecraftModel: 'Surveyor Class Mk-1',
      spacecraftMassKg: 12500,
      spacecraftPowerWatts: 45000,
      spacecraftFuelCapacityKg: 8000,
      components: []
    };

    this.cargandoProfile = true;
    this.epiApiSvc.crearMissionProfile(epId, defaultProfile).subscribe({
      next: (created) => {
        this.missionProfile = created;
        this.cargandoProfile = false;
        this.statusMensaje = '✅ Ficha de misión creada y persistida';
        this.cdr.detectChanges();
        setTimeout(() => this.statusMensaje = '', 3000);
      },
      error: (err) => {
        this.cargandoProfile = false;
        alert('Error al inicializar el perfil de misión: ' + (err.error?.msg || err.message));
      }
    });
  }

  public recalcularPresupuesto() {
    if (!this.missionProfile) return;
    const assigned = Number(this.missionProfile.assignedBudget) || 0;
    const spent = Number(this.missionProfile.spentBudget) || 0;
    this.missionProfile.remainingBudget = Math.max(0, assigned - spent);
    this.marcarModificado();
  }

  public marcarModificado() {
    // Si cambian cosas aeroespaciales que no son de UI, solo preparamos para Guardar Perfil manualmente
  }

  public agregarComponenteDefecto() {
    if (!this.missionProfile) return;
    if (!this.missionProfile.components) this.missionProfile.components = [];

    const newComp: SpacecraftComponentDto = {
      id: 'comp_' + Math.random().toString(36).substring(2, 7),
      type: 'avionics',
      name: 'Módulo de Navegación',
      manufacturer: 'Honeywell Aerospace',
      status: 'NOMINAL',
      health: 100,
      specifications: {},
      configuration: {}
    };

    this.missionProfile.components.push(newComp);
    this.marcarModificado();
  }

  public quitarComponente(index: number) {
    if (!this.missionProfile || !this.missionProfile.components) return;
    this.missionProfile.components.splice(index, 1);
    this.marcarModificado();
  }

  public guardarPerfilEnServidor() {
    const epId = this.currentEpisodeId;
    if (!epId || !this.missionProfile) return;

    this.statusMensaje = 'Guardando perfil...';
    this.epiApiSvc.actualizarMissionProfile(epId, this.missionProfile).subscribe({
      next: (res) => {
        this.missionProfile = res;
        this.statusMensaje = '✅ Perfil guardado correctamente';
        this.cdr.detectChanges();
        setTimeout(() => this.statusMensaje = '', 3000);
      },
      error: (err) => {
        this.statusMensaje = '❌ Error al guardar';
        alert('Error guardando perfil: ' + (err.error?.msg || err.message));
      }
    });
  }

  public getStatusColor(status: MissionStatus): string {
    switch (status) {
      case 'PLANNING': return '#94a3b8';
      case 'PRE_LAUNCH': return '#facc15';
      case 'IN_FLIGHT': return '#3b82f6';
      case 'ORBIT_INSERTION': return '#c084fc';
      case 'LANDED': return '#22c55e';
      case 'COMPLETED': return '#10b981';
      case 'ABORTED': return '#ef4444';
      default: return '#3b82f6';
    }
  }

  leerEstadoUI() {
    const s = this.worldSettingsSvc.uiSettings();
    this.uiSettings = {
      ...s,
      objetivos: Array.isArray(s.objetivos) ? s.objetivos.join('\n') : (s.objetivos || ''),
      recompensas: Array.isArray(s.recompensas) ? s.recompensas.join('\n') : (s.recompensas || ''),
      requisitos: Array.isArray(s.requisitos) ? s.requisitos.join('\n') : (s.requisitos || '')
    };
    this.cdr.detectChanges();
  }

  aplicarCambiosUI() {
    const objStr = typeof this.uiSettings.objetivos === 'string' ? this.uiSettings.objetivos : '';
    const recStr = typeof this.uiSettings.recompensas === 'string' ? this.uiSettings.recompensas : '';
    const reqStr = typeof this.uiSettings.requisitos === 'string' ? this.uiSettings.requisitos : '';

    const objetivosArray = objStr.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    const recompensasArray = recStr.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    const requisitosArray = reqStr.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);

    const newSettings = {
      ...this.uiSettings,
      bgOpacity: Number(this.uiSettings.bgOpacity),
      overlayOpacity: Number(this.uiSettings.overlayOpacity),
      blurIntensity: Number(this.uiSettings.blurIntensity),
      borderRadius: Number(this.uiSettings.borderRadius),
      objetivos: objetivosArray,
      recompensas: recompensasArray,
      requisitos: requisitosArray
    };

    this.worldSettingsSvc.updateUiSettings(newSettings);

    const escenaActual = this.editorSvc.escenaActualData();
    if (escenaActual && escenaActual.scene) {
        escenaActual.scene.uiSettings = newSettings;
    }

    this.editorSvc.onMapChanged.next(); 
  }
}