
import { Component, HostListener, inject, effect } from '@angular/core';
import { InspectorOutliner } from './inspector-outliner/inspector-outliner';
import { InspectorProperties } from './inspector-properties/inspector-properties';
import { EditorLayoutService } from '../../services/editor/editor-layout.service';
 
@Component({
  selector: 'app-inspector-escena',
  standalone: true,
  imports: [InspectorOutliner, InspectorProperties],
  templateUrl: './inspector-escena.html',
  styleUrl: './inspector-escena.css'
})
export class InspectorEscena {
  private layoutSvc = inject(EditorLayoutService);
  public activeTab: string = 'transform';
  
  public outlinerHeight = 40; 
  public isResizing = false;

  constructor() {
    effect(() => {
      const requested = this.layoutSvc.inspectorRequestedTab();
      if (requested) {
        this.activeTab = requested;
        this.layoutSvc.inspectorRequestedTab.set(null);
      }
    });
  }

  startVerticalResize(event: MouseEvent) {
    this.isResizing = true;
    event.preventDefault();
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (!this.isResizing) return;
    
    const headerOffset = 70;
    const containerHeight = window.innerHeight - headerOffset;
    const mouseY = event.clientY - headerOffset;
    
    let newHeight = (mouseY / containerHeight) * 100;
    
    if (newHeight < 15) newHeight = 15;
    if (newHeight > 85) newHeight = 85;
    
    this.outlinerHeight = newHeight;
  }

  @HostListener('window:mouseup')
  onMouseUp() {
    if (this.isResizing) {
      this.isResizing = false;
    }
  }
}
