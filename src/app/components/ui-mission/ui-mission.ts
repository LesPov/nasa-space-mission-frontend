
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
  @Input() isPreviewOnly = false; // 🔥 NUEVO: Indica si solo es una vista previa del editor

  @Output() onStart = new EventEmitter<void>();
  @Output() onExit = new EventEmitter<void>();
  @Output() mapaNombreChange = new EventEmitter<string>();
  @Output() mapaDescChange = new EventEmitter<string>();

  public objetivosActuales: string[] = [];
  public tieneInventario = false;
  public tieneMapaUnLocker = false;
  public tieneHistoria = false;

  public ui = {
    primaryColor: '#ef4444',
    bgColor: 'rgba(15, 23, 42, 0.95)',
    textColor: '#cbd5e1',
    loreQuote: '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."',
    loreAuthor: 'Anónimo',
    initialSequence: ''
  };

  ngOnChanges() {
    this.procesarEstadoJugador();
  }

  procesarEstadoJugador() {
    const sourceSettings = this.liveUiSettings || this.episodio?.uiSettings || {};

    this.ui.primaryColor = sourceSettings.primaryColor || '#ef4444';
    this.ui.bgColor = sourceSettings.bgColor || 'rgba(15, 23, 42, 0.95)';
    this.ui.textColor = sourceSettings.textColor || '#cbd5e1';
    this.ui.loreQuote = sourceSettings.loreQuote || '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."';
    this.ui.loreAuthor = sourceSettings.loreAuthor || 'Anónimo';
    this.ui.initialSequence = sourceSettings.initialSequence || '';

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

  getPrimaryColorWithAlpha(alpha: number): string {
    const hex = this.ui.primaryColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) || 239;
    const g = parseInt(hex.substring(2, 4), 16) || 68;
    const b = parseInt(hex.substring(4, 6), 16) || 68;
    return `rgba(${r},${g},${b},${alpha})`;
  }
}