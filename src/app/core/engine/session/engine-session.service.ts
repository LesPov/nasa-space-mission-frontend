import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class EngineSessionService {
  private currentSessionId: number = 0;

  public startNewSession(): number {
    this.currentSessionId++;
    return this.currentSessionId;
  }

  public getSessionId(): number {
    return this.currentSessionId;
  }

  public isSessionActive(sessionId: number): boolean {
    return this.currentSessionId === sessionId;
  }

  public invalidateSession(): void {
    this.currentSessionId++; 
  }
}