// src/app/core/engine/session/game-context.service.ts

import { Injectable, signal, computed } from '@angular/core';
import { GameMode } from './game-mode.model';
import { 
  CameraViewMode, ToolModeContext, AppMode, EngineState, InputContext, 
  ExecutionContext, EditorSubmode 
} from './game-context.model';
import { AuthorityProfile, PROFILES } from './authority-profile.model';
import { GameEntity } from '../entities/game.entity';
import { Node, AbstractMesh } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class GameContextService {
  // ==========================================
  // ESTADO PRIVADO (SINGLE SOURCE OF TRUTH)
  // ==========================================
  
  // Dimensiones de Ejecución y Submodo
  readonly #executionContext = signal<ExecutionContext>('EDITOR');
  readonly #editorSubmode = signal<EditorSubmode | null>('EDITING');

  // Estado del Motor y Permisos
  readonly #mode = signal<GameMode>(GameMode.EDITOR);
  readonly #appMode = signal<AppMode>('EDITOR');
  readonly #engineState = signal<EngineState>('STOPPED');
  readonly #inputContext = signal<InputContext>('UI');
  readonly #authorityProfile = signal<AuthorityProfile>(PROFILES.ADMIN_EDITING);

  // Transiciones y Diálogos
  readonly #isTransitioning = signal<boolean>(false);
  readonly #isInteracting = signal<boolean>(false);

  // Runtime Session
  readonly #cameraView = signal<CameraViewMode>('FPS');
  readonly #activePlayerEntity = signal<GameEntity | null>(null);
  readonly #isPointerLocked = signal<boolean>(false);

  // Selection & Interaction
  readonly #selectedNode = signal<Node | null>(null);
  readonly #subSelectedObject = signal<'collider' | 'camera' | 'light' | 'fog' | null>(null);
  readonly #hoveredObject = signal<AbstractMesh | null>(null);
  readonly #interactedObject = signal<Node | null>(null);

  // Editor UI State
  readonly #currentTool = signal<ToolModeContext>('translate');
  readonly #isAddObjectModalOpen = signal<boolean>(false);
  readonly #isFogDisabled = signal<boolean>(false);
  readonly #isPreviewMissionModalOpen = signal<boolean>(false);

  // Map & Scene Data
  readonly #sceneNodes = signal<Node[]>([]);
  readonly #activeEpisode = signal<any>(null);
  readonly #activePlatformId = signal<number | null>(null);
  readonly #activePlatformData = signal<any>(null);
  readonly #platforms = signal<any[]>([]);

  // ==========================================
  // ESTADO PÚBLICO INMUTABLE (COMPUTED)
  // ==========================================

  public readonly executionContext = computed(() => this.#executionContext());
  public readonly editorSubmode = computed(() => this.#editorSubmode());

  public readonly mode = computed(() => this.#mode());
  public readonly appMode = computed(() => this.#appMode());
  public readonly engineState = computed(() => this.#engineState());
  public readonly inputContext = computed(() => this.#inputContext());
  public readonly authorityProfile = computed(() => this.#authorityProfile());

  public readonly isTransitioning = computed(() => this.#isTransitioning());
  public readonly isInteracting = computed(() => this.#isInteracting());

  public readonly cameraView = computed(() => this.#cameraView());
  public readonly activePlayerEntity = computed(() => this.#activePlayerEntity());
  public readonly isPointerLocked = computed(() => this.#isPointerLocked());

  public readonly selectedNode = computed(() => this.#selectedNode());
  public readonly subSelectedObject = computed(() => this.#subSelectedObject());
  public readonly hoveredObject = computed(() => this.#hoveredObject());
  public readonly interactedObject = computed(() => this.#interactedObject());

  public readonly currentTool = computed(() => this.#currentTool());
  public readonly isAddObjectModalOpen = computed(() => this.#isAddObjectModalOpen());
  public readonly isFogDisabled = computed(() => this.#isFogDisabled());
  public readonly isPreviewMissionModalOpen = computed(() => this.#isPreviewMissionModalOpen());

  public readonly sceneNodes = computed(() => this.#sceneNodes());
  public readonly activeEpisode = computed(() => this.#activeEpisode());
  public readonly activePlatformId = computed(() => this.#activePlatformId());
  public readonly activePlatformData = computed(() => this.#activePlatformData());
  public readonly platforms = computed(() => this.#platforms());

  // Lógica Derivada Reactiva
  public readonly isPlaying = computed(() => 
    this.#engineState() === 'PLAYING' ||
    this.#mode() === GameMode.TEST_LIVE || 
    this.#mode() === GameMode.PREVIEW_ADMIN || 
    this.#mode() === GameMode.FINAL_USER
  );
  
  public readonly isDebugMode = computed(() => 
    this.#authorityProfile().canViewDebug
  );

  public readonly isEditor = computed(() => this.#executionContext() === 'EDITOR');
  public readonly isPlayerPreview = computed(() => this.#executionContext() === 'PLAYER_PREVIEW');
  public readonly isAdminPreview = computed(() => this.#executionContext() === 'ADMIN_PREVIEW');

  // ==========================================
  // CONFIGURACIÓN DE CONTEXTO Y AUTORIDAD (FASE 1)
  // ==========================================

  public setupContext(
    context: ExecutionContext,
    options?: { submode?: EditorSubmode; cameraView?: CameraViewMode }
  ): void {
    this.#executionContext.set(context);

    if (options?.cameraView) {
      this.#cameraView.set(options.cameraView);
    }

    switch (context) {
      case 'PLAYER_PREVIEW':
        this.#editorSubmode.set(null);
        this.#mode.set(GameMode.FINAL_USER);
        this.#appMode.set('PLAYER');
        this.#engineState.set('PLAYING');
        this.#inputContext.set('PLAYER');
        this.#authorityProfile.set(PROFILES.PLAYER);
        break;

      case 'ADMIN_PREVIEW':
        this.#editorSubmode.set(null);
        this.#mode.set(GameMode.PREVIEW_ADMIN);
        this.#appMode.set('PLAYER');
        this.#engineState.set('PLAYING');
        this.#inputContext.set('PLAYER');
        this.#authorityProfile.set(PROFILES.ADMIN_PREVIEW);
        break;

      case 'EDITOR':
        const sub = options?.submode ?? 'EDITING';
        this.setEditorSubmode(sub);
        break;
    }
  }

  public setEditorSubmode(submode: EditorSubmode): void {
    this.#executionContext.set('EDITOR');
    this.#editorSubmode.set(submode);

    switch (submode) {
      case 'EDITING':
        this.#mode.set(GameMode.EDITOR);
        this.#appMode.set('EDITOR');
        this.#engineState.set('STOPPED');
        this.#inputContext.set('UI');
        this.#authorityProfile.set(PROFILES.ADMIN_EDITING);
        break;

      case 'PLAYTEST_FPS':
        this.#mode.set(GameMode.TEST_LIVE);
        this.#appMode.set('EDITOR');
        this.#engineState.set('PLAYING');
        this.#inputContext.set('PLAYER');
        this.#authorityProfile.set(PROFILES.ADMIN_PLAYING);
        this.#cameraView.set('FPS');
        break;

      case 'PLAYTEST_TPS':
        this.#mode.set(GameMode.TEST_LIVE);
        this.#appMode.set('EDITOR');
        this.#engineState.set('PLAYING');
        this.#inputContext.set('PLAYER');
        this.#authorityProfile.set(PROFILES.ADMIN_PLAYING);
        this.#cameraView.set('TPS');
        break;

      case 'EDITING_IN_GAME':
        this.#mode.set(GameMode.EDITING_IN_GAME);
        this.#appMode.set('EDITOR');
        this.#engineState.set('PAUSED');
        this.#inputContext.set('UI');
        this.#authorityProfile.set(PROFILES.ADMIN_EDITING);
        break;
    }
  }

  // Retrocompatibilidad con llamadas legacy
  public setMode(newMode: GameMode): void {
    switch (newMode) {
      case GameMode.EDITOR:
        this.setupContext('EDITOR', { submode: 'EDITING' });
        break;
      case GameMode.TEST_LIVE:
        this.setupContext('EDITOR', { 
          submode: this.#cameraView() === 'TPS' ? 'PLAYTEST_TPS' : 'PLAYTEST_FPS' 
        });
        break;
      case GameMode.EDITING_IN_GAME:
        this.setupContext('EDITOR', { submode: 'EDITING_IN_GAME' });
        break;
      case GameMode.PREVIEW_ADMIN:
        this.setupContext('ADMIN_PREVIEW');
        break;
      case GameMode.FINAL_USER:
        this.setupContext('PLAYER_PREVIEW');
        break;
    }
  }

  public setTransitioning(val: boolean): void { 
    this.#isTransitioning.set(val); 
    if (val) this.#engineState.set('TRANSITIONING');
  }

  public setInteracting(val: boolean): void { 
    this.#isInteracting.set(val); 
  }

  public setCameraView(view: CameraViewMode): void { this.#cameraView.set(view); }
  public setActivePlayer(entity: GameEntity | null): void { this.#activePlayerEntity.set(entity); }
  public setPointerLocked(locked: boolean): void { this.#isPointerLocked.set(locked); }

  public setSelectedNode(node: Node | null): void { this.#selectedNode.set(node); }
  public setSubSelectedObject(sub: 'collider' | 'camera' | 'light' | 'fog' | null): void { this.#subSelectedObject.set(sub); }
  public setHoveredObject(mesh: AbstractMesh | null): void { this.#hoveredObject.set(mesh); }
  public setInteractedObject(node: Node | null): void { this.#interactedObject.set(node); }

  public setCurrentTool(tool: ToolModeContext): void { this.#currentTool.set(tool); }
  public setAddObjectModalOpen(isOpen: boolean): void { this.#isAddObjectModalOpen.set(isOpen); }
  public setFogDisabled(isDisabled: boolean): void { this.#isFogDisabled.set(isDisabled); }
  public setPreviewMissionModalOpen(isOpen: boolean): void { this.#isPreviewMissionModalOpen.set(isOpen); }

  public setSceneNodes(nodes: Node[]): void { this.#sceneNodes.set(nodes); }
  public setActiveEpisode(data: any): void { this.#activeEpisode.set(data); }
  public setActivePlatformId(id: number | null): void { this.#activePlatformId.set(id); }
  public setActivePlatformData(data: any): void { this.#activePlatformData.set(data); }
  public setPlatforms(platforms: any[]): void { this.#platforms.set(platforms); }

  public startGameSession(player: GameEntity, view: CameraViewMode): void {
    this.setActivePlayer(player);
    this.setCameraView(view);
    this.setPointerLocked(true);
  }

  public stopGameSession(): void {
    this.setActivePlayer(null);
    this.setPointerLocked(false);
  }
}