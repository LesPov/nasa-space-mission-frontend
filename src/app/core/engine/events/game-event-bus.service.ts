import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { GameEntity } from '../entities/game.entity';
import { AbstractMesh } from '@babylonjs/core';

export type GameEvent = 
  | { type: 'HUD_MESSAGE', payload: string | null }
  | { type: 'INTERACTION_TARGET', payload: { entity: GameEntity | null, showE: boolean, showI: boolean } }
  | { type: 'HOVER_MESH', payload: AbstractMesh | null }
  | { type: 'INTERACTING_STATE', payload: boolean };

@Injectable({ providedIn: 'root' })
export class GameEventBusService {
  private eventSubject = new Subject<GameEvent>();
  public events$ = this.eventSubject.asObservable();

  public emit(event: GameEvent): void {
    this.eventSubject.next(event);
  }
}