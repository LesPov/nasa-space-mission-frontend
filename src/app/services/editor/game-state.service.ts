import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GameStateService {
  // Estado global del mundo (Las consecuencias de Telltale)
  // Ejemplo: { 'salvo_al_alcalde': true, 'puerta_granero_abierta': false }
  public worldState = signal<Record<string, any>>({});
  
  // Inventario del jugador
  public inventory = signal<string[]>([]);
  
  // Rol actual de la historia (militar, campesino, politico, etc)
  public playerRole = signal<string>('campesino');

  /**
   * Actualiza o crea una variable en el mundo
   */
  public setVar(key: string, value: any): void {
    this.worldState.update(state => ({ ...state, [key]: value }));
    console.log(`[GameState] Variable actualizada: ${key} = ${value}`);
  }

  /**
   * Obtiene el valor de una variable
   */
  public getVar(key: string): any {
    return this.worldState()[key];
  }

  /**
   * Evalúa si una condición se cumple (Ideal para Triggers y Secuencias)
   */
  public evaluateCondition(key: string, expectedValue: any): boolean {
    return this.worldState()[key] === expectedValue;
  }

  /**
   * Manejo de Inventario
   */
  public addItem(itemId: string): void {
    if (!this.hasItem(itemId)) {
      this.inventory.update(items => [...items, itemId]);
      console.log(`[GameState] Objeto añadido al inventario: ${itemId}`);
    }
  }

  public removeItem(itemId: string): void {
    this.inventory.update(items => items.filter(id => id !== itemId));
  }

  public hasItem(itemId: string): boolean {
    return this.inventory().includes(itemId);
  }

  /**
   * Carga una partida guardada desde el Backend
   */
  public loadGame(savedData: any): void {
    if (savedData.worldState) this.worldState.set(savedData.worldState);
    if (savedData.inventory) this.inventory.set(savedData.inventory);
    if (savedData.playerRole) this.playerRole.set(savedData.playerRole);
  }

  /**
   * Prepara los datos para guardar la partida
   */
  public getSaveData(): any {
    return {
      worldState: this.worldState(),
      inventory: this.inventory(),
      playerRole: this.playerRole()
    };
  }

  public resetState(): void {
    this.worldState.set({});
    this.inventory.set([]);
  }
}