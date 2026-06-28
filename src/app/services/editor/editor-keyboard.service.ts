
import { Injectable, inject } from '@angular/core';
import { EditorStateService } from './editor-state.service';
import { ToolsClipboardService } from './toolsservice/tools-clipboard.service';

@Injectable({ providedIn: 'root' })
export class EditorKeyboardService {
  private stateSvc = inject(EditorStateService);
  private clipboardSvc = inject(ToolsClipboardService);

  public handleKeydown(event: KeyboardEvent, isEditando: boolean): void {
    const target = event.target as HTMLElement | null;
    
    // Si el usuario está escribiendo en un input o textarea, ignoramos los atajos del editor
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    const state = this.stateSvc.playState();
    
    // Solo permitimos atajos si estamos en un modo de edición activo y sin modales invasivos
    if (isEditando && !this.stateSvc.showAddObjectModal() && (state === 'EDITOR' || state === 'EDITING_IN_GAME')) {
      if (event.ctrlKey && (event.key === 'z' || event.key === 'Z')) { 
        this.clipboardSvc.deshacerAccion(); 
        event.preventDefault(); 
      }
      if (event.ctrlKey && (event.key === 'c' || event.key === 'C')) { 
        this.clipboardSvc.copiarObjeto(); 
        event.preventDefault(); 
      }
      if (event.ctrlKey && (event.key === 'v' || event.key === 'V')) { 
        this.clipboardSvc.pegarObjeto(); 
        event.preventDefault(); 
      }
    }
  }
}