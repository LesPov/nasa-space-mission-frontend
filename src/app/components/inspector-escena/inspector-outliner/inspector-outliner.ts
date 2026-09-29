
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorMapaService } from '../../../services/editor-mapa.service';
import { OutlinerStateService } from './outliner-state.service';
import { SceneOutlinerComponent } from './scene-outliner/scene-outliner';

@Component({
  selector: 'app-inspector-outliner',
  standalone: true,
  imports: [CommonModule, FormsModule, SceneOutlinerComponent],
  templateUrl: './inspector-outliner.html',
  styleUrls: ['./inspector-outliner.css']
})
export class InspectorOutliner {
  public mapaSvc = inject(EditorMapaService);
  public outlinerState = inject(OutlinerStateService);

  get plataformas() { return this.mapaSvc.plataformasEscena(); }
  get plataformaActivaId() { return this.mapaSvc.escenaIdActiva(); }

  trackById(index: number, plat: any): number {
    return plat.id;
  }

  cambiarPlataforma(id: number) {
    if (this.plataformaActivaId !== id) {
      this.outlinerState.clear(); // Resetea el estado visual del outliner viejo
      this.mapaSvc.onRequestPlatformChange.next(id);
    }
  }

  onSearchChange(term: string) {
    this.outlinerState.searchTerm.set(term);
  }
}