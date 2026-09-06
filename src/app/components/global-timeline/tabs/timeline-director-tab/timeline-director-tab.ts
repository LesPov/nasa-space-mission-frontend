
import { Component, ChangeDetectorRef, inject, OnInit, OnDestroy, effect, untracked, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Tags } from '@babylonjs/core';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { EditorCinematicService } from '../../../../services/editor/editor-cinematic.service';
import { CinematicSequence, CinematicTrack, CinematicKeyframe } from '../../../../core/engine/models/cinematic.model';
import { Subscription } from 'rxjs';
import { EditorCinematicToolsService } from '../../../../services/editor-cinematic-tools.service';
import { EditorCinematicProxyService } from '../../../../services/editor-cinematic-proxy.service';
import { CinematicPlaybackManagerService } from '../../../../core/engine/runtime/cinematics/cinematic-playback-manager.service';
import { EditorLayoutService } from '../../../../services/editor/editor-layout.service';
import { CinematicCameraRegistryService } from '../../../../core/engine/runtime/cameras/cinematic-camera-registry.service';
import { CinematicLogger } from '../../../../core/engine/runtime/cinematics/cinematic-logger';

@Component({
  selector: 'app-timeline-director-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ],
  templateUrl: './timeline-director-tab.html',
  styleUrls: ['./timeline-director-tab.css']
})
export class TimelineDirectorTab implements OnInit, OnDestroy {
  @ViewChild('scrollWrapper') scrollWrapper!: ElementRef<HTMLDivElement>;

  public stateSvc = inject(EditorStateService);
  public mapaSvc = inject(EditorMapaService);
  public cinematicSvc = inject(EditorCinematicService);
  public playbackManager = inject(CinematicPlaybackManagerService);
  public proxySvc = inject(EditorCinematicProxyService);
  public cinematicTools = inject(EditorCinematicToolsService);
  public layoutUI = inject(EditorLayoutService);
  public cameraRegistry = inject(CinematicCameraRegistryService);
  private cdr = inject(ChangeDetectorRef);

  get cinematics() { return this.cinematicSvc.cinematics(); }
  
  public isScrubbing = false;
  public isPanning = false;
  private panStartX = 0;
  private scrollStartX = 0;
  private draggedKeyframe: { trackIdx: number, kfId: string } | null = null;
  
  private subs: Subscription[] = [];

  // =====================================
  // SCALING & ZOOM LOGIC
  // =====================================
  public pixelsPerSecond = 100;
  public zoomFactor = 1.0;

  get timelineMaxMs(): number {
     const cinematicDuration = this.cinematicSvc.currentCinematic()?.durationMs || 5000;
     return Math.max(cinematicDuration, 300000); 
  }

  get timelineWidth(): number {
     return (this.timelineMaxMs / 1000) * this.pixelsPerSecond * this.zoomFactor;
  }

  timeToPx(ms: number): number {
     return (ms / 1000) * this.pixelsPerSecond * this.zoomFactor;
  }

  pxToTime(px: number): number {
     return (px / (this.pixelsPerSecond * this.zoomFactor)) * 1000;
  }

  formatTime(ms: number): string {
      const totalS = Math.floor(ms / 1000);
      const mins = Math.floor(totalS / 60);
      const secs = totalS % 60;
      const millis = Math.floor(ms % 1000);
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
  }

  formatTimeShort(ms: number): string {
      const totalS = Math.floor(ms / 1000);
      const mins = Math.floor(totalS / 60);
      const secs = totalS % 60;
      if (mins > 0) return `${mins}:${secs.toString().padStart(2, '0')}`;
      return `${secs}s`;
  }

  zoomIn() { 
      this.zoomFactor = Math.min(20.0, this.zoomFactor * 1.25); 
      CinematicLogger.logPlayback('ZOOM', `x${this.zoomFactor.toFixed(2)}`); 
  }
  
  zoomOut() { 
      this.zoomFactor = Math.max(0.01, this.zoomFactor / 1.25); 
      CinematicLogger.logPlayback('ZOOM', `x${this.zoomFactor.toFixed(2)}`); 
  }

