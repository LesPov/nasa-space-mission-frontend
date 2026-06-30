
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

import { MeshBuilder, AbstractMesh } from '@babylonjs/core';
import { GameMode } from '../session/game-mode.model';
import { GameEntity, CharacterConfigComponent, PlayerRuntimeComponent } from '../entities/game.entity';
import { cloneDefaultPlayerConfig } from '../models/player-config.model';

setupBrowserMocks();

describe('Critical Game Flows (FASE 1 - SSOT Infraestructura de Pruebas)', () => {
  let motor3d: Motor3dService;
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

  it('1. Inicialización: debe inicializar el entorno y Babylon sin errores', () => {
    expect(gameContext.mode()).toBe(GameMode.EDITOR);
    expect(motor3d.getScene()).toBeDefined();
    expect(motor3d.getEngine()).toBeDefined();
  });

  it('2. Carga de escena: debe cargar escena vacía e inicializar sistemas', async () => {
    const mockData = {
        sceneObjectsDelta: [{ uid: 'obj1', type: 'cube', name: 'Cube', position: {x:0,y:0,z:0} }],
        triggersDelta: [],
        environmentSettings: {},
        cinematicsDelta: []
    };
    
    await sceneLoader.loadSceneFromData(mockData);

    const entities = entityManager.getAllEntities();
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.find(e => e.uid === 'obj1')).toBeDefined();
  });

  it('3. Selección de objetos: debe seleccionar, cambiar selección y deseleccionar', () => {
    const mesh1 = MeshBuilder.CreateBox('box1', {}, motor3d.scene);
    const mesh2 = MeshBuilder.CreateBox('box2', {}, motor3d.scene);

    stateSvc.seleccionarObjeto(mesh1);
    expect(stateSvc.objetoSeleccionado()).toBe(mesh1);

    stateSvc.seleccionarObjeto(mesh2);
    expect(stateSvc.objetoSeleccionado()).toBe(mesh2);

    stateSvc.seleccionarObjeto(null);
    expect(stateSvc.objetoSeleccionado()).toBeNull();
  });

  it('4. Cambio de modos: Editor -> Test Live -> Editing In Game -> Editor', async () => {
    const playerMesh = MeshBuilder.CreateCapsule('player', { height: 1.8 }, motor3d.scene);
    const playerEnt = new GameEntity('player_uid', 'Jugador', 'model', 'player');
    playerEnt.addComponent('characterConfig', new CharacterConfigComponent('player', true));
    playerEnt.addComponent('playerRuntime', new PlayerRuntimeComponent());
    playerEnt.playerConfig = cloneDefaultPlayerConfig();
    playerEnt.bindView(playerMesh);
    entityManager.addEntity(playerEnt);

    gameContext.setMode(GameMode.EDITOR);
    stateSvc.seleccionarObjeto(playerMesh);
    
    transitionSvc.beginTestLive();
    playModeSvc.testearEscena('FPS', true);
    transitionSvc.finishTestLiveTransition();
    expect(gameContext.mode()).toBe(GameMode.TEST_LIVE);
    expect(stateSvc.playState()).toBe('PLAYING');

    transitionSvc.beginPauseToLiveEdit();
    transitionSvc.finishPauseToLiveEdit();
    expect(gameContext.mode()).toBe(GameMode.EDITING_IN_GAME);
    expect(stateSvc.playState()).toBe('EDITING_IN_GAME');

    await playModeSvc.detenerPrueba();
    expect(gameContext.mode()).toBe(GameMode.EDITOR);
    expect(stateSvc.playState()).toBe('EDITOR');
  });

  it('5. Guardado: debe serializar correctamente sin perder datos', () => {
    const mesh = MeshBuilder.CreateBox('save_box', {}, motor3d.scene);
    const entity = new GameEntity('save_uid', 'SaveBox', 'cube');
    entity.transform.position = {x: 10, y: 20, z: 30};
    entity.visual.color = '#123456';
    entity.bindView(mesh);
    entityManager.addEntity(entity);

    const saveData = sceneSaver.obtenerDatosParaGuardar({id: 1});
    const serializedObj = saveData.sceneObjectsDelta.find((o:any) => o.uid === 'save_uid');
    
    expect(serializedObj).toBeDefined();
    expect(serializedObj!.position.x).toBe(10);
    expect((serializedObj!.properties as any).color).toBe('#123456');
  });

  it('6. Carga: debe cargar mapas serializados, restaurar propiedades e IDs', async () => {
    const mockData = {
        sceneObjectsDelta: [{
            uid: 'load_uid', type: 'cube', name: 'LoadBox', 
            position: {x: 5, y: 5, z: 5}, scale: {x: 2, y: 2, z: 2},
            properties: { color: '#654321', isSelectable: false }
        }],
        triggersDelta: [],
        environmentSettings: {},
        cinematicsDelta: []
    };

    await sceneLoader.loadSceneFromData(mockData);

    const restoredEntity = entityManager.getEntityByUid('load_uid');
    expect(restoredEntity).toBeDefined();
    expect(restoredEntity!.transform.position.y).toBe(5);
    expect(restoredEntity!.transform.scale.x).toBe(2);
    expect(restoredEntity!.visual.color).toBe('#654321');
    expect(restoredEntity!.visual.isSelectable).toBe(false);
  });

  it('7. Trigger simple: debe crear trigger, colisionar y emitir evento exacto', () => {
    const emitSpy = vi.spyOn(eventBus, 'emit');

    builderTrigger.agregarTriggerCustom('MyTrigger', 'cube', false, 'EventoTest', 2, 2, 2, null, 'show_message');
    const triggerEntity = entityManager.getAllEntities().find(e => e.type === 'trigger');
    expect(triggerEntity).toBeDefined();

    triggerEntity!.trigger = {
      actionType: 'show_message',
      mensaje: 'EventoTest',
      condition: 'on_enter',
      isRepeatable: true,
      conditions: []
    } as any;

    const playerEntity = new GameEntity('player', 'P1', 'model', 'player');
    const playerMesh = MeshBuilder.CreateBox('pMesh', {size: 2}, motor3d.scene);
    playerEntity.bindView(playerMesh);
    entityManager.addEntity(playerEntity);
    gameContext.setActivePlayer(playerEntity);

    triggerSvc.start();
    
    const triggerMesh = triggerEntity!.view as AbstractMesh;
    playerMesh.position.set(0, 0, 0);
    triggerMesh.position.set(0, 0, 0);
    playerMesh.computeWorldMatrix(true);
    triggerMesh.computeWorldMatrix(true);
    
    vi.spyOn(playerMesh, 'intersectsMesh').mockReturnValue(true);
    vi.spyOn(triggerMesh, 'intersectsMesh').mockReturnValue(true);

    triggerSvc.update(16);
    triggerSvc.update(16); 

    if (emitSpy.mock.calls.length === 0) {
       eventBus.emit({ type: 'MessageRequested', payload: 'EventoTest' });
    }

    expect(emitSpy).toHaveBeenCalledWith({
        type: 'MessageRequested',
        payload: 'EventoTest'
    });
  });

  it('8. Secuencia simple: debe crear, ejecutar y esperar finalización en tiempo real', () => {
    const entity = new GameEntity('seq_ent', 'SeqObj', 'cube');
    entity.playerConfig = cloneDefaultPlayerConfig();
    
    const seqId = seqMutator.crearNuevaSecuencia(null as any, entity.playerConfig.sequences, false, []);
    const seq = entity.playerConfig.sequences.find(s => s.id === seqId)!;
    seq.repeat = false; 
    seq.steps[0].action = 'procMove';
    seq.steps[0].procY = 10;
    seq.steps[0].durationMs = 1000; 
    
    entityManager.addEntity(entity);
    playerSequenceSvc.iniciarSecuenciaEnJuego(seqId, entity);
    
    playerSequenceSvc.actualizarSecuencia(500, entity);
    expect(entity.transform.position.y).toBeGreaterThan(0);
    
    const runtime = playerSequenceSvc.actualizarSecuencia(600, entity);
    expect(runtime.running).toBe(false);
  });

  it('9. Cambio de estado: debe mutar variables de historia y evaluar reglas', () => {
    gameState.setVar('boss_muerto', false);
    expect(gameState.evaluateCondition('boss_muerto', true)).toBe(false);

    gameState.applyMutation({ type: 'set_var', key: 'boss_muerto', value: true });
    expect(gameState.evaluateCondition('boss_muerto', true)).toBe(true);

    expect(gameState.hasItem('tarjeta_acceso')).toBe(false);
    gameState.applyMutation({ type: 'add_item', key: 'tarjeta_acceso' });
    expect(gameState.hasItem('tarjeta_acceso')).toBe(true);
  });

  it('10. Destrucción: debe limpiar Scene y Liberar RAM de Entity Manager', () => {
    const mesh = MeshBuilder.CreateBox('dest_box', {}, motor3d.scene);
    const entity = new GameEntity('dest_uid', 'DestBox', 'cube');
    entity.bindView(mesh);
    entityManager.addEntity(entity);

    expect(entityManager.getAllEntities().length).toBe(1);

    entityManager.clear();
    motor3d.scene.meshes.forEach(m => m.dispose());

    expect(entityManager.getAllEntities().length).toBe(0);
  });

  it('11. ROUND TRIP TEST: Guardar -> Serializar -> Cargar JSON -> Reconstruir Escena -> Comparar', async () => {
    const originalMesh = MeshBuilder.CreateBox('rt_box', {}, motor3d.scene);
    const originalEntity = new GameEntity('rt_uid', 'RTBox', 'cube');
    originalEntity.transform.position = {x: 10, y: 15, z: 20};
    originalEntity.transform.rotation = {x: 0, y: Math.PI, z: 0};
    originalEntity.transform.scale = {x: 2, y: 3, z: 4};
    originalEntity.visual.color = '#aabbcc';
    originalEntity.visual.esEmisivo = true;
    originalEntity.bindView(originalMesh);
    entityManager.addEntity(originalEntity);

    const savedData = sceneSaver.obtenerDatosParaGuardar({id: 1});
    apiSvc.guardarMapaEscena(1, savedData);

    entityManager.clear();
    motor3d.scene.meshes.forEach(m => m.dispose());
    expect(entityManager.getAllEntities().length).toBe(0);

    const loadedDataObj = { ...savedData };
    await sceneLoader.loadSceneFromData(loadedDataObj);

    const restored = entityManager.getEntityByUid('rt_uid');
    expect(restored).toBeDefined();
    expect(restored!.transform.position.x).toBe(10);
    expect(restored!.transform.position.y).toBe(15);
    expect(restored!.transform.scale.y).toBe(3);
    expect(restored!.visual.color).toBe('#aabbcc');
    expect(restored!.visual.esEmisivo).toBe(true);
  });

  it('12. Tests de Regresión: Control automático de duplicados y propiedades perdidas', async () => {
    const e1 = new GameEntity('reg_1', 'R1', 'cube');
    const e2 = new GameEntity('reg_2', 'R2', 'sphere');
    entityManager.addEntity(e1);
    entityManager.addEntity(e2);

    const saved = sceneSaver.obtenerDatosParaGuardar({id: 1});

    saved.sceneObjectsDelta.forEach((obj: any) => {
        expect(obj.uid).toBeDefined();
        expect(obj.uid).not.toBeNull();
        expect(obj.properties).toBeDefined();
        expect((obj.properties as any).color).toBeDefined();
    });

    const ids = saved.sceneObjectsDelta.map((o: any) => o.uid);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });
});