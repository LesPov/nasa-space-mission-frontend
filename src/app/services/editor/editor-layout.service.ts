
import { Injectable, inject, signal } from '@angular/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService } from './editor-state.service';

@Injectable({ providedIn: 'root' })
export class EditorLayoutService {
  private motor3dSvc = inject(Motor3dService);
  private stateSvc = inject(EditorStateService);

  // Estado reactivo de los paneles de la UI
  public showInspector = signal<boolean>(true);
  public showTimeline = signal<boolean>(true);
  
  // 🔥 FIX: Aumentamos el tamaño inicial del panel derecho (Inspector) para mayor comodidad visual
  public inspectorWidth = signal<number>(450); 
  
  // 🔥 FIX: Reducimos un poco el alto del timeline para dejar más espacio al canvas
  public timelineHeight = signal<number>(25); 
  
  public isResizing = signal<boolean>(false);
  public isResizingTimeline = signal<boolean>(false);

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
    if (this.isResizing()) {
      const newWidth = window.innerWidth - event.clientX;
      // Límites de la barra lateral (Inspector)
      if (newWidth > 250 && newWidth < window.innerWidth * 0.6) {
        this.inspectorWidth.set(newWidth);
        this.motor3dSvc.forzarRedimension();
      }
    }
    
    if (this.isResizingTimeline()) {
      const containerHeight = window.innerHeight;
      const bottomY = window.innerHeight - event.clientY;
      let newHeight = (bottomY / containerHeight) * 100;
      
      // Límites del timeline (Porcentaje)
      if (newHeight < 5) newHeight = 5;
      if (newHeight > 70) newHeight = 70;
      
      this.timelineHeight.set(newHeight);
      this.motor3dSvc.forzarRedimension();
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
    setTimeout(() => this.motor3dSvc.forzarRedimension(), 10);
    setTimeout(() => this.motor3dSvc.forzarRedimension(), 150);
  }
}