  fitTimeline() {
     if (!this.scrollWrapper) return;
     const container = this.scrollWrapper.nativeElement;
     const availableWidth = Math.max(100, container.clientWidth - 240);
     const durationS = this.timelineMaxMs / 1000;
     if (durationS > 0) {
        this.zoomFactor = availableWidth / (durationS * this.pixelsPerSecond);
        CinematicLogger.logPlayback('FIT', `x${this.zoomFactor.toFixed(2)}`);
     }
  }

  getTimelineMarks(): number[] {
      const marks = [];
      const pxPerSec = this.pixelsPerSecond * this.zoomFactor;
      
      let stepMs = 1000;
      if (pxPerSec < 5) stepMs = 60000;
      else if (pxPerSec < 15) stepMs = 10000;
      else if (pxPerSec < 40) stepMs = 5000;
      else if (pxPerSec > 200) stepMs = 500;
      else if (pxPerSec > 500) stepMs = 100;

      for (let i = 0; i <= this.timelineMaxMs; i += stepMs) {
        marks.push(i);
      }
      return marks;
  }

  onScroll() { }

  onScrollWrapperMouseDown(event: MouseEvent) {
      if (event.button === 1 || (event.button === 0 && event.altKey)) {
          this.isPanning = true;
          this.panStartX = event.clientX;
          this.scrollStartX = this.scrollWrapper.nativeElement.scrollLeft;
          event.preventDefault();
      }
  }

  onScrollWrapperWheel(event: WheelEvent) {
      if (event.shiftKey) {
          this.scrollWrapper.nativeElement.scrollLeft += event.deltaY;
          event.preventDefault();
      } else if (event.ctrlKey || event.metaKey) {
          if (event.deltaY < 0) this.zoomIn();
          else this.zoomOut();
          event.preventDefault();
      }
  }

  onTimelineMouseDown(event: MouseEvent) {
      if (event.button !== 0) return;
      this.isScrubbing = true;
      this.updateScrub(event);
  }

  @HostListener('window:mousemove', ['$event'])
  onGlobalMouseMove(event: MouseEvent) {
      if (this.isScrubbing) {
         this.updateScrub(event);
      } else if (this.isPanning) {
         const dx = event.clientX - this.panStartX;
         this.scrollWrapper.nativeElement.scrollLeft = this.scrollStartX - dx;
      } else if (this.draggedKeyframe) {
         const currentCin = this.cinematicSvc.currentCinematic();
         if (!currentCin) return;
         
         const track = currentCin.tracks[this.draggedKeyframe.trackIdx];
         const kf = track.keyframes.find(k => k.id === this.draggedKeyframe!.kfId);
         
         if (kf && this.scrollWrapper) {
            const rect = this.scrollWrapper.nativeElement.getBoundingClientRect();
            let x = event.clientX - rect.left - 220 + this.scrollWrapper.nativeElement.scrollLeft;
            x = Math.max(0, x);
            let newTime = this.pxToTime(x);
            
            const clampedTime = Math.max(0, Math.min(newTime, 300000)); 
            
            if (kf.timeMs !== clampedTime) {
                kf.timeMs = clampedTime;
                
                if (kf.timeMs > currentCin.durationMs) {
                    CinematicLogger.logAutoExpand(currentCin.durationMs, kf.timeMs);
                    currentCin.durationMs = kf.timeMs;
                }
                
                this.cdr.detectChanges();
            }
         }
      }
  }

  @HostListener('window:mouseup', ['$event'])
  onGlobalMouseUp(event: MouseEvent) {
      this.isScrubbing = false;
      this.isPanning = false;
      
      if (this.draggedKeyframe) {
          const currentCin = this.cinematicSvc.currentCinematic();
          if (currentCin) {
              const track = currentCin.tracks[this.draggedKeyframe.trackIdx];
              track.keyframes.sort((a,b) => a.timeMs - b.timeMs);
              this.cinematicSvc.selectedKeyframeId.set(this.draggedKeyframe.kfId);
              
              this.persistCinematics();
              this.proxySvc.rebuild(currentCin);
          }
          this.draggedKeyframe = null;
          this.cdr.detectChanges();
      }
  }

