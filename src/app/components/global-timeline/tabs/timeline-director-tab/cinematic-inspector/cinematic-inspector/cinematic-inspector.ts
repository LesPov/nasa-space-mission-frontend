
import { Component, Input, Output, EventEmitter, inject, OnChanges, SimpleChanges, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CinematicKeyframe, CinematicSequence, CinematicTrack } from '../../../../../../core/engine/models/cinematic.model';
import { CinematicCameraDefinition } from '../../../../../../core/engine/models/cinematic-camera.model';
import { CinematicCameraRegistryService } from '../../../../../../core/engine/runtime/cameras/cinematic-camera-registry.service';
import { EditorCinematicToolsService } from '../../../../../../services/editor-cinematic-tools.service';
import { CinematicLogger, CINEMATIC_DEBUG } from '../../../../../../core/engine/runtime/cinematics/cinematic-logger';
import { EpisodiosService } from '../../../../../../services/api/episodios';

@Component({
  selector: 'app-cinematic-inspector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cinematic-inspector.html',
  styleUrls: ['./cinematic-inspector.css']
})
export class CinematicInspector implements OnChanges, OnInit {
  @Input() cinematic: CinematicSequence | null = null;
  @Input() track: CinematicTrack | null = null;
  @Input() keyframe: CinematicKeyframe | null = null;
  @Input() reusableCamera: CinematicCameraDefinition | null = null;
  @Input() sceneEntities: {uid: string, name: string}[] = [];

  @Output() propertyChanged = new EventEmitter<void>();
  @Output() timeChanged = new EventEmitter<void>();
  @Output() transformChanged = new EventEmitter<void>();
  @Output() actionDeleteCinematic = new EventEmitter<void>();
  @Output() actionDeleteTrack = new EventEmitter<void>();
  @Output() actionDeleteKeyframe = new EventEmitter<string>();
  @Output() actionCapturePosRot = new EventEmitter<any>();

  private cinematicTools = inject(EditorCinematicToolsService);
  private cameraRegistry = inject(CinematicCameraRegistryService);
  private epiApiSvc = inject(EpisodiosService);

  public isKeyframe = false;
  public isTrack = false;
  public isCamera = false;
  public isCinematic = false;
  
  public localName = '';
  public fovDeg = 45;
  public durationToNext = 'Fin de pista';
  public transitionWarning: string | null = null;

  public listaAssets: any[] = [];
  public archivoSubida: File | null = null;
  public subiendoAsset = false;

  private oldTimeMs: number = 0;

  get reusableCameras() { return this.cameraRegistry.listCameras(); }

