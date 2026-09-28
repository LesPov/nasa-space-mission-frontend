import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

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
  styleUrls: ['./prop-mission.css']
})
export class PropMission implements OnInit, OnDestroy {
  public editorSvc = inject(EditorMapaService);
  private worldSettingsSvc = inject(WorldSettingsService);
  private epiApiSvc = inject(EpisodiosService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  public seccionActiva: 'aerospace' | 'ui' | 'metadata' = 'metadata';

  public missionProfile: MissionProfileDto | null = null;
  public cargandoProfile = false;
  public statusMensaje = '';

  public uiSettings: any = {};
  public episodeTitle = '';
  public episodeDescription = '';

  get currentEpisode() {
    return this.editorSvc.episodioActualData();
  }

  get currentEpisodeId(): number | null {
    return this.currentEpisode?.id || null;
  }

  ngOnInit() {
    this.leerMetadataEpisodio();
    this.leerEstadoUI();
    this.cargarPerfilMision();
    
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => {
         // Silencioso para evitar parpadeos si se editó desde otro lado
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
  }

  public aplicarMetadataEpisodio() {
    const ep = this.currentEpisode;
    if (ep) {
        ep.title = this.episodeTitle;
        ep.description = this.episodeDescription;
        this.editorSvc.setEpisodioActualData(ep);
        this.marcarModificado();
    }
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
      components: [
        {
          id: 'prop-ion-01',
          type: 'propulsion',
          name: 'Propulsor Iónico NEXT-C',
          manufacturer: 'Aerojet Rocketdyne',
          status: 'NOMINAL',
          health: 100,
          specifications: { thrustKn: 0.236, specificImpulseSec: 4190 },
          configuration: { throttle: 100 }
        },
        {
          id: 'pwr-solar-01',
          type: 'power',
          name: 'Paneles Solares Ultraflex',
          manufacturer: 'Northrop Grumman',
          status: 'NOMINAL',
          health: 100,
          specifications: { powerGenerationWatts: 15000 },
          configuration: { autoTracking: true }
        }
      ]
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
    this.editorSvc.onMapChanged.next();
  }

  public agregarComponenteDefecto() {
    if (!this.missionProfile) return;
    if (!this.missionProfile.components) this.missionProfile.components = [];

    const newComp: SpacecraftComponentDto = {
      id: 'comp_' + Math.random().toString(36).substring(2, 7),
      type: 'avionics',
      name: 'Módulo de Navegación Computarizada',
      manufacturer: 'Honeywell Aerospace',
      status: 'NOMINAL',
      health: 100,
      specifications: { bandwidthMbps: 1000 },
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
      objetivos: s.objetivos.join('\n'),
      recompensas: s.recompensas.join('\n'),
      requisitos: (s.requisitos || []).join('\n')
    };
    this.cdr.detectChanges();
  }

  aplicarCambiosUI() {
    const objStr = typeof this.uiSettings.objetivos === 'string' ? this.uiSettings.objetivos : (this.uiSettings.objetivos as any).join('\n');
    const recStr = typeof this.uiSettings.recompensas === 'string' ? this.uiSettings.recompensas : (this.uiSettings.recompensas as any).join('\n');
    const reqStr = typeof this.uiSettings.requisitos === 'string' ? this.uiSettings.requisitos : (this.uiSettings.requisitos || []).join('\n');

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

    const epiData = this.editorSvc.episodioActualData();
    if (epiData) {
      epiData.uiSettings = newSettings;
    }

    this.editorSvc.onMapChanged.next(); 
  }
}