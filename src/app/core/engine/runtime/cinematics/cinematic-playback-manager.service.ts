
import { Injectable, inject, signal } from '@angular/core';
import { CinematicDirectorService } from '../systems/cinematic-director.service';
import { EditorCinematicService } from '../../../../services/editor/editor-cinematic.service';
import { EditorCinematicToolsService } from '../../../../services/editor-cinematic-tools.service';
import { EditorCinematicProxyService } from '../../../../services/editor-cinematic-proxy.service';
import { CinematicSequence } from '../../models/cinematic.model';
import { CinematicLogger } from './cinematic-logger';
 import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { GameContextService } from '../../session/game-context.service';

@Injectable({ providedIn: 'root' })
export class CinematicPlaybackManagerService {
  private cinematicDirector = inject(CinematicDirectorService);
  private cinematicSvc = inject(EditorCinematicService);
  private cinematicTools = inject(EditorCinematicToolsService);
  private proxySvc = inject(EditorCinematicProxyService);
  private gameContext = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);

  public isPlaying = signal(false);
  public playheadMs = signal(0);
  
  private playbackTimer: any = null;
  
  // Watchdog variables
  private lastWatchdogTime = 0;
  private stalledTicks = 0;

  public play(cinematic: CinematicSequence | null): string[] {
    if (!cinematic) return [];
    
    const errors = this.cinematicSvc.validateCinematic(cinematic);
    if (errors.length > 0) return errors;

    this.cinematicDirector.editorWantsCamera = this.cinematicTools.isInsideCamera;
    this.cinematicDirector.play(cinematic);
    this.cinematicDirector.seek(this.playheadMs());
    
    this.isPlaying.set(true);
    this.stalledTicks = 0;
    this.lastWatchdogTime = this.cinematicDirector.currentTimeMs;

    if (this.playbackTimer) clearInterval(this.playbackTimer);
    this.playbackTimer = setInterval(() => {
      this.playheadMs.set(this.cinematicDirector.currentTimeMs);

      // 🔥 WATCHDOG: Monitorea si el Update Loop ha muerto externamente
      if (this.isPlaying()) {
         if (this.lastWatchdogTime === this.cinematicDirector.currentTimeMs) {
             this.stalledTicks++;
             if (this.stalledTicks > 60) { // Approx 1s stalled
                 CinematicLogger.logPlaybackWarning('timeStalled', { 
                     time: this.lastWatchdogTime, 
                     mode: this.gameContext.mode(), 
                     owner: this.ownership.getOwner() 
                 });
                 this.stalledTicks = 0; 
             }
         } else {
             this.stalledTicks = 0;
             this.lastWatchdogTime = this.cinematicDirector.currentTimeMs;
         }
      }

      if (!this.cinematicDirector.isPlaying) {
         this.isPlaying.set(false);
         clearInterval(this.playbackTimer);
      }
    }, 16);

    return [];
  }

  public pause(): void {
    this.cinematicDirector.pause();
    this.isPlaying.set(false);
    if (this.playbackTimer) clearInterval(this.playbackTimer);
  }

  public stop(): void {
    this.cinematicDirector.stop();
    this.isPlaying.set(false);
    this.playheadMs.set(0);
    if (this.playbackTimer) clearInterval(this.playbackTimer);
  }

  public seek(timeMs: number): void {
    this.playheadMs.set(timeMs);
    const cinematic = this.cinematicSvc.currentCinematic();
    if (cinematic && !this.cinematicDirector.activeSequence) {
        this.cinematicDirector.activeSequence = cinematic;
    }
    this.cinematicDirector.editorWantsCamera = this.cinematicTools.isInsideCamera;
    this.cinematicDirector.seek(timeMs);
    this.proxySvc.renderScene();
  }
}