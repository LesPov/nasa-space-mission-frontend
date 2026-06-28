
import { Injectable, signal, computed } from '@angular/core';
import { GameMode } from './game-mode.model';
import { CameraViewMode } from './game-context.model';
import { GameEntity } from '../entities/game.entity';

@Injectable({ providedIn: 'root' })
export class GameContextService {
  // Estado centralizado y fuertemente tipado (Única Fuente de Verdad del Runtime)
  public mode = signal<GameMode>(GameMode.EDITOR);
  public cameraView = signal<CameraViewMode>('FPS');
  public activePlayerEntity = signal<GameEntity | null>(null);
  public isPointerLocked = signal<boolean>(false);

  // 🔥 Transiciones e Interacciones centralizadas para alimentar el computed de EditorState
  public isTransitioning = signal<boolean>(false);
  public isInteracting = signal<boolean>(false);

  // Derivados reactivos
  public isPlaying = computed(() => 
    this.mode() === GameMode.TEST_LIVE || 
    this.mode() === GameMode.PREVIEW_ADMIN || 
    this.mode() === GameMode.FINAL_USER
  );
  
  // True si es el creador interactuando (sea editando, probando, o en ruta admin)
  public isDebugMode = computed(() => 
    this.mode() === GameMode.TEST_LIVE || 
    this.mode() === GameMode.PREVIEW_ADMIN ||
    this.mode() === GameMode.EDITING_IN_GAME
  );

  public setMode(newMode: GameMode): void {
    if (this.mode() === newMode) return;
    this.mode.set(newMode);
  }

  public setTransitioning(val: boolean): void {
    this.isTransitioning.set(val);
  }

  public setInteracting(val: boolean): void {
    this.isInteracting.set(val);
  }

  public setCameraView(view: CameraViewMode): void {
    this.cameraView.set(view);
  }

  public setActivePlayer(entity: GameEntity | null): void {
    this.activePlayerEntity.set(entity);
  }

  public setPointerLocked(locked: boolean): void {
    this.isPointerLocked.set(locked);
  }

  public startGameSession(player: GameEntity, view: CameraViewMode): void {
    this.setActivePlayer(player);
    this.setCameraView(view);
    this.setPointerLocked(true);
  }

  public stopGameSession(): void {
    this.setActivePlayer(null);
    this.setPointerLocked(false);
  }
}