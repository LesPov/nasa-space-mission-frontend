import { Component, inject, OnInit, effect } from '@angular/core';
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
export class InspectorOutliner implements OnInit {
  public mapaSvc = inject(EditorMapaService);
  public outlinerState = inject(OutlinerStateService);

  // Estado visual independiente: Guarda qué plataformas están desplegadas
  public expandedPlatforms = new Set<number>();

  get plataformas() { return this.mapaSvc.plataformasEscena(); }
  get plataformaActivaId() { return this.mapaSvc.escenaIdActiva(); }

  constructor() {
    // Efecto reactivo: Si la plataforma activa cambia, la expandimos automáticamente
    effect(() => {
      const activeId = this.plataformaActivaId;
      if (activeId !== null && !this.expandedPlatforms.has(activeId)) {
        this.expandedPlatforms.add(activeId);
      }
    });
  }

  ngOnInit() {
    // Al iniciar, la plataforma activa debe estar expandida
    if (this.plataformaActivaId) {
      this.expandedPlatforms.add(this.plataformaActivaId);
    }
  }

  trackById(index: number, plat: any): number {
    return plat.id;
  }

  // Alterna EXCLUSIVAMENTE el estado visual de la colección
  toggleExpand(id: number, event: Event) {
    event.stopPropagation();
    if (this.expandedPlatforms.has(id)) {
      this.expandedPlatforms.delete(id);
    } else {
      this.expandedPlatforms.add(id);
    }
  }

  isExpanded(id: number): boolean {
    return this.expandedPlatforms.has(id);
  }

  // Carga la escena en el motor 3D
  cambiarPlataforma(id: number) {
    if (this.plataformaActivaId !== id) {
      this.outlinerState.clear();
      this.mapaSvc.onRequestPlatformChange.next(id);
      this.expandedPlatforms.add(id);
    }
  }

  onSearchChange(term: string) {
    this.outlinerState.searchTerm.set(term);
    if (term.trim() !== '' && this.plataformaActivaId) {
        this.expandedPlatforms.add(this.plataformaActivaId);
    }
  }
}