  updateScrub(event: MouseEvent) {
      if (!this.scrollWrapper) return;
      const rect = this.scrollWrapper.nativeElement.getBoundingClientRect();
      const x = Math.max(0, event.clientX - rect.left - 220 + this.scrollWrapper.nativeElement.scrollLeft);
      const timeMs = this.pxToTime(x);
      
      const durationMs = this.cinematicSvc.currentCinematic()?.durationMs || 5000;
      const clampedTime = Math.max(0, Math.min(timeMs, durationMs));

      this.playbackManager.seek(clampedTime);
  }

  // =====================================
  // CORE TIMELINE LOGIC
  // =====================================

  constructor() {
    effect(() => {
       const playhead = this.playbackManager.playheadMs();
       if (this.playbackManager.isPlaying()) {
           this.autoScrollToPlayhead(playhead);
       }
    });

    effect(() => {
      const selected = this.stateSvc.objetoSeleccionado();
      untracked(() => {
        if (selected && Tags.MatchesQuery(selected, "cinematic_proxy")) {
           if (selected.name.startsWith('proxy_reusable_cam_')) {
               let camId = selected.name.replace('proxy_reusable_cam_', '');
               if (this.cinematicSvc.selectedReusableCameraId() !== camId) {
                   this.cinematicSvc.selectedReusableCameraId.set(camId);
                   this.cinematicSvc.selectedTrackIndex.set(-1);
                   this.cinematicSvc.selectedKeyframeId.set(null);
                   CinematicLogger.logSelection('ReusableCamera', camId);
                   this.layoutUI.showInspector.set(true);
                   this.cdr.detectChanges();
               }
           } else {
               let kfId = selected.name.replace('proxy_cam_', '');
               this.cinematicSvc.selectedReusableCameraId.set(null);
               const currentCin = this.cinematicSvc.currentCinematic();
               if (currentCin) {
                   currentCin.tracks.forEach((track, tIdx) => {
                       const kf = track.keyframes.find(k => k.id === kfId);
                       if (kf) {
                           if (this.cinematicSvc.selectedTrackIndex() !== tIdx || this.cinematicSvc.selectedKeyframeId() !== kfId) {
                               this.cinematicSvc.selectedTrackIndex.set(tIdx);
                               this.cinematicSvc.selectedKeyframeId.set(kfId);
                               CinematicLogger.logSelection(`Track_${tIdx}`, kfId);
                               this.layoutUI.showInspector.set(true); 
                               this.autoScrollToPlayhead(kf.timeMs);
                               this.cdr.detectChanges();
                           }
                       }
                   });
               }
           }
        }
      });
    });
  }

  autoScrollToPlayhead(ms: number) {
      if (!this.scrollWrapper) return;
      const px = this.timeToPx(ms);
      const wrapper = this.scrollWrapper.nativeElement;
      const leftOffset = 220; 
      const visibleStart = wrapper.scrollLeft;
      const visibleEnd = wrapper.scrollLeft + wrapper.clientWidth - leftOffset;
      
      if (this.isPanning || this.isScrubbing || this.draggedKeyframe) return;

      if (px < visibleStart || px > visibleEnd - 50) {
          wrapper.scrollLeft = Math.max(0, px - 50); 
      }
  }

