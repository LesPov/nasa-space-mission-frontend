import { Component, Input, Output, EventEmitter, OnChanges, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WorldSettingsService } from '../../core/engine/world/world-settings.service';

@Component({
  selector: 'app-ui-mission',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ui-mission.html',
  styleUrls: ['./ui-mission.css']
})
export class UiMission implements OnChanges {
  @Input() episodio: any = null; 
  @Input() playerState: any = null; 
  @Input() misionIniciada = false;
  @Input() cerrando = false;
  @Input() isDebugMode = false;
  @Input() isPreviewOnly = false;

  @Output() onStart = new EventEmitter<void>();
  @Output() onExit = new EventEmitter<void>();
  @Output() mapaNombreChange = new EventEmitter<string>();
  @Output() mapaDescChange = new EventEmitter<string>();

  private worldSettingsSvc = inject(WorldSettingsService);

  public tieneInventario = false;
  public tieneMapaUnLocker = false;
  public tieneHistoria = false;

  public ui = computed(() => {
    const s = this.worldSettingsSvc.uiSettings();
    return {
      primaryColor: s.primaryColor || '#ef4444',
      bgColor: s.bgColor || '#0f172a',
      bgOpacity: Number.isFinite(Number(s.bgOpacity)) ? Number(s.bgOpacity) : 0.85,
      textColor: s.textColor || '#cbd5e1',
      loreQuote: s.loreQuote || '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."',
      loreAuthor: s.loreAuthor || 'Anónimo',
      initialSequence: s.initialSequence || '',
      overlayColor: s.overlayColor || '#050508',
      overlayOpacity: Number.isFinite(Number(s.overlayOpacity)) ? Number(s.overlayOpacity) : 0.7,
      blurIntensity: Number.isFinite(Number(s.blurIntensity)) ? Number(s.blurIntensity) : 8,
      borderRadius: Number.isFinite(Number(s.borderRadius)) ? Number(s.borderRadius) : 12,
      padding: 20,
      maxWidth: 650,
      shadows: '0 20px 50px rgba(0,0,0,0.8)'
    };
  });

  public logicSettings = computed(() => this.worldSettingsSvc.settings().logicSettings || {});

  public objetivosLocales = computed(() => {
     const val = this.logicSettings().objetivosLocales;
     if (!val) return [];
     if (Array.isArray(val)) return val;
     return val.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  });

  public recompensasLocales = computed(() => {
     const val = this.logicSettings().recompensasLocales;
     if (!val) return [];
     if (Array.isArray(val)) return val;
     return val.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
  });

  public objetivosGlobales = computed(() => {
     const s = this.worldSettingsSvc.uiSettings();
     const ws = this.playerState?.worldState || {};
     const episodeState = ws.schemaVersion === 2 ? ws.episode : ws;
     const globalState = ws.schemaVersion === 2 ? ws.global : ws;

     if (episodeState['mision_en_curso'] || globalState['mision_en_curso']) {
        let activeObj = episodeState['objetivos_activos'] || globalState['objetivos_activos'];
        if (typeof activeObj === 'string') {
           activeObj = activeObj.split('\n').map((str: string) => str.trim()).filter((str: string) => str.length > 0);
        }
        if (Array.isArray(activeObj) && activeObj.length > 0) return activeObj;
     }

     if (Array.isArray(s.objetivos) && s.objetivos.length > 0) return s.objetivos;
     return ['Explora el área y sobrevive.'];
  });

  public recompensasGlobales = computed(() => {
     const s = this.worldSettingsSvc.uiSettings();
     return Array.isArray(s.recompensas) ? s.recompensas : [];
  });

  public requisitosGlobales = computed(() => {
     const s = this.worldSettingsSvc.uiSettings();
     return Array.isArray(s.requisitos) ? s.requisitos : [];
  });

  ngOnChanges() {
    this.procesarEstadoJugador();
  }

  get episodeTitle(): string {
    return this.episodio?.title || this.episodio?.episode?.title || 'EPISODIO DESCONOCIDO';
  }

  get episodeDescription(): string {
    return this.episodio?.description || this.episodio?.episode?.description || 'No hay descripción disponible. Explora bajo tu propio riesgo.';
  }

  get episodeThumbnail(): string {
    return this.episodio?.thumbnailUrl || this.episodio?.episode?.thumbnailUrl || '';
  }

  procesarEstadoJugador() {
    const ws = this.playerState?.worldState || {};
    const globalState = ws.schemaVersion === 2 ? ws.global : ws;
    
    this.tieneInventario = (this.playerState?.inventory || []).length > 0;
    this.tieneMapaUnLocker = !!globalState['mapa_desbloqueado'];
    this.tieneHistoria = !!globalState['lore_desbloqueado'];
  }

  cambiarTitulo(nuevoTitulo: string) {
    if (this.episodio) {
      if (this.episodio.episode) {
        this.episodio.episode.title = nuevoTitulo;
      } else {
        this.episodio.title = nuevoTitulo;
      }
      this.mapaNombreChange.emit(nuevoTitulo);
    }
  }

  cambiarDesc(nuevaDesc: string) {
    if (this.episodio) {
      if (this.episodio.episode) {
        this.episodio.episode.description = nuevaDesc;
      } else {
        this.episodio.description = nuevaDesc;
      }
      this.mapaDescChange.emit(nuevaDesc);
    }
  }

  hexToRgba(hex: string, alpha: number): string {
    if (!hex) return `rgba(5, 5, 8, ${alpha})`;
    const cleanHex = hex.replace('#', '');
    if (cleanHex.length !== 6 && cleanHex.length !== 3) return `rgba(5, 5, 8, ${alpha})`;
    
    let r, g, b;
    if (cleanHex.length === 3) {
      r = parseInt(cleanHex[0] + cleanHex[0], 16);
      g = parseInt(cleanHex[1] + cleanHex[1], 16);
      b = parseInt(cleanHex[2] + cleanHex[2], 16);
    } else {
      r = parseInt(cleanHex.substring(0, 2), 16);
      g = parseInt(cleanHex.substring(2, 4), 16);
      b = parseInt(cleanHex.substring(4, 6), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  getPrimaryColorWithAlpha(alpha: number): string {
    return this.hexToRgba(this.ui().primaryColor, alpha);
  }
}