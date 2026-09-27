import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class EpisodeSessionService {
  private currentSessionId = 0;
  public isSessionActive = signal<boolean>(false);

  /**
   * Crea e inicia una nueva sesión de carga.
   * Invalida cualquier callback o promesa rezagada de la sesión anterior.
   */
  public startNewSession(): number {
    this.currentSessionId++;
    this.isSessionActive.set(true);
    return this.currentSessionId;
  }

  /**
   * Comprueba si el sessionId recibido sigue siendo el dueño de la sesión actual.
   */
  public isValidSession(sessionId: number): boolean {
    return this.isSessionActive() && this.currentSessionId === sessionId;
  }

  /**
   * Cancela la sesión actual inmediatamente al salir o cambiar de episodio.
   */
  public cancelSession(): void {
    this.currentSessionId++;
    this.isSessionActive.set(false);
  }

  public getActiveSessionId(): number {
    return this.currentSessionId;
  }
}