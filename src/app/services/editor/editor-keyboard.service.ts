import { Injectable, inject } from '@angular/core';
import { EditorStateService } from './editor-state.service';
import { ToolsClipboardService } from './toolsservice/tools-clipboard.service';
import { InputRouterService } from '../../core/engine/session/input-router.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { Subscription } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class EditorKeyboardService {
  private stateSvc = inject(EditorStateService);
  private clipboardSvc = inject(ToolsClipboardService);
  private inputRouter = inject(InputRouterService);
  private gameContext = inject(GameContextService);
  
  private sub: Subscription | null = null;

  public init(): void {
    if (this.sub) return;
    // Escucha global centralizada a través del Router para evitar HostListeners duplicados
    this.sub = this.inputRouter.getGlobalKeyboardStream(['EDITOR_EDITING']).subscribe(event => {
      this.handleKeydown(event, true);
    });
  }

  public dispose(): void {
    if (this.sub) {
      this.sub.unsubscribe();
      this.sub = null;
    }
  }

  public handleKeydown(event: KeyboardEvent, isEditando: boolean): void {
    const target = event.target as HTMLElement | null;
    
    // Si el usuario está escribiendo en un input o textarea, ignoramos los atajos del editor
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    const state = this.stateSvc.playState();
    const inputCtx = this.gameContext.inputContext();
    
    // El teclado editorial solo se activa si el contexto específico de input es edición
    if (inputCtx !== 'EDITOR_EDITING') return;
    
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