  ngOnInit() {
    this.subs.push(
      this.cinematicSvc.onProxyMoved.subscribe(data => {
        if (data.type === 'keyframe') {
            const currentCin = this.cinematicSvc.currentCinematic();
            if (currentCin) {
              currentCin.tracks.forEach(track => {
                track.keyframes.forEach(kf => {
                  if (kf.id === data.id) {
                     if (!kf.value) kf.value = {};
                     kf.value.position = { x: data.position.x, y: data.position.y, z: data.position.z };
                     kf.value.rotation = { x: data.rotation.x, y: data.rotation.y, z: data.rotation.z };
                  }
                });
              });
              this.persistCinematics();
              this.cdr.detectChanges();
            }
        } else if (data.type === 'camera') {
            const camDef = this.cameraRegistry.getCamera(data.id);
            if (camDef) {
               camDef.position = { x: data.position.x, y: data.position.y, z: data.position.z };
               camDef.rotation = { x: data.rotation.x, y: data.rotation.y, z: data.rotation.z };
               this.cameraRegistry.registerCamera(camDef);
               this.persistCinematics();
               this.cdr.detectChanges();
            }
        }
      })
    );
    
    if (this.cinematicSvc.currentCinematic()) {
       this.proxySvc.rebuild(this.cinematicSvc.currentCinematic());
    }
  }

  ngOnDestroy() {
    this.proxySvc.clear();
    if (this.cinematicTools.isInsideCamera) {
        this.cinematicTools.salirCamara();
    }
    this.playbackManager.stop();
    this.subs.forEach(s => s.unsubscribe());
  }

  getTrackIcon(type: string): string {
     switch(type) {
       case 'camera': return '🎥';
       case 'actor': return '🧍';
       case 'object': return '📦';
       case 'dialogue': return '💬';
       case 'event': return '⚡';
       case 'text': return '🔤';
       case 'image': return '🖼️';
       case 'background': return '🟩';
       case 'overlay': return '📄';
       default: return '📄';
     }
  }

  seleccionarTrack(tIdx: number, event: Event) {
     event.stopPropagation();
     this.cinematicSvc.selectedTrackIndex.set(tIdx);
     this.cinematicSvc.selectedKeyframeId.set(null);
     this.cinematicSvc.selectedReusableCameraId.set(null);
     
     const track = this.cinematicSvc.currentCinematic()?.tracks[tIdx];
     if (track) CinematicLogger.logSelection('TRACK', track.id);

     this.layoutUI.showInspector.set(true); 
     this.cdr.detectChanges();
  }

  seleccionarKeyframe(tIdx: number, kf: CinematicKeyframe, event?: MouseEvent) {
     if (event && event.button === 0) {
         event.stopPropagation();
         this.draggedKeyframe = { trackIdx: tIdx, kfId: kf.id };
     }
     
     this.cinematicSvc.selectedTrackIndex.set(tIdx);
     this.cinematicSvc.selectedKeyframeId.set(kf.id);
     this.cinematicSvc.selectedReusableCameraId.set(null);
     
     const track = this.cinematicSvc.currentCinematic()?.tracks[tIdx];
     if (track) {
         CinematicLogger.logSelection('KEYFRAME', kf.id);
         this.layoutUI.showInspector.set(true); 
         if (track.type === 'camera' && !this.cinematicTools.isInsideCamera) {
             this.cinematicTools.enfocarCamara(kf);
             const proxyMesh = this.proxySvc.getProxyById(kf.id);
             if (proxyMesh) {
                this.stateSvc.seleccionarObjeto(proxyMesh);
             }
         }
     }
     this.cdr.detectChanges();
  }

  preventClickPropagation(event: MouseEvent) {
      event.stopPropagation();
  }

  persistCinematics() {
    this.mapaSvc.onMapChanged.next(); 
  }

  seleccionarCinematica(id: string) {
    if (this.cinematicTools.isInsideCamera) this.cinematicTools.salirCamara();
    
    // 🔥 FIX: Resetear estado forzado para la nueva cinemática
    this.playbackManager.stop();
    
    this.cinematicSvc.selectedCinematicId.set(id);
    this.cinematicSvc.selectedTrackIndex.set(-1);
    this.cinematicSvc.selectedKeyframeId.set(null);
    this.cinematicSvc.selectedReusableCameraId.set(null);
    
    this.proxySvc.rebuild(this.cinematicSvc.currentCinematic());
    CinematicLogger.logSelection('CINEMATIC', id);
  }

