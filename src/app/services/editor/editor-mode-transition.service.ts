
// src/app/services/editor/editor-mode-transition.service.ts

import { Injectable, inject } from '@angular/core';
import { EditorStateService } from './editor-state.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { CameraViewMode } from '../../core/engine/session/game-context.model';

@Injectable({ providedIn: 'root' })
export class EditorModeTransitionService {
  private state = inject(EditorStateService);
  private gameContext = inject(GameContextService);

  public beginTestLive(vista: CameraViewMode = 'FPS'): void {
    this.gameContext.setEditorSubmode(vista === 'TPS' ? 'PLAYTEST_TPS' : 'PLAYTEST_FPS');
    this.gameContext.setTransitioning(true);
    this.state.setObjetoHovereado(null);
  }

  public finishTestLiveTransition(): void {
    this.gameContext.setTransitioning(false);
  }

  public stopTestLive(): void {
    this.gameContext.setEditorSubmode('EDITING');
    this.gameContext.setTransitioning(false);
    this.gameContext.setInteracting(false);
    this.state.setObjetoHovereado(null);
    this.state.seleccionarObjeto(null);
  }

  public beginPauseToLiveEdit(): void {
    this.gameContext.setTransitioning(true);
    this.state.setObjetoHovereado(null);
    this.state.seleccionarObjeto(null);
  }

  public finishPauseToLiveEdit(): void {
    this.gameContext.setTransitioning(false);
    this.gameContext.setEditorSubmode('EDITING_IN_GAME');
  }

  public beginResumeToTestLive(vista: CameraViewMode = 'FPS'): void {
    this.gameContext.setTransitioning(true);
    this.state.seleccionarObjeto(null);
    this.state.setObjetoHovereado(null); // 🔥 FIX: Limpieza completa para evitar residuo pegado que rompa el Hover nuevo
  }

  public finishResumeToTestLive(vista: CameraViewMode = 'FPS'): void {
    this.gameContext.setTransitioning(false);
    this.gameContext.setEditorSubmode(vista === 'TPS' ? 'PLAYTEST_TPS' : 'PLAYTEST_FPS');
  }

  public enterInteraction(): void {
    this.gameContext.setInteracting(true);
  }

  public exitInteraction(): void {
    this.gameContext.setInteracting(false);
  }

  public resetToEditor(): void {
    this.gameContext.setEditorSubmode('EDITING');
    this.gameContext.setTransitioning(false);
    this.gameContext.setInteracting(false);
  }
}