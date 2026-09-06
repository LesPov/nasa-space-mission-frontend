
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TimelineClipsTab } from './tabs/timeline-clips-tab/timeline-clips-tab';
import { TimelineAutoAnimTab } from './tabs/timeline-auto-anim-tab/timeline-auto-anim-tab';
import { TimelineDirectorTab } from './tabs/timeline-director-tab/timeline-director-tab';
import { TimelinePrefabsTab } from './tabs/timeline-prefabs-tab/timeline-prefabs-tab';
import { TimelinePlatformTab } from './tabs/timeline-platform-tab/timeline-platform-tab';
import { EditorCinematicProxyService } from '../../services/editor-cinematic-proxy.service';
import { EditorCinematicToolsService } from '../../services/editor-cinematic-tools.service';
import { EditorStateService } from '../../services/editor/editor-state.service';
import { CinematicPlaybackManagerService } from '../../core/engine/runtime/cinematics/cinematic-playback-manager.service';
  
@Component({
  selector: 'app-global-timeline', 
  standalone: true,
  imports: [
    CommonModule, 
    TimelineClipsTab, 
    TimelineAutoAnimTab, 
    TimelineDirectorTab, 
    TimelinePrefabsTab, 
    TimelinePlatformTab
  ],
  templateUrl: './global-timeline.html',
  styleUrl: './global-timeline.css'
})
export class GlobalTimeline {
  public stateSvc = inject(EditorStateService);
  private proxySvc = inject(EditorCinematicProxyService);
  private cinematicTools = inject(EditorCinematicToolsService);
  private playbackManager = inject(CinematicPlaybackManagerService);

  cambiarTab(tab: string) {
    this.stateSvc.setActiveBottomTab(tab);
    if (tab !== 'director') {
        this.proxySvc.clear();
        if (this.cinematicTools.isInsideCamera) {
            this.cinematicTools.salirCamara();
        }
        // 🔥 FIX: Limpia la cinemática para evitar desincronización de actores en Editor
        this.playbackManager.stop();
    }
  }
}