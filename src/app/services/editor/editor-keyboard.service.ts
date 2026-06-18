import { Injectable, inject } from '@angular/core';
import { EditorMapaService } from '../editor-mapa.service';

@Injectable({ providedIn: 'root' })
export class EditorKeyboardService {
  private editorSvc = inject(EditorMapaService);

  public handleKeydown(event: KeyboardEvent, isEditando: boolean): void {
    const target = event.target as HTMLElement | null;
    
    // Si el usuario está escribiendo en un input o textarea, ignoramos los atajos del editor
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    const state = this.editorSvc.playState();
    
    // Solo permitimos atajos si estamos en un modo de edición activo y sin modales invasivos
    if (isEditando && !this.editorSvc.showAddObjectModal() && (state === 'EDITOR' || state === 'EDITING_IN_GAME')) {
      if (event.ctrlKey && (event.key === 'z' || event.key === 'Z')) { 
        this.editorSvc.deshacerAccion(); 
        event.preventDefault(); 
      }
      if (event.ctrlKey && (event.key === 'c' || event.key === 'C')) { 
        this.editorSvc.copiarObjeto(); 
        event.preventDefault(); 
      }
      if (event.ctrlKey && (event.key === 'v' || event.key === 'V')) { 
        this.editorSvc.pegarObjeto(); 
        event.preventDefault(); 
      }
    }
  }
}