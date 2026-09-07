
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GameStateService } from '../runtime/state/game-state.service';
import { SpawnManagerService } from '../runtime/systems/spawn-manager.service';
import { GameContextService } from '../session/game-context.service';

describe('Narrative Role Integration (Fase 1)', () => {
    let gameState: GameStateService;
    let context: GameContextService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [GameStateService, GameContextService, SpawnManagerService]
        });
        gameState = TestBed.inject(GameStateService);
        context = TestBed.inject(GameContextService);
    });

    it('1. El Role Lock debe persistir inmutable en la memoria del juego', () => {
        gameState.setPlayerRole('militar_uid');
        expect(gameState.playerRole).toBe('militar_uid');
        
        // Simular un reseteo de escena, el rol NO debe borrarse
        gameState.clearSceneState();
        expect(gameState.playerRole).toBe('militar_uid');
    });

    it('2. El Role Lock debe serializarse correctamente para la Base de Datos', () => {
        gameState.setPlayerRole('civil_uid');
        const savedData = gameState.getSaveData();
        
        expect(savedData.worldState.activeRole).toBe('civil_uid');
    });

    it('3. El GameState debe restaurar un Rol guardado de partidas anteriores', () => {
        const fakeSave = {
            worldState: {
                schemaVersion: 2,
                activeRole: 'medico_uid'
            }
        };
        
        gameState.loadGame(fakeSave);
        expect(gameState.playerRole).toBe('medico_uid');
    });
});