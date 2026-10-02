
import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { GameEntity } from '../entities/game.entity';
import { AbstractMesh } from '@babylonjs/core';

export type GameEvent = 
  | { type: 'MessageRequested', payload: { text: string, durationMs?: number } | null }
  | { type: 'ObjectFocused', payload: { entity: GameEntity | null, mesh: AbstractMesh | null, canInteract: boolean, canInspect: boolean } }
  | { type: 'InteractionStateChanged', payload: boolean }
  | { type: 'GameStarted', payload: { view: 'FPS' | 'TPS', isDebugMode: boolean } }
  | { type: 'GameStopped' }
  | { type: 'GamePaused' }
  | { type: 'GameResumed' }
  | { type: 'CameraViewChanged', payload: 'FPS' | 'TPS' }
  | { type: 'SequenceTriggered', payload: { sequenceId: string } }
  | { type: 'SequenceSyncRequested', payload: { sequenceId: string, elapsedMs: number } }
  | { type: 'ToggleCameraRequested' }
  | { type: 'ChangeSceneRequested', payload: { sceneId: number } }
  | { type: 'CinematicStarted', payload: { cinematicId: string } }
  | { type: 'CinematicStopped' }
  | { type: 'CinematicSeeked', payload: { timeMs: number } }
  | { type: 'DialogueRequested', payload: { actor?: string, text?: string, durationMs: number } }
  | { type: 'RadialMenuToggled', payload: boolean }
  | { type: 'AssetSelectedForBuild', payload: any | null }
  | { type: 'RuntimeVisibilityBatchChanged' }; // 🔥 Evento para notificar cambios de Culling masivos sin ahogar Angular

@Injectable({ providedIn: 'root' })
export class GameEventBusService {
  private eventSubject = new Subject<GameEvent>();
  public events$ = this.eventSubject.asObservable();

  public emit(event: GameEvent): void {
    this.eventSubject.next(event);
  }
}