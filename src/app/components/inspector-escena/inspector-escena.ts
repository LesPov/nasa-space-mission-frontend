import { Component } from '@angular/core';
import { InspectorOutliner } from './inspector-outliner/inspector-outliner';
import { InspectorProperties } from './inspector-properties/inspector-properties';
 
@Component({
  selector: 'app-inspector-escena',
  standalone: true,
  imports: [InspectorOutliner, InspectorProperties],
  // 🔥 FIX: Ahora usamos templateUrl en lugar de template
  templateUrl: './inspector-escena.html',
  styleUrl: './inspector-escena.css'
})
export class InspectorEscena {
  // Estado compartido para saber qué pestaña (transform, physics, etc) está abierta
  public activeTab: string = 'transform';
}