
import { Component, Input, Output, EventEmitter, OnChanges, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorldSettingsService } from '../../core/engine/world/world-settings.service';
import { MissionManagerSystem } from '../../core/engine/runtime/systems/mission-manager.system';

@Component({
  selector: 'app-ui-mission',
  standalone: true,
  imports: [CommonModule],
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

  private worldSettingsSvc = inject(WorldSettingsService);
  public missionManager = inject(MissionManagerSystem);

  public tieneInventario = false;
  public tieneMapaUnLocker = false;
  public tieneHistoria = false;

  public ui = computed(() => {
    const s = this.worldSettingsSvc.uiSettings();
    return {
      missionTitle: s.missionTitle || 'Misión Principal',
      missionDescription: s.missionDescription || 'Explora y sobrevive.',
      primaryColor: s.primaryColor || '#ef4444',
      bgColor: s.bgColor || '#0f172a',
      bgOpacity: Number.isFinite(Number(s.bgOpacity)) ? Number(s.bgOpacity) : 0.85,
      textColor: s.textColor || '#cbd5e1',
      loreQuote: s.loreQuote || '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."',
      loreAuthor: s.loreAuthor || 'Control de Misión',
      overlayColor: s.overlayColor || '#050508',
      overlayOpacity: Number.isFinite(Number(s.overlayOpacity)) ? Number(s.overlayOpacity) : 0.7,
      blurIntensity: Number.isFinite(Number(s.blurIntensity)) ? Number(s.blurIntensity) : 8,
      borderRadius: Number.isFinite(Number(s.borderRadius)) ? Number(s.borderRadius) : 12,
      padding: 20,
      maxWidth: 650,
      shadows: '0 20px 50px rgba(0,0,0,0.8)'
    };
  });

  public objetivos = computed(() => {
     const s = this.worldSettingsSvc.uiSettings();
     return Array.isArray(s.objetivos) ? s.objetivos : [];
  });

  public recompensas = computed(() => {
     const s = this.worldSettingsSvc.uiSettings();
     return Array.isArray(s.recompensas) ? s.recompensas : [];
  });

  public requisitos = computed(() => {
     const s = this.worldSettingsSvc.uiSettings();
     return Array.isArray(s.requisitos) ? s.requisitos : [];
  });

  ngOnChanges() {
    this.procesarEstadoJugador();
  }

  // 🔥 FIX CRÍTICO: La fuente de verdad del Título Global del Episodio inyectado desde EditorOrchestrator
  get episodeTitle(): string {
    return this.episodio?.episode?.title || this.episodio?.title || 'EPISODIO DESCONOCIDO';
  }

  // 🔥 FIX CRÍTICO: La fuente de verdad del Nombre de la Plataforma (SceneName)
  get platformName(): string {
    return this.episodio?.scene?.name || 'ZONA ACTUAL';
  }

  get episodeThumbnail(): string {
    return this.episodio?.episode?.thumbnailUrl || this.episodio?.thumbnailUrl || '';
  }

  procesarEstadoJugador() {
    const ws = this.playerState?.worldState || {};
    const globalState = ws.schemaVersion === 2 ? ws.global : ws;
    
    this.tieneInventario = (this.playerState?.inventory || []).length > 0;
    this.tieneMapaUnLocker = !!globalState['mapa_desbloqueado'];
    this.tieneHistoria = !!globalState['lore_desbloqueado'];
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