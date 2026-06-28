
import { Component, ChangeDetectorRef, inject, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorStateService } from '../../../../services/editor/editor-state.service';
import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { EditorCinematicService } from '../../../../services/editor/editor-cinematic.service';
import { CinematicDirectorService } from '../../../../core/engine/runtime/systems/cinematic-director.service';
  import { CinematicSequence, CinematicTrack, CinematicClip } from '../../../../core/engine/models/cinematic.model';
import { Subscription } from 'rxjs';
import { EditorCinematicToolsService } from '../../../../services/editor-cinematic-tools.service';
import { EditorCinematicProxyService } from '../../../../services/editor-cinematic-proxy.service';

@Component({
  selector: 'app-timeline-director-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './timeline-director-tab.html',
  styleUrls: ['./timeline-director-tab.css']
})
export class TimelineDirectorTab implements OnInit, OnDestroy {
  public stateSvc = inject(EditorStateService);
  public mapaSvc = inject(EditorMapaService);
  private entityManager = inject(EntityManagerService);
  public cinematicSvc = inject(EditorCinematicService);
  public cinematicDirector = inject(CinematicDirectorService);
  public proxySvc = inject(EditorCinematicProxyService);
  public cinematicTools = inject(EditorCinematicToolsService);
  private cdr = inject(ChangeDetectorRef);

  get cinematics() { return this.cinematicSvc.cinematics(); }
  
  public selectedCinematicId: string | null = null;
  public selectedTrackIndex: number = -1;
  public selectedClipIndex: number = -1;
  public cinematicPlayhead: number = 0;
  public cinematicIsPlaying = false;
  private cinematicTimer: any;
  public sceneEntities: any[] = [];
  public isScrubbing = false;

  private subs: Subscription[] = [];

  ngOnInit() {
    this.sceneEntities = this.entityManager.getAllEntities()
      .map(e => ({ uid: e.uid, name: e.name }))
      .sort((a,b) => a.name.localeCompare(b.name));

    this.subs.push(
      this.cinematicSvc.onProxyMoved.subscribe(data => {
        if (this.currentCinematic) {
          this.currentCinematic.tracks.forEach(track => {
            track.clips.forEach(clip => {
              if (clip.id === data.clipId) {
                 clip.startPosition = { x: data.position.x, y: data.position.y, z: data.position.z };
                 clip.startRotation = { x: data.rotation.x, y: data.rotation.y, z: data.rotation.z };
              }
            });
          });
          this.persistCinematics();
          this.cdr.detectChanges();
        }
      })
    );
    
    // Automatically rebuild proxies if there is a selected cinematic initially
    if (this.currentCinematic) {
       this.proxySvc.rebuild(this.currentCinematic);
    }
  }

  ngOnDestroy() {
    this.proxySvc.clear();
    if (this.cinematicTools.isInsideCamera) {
        this.cinematicTools.salirCamara();
    }
    this.subs.forEach(s => s.unsubscribe());
    if (this.cinematicTimer) clearInterval(this.cinematicTimer);
  }

  get currentCinematic() { return this.cinematics.find(c => c.id === this.selectedCinematicId) || null; }
  get currentTrack() { return this.currentCinematic?.tracks[this.selectedTrackIndex] || null; }
  
  get currentCinematicClip() { 
      const clip = this.currentTrack?.clips[this.selectedClipIndex] || null; 
      if (clip) {
          if (!clip.startPosition) clip.startPosition = {x:0, y:0, z:0};
          if (!clip.endPosition) clip.endPosition = {x:0, y:0, z:0};
          if (!clip.startRotation) clip.startRotation = {x:0, y:0, z:0};
          if (!clip.endRotation) clip.endRotation = {x:0, y:0, z:0};
      }
      return clip;
  }

  persistCinematics() {
    this.mapaSvc.onMapChanged.next(); 
  }

  seleccionarCinematica(id: string) {
    if (this.cinematicTools.isInsideCamera) this.cinematicTools.salirCamara();
    this.selectedCinematicId = id;
    this.selectedTrackIndex = -1;
    this.selectedClipIndex = -1;
    this.cinematicPlayhead = 0;
    if (this.cinematicIsPlaying) this.stopCinematic();
    this.proxySvc.rebuild(this.currentCinematic);
  }

  copiarId(id: string) {
    navigator.clipboard.writeText(id);
    alert('ID de cinemática copiado: ' + id);
  }

  nuevaCinematica() {
    const cin: CinematicSequence = {
      id: 'cin_' + Math.random().toString(36).substr(2, 6),
      name: 'Cinemática ' + (this.cinematics.length + 1),
      durationMs: 5000,
      tracks: []
    };
    this.cinematicSvc.cinematics.update(v => [...v, cin]);
    this.selectedCinematicId = cin.id;
    this.persistCinematics();
    this.proxySvc.rebuild(this.currentCinematic);
  }

  eliminarCinematica(id: string) {
    this.cinematicSvc.deletedCinematics.push(id);
    this.cinematicSvc.cinematics.update(v => v.filter(c => c.id !== id));
    this.selectedCinematicId = this.cinematics.length > 0 ? this.cinematics[0].id : null;
    this.persistCinematics();
    this.proxySvc.rebuild(this.currentCinematic);
  }

