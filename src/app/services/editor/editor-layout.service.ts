
import { Injectable, inject, signal } from '@angular/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { EditorStateService } from './editor-state.service';

@Injectable({ providedIn: 'root' })
export class EditorLayoutService {
  private motor3dSvc: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private stateSvc = inject(EditorStateService);

  // Estado reactivo de los paneles de la UI
  public showInspector = signal<boolean>(true);
  public showTimeline = signal<boolean>(true);
  
  // Solicitud externa de pestaña para el inspector (ej: 'fog', 'transform', etc.)
  public inspectorRequestedTab = signal<string | null>(null);

  public inspectorWidth = signal<number>(450); 
  public timelineHeight = signal<number>(25); 
  
  public isResizing = signal<boolean>(false);
  public isResizingTimeline = signal<boolean>(false);
  
  private lastResizeTime = 0;

  public requestInspectorTab(tab: string): void {
    this.showInspector.set(true);
    this.inspectorRequestedTab.set(tab);
    this.recalcularMotor();
  }

  public toggleInspector(): void {
    this.showInspector.set(!this.showInspector());
    this.recalcularMotor();
  }

  public toggleTimeline(): void {
    this.showTimeline.set(!this.showTimeline());
    this.recalcularMotor();
  }

  public startResize(event: MouseEvent): void {
    const state = this.stateSvc.playState();
    if (state === 'EDITOR' || state === 'EDITING_IN_GAME') {
      this.isResizing.set(true);
      event.preventDefault();
    }
  }

  public startResizeTimeline(event: MouseEvent): void {
    const state = this.stateSvc.playState();
    if (state === 'EDITOR' || state === 'EDITING_IN_GAME') {
      this.isResizingTimeline.set(true);
      event.preventDefault();
    }
  }

  public onMouseMove(event: MouseEvent): void {
    let changed = false;
    
    if (this.isResizing()) {
      const newWidth = window.innerWidth - event.clientX;
      if (newWidth > 250 && newWidth < window.innerWidth * 0.6) {
        this.inspectorWidth.set(newWidth);
        changed = true;
      }
    }
    
    if (this.isResizingTimeline()) {
      const containerHeight = window.innerHeight;
      const bottomY = window.innerHeight - event.clientY;
      let newHeight = (bottomY / containerHeight) * 100;
      
      if (newHeight < 5) newHeight = 5;
      if (newHeight > 70) newHeight = 70;
      
      this.timelineHeight.set(newHeight);
      changed = true;
    }
    
    if (changed) {
      const now = performance.now();
      if (now - this.lastResizeTime > 16) {
        this.motor3dSvc.forceResize();
        this.lastResizeTime = now;
      }
    }
  }

  public onMouseUp(): void {
    if (this.isResizing()) {
      this.isResizing.set(false);
      this.recalcularMotor();
    }
    if (this.isResizingTimeline()) {
      this.isResizingTimeline.set(false);
      this.recalcularMotor();
    }
  }

  private recalcularMotor(): void {
    setTimeout(() => this.motor3dSvc.forceResize(), 10);
    setTimeout(() => this.motor3dSvc.forceResize(), 150);
  }
}