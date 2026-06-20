import { Injectable, inject } from '@angular/core';
import { EditorStateService } from './editor-state.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { GameMode } from '../../core/engine/session/game-context.model';

@Injectable({ providedIn: 'root' })
export class EditorModeTransitionService {
  private state = inject(EditorStateService);
  private gameContext = inject(GameContextService);

  // ==========================================
  // TRANSICIONES DE TEST LIVE (EDITOR ⇄ JUEGO)
  // ==========================================

  public beginTestLive(): void {
    this.gameContext.setMode(GameMode.TEST_LIVE);
    this.state.playState.set('TRANSITIONING');
    this.state.objetoHovereado.set(null);
  }

  public finishTestLiveTransition(): void {
    this.state.playState.set('PLAYING');
  }

  public stopTestLive(): void {
    this.gameContext.setMode(GameMode.EDITOR);
    this.state.playState.set('EDITOR');
    this.state.modoVistaPrueba = null;
    this.state.jugadorActivo = null;
    this.state.objetoHovereado.set(null);
    this.state.objetoSeleccionado.set(null);
  }

  // ==========================================
  // TRANSICIONES EN VIVO (JUEGO ⇄ EDICIÓN LIVE)
  // ==========================================

  public beginPauseToLiveEdit(): void {
    this.state.playState.set('TRANSITIONING');
    this.state.objetoHovereado.set(null);
    this.state.objetoSeleccionado.set(null);
  }

  public finishPauseToLiveEdit(): void {
    this.state.playState.set('EDITING_IN_GAME');
  }

  public beginResumeToTestLive(): void {
    this.state.playState.set('TRANSITIONING');
    this.state.objetoSeleccionado.set(null);
  }

  public finishResumeToTestLive(): void {
    this.state.playState.set('PLAYING');
  }
}