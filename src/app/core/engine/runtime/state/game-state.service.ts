import { Injectable, signal } from '@angular/core';
import { GameCondition, GameStateMutation } from '../../models/player-config.model';

@Injectable({ providedIn: 'root' })
export class GameStateService {
  // Estado global del mundo (Las consecuencias de Telltale)
  public worldState = signal<Record<string, any>>({});
  
  // Inventario del jugador
  public inventory = signal<string[]>([]);
  
  // Rol actual de la historia
  public playerRole = signal<string>('campesino');

  // 🔥 PATRÓN SANDBOX: Protección para el Editor
  private backupState: any = null;

  public enterSandbox(): void {
    this.backupState = this.getSaveData();
    console.log('[GameState] 🛡️ Sandbox Activado (Estado respaldado)');
  }

  public exitSandbox(): void {
    if (this.backupState) {
      this.loadGame(this.backupState);
      this.backupState = null;
      console.log('[GameState] 🛡️ Sandbox Desactivado (Estado restaurado)');
    }
  }

  public setVar(key: string, value: any): void {
    this.worldState.update(state => ({ ...state, [key]: value }));
    console.log(`[GameState] Variable actualizada: ${key} = ${value}`);
  }

  public getVar(key: string): any {
    return this.worldState()[key];
  }

  public evaluateCondition(key: string, expectedValue: any): boolean {
    return this.worldState()[key] === expectedValue;
  }

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

  public loadGame(savedData: any): void {
    if (savedData.worldState) this.worldState.set(savedData.worldState);
    if (savedData.inventory) this.inventory.set(savedData.inventory);
    if (savedData.playerRole) this.playerRole.set(savedData.playerRole);
  }

  public getSaveData(): any {
    return {
      worldState: JSON.parse(JSON.stringify(this.worldState())),
      inventory: JSON.parse(JSON.stringify(this.inventory())),
      playerRole: this.playerRole()
    };
  }

  public resetState(): void {
    this.worldState.set({});
    this.inventory.set([]);
  }

  // --- MÉTODOS DE EVALUACIÓN NARRATIVA DE MOTOR ---
  public evaluateGameCondition(cond: GameCondition): boolean {
    switch(cond.type) {
      case 'var_eq': return this.getVar(cond.key) === cond.value;
      case 'var_neq': return this.getVar(cond.key) !== cond.value;
      case 'has_item': return this.hasItem(cond.key);
      case 'missing_item': return !this.hasItem(cond.key);
      case 'role_eq': return this.playerRole() === cond.key;
      default: return true;
    }
  }

  public evaluateAllConditions(conditions?: GameCondition[]): boolean {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every(c => this.evaluateGameCondition(c));
  }

  public applyMutation(mut: GameStateMutation): void {
    switch(mut.type) {
      case 'set_var': this.setVar(mut.key, mut.value); break;
      case 'add_item': this.addItem(mut.key); break;
      case 'remove_item': this.removeItem(mut.key); break;
    }
  }

  public applyMutations(mutations?: GameStateMutation[]): void {
    if (!mutations || mutations.length === 0) return;
    mutations.forEach(m => this.applyMutation(m));
  }
}