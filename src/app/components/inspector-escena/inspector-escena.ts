

import { Component, HostListener } from '@angular/core';
import { InspectorOutliner } from './inspector-outliner/inspector-outliner';
import { InspectorProperties } from './inspector-properties/inspector-properties';
 
@Component({
  selector: 'app-inspector-escena',
  standalone: true,
  imports: [InspectorOutliner, InspectorProperties],
  templateUrl: './inspector-escena.html',
  styleUrl: './inspector-escena.css'
})
export class InspectorEscena {
  public activeTab: string = 'transform';
  
  // 🔥 Lógica del SPLITTER VERTICAL
  public outlinerHeight = 40; // Porcentaje inicial
  public isResizing = false;

  startVerticalResize(event: MouseEvent) {
    this.isResizing = true;
    event.preventDefault();
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (!this.isResizing) return;
    
    // Calculamos el porcentaje en base a la altura disponible (descontando el header de 70px)
    const headerOffset = 70;
    const containerHeight = window.innerHeight - headerOffset;
    const mouseY = event.clientY - headerOffset;
    
    let newHeight = (mouseY / containerHeight) * 100;
    
    // Límites para que ninguna caja desaparezca
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

