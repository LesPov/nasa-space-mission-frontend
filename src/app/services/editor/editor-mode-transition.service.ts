// src/app/services/editor/editor-mode-transition.service.ts

import { Injectable, inject, signal } from '@angular/core';
import { EditorStateService } from './editor-state.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { CameraViewMode } from '../../core/engine/session/game-context.model';

@Injectable({ providedIn: 'root' })
export class EditorModeTransitionService {
  private state = inject(EditorStateService);
  private gameContext = inject(GameContextService);

  public isExitingPlayMode = signal<boolean>(false);

  public beginTestLive(vista: CameraViewMode = 'FPS'): void {
    this.isExitingPlayMode.set(false);
    this.gameContext.setEditorSubmode(vista === 'TPS' ? 'PLAYTEST_TPS' : 'PLAYTEST_FPS');
    this.gameContext.setTransitioning(true);
    this.state.setObjetoHovereado(null);
  }

  public finishTestLiveTransition(): void {
    this.gameContext.setTransitioning(false);
  }

  public beginStopTestLive(): void {
    this.isExitingPlayMode.set(true);
    this.gameContext.setTransitioning(true);
    this.state.setObjetoHovereado(null);
    this.state.seleccionarObjeto(null);
  }

  public finishStopTestLive(): void {
    this.gameContext.setEditorSubmode('EDITING');
    this.gameContext.setTransitioning(false);
    this.gameContext.setInteracting(false);
    this.state.setObjetoHovereado(null);
    this.state.seleccionarObjeto(null);
    this.isExitingPlayMode.set(false);
  }

  public stopTestLive(): void {
    this.finishStopTestLive();
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
    this.state.setObjetoHovereado(null);
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
    this.isExitingPlayMode.set(false);
    this.gameContext.setEditorSubmode('EDITING');
    this.gameContext.setTransitioning(false);
    this.gameContext.setInteracting(false);
  }
}