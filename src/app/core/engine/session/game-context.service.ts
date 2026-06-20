
import { Injectable, signal, computed } from '@angular/core';
import { GameMode, CameraViewMode } from './game-context.model';
import { GameEntity } from '../entities/game.entity';
 
@Injectable({ providedIn: 'root' })
export class GameContextService {
  // Estado centralizado y fuertemente tipado
  public mode = signal<GameMode>(GameMode.EDITOR);
  public cameraView = signal<CameraViewMode>('FPS');
  public activePlayerEntity = signal<GameEntity | null>(null);
  public isPointerLocked = signal<boolean>(false);

  // Derivados reactivos
  public isPlaying = computed(() => this.mode() !== GameMode.EDITOR);
  
  // True si es el creador probando (sea en el editor o en la ruta final)
  public isDebugMode = computed(() => 
    this.mode() === GameMode.TEST_LIVE || 
    this.mode() === GameMode.PREVIEW_ADMIN
  );

  public setMode(mode: GameMode): void {
    this.mode.set(mode);
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