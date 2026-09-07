
import { Injectable, signal } from '@angular/core';
import { GameCondition, GameStateMutation } from '../../models/player-config.model';

export type StateScope = 'global' | 'episode' | 'scene' | 'player';

export interface InventoryItemState {
  itemId: string;
  quantity: number;
  scope: StateScope;
  metadata?: Record<string, unknown>;
}

export interface GameStateData {
  schemaVersion: number;
  global: Record<string, any>;
  episode: Record<string, any>;
  scene: Record<string, any>;
  player: Record<string, any>;
  inventory: InventoryItemState[];
  activeRole: string; // 🔥 SSOT para el Narrative Role ID ('militar_1948')
}

@Injectable({ providedIn: 'root' })
export class GameStateService {
  public state = signal<GameStateData>(this.createEmptyState());
  
  private backupState: GameStateData | null = null;

  private createEmptyState(): GameStateData {
    return {
      schemaVersion: 2,
      global: {},
      episode: {},
      scene: {},
      player: {},
      inventory: [],
      activeRole: '' // Vacío significa que aún no ha seleccionado rol
    };
  }

  public enterSandbox(): void {
    this.backupState = JSON.parse(JSON.stringify(this.state()));
  }

  public exitSandbox(): void {
    if (this.backupState) {
      this.state.set(JSON.parse(JSON.stringify(this.backupState)));
      this.backupState = null;
    }
  }

  public setVar(key: string, value: any, scope: StateScope = 'episode'): void {
    this.state.update(s => {
      const ns = { ...s };
      ns[scope] = { ...ns[scope], [key]: value };
      return ns;
    });
  }

  public getVar(key: string, explicitScope?: StateScope): any {
    const s = this.state();
    if (explicitScope) return s[explicitScope][key];
    if (s.scene[key] !== undefined) return s.scene[key];
    if (s.episode[key] !== undefined) return s.episode[key];
    if (s.global[key] !== undefined) return s.global[key];
    if (s.player[key] !== undefined) return s.player[key];
    return undefined;
  }

  public addItem(itemId: string, quantity: number = 1, scope: StateScope = 'global'): void {
    this.state.update(s => {
      const ns = { ...s };
      const existing = ns.inventory.find(i => i.itemId === itemId && i.scope === scope);
      if (existing) existing.quantity += quantity;
      else ns.inventory.push({ itemId, quantity, scope });
      return ns;
    });
  }

  public removeItem(itemId: string, quantity: number = 1, scope?: StateScope): void {
    this.state.update(s => {
      const ns = { ...s };
      const itemIdx = ns.inventory.findIndex(i => i.itemId === itemId && (!scope || i.scope === scope));
      if (itemIdx >= 0) {
        ns.inventory[itemIdx].quantity -= quantity;
        if (ns.inventory[itemIdx].quantity <= 0) ns.inventory.splice(itemIdx, 1);
      }
      return ns;
    });
  }

  public hasItem(itemId: string, scope?: StateScope): boolean {
    return this.state().inventory.some(i => i.itemId === itemId && (!scope || i.scope === scope) && i.quantity > 0);
  }

  // 🔥 Propiedad central para el Narrative Role Jugable (Militar, Civil, etc)
  public get playerRole(): string {
    return this.state().activeRole;
  }

  public setPlayerRole(roleUid: string): void {
    this.state.update(s => ({ ...s, activeRole: roleUid }));
  }

  public loadGame(savedData: any): void {
    const migrated = this.migrateState(savedData);
    this.state.set(migrated);
  }

  public clearSceneState(): void {
    this.state.update(s => ({
       ...s,
       scene: {},
       inventory: s.inventory.filter(i => i.scope !== 'scene')
    }));
  }

  private migrateState(savedData: any): GameStateData {
    if (!savedData) return this.createEmptyState();
    
    const ws = savedData.worldState;
    if (ws && ws.schemaVersion === 2) {
       return {
         schemaVersion: 2,
         global: ws.global || {},
         episode: ws.episode || {},
         scene: ws.scene || {},
         player: ws.player || {},
         activeRole: ws.activeRole || '', // Se adapta silenciosamente si venía 'campesino' legacy
         inventory: Array.isArray(savedData.inventory) ? savedData.inventory : []
       };
    }

    const migrated = this.createEmptyState();
    if (ws) migrated.episode = { ...ws };
    
    if (Array.isArray(savedData.inventory)) {
       migrated.inventory = savedData.inventory.map((id: any) => {
          if (typeof id === 'string') return { itemId: id, quantity: 1, scope: 'global' };
          return id; 
       });
    }
    
    if (savedData.playerRole) migrated.activeRole = savedData.playerRole;
    return migrated;
  }

  public getSaveData(): any {
    const s = this.state();
    return {
      worldState: {
        schemaVersion: 2,
        global: s.global,
        episode: s.episode,
        scene: s.scene,
        player: s.player,
        activeRole: s.activeRole // 🔥 Siempre guardamos el rol activo
      },
      inventory: s.inventory
    };
  }

  public resetState(): void {
    this.state.set(this.createEmptyState());
  }

  public evaluateGameCondition(cond: GameCondition): boolean {
    const actualValue = this.getVar(cond.key, cond.scope as StateScope);
    switch(cond.type) {
      case 'var_eq': return actualValue === cond.value;
      case 'var_neq': return actualValue !== cond.value;
      case 'has_item': return this.hasItem(cond.key, cond.scope as StateScope);
      case 'missing_item': return !this.hasItem(cond.key, cond.scope as StateScope);
      case 'role_eq': return this.playerRole === cond.key;
      default: return true;
    }
  }

  public evaluateAllConditions(conditions?: GameCondition[]): boolean {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every(c => this.evaluateGameCondition(c));
  }

  public applyMutation(mut: GameStateMutation): void {
    const scope = (mut.scope as StateScope) || 'episode';
    switch(mut.type) {
      case 'set_var': this.setVar(mut.key, mut.value, scope); break;
      case 'add_item': this.addItem(mut.key, typeof mut.value === 'number' ? mut.value : 1, scope); break;
      case 'remove_item': this.removeItem(mut.key, typeof mut.value === 'number' ? mut.value : 1, mut.scope as StateScope); break;
    }
  }

  public applyMutations(mutations?: GameStateMutation[]): void {
    if (!mutations || mutations.length === 0) return;
    mutations.forEach(m => this.applyMutation(m));
  }
}