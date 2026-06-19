import { Component, Input, Output, EventEmitter, OnChanges, DoCheck, KeyValueDiffers, KeyValueDiffer } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-ui-mission',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ui-mission.html',
  styleUrls: ['./ui-mission.css']
})
export class UiMission implements OnChanges, DoCheck {
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

  private differ: KeyValueDiffer<string, any>;

  constructor(private differs: KeyValueDiffers) {
    this.differ = this.differs.find({}).create();
  }

  ngOnChanges() {
    this.procesarEstadoJugador();
  }

  ngDoCheck() {
    if (this.liveUiSettings) {
      const changes = this.differ.diff(this.liveUiSettings);
      if (changes) {
        this.procesarEstadoJugador();
      }
    }
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
    let sourceSettings = this.liveUiSettings;

    if (!sourceSettings || Object.keys(sourceSettings).length === 0) {
        let epUi = this.episodio?.uiSettings || this.episodio?.episode?.uiSettings;
        if (epUi) {
            try {
                sourceSettings = typeof epUi === 'string' ? JSON.parse(epUi) : epUi;
            } catch(e) {
                sourceSettings = {};
            }
        }
    }
    sourceSettings = sourceSettings || {};

    this.ui.primaryColor = sourceSettings.primaryColor || '#ef4444';
    this.ui.bgColor = sourceSettings.bgColor || '#0f172a';
    this.ui.textColor = sourceSettings.textColor || '#cbd5e1';
    this.ui.loreQuote = sourceSettings.loreQuote || '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."';
    this.ui.loreAuthor = sourceSettings.loreAuthor || 'Anónimo';
    this.ui.initialSequence = sourceSettings.initialSequence || '';
    this.ui.overlayColor = sourceSettings.overlayColor || '#050508';
    this.ui.shadows = sourceSettings.shadows || '0 20px 50px rgba(0,0,0,0.8)';

    // 🔥 Parseo estricto para valores numéricos, previene que "0" sea ignorado y se ponga el valor fallback
    this.ui.bgOpacity = sourceSettings.bgOpacity !== undefined && sourceSettings.bgOpacity !== null ? Number(sourceSettings.bgOpacity) : 0.85;
    this.ui.overlayOpacity = sourceSettings.overlayOpacity !== undefined && sourceSettings.overlayOpacity !== null ? Number(sourceSettings.overlayOpacity) : 0.7;
    this.ui.blurIntensity = sourceSettings.blurIntensity !== undefined && sourceSettings.blurIntensity !== null ? Number(sourceSettings.blurIntensity) : 8;
    this.ui.borderRadius = sourceSettings.borderRadius !== undefined && sourceSettings.borderRadius !== null ? Number(sourceSettings.borderRadius) : 12;
    this.ui.padding = sourceSettings.padding !== undefined && sourceSettings.padding !== null ? Number(sourceSettings.padding) : 20;
    this.ui.maxWidth = sourceSettings.maxWidth !== undefined && sourceSettings.maxWidth !== null ? Number(sourceSettings.maxWidth) : 650;

    const worldState = this.playerState?.worldState || {};
    this.tieneInventario = (this.playerState?.inventory || []).length > 0;
    this.tieneMapaUnLocker = !!worldState['mapa_desbloqueado'];
    this.tieneHistoria = !!worldState['lore_desbloqueado'];

    let parsedObjetivos: string[] = [];
    if (Array.isArray(sourceSettings.objetivos)) {
      parsedObjetivos = sourceSettings.objetivos;
    } else if (typeof sourceSettings.objetivos === 'string') {
      parsedObjetivos = sourceSettings.objetivos.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    }

    if (!worldState['mision_en_curso']) {
        this.objetivosActuales = parsedObjetivos.length > 0 
          ? parsedObjetivos 
          : ['Explora el área y sobrevive.'];
    } else {
        let activeObj = worldState['objetivos_activos'];
        if (typeof activeObj === 'string') {
           activeObj = activeObj.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
        }
        this.objetivosActuales = (Array.isArray(activeObj) && activeObj.length > 0) 
          ? activeObj 
          : ['Encuentra la salida.'];
    }

    let parsedRecompensas: string[] = [];
    if (Array.isArray(sourceSettings.recompensas)) {
      parsedRecompensas = sourceSettings.recompensas;
    } else if (typeof sourceSettings.recompensas === 'string') {
      parsedRecompensas = sourceSettings.recompensas.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    }
    
    this.recompensasActuales = parsedRecompensas;
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
    return this.hexToRgba(this.ui.primaryColor, alpha);
  }
}