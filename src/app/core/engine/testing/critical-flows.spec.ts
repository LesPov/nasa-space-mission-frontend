
import '@angular/compiler';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

if (!getTestBed().platform) {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
}

import { HttpClient } from '@angular/common/http';
import { Router, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { setupBrowserMocks } from './mocks/browser.mock';
import { setupTestEngine } from './helpers/engine-setup';
import { MockEpisodiosService } from './mocks/api.mock';
import { MockAuthService } from './mocks/auth.mock';

import { Motor3dService } from '../../../services/motor-3d.service';
import { EditorMapaService } from '../../../services/editor-mapa.service';
import { EditorPlayModeService } from '../../../services/editor/editor-play-mode.service';
import { CoreSceneLoaderService } from '../scene/utils/core-scene-loader.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { GameContextService } from '../session/game-context.service';
import { EditorStateService } from '../../../services/editor/editor-state.service';
import { EditorModeTransitionService } from '../../../services/editor/editor-mode-transition.service';
import { SceneSaverService } from '../../../services/editor/sceneservice/scene-saver.service';
import { BuilderTriggerService } from '../../../services/editor/sceneservice/builder-trigger.service';
import { PlayerTriggerService } from '../runtime/systems/player-trigger.service';
import { PlayerSequenceService } from '../runtime/systems/player-sequence.service';
import { GameStateService } from '../runtime/state/game-state.service';
import { GameEventBusService } from '../events/game-event-bus.service';
import { LoopManagerService } from '../behaviors/services/loop-manager.service';
import { SequenceMutatorService } from '../../../services/editor/mutators/sequence-mutator.service';
import { SCENE_ACCESS_TOKEN } from '../scene/scene-access.token';
import { CoreModelLoaderService } from '../scene/utils/core-model-loader.service';
import { CorePrimitiveLoaderService } from '../scene/utils/core-primitive-loader.service';
import { CoreTriggerLoaderService } from '../scene/utils/core-trigger-loader.service';
import { CoreSceneProjectionService } from '../scene/utils/core-scene-projection.service';
import { CoreSceneMaterialService } from '../scene/utils/core-scene-material.service';
import { CoreSceneUtilsService } from '../scene/utils/core-scene-utils.service';
import { EntityPersistenceMapperService } from '../scene/utils/entity-persistence-mapper.service';
import { WorldSettingsService } from '../world/world-settings.service';
import { CameraOwnershipService } from '../runtime/cameras/camera-ownership.service';
import { CameraFactoryService } from '../runtime/cameras/camera-factory.service';
import { CinematicDirectorService } from '../runtime/systems/cinematic-director.service';
import { ShadowOrchestratorService } from '../runtime/shadows/shadow-orchestrator.service';
import { DynamicLightingSystem } from '../runtime/systems/lighting/dynamic-lighting.system';
import { SpawnManagerService } from '../runtime/systems/spawn-manager.service';
import { EditorCinematicService } from '../../../services/editor/editor-cinematic.service';
import { PlayerCameraManagerService } from '../runtime/systems/player-camera.service';
import { InputOrchestratorService } from '../runtime/systems/input-orchestrator.service';
import { PlayerInteractionService } from '../runtime/systems/player-interaction.service';
import { PlayerInputService } from '../runtime/systems/player-input.service';
import { PlayerBubbleService } from '../runtime/systems/player-bubble.service';
import { InteractableRulesService } from '../runtime/rules/interactable-rules.service';
import { MediaCommandSystem } from '../runtime/systems/media-command.system';
import { CharacterKinematicsService } from '../runtime/systems/character-kinematics.service';
import { PlayerAnimationService } from '../runtime/systems/player-animation.service';
import { RenderSync } from '../runtime/systems/render-sync';
import { LayoutService } from '../../../services/layout.service';
import { EditorCameraService } from '../../../services/editor/editor-camera.service';
import { SceneObjectBuilderService } from '../../../services/editor/sceneservice/scene-object-builder.service';
import { SceneNodesService } from '../../../services/editor/sceneservice/scene-nodes.service';
import { ToolsSelectionService } from '../../../services/editor/toolsservice/tools-selection.service';
import { HistorialService } from '../../../services/historial.service';
import { ObjectAnimationService } from '../runtime/systems/object-animation.service';
import { PlayerFogService } from '../runtime/systems/player-fog.service';
import { RuntimeEngineService } from '../runtime/runtime-engine.service';
import { AdminFreeCameraService } from '../runtime/cameras/admin-free-camera.service';
import { FogRendererService } from '../runtime/systems/fog-renderer.service';
import { WindowSyncService } from '../../services/window-sync.service';
import { EpisodiosService } from '../../../services/api/episodios';
import { AuthService } from '../../services/auth';
import { EditorOrchestratorService } from '../../../services/editor/editor-orchestrator.service';
import { EditorLiveSyncService } from '../../../services/editor/editor-live-sync.service';

import { MeshBuilder, AbstractMesh } from '@babylonjs/core';
import { GameMode } from '../session/game-mode.model';
import { GameEntity, CharacterConfigComponent, PlayerRuntimeComponent } from '../entities/game.entity';
import { cloneDefaultPlayerConfig } from '../models/player-config.model';

setupBrowserMocks();

describe('Critical Game Flows (FASE 2 - Extracción de Orquestador)', () => {
  let motor3d: Motor3dService;
  let orchestrator: EditorOrchestratorService;
  let liveSync: EditorLiveSyncService;
  let editorSvc: EditorMapaService;
  let playModeSvc: EditorPlayModeService;
  let sceneLoader: CoreSceneLoaderService;
  let entityManager: EntityManagerService;
  let gameContext: GameContextService;
  let stateSvc: EditorStateService;
  let transitionSvc: EditorModeTransitionService;
  let sceneSaver: SceneSaverService;
  let builderTrigger: BuilderTriggerService;
  let triggerSvc: PlayerTriggerService;
  let playerSequenceSvc: PlayerSequenceService;
  let gameState: GameStateService;
  let eventBus: GameEventBusService;
  let loopManager: LoopManagerService;
  let seqMutator: SequenceMutatorService;
  let apiSvc: MockEpisodiosService;

  beforeEach(() => {
    TestBed.resetTestingModule(); 
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: {} },
        { provide: Router, useValue: { navigate: vi.fn(), serializeUrl: vi.fn(), createUrlTree: vi.fn() } },
        { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { paramMap: { get: vi.fn() } } } },
        { provide: EpisodiosService, useClass: MockEpisodiosService },
        { provide: AuthService, useClass: MockAuthService },
        
        Motor3dService,
        { provide: SCENE_ACCESS_TOKEN, useExisting: Motor3dService },
        GameContextService,
        EntityManagerService,
        GameStateService,
        GameEventBusService,
        LoopManagerService,
        WorldSettingsService,
        WindowSyncService,
        
        CoreSceneLoaderService,
        CoreModelLoaderService,
        CorePrimitiveLoaderService,
        CoreTriggerLoaderService,
        CoreSceneProjectionService,
        CoreSceneMaterialService,
        CoreSceneUtilsService,
        EntityPersistenceMapperService,

        RuntimeEngineService,
        CameraOwnershipService,
        CameraFactoryService,
        CinematicDirectorService,
        ShadowOrchestratorService,
        DynamicLightingSystem,
        SpawnManagerService,
        PlayerCameraManagerService,
        InputOrchestratorService,
        PlayerInteractionService,
        PlayerInputService,
        PlayerBubbleService,
        InteractableRulesService,
        MediaCommandSystem,
        CharacterKinematicsService,
        PlayerAnimationService,
        RenderSync,
        ObjectAnimationService,
        PlayerFogService,
        AdminFreeCameraService,
        FogRendererService,
        PlayerTriggerService,
        PlayerSequenceService,

        EditorMapaService,
        EditorPlayModeService,
        EditorOrchestratorService,
        EditorLiveSyncService,
        EditorStateService,
        EditorModeTransitionService,
        SceneSaverService,
        BuilderTriggerService,
        SequenceMutatorService,
        EditorCinematicService,
        LayoutService,
        EditorCameraService,
        SceneObjectBuilderService,
        SceneNodesService,
        ToolsSelectionService,
        HistorialService,
      ]
    });

    motor3d = TestBed.inject(Motor3dService);
    editorSvc = TestBed.inject(EditorMapaService);
    orchestrator = TestBed.inject(EditorOrchestratorService);
    liveSync = TestBed.inject(EditorLiveSyncService);
    playModeSvc = TestBed.inject(EditorPlayModeService);
    sceneLoader = TestBed.inject(CoreSceneLoaderService);
    entityManager = TestBed.inject(EntityManagerService);
    gameContext = TestBed.inject(GameContextService);
    stateSvc = TestBed.inject(EditorStateService);
    transitionSvc = TestBed.inject(EditorModeTransitionService);
    sceneSaver = TestBed.inject(SceneSaverService);
    builderTrigger = TestBed.inject(BuilderTriggerService);
    triggerSvc = TestBed.inject(PlayerTriggerService);
    playerSequenceSvc = TestBed.inject(PlayerSequenceService);
    gameState = TestBed.inject(GameStateService);
    eventBus = TestBed.inject(GameEventBusService);
    loopManager = TestBed.inject(LoopManagerService);
    seqMutator = TestBed.inject(SequenceMutatorService);
    apiSvc = TestBed.inject(EpisodiosService) as unknown as MockEpisodiosService;

    setupTestEngine(motor3d, loopManager);

    const shadowOrch = TestBed.inject(ShadowOrchestratorService);
    vi.spyOn(shadowOrch, 'asignarObjetosASombrasDeLuces').mockImplementation(() => {});
  });

  afterEach(() => {
    if (motor3d) motor3d.detenerMotor();
    if (entityManager) entityManager.clear();
    vi.clearAllMocks();
  });

  it('1. Inicialización: el orquestador toma el control de los ciclos y limpia el componente', () => {
    expect(gameContext.mode()).toBe(GameMode.EDITOR);
    expect(orchestrator).toBeDefined();
    expect(liveSync).toBeDefined();
  });

  it('2. Orquestador: Puede gestionar la transición y detener la prueba interactuando con PlayModeSvc', async () => {
    const playerMesh = MeshBuilder.CreateCapsule('player', { height: 1.8 }, motor3d.scene);
    const playerEnt = new GameEntity('player_uid', 'Jugador', 'model', 'player');
    playerEnt.addComponent('characterConfig', new CharacterConfigComponent('player', true));
    playerEnt.addComponent('playerRuntime', new PlayerRuntimeComponent());
    playerEnt.playerConfig = cloneDefaultPlayerConfig();
    playerEnt.bindView(playerMesh);
    entityManager.addEntity(playerEnt);

    gameContext.setMode(GameMode.EDITOR);
    stateSvc.seleccionarObjeto(playerMesh);
    
    // El Orquestador ahora hace el trabajo sucio
    orchestrator.iniciarModoPrueba('FPS', true);
    expect(gameContext.mode()).toBe(GameMode.TEST_LIVE);
    expect(stateSvc.playState()).toBe('PLAYING');

    transitionSvc.beginPauseToLiveEdit();
    transitionSvc.finishPauseToLiveEdit();
    expect(gameContext.mode()).toBe(GameMode.EDITING_IN_GAME);
    expect(stateSvc.playState()).toBe('EDITING_IN_GAME');

    await orchestrator.detenerModoPrueba();
    expect(gameContext.mode()).toBe(GameMode.EDITOR);
    expect(stateSvc.playState()).toBe('EDITOR');
  });

  it('3. LiveSync: Centraliza los mensajes del Broadcast Channel correctamente', () => {
    const broadcastSpy = vi.spyOn(TestBed.inject(WindowSyncService), 'broadcast');
    const dummyMapData = { sceneObjectsDelta: [] };
    
    liveSync.broadcastMapData(dummyMapData);
    expect(broadcastSpy).toHaveBeenCalledWith({ type: 'SYNC_MAP_DATA', payload: dummyMapData });
  });

});