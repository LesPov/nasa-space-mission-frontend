
import { Injectable, inject } from '@angular/core';
import { EditorStateService } from './editor-state.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { GameMode } from '../../core/engine/session/game-mode.model';

@Injectable({ providedIn: 'root' })
export class EditorModeTransitionService {
  private state = inject(EditorStateService);
  private gameContext = inject(GameContextService);

  // ==========================================
  // TRANSICIONES DE TEST LIVE (EDITOR ⇄ JUEGO)
  // ==========================================

  public beginTestLive(): void {
    this.gameContext.setMode(GameMode.TEST_LIVE);
    this.gameContext.setTransitioning(true);
    this.state.objetoHovereado.set(null);
  }

  public finishTestLiveTransition(): void {
    this.gameContext.setTransitioning(false);
  }

  public stopTestLive(): void {
    this.gameContext.setMode(GameMode.EDITOR);
    this.gameContext.setTransitioning(false);
    this.gameContext.setInteracting(false);
    this.state.modoVistaPrueba = null;
    this.state.jugadorActivo = null;
    this.state.objetoHovereado.set(null);
    this.state.objetoSeleccionado.set(null);
  }

  // ==========================================
  // TRANSICIONES EN VIVO (JUEGO ⇄ EDICIÓN LIVE)
  // ==========================================

  public beginPauseToLiveEdit(): void {
    this.gameContext.setTransitioning(true);
    this.state.objetoHovereado.set(null);
    this.state.objetoSeleccionado.set(null);
  }

  public finishPauseToLiveEdit(): void {
    this.gameContext.setTransitioning(false);
    this.gameContext.setMode(GameMode.EDITING_IN_GAME);
  }

  public beginResumeToTestLive(): void {
    this.gameContext.setTransitioning(true);
    this.state.objetoSeleccionado.set(null);
  }

  public finishResumeToTestLive(): void {
    this.gameContext.setTransitioning(false);
    this.gameContext.setMode(GameMode.TEST_LIVE);
  }

  // ==========================================
  // TRANSICIONES DE UI (INTERACCIÓN & RESET)
  // ==========================================

  public enterInteraction(): void {
    this.gameContext.setInteracting(true);
  }

  public exitInteraction(): void {
    this.gameContext.setInteracting(false);
  }

  public resetToEditor(): void {
    this.gameContext.setMode(GameMode.EDITOR);
    this.gameContext.setTransitioning(false);
    this.gameContext.setInteracting(false);
  }
}