  ngOnInit() {
    this.cargarAssets();
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.isKeyframe = !!this.keyframe;
    this.isTrack = !this.isKeyframe && !!this.track;
    this.isCamera = !this.isKeyframe && !this.isTrack && !!this.reusableCamera;
    this.isCinematic = !this.isKeyframe && !this.isTrack && !this.isCamera && !!this.cinematic;

    if (this.isKeyframe && this.keyframe) {
       this.oldTimeMs = this.keyframe.timeMs;

       if (this.track?.type === 'camera' || this.track?.type === 'actor' || this.track?.type === 'object') {
           const fovRad = this.keyframe.value.fov !== undefined ? this.keyframe.value.fov : 0.8;
           this.fovDeg = Math.round(fovRad * 180 / Math.PI);
           
           if (!this.keyframe.value.movementMode) this.keyframe.value.movementMode = 'linear';
           if (!this.keyframe.value.orientationMode) this.keyframe.value.orientationMode = 'free';
           
           if (!this.keyframe.value.targetUid && this.keyframe.value.cameraTargetUid) {
               this.keyframe.value.targetUid = this.keyframe.value.cameraTargetUid;
           }
       } else if (this.track?.type === 'background') {
           if (this.keyframe.value.opacity === undefined) this.keyframe.value.opacity = 1;
           if (!this.keyframe.value.bgType) this.keyframe.value.bgType = 'SOLID';
           if (!this.keyframe.value.bgColor) this.keyframe.value.bgColor = '#000000';
           if (!this.keyframe.value.animIn) this.keyframe.value.animIn = 'FADE_IN';
           if (!this.keyframe.value.animOut) this.keyframe.value.animOut = 'FADE_OUT';
           if (this.keyframe.value.fadeInMs === undefined) this.keyframe.value.fadeInMs = 1000;
           if (this.keyframe.value.fadeOutMs === undefined) this.keyframe.value.fadeOutMs = 1000;
       } else if (this.track?.type === 'text' || this.track?.type === 'image' || this.track?.type === 'overlay') {
           if (this.keyframe.value.opacity === undefined) this.keyframe.value.opacity = 1;
           if (this.keyframe.value.scale === undefined) this.keyframe.value.scale = 1;
           if (!this.keyframe.value.bgType) this.keyframe.value.bgType = 'NONE';
           // 🔥 FIX: Aseguramos que los valores iniciales de Color y Radio existan para prevenir undefined en el CSS
           if (!this.keyframe.value.bgColor) this.keyframe.value.bgColor = '#000000';
           if (!this.keyframe.value.gradientColorB) this.keyframe.value.gradientColorB = '#000000';
           if (this.keyframe.value.bgRadius === undefined) this.keyframe.value.bgRadius = 50;
           if (this.keyframe.value.bgCenterX === undefined) this.keyframe.value.bgCenterX = 50;
           if (this.keyframe.value.bgCenterY === undefined) this.keyframe.value.bgCenterY = 50;

           if (this.keyframe.value.positionX === undefined) this.keyframe.value.positionX = 0.5;
           if (this.keyframe.value.positionY === undefined) this.keyframe.value.positionY = 0.5;
           if (!this.keyframe.value.anchor) this.keyframe.value.anchor = 'CENTER';
           if (!this.keyframe.value.animIn) this.keyframe.value.animIn = 'FADE_IN';
           if (!this.keyframe.value.animOut) this.keyframe.value.animOut = 'FADE_OUT';
           if (this.keyframe.value.fadeInMs === undefined) this.keyframe.value.fadeInMs = 500;
           if (this.keyframe.value.fadeOutMs === undefined) this.keyframe.value.fadeOutMs = 500;
           
           if (this.track.type === 'image') {
               if (!this.keyframe.value.fitMode) this.keyframe.value.fitMode = 'CONTAIN';
               if (this.keyframe.value.maxWidth === undefined) this.keyframe.value.maxWidth = 800;
               if (this.keyframe.value.maxHeight === undefined) this.keyframe.value.maxHeight = 800;
           }
           
           if (this.keyframe.value.fullscreenBg === undefined) this.keyframe.value.fullscreenBg = false;
       }

       this.calculateDuration();
    } else if (this.isCamera && this.reusableCamera) {
       this.localName = this.reusableCamera.name;
       const fovRad = this.reusableCamera.fov !== undefined ? this.reusableCamera.fov : 0.8;
       this.fovDeg = Math.round(fovRad * 180 / Math.PI);
    }
    
    this.validateTransitions();
  }

  cargarAssets() {
    this.epiApiSvc.obtenerAssets().subscribe({
      next: (res) => {
        this.listaAssets = res.filter((a:any) => 
          a.type === 'texture_png' || a.type === 'texture_jpg' || 
          a.path.endsWith('.png') || a.path.endsWith('.jpg') || a.path.endsWith('.jpeg')
        );
      }
    });
  }

  seleccionarArchivoSubida(event: any) {
    if (event.target.files && event.target.files.length > 0) {
      this.archivoSubida = event.target.files[0];
    }
  }

  subirNuevoAsset() {
    if (!this.archivoSubida) return;
    this.subiendoAsset = true;
    this.epiApiSvc.subirAsset(this.archivoSubida).subscribe({
      next: (res) => {
        this.subiendoAsset = false;
        this.archivoSubida = null;
        this.cargarAssets();
        
        if (this.isKeyframe && this.keyframe && (this.track?.type === 'image' || this.track?.type === 'overlay')) {
            this.keyframe.value.assetId = res.id;
            this.keyframe.value.image = 'http://localhost:4000' + res.path;
            this.onTransformChange();
        }
      },
      error: () => {
        this.subiendoAsset = false;
        alert('Error al subir imagen. Revisa la consola.');
      }
    });
  }
  
  onAssetChange() {
      if (this.isKeyframe && this.keyframe && (this.track?.type === 'image' || this.track?.type === 'overlay')) {
          const asset = this.listaAssets.find(a => a.id === this.keyframe!.value.assetId);
          if (asset) {
              this.keyframe.value.image = 'http://localhost:4000' + asset.path;
              CinematicLogger.logOverlay('assetChanged', asset.path);
          } else {
              this.keyframe.value.image = '';
              CinematicLogger.logOverlay('assetChanged', 'none');
          }
          this.onTransformChange();
      }
  }

  private calculateDuration(): void {
    if (this.track && this.keyframe) {
       const sorted = [...this.track.keyframes].sort((a:any, b:any) => a.timeMs - b.timeMs);
       const idx = sorted.findIndex(k => k.id === this.keyframe!.id);
       if (idx >= 0 && idx < sorted.length - 1) {
           this.durationToNext = (sorted[idx + 1].timeMs - sorted[idx].timeMs) + ' ms';
       } else {
           this.durationToNext = 'Fin de pista';
       }
    }
  }