  nuevaCinematica() {
    const cin: CinematicSequence = {
      id: 'cin_' + Math.random().toString(36).substr(2, 6),
      name: 'Cinemática ' + (this.cinematics.length + 1),
      durationMs: 5000,
      tracks: []
    };
    this.cinematicSvc.cinematics.update(v => [...v, cin]);
    this.cinematicSvc.selectedCinematicId.set(cin.id);
    this.persistCinematics();
    this.proxySvc.rebuild(this.cinematicSvc.currentCinematic());
  }

  agregarTrack(type: string) {
      const cin = this.cinematicSvc.currentCinematic();
      if (!cin) return;

      let name = 'Nueva Pista';
      if(type==='camera') name = 'Cámara Libre';
      if(type==='actor') name = 'Personaje / Actor';
      if(type==='object') name = 'Objeto Animado';
      if(type==='dialogue') name = 'Subtítulos / Diálogos';
      if(type==='text') name = 'Texto Cinemático';
      if(type==='image') name = 'Imagen / Logo';
      if(type==='background') name = 'Fondo Global';
      if(type==='event') name = 'Eventos Lógicos';

      cin.tracks.push({
          id: 'trk_' + Math.random().toString(36).substr(2,6),
          name: name,
          type: type as any,
          keyframes: []
      });
      this.persistCinematics();
      CinematicLogger.logPlayback('TRACK CREATED', type);
  }

  agregarKeyframe(track: CinematicTrack) {
      let newTime = 0;
      let newValue: any = {};

      if (track.type === 'camera' || track.type === 'actor' || track.type === 'object') {
          newValue = {
             position: {x:0, y:0, z:0},
             rotation: {x:0, y:0, z:0},
             fov: 0.8,
             movementMode: 'linear',
             orientationMode: 'free'
          };
      } else if (track.type === 'dialogue') {
          newValue = { actorName: '', text: 'Nuevo diálogo', durationMs: 2000 };
      } else if (track.type === 'text') {
          newValue = { title: 'TÍTULO', text: 'Subtítulo', durationMs: 4000, fadeInMs: 500, fadeOutMs: 500, textAlign: 'center', opacity: 1, scale: 1 };
      } else if (track.type === 'image') {
          newValue = { assetId: null, image: '', durationMs: 4000, fadeInMs: 500, fadeOutMs: 500, fitMode: 'CONTAIN', opacity: 1, scale: 1, rotation: 0, maxWidth: 800, maxHeight: 800 };
      } else if (track.type === 'background') {
          newValue = { bgType: 'SOLID', bgColor: '#000000', opacity: 1, durationMs: 4000, fadeInMs: 1000, fadeOutMs: 1000, animIn: 'FADE_IN', animOut: 'FADE_OUT' };
      } else if (track.type === 'event') {
          newValue = { eventName: 'mi_evento', eventPayload: '' };
      }

      if (track.keyframes.length > 0) {
          const lastKf = track.keyframes[track.keyframes.length - 1];
          newTime = lastKf.timeMs + 3000;
          newValue = JSON.parse(JSON.stringify(lastKf.value));
      }
      
      const currentCin = this.cinematicSvc.currentCinematic();
      if (currentCin) {
          if (newTime > 300000) newTime = 300000;
          
          if (newTime > currentCin.durationMs) {
              CinematicLogger.logAutoExpand(currentCin.durationMs, newTime);
              currentCin.durationMs = newTime;
          }
      }

      track.keyframes.push({
         id: 'kf_' + Math.random().toString(36).substr(2,6),
         timeMs: newTime,
         interpolation: 'easeInOut',
         value: newValue
      });
      
      track.keyframes.sort((a,b) => a.timeMs - b.timeMs);
      this.persistCinematics();
      this.proxySvc.rebuild(currentCin);
  }

  togglePlayCinematic() {
    if (this.playbackManager.isPlaying()) {
      this.playbackManager.pause();
    } else {
      const errors = this.playbackManager.play(this.cinematicSvc.currentCinematic());
      if (errors.length > 0) {
         alert("Errores en la cinemática:\n" + errors.join('\n'));
      }
    }
  }

  stopCinematic() {
    this.playbackManager.stop();
    this.cdr.detectChanges();
  }
}