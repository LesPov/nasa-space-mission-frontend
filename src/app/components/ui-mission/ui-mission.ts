import { Component, Input, Output, EventEmitter, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
  @Input() liveUiSettings: any = null; 
  @Input() isPreviewOnly = false;

  @Output() onStart = new EventEmitter<void>();
  @Output() onExit = new EventEmitter<void>();
  @Output() mapaNombreChange = new EventEmitter<string>();
  @Output() mapaDescChange = new EventEmitter<string>();

  public objetivosActuales: string[] = [];
  public recompensasActuales: string[] = [];
  public tieneInventario = false;
  public tieneMapaUnLocker = false;
  public tieneHistoria = false;

  public ui: any = {
    primaryColor: '#ef4444',
    bgColor: '#0f172a',
    bgOpacity: 0.85,
    textColor: '#cbd5e1',
    loreQuote: '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."',
    loreAuthor: 'Anónimo',
    initialSequence: '',
    overlayColor: '#050508',
    overlayOpacity: 0.7,
    blurIntensity: 8,
    borderRadius: 12,
    padding: 20,
    maxWidth: 650,
    shadows: '0 20px 50px rgba(0,0,0,0.8)'
  };

  ngOnChanges() {
    this.procesarEstadoJugador();
  }

  procesarEstadoJugador() {
    const sourceSettings = this.liveUiSettings || this.episodio?.uiSettings || {};

    this.ui.primaryColor = sourceSettings.primaryColor || '#ef4444';
    this.ui.bgColor = sourceSettings.bgColor || '#0f172a';
    this.ui.bgOpacity = sourceSettings.bgOpacity ?? 0.85;
    this.ui.textColor = sourceSettings.textColor || '#cbd5e1';
    this.ui.loreQuote = sourceSettings.loreQuote || '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."';
    this.ui.loreAuthor = sourceSettings.loreAuthor || 'Anónimo';
    this.ui.initialSequence = sourceSettings.initialSequence || '';

    this.ui.overlayColor = sourceSettings.overlayColor || '#050508';
    this.ui.overlayOpacity = sourceSettings.overlayOpacity ?? 0.7;
    this.ui.blurIntensity = sourceSettings.blurIntensity ?? 8;
    this.ui.borderRadius = sourceSettings.borderRadius ?? 12;
    this.ui.padding = sourceSettings.padding ?? 20;
    this.ui.maxWidth = sourceSettings.maxWidth ?? 650;
    this.ui.shadows = sourceSettings.shadows || '0 20px 50px rgba(0,0,0,0.8)';

    const worldState = this.playerState?.worldState || {};
    this.tieneInventario = (this.playerState?.inventory || []).length > 0;
    this.tieneMapaUnLocker = !!worldState['mapa_desbloqueado'];
    this.tieneHistoria = !!worldState['lore_desbloqueado'];

    if (!worldState['mision_en_curso']) {
        this.objetivosActuales = Array.isArray(sourceSettings.objetivos) && sourceSettings.objetivos.length > 0 
          ? sourceSettings.objetivos 
          : ['Explora el área y sobrevive.'];
    } else {
        this.objetivosActuales = worldState['objetivos_activos'] || ['Encuentra la salida.'];
    }

    this.recompensasActuales = Array.isArray(sourceSettings.recompensas) ? sourceSettings.recompensas : [];
  }

  cambiarTitulo(nuevoTitulo: string) {
    if (this.episodio) {
      this.episodio.title = nuevoTitulo;
      this.mapaNombreChange.emit(nuevoTitulo);
    }
  }

  cambiarDesc(nuevaDesc: string) {
    if (this.episodio) {
      this.episodio.description = nuevaDesc;
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
    return this.hexToRgba(this.ui.primaryColor, alpha);
  }
}