  validateTransitions() {
     this.transitionWarning = null;
     if (this.track) {
         const sorted = [...this.track.keyframes].sort((a,b) => a.timeMs - b.timeMs);
         for (let i = 0; i < sorted.length - 1; i++) {
             if (sorted[i+1].timeMs - sorted[i].timeMs > 60000) {
                 this.transitionWarning = `El tramo entre los Keyframes excede 60s (60000ms). Crea un Keyframe intermedio para mantener la estabilidad del motor.`;
                 break;
             }
         }
     }
  }

  onPropChange() { this.propertyChanged.emit(); }
  
  onTimeChange() { 
      if (this.isKeyframe && this.keyframe && this.cinematic) {
         if (this.keyframe.timeMs < 0) this.keyframe.timeMs = 0;
         
         if (this.keyframe.timeMs > 300000) {
             CinematicLogger.logWarningExceedsMax(this.keyframe.timeMs);
             alert("El tiempo máximo de la Cinematic es 05:00 (300000ms).");
             this.keyframe.timeMs = 300000;
         }

         if (this.keyframe.timeMs !== this.oldTimeMs) {
             CinematicLogger.logTimeChanged(this.oldTimeMs, this.keyframe.timeMs);
             this.oldTimeMs = this.keyframe.timeMs;
         }
         
         if (this.keyframe.timeMs > this.cinematic.durationMs) {
             CinematicLogger.logAutoExpand(this.cinematic.durationMs, this.keyframe.timeMs);
             this.cinematic.durationMs = this.keyframe.timeMs;
         }
         
         this.calculateDuration();
         this.validateTransitions();
         this.timeChanged.emit();
      }
  }
  
  onTransformChange() { 
      if (this.isKeyframe && this.keyframe) {
          if (!this.keyframe.value) this.keyframe.value = {};
      }
      this.transformChanged.emit(); 
  }

  onCamChange() {
    if (this.reusableCamera) {
      if (this.reusableCamera.fov !== undefined) {
          if (this.reusableCamera.fov < 0.1) this.reusableCamera.fov = 0.1;
          if (this.reusableCamera.fov > Math.PI) this.reusableCamera.fov = Math.PI;
      }
      this.cameraRegistry.registerCamera(this.reusableCamera);
      this.transformChanged.emit();
    }
  }

  onFovChange() {
    let rads = this.fovDeg * Math.PI / 180;
    if (rads < 0.1) rads = 0.1;
    if (rads > Math.PI) rads = Math.PI;

    if (this.isKeyframe && this.keyframe) {
      if (!this.keyframe.value) this.keyframe.value = {};
      this.keyframe.value.fov = rads;
    } else if (this.reusableCamera) {
      this.reusableCamera.fov = rads;
    }
    this.transformChanged.emit();
  }

  onCinematicDurationChange() {
    if (this.cinematic) {
      if (this.cinematic.durationMs > 300000) {
          CinematicLogger.logWarningExceedsMax(this.cinematic.durationMs);
          alert("El tiempo máximo de la Cinematic es 05:00 (300000ms).");
          this.cinematic.durationMs = 300000;
      }
      
      const maxKfTime = this.getMaxKeyframeTime();
      if (this.cinematic.durationMs < maxKfTime) {
          const proceed = confirm(`Advertencia: Existen Keyframes (en ${maxKfTime}ms) fuera de la nueva duración (${this.cinematic.durationMs}ms). La cinemática terminará antes de alcanzarlos. ¿Deseas continuar?`);
          if (!proceed) {
              this.cinematic.durationMs = maxKfTime;
          }
      }
      
      if(CINEMATIC_DEBUG) console.log(`[CinematicTimeline] duration=${this.cinematic.durationMs}`);
      
      this.propertyChanged.emit();
    }
  }

  getMaxKeyframeTime(): number {
      let max = 0;
      this.cinematic?.tracks.forEach(t => {
          t.keyframes.forEach(kf => {
              if (kf.timeMs > max) max = kf.timeMs;
          });
      });
      return max;
  }

  deleteKeyframe() { 
      if (this.keyframe) {
          this.actionDeleteKeyframe.emit(this.keyframe.id); 
      }
  }
  
  captureTransform() { this.actionCapturePosRot.emit(this.keyframe); }

  captureCamera(id: string) {
    this.cinematicTools.capturarPosRotCamaraCinematica(id);
    this.transformChanged.emit();
  }

  enterCamera(id: string) { this.cinematicTools.entrarCamaraCinematica(id); }
  exitCamera() { this.cinematicTools.salirCamaraCinematica(); }
  isInsideCamera(id: string) { return this.cinematicTools.isInsideCamera && this.cinematicTools.activeCinematicCameraId === id; }

  enterCameraKf() { this.cinematicTools.entrarCamara(this.keyframe); }
  exitCameraKf() { this.cinematicTools.salirCamara(); }
  isInsideCameraKf() { return this.cinematicTools.isInsideCamera && !this.cinematicTools.activeCinematicCameraId; }
}