  agregarTrack(cin: CinematicSequence) {
      cin.tracks.push({
          id: 'trk_' + Math.random().toString(36).substr(2,6),
          name: 'Nueva Pista',
          type: 'camera',
          clips: []
      });
      this.persistCinematics();
  }
  
  quitarTrack(cin: CinematicSequence, index: number) {
      cin.tracks.splice(index, 1);
      this.selectedTrackIndex = -1;
      this.selectedClipIndex = -1;
      this.persistCinematics();
      this.proxySvc.rebuild(this.currentCinematic);
  }

  agregarClip(track: CinematicTrack) {
      track.clips.push({
         id: 'clip_' + Math.random().toString(36).substr(2,6),
         startTimeMs: 0,
         durationMs: 2000,
         easing: 'easeInOut',
         startPosition: {x:0, y:0, z:0},
         endPosition: {x:0, y:0, z:0},
         startRotation: {x:0, y:0, z:0},
         endRotation: {x:0, y:0, z:0},
         fadeMode: 'none'
      });
      this.persistCinematics();
      this.proxySvc.rebuild(this.currentCinematic);
  }

  seleccionarClip(tIdx: number, cIdx: number) {
     this.selectedTrackIndex = tIdx;
     this.selectedClipIndex = cIdx;
     
     const track = this.currentCinematic?.tracks[tIdx];
     if (track) {
         const clip = track.clips[cIdx];
         if (clip) {
             if (!clip.startPosition) clip.startPosition = {x:0, y:0, z:0};
             if (!clip.endPosition) clip.endPosition = {x:0, y:0, z:0};
             if (!clip.startRotation) clip.startRotation = {x:0, y:0, z:0};
             if (!clip.endRotation) clip.endRotation = {x:0, y:0, z:0};
             
             if (track.type === 'camera' && !this.cinematicTools.isInsideCamera) {
                 this.cinematicTools.enfocarCamara(clip);
                 const proxyMesh = this.proxySvc.getProxyById(clip.id);
                 if (proxyMesh) {
                    this.stateSvc.seleccionarObjeto(proxyMesh);
                 }
             }
         }
     }
  }

  quitarClip() {
      if (this.currentTrack && this.selectedClipIndex >= 0) {
          this.currentTrack.clips.splice(this.selectedClipIndex, 1);
          this.selectedClipIndex = -1;
          this.persistCinematics();
          this.proxySvc.rebuild(this.currentCinematic);
      }
  }

  togglePlayCinematic() {
    const cin = this.currentCinematic;
    if (!cin) return;
    
    if (this.cinematicIsPlaying) {
      this.cinematicDirector.pause();
      this.cinematicIsPlaying = false;
      clearInterval(this.cinematicTimer);
    } else {
      const errors = this.cinematicSvc.validateCinematic(cin);
      if (errors.length > 0) {
         alert("Errores en la cinemática:\n" + errors.join('\n'));
         return;
      }
      
      this.cinematicDirector.editorWantsCamera = this.cinematicTools.isInsideCamera;
      this.cinematicDirector.play(cin);
      this.cinematicDirector.seek(this.cinematicPlayhead);
      this.cinematicIsPlaying = true;
      
      this.cinematicTimer = setInterval(() => {
         this.cinematicPlayhead = this.cinematicDirector.currentTimeMs;
         if (!this.cinematicDirector.isPlaying) {
             this.cinematicIsPlaying = false;
             clearInterval(this.cinematicTimer);
         }
         this.cdr.detectChanges();
      }, 16);
    }
  }

  stopCinematic() {
    this.cinematicDirector.stop();
    this.cinematicIsPlaying = false;
    this.cinematicPlayhead = 0;
    clearInterval(this.cinematicTimer);
    this.cdr.detectChanges();
  }

  getTimelineMarks(durationMs: number): number[] {
    const marks = [];
    const step = 1000; 
    for (let i = 0; i <= durationMs; i += step) {
      marks.push(i);
    }
    return marks;
  }

  onTimelineMouseDown(event: MouseEvent, durationMs: number) {
    this.isScrubbing = true;
    this.updateScrub(event, durationMs);
  }

  @HostListener('window:mousemove', ['$event'])
  onTimelineMouseMove(event: MouseEvent) {
    if (this.isScrubbing && this.currentCinematic) {
      this.updateScrub(event, this.currentCinematic.durationMs);
    }
  }

  @HostListener('window:mouseup')
  onTimelineMouseUp() {
    this.isScrubbing = false;
  }

  updateScrub(event: MouseEvent, durationMs: number) {
    const el = document.querySelector('.timeline-ruler') as HTMLElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const percent = x / rect.width;
    this.cinematicPlayhead = percent * durationMs;
    this.cinematicDirector.seek(this.cinematicPlayhead);
    this.proxySvc.renderScene();
  }

  enfocarCamara() {
     this.cinematicTools.enfocarCamara(this.currentCinematicClip);
  }

  entrarCamara() {
     this.cinematicTools.entrarCamara(this.currentCinematicClip);
  }

  salirCamara() {
     this.cinematicTools.salirCamara();
  }

  capturarPosRot(targetClip: CinematicClip, isStart: boolean) {
    this.cinematicTools.capturarPosRot(this.currentTrack, targetClip, isStart);
    this.proxySvc.rebuild(this.currentCinematic);
  }
}