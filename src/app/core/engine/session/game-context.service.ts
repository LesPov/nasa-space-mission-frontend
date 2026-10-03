
// src/app/core/engine/session/game-context.service.ts

import { Injectable, signal, computed } from '@angular/core';
import { GameMode } from './game-mode.model';
import { 
  CameraViewMode, ToolModeContext, AppMode, EngineState, InputContext, 
  ExecutionContext, EditorSubmode, RuntimeReadyStage 
} from './game-context.model';
import { AuthorityProfile, PROFILES } from './authority-profile.model';
import { GameEntity } from '../entities/game.entity';
import { Node, AbstractMesh } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class GameContextService {
  readonly #executionContext = signal<ExecutionContext>('EDITOR');
  readonly #editorSubmode = signal<EditorSubmode | null>('EDITING');

  readonly #mode = signal<GameMode>(GameMode.EDITOR);
  readonly #appMode = signal<AppMode>('EDITOR');
  readonly #engineState = signal<EngineState>('STOPPED');
  readonly #inputContext = signal<InputContext>('EDITOR_EDITING');
  readonly #authorityProfile = signal<AuthorityProfile>(PROFILES.ADMIN_EDITING);
  readonly #runtimeReadyStage = signal<RuntimeReadyStage>('IDLE');

  readonly #isTransitioning = signal<boolean>(false);
  readonly #isInteracting = signal<boolean>(false);

  readonly #cameraView = signal<CameraViewMode>('FPS');
  readonly #activePlayerEntity = signal<GameEntity | null>(null);
  readonly #isPointerLocked = signal<boolean>(false);

  readonly #selectedNode = signal<Node | null>(null);
  readonly #subSelectedObject = signal<'collider' | 'camera' | 'light' | 'fog' | null>(null);
  readonly #hoveredObject = signal<AbstractMesh | null>(null);
  readonly #interactedObject = signal<Node | null>(null);

  readonly #currentTool = signal<ToolModeContext>('translate');
  readonly #isAddObjectModalOpen = signal<boolean>(false);
  readonly #isFogDisabled = signal<boolean>(false);
  readonly #isPreviewMissionModalOpen = signal<boolean>(false);

  readonly #sceneNodes = signal<Node[]>([]);
  readonly #activeEpisode = signal<any>(null);
  readonly #activePlatformId = signal<number | null>(null);
  readonly #activePlatformData = signal<any>(null);
  readonly #platforms = signal<any[]>([]);

  private _isCinematicPlaying = false;
  private _activeCinematicId: string | null = null;
  private _cinematicTimeMs = 0;

  public readonly executionContext = computed(() => this.#executionContext());
  public readonly editorSubmode = computed(() => this.#editorSubmode());

  public readonly mode = computed(() => this.#mode());
  public readonly appMode = computed(() => this.#appMode());
  public readonly engineState = computed(() => this.#engineState());
  public readonly inputContext = computed(() => this.#inputContext());
  public readonly authorityProfile = computed(() => this.#authorityProfile());
  public readonly runtimeReadyStage = computed(() => this.#runtimeReadyStage());

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

  // 🔥 FIX ARQUITECTÓNICO: isPlaying es ESTRICTAMENTE falso si el modo es EDITOR o EDITING_IN_GAME
  public readonly isPlaying = computed(() => {
    const currentMode = this.#mode();
    if (currentMode === GameMode.EDITOR || currentMode === GameMode.EDITING_IN_GAME) {
      return false;
    }
    return (
      (currentMode === GameMode.TEST_LIVE || 
       currentMode === GameMode.PREVIEW_ADMIN || 
       currentMode === GameMode.FINAL_USER) &&
      this.#engineState() === 'PLAYING'
    );
  });
  
  public readonly isDebugMode = computed(() => 
    this.#authorityProfile().canViewDebug
  );

  public readonly isEditor = computed(() => this.#executionContext() === 'EDITOR');
  public readonly isPlayerPreview = computed(() => this.#executionContext() === 'PLAYER_PREVIEW');
  public readonly isAdminPreview = computed(() => this.#executionContext() === 'ADMIN_PREVIEW');

  public isCinematicPlaying(): boolean { return this._isCinematicPlaying; }
  public activeCinematicId(): string | null { return this._activeCinematicId; }
  public cinematicTimeMs(): number { return this._cinematicTimeMs; }

  public setCinematicState(isPlaying: boolean, activeId: string | null, timeMs: number): void {
    this._isCinematicPlaying = isPlaying;
    this._activeCinematicId = activeId;
    this._cinematicTimeMs = timeMs;
  }

  public setRuntimeReadyStage(stage: RuntimeReadyStage): void {
    this.#runtimeReadyStage.set(stage);
  }

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
        this.#inputContext.set('GAMEPLAY');
        this.#authorityProfile.set(PROFILES.PLAYER);
        break;

      case 'ADMIN_PREVIEW':
        this.#editorSubmode.set(null);
        this.#mode.set(GameMode.PREVIEW_ADMIN);
        this.#appMode.set('PLAYER');
        this.#engineState.set('PLAYING');
        this.#inputContext.set('ADMIN_PREVIEW');
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
        this.#inputContext.set('EDITOR_EDITING');
        this.#authorityProfile.set(PROFILES.ADMIN_EDITING);
        break;

      case 'PLAYTEST_FPS':
        this.#mode.set(GameMode.TEST_LIVE);
        this.#appMode.set('EDITOR');
        this.#engineState.set('PLAYING');
        this.#inputContext.set('EDITOR_PLAYTEST');
        this.#authorityProfile.set(PROFILES.ADMIN_PLAYING);
        this.#cameraView.set('FPS');
        break;

      case 'PLAYTEST_TPS':
        this.#mode.set(GameMode.TEST_LIVE);
        this.#appMode.set('EDITOR');
        this.#engineState.set('PLAYING');
        this.#inputContext.set('EDITOR_PLAYTEST');
        this.#authorityProfile.set(PROFILES.ADMIN_PLAYING);
        this.#cameraView.set('TPS');
        break;

      case 'EDITING_IN_GAME':
        this.#mode.set(GameMode.EDITING_IN_GAME);
        this.#appMode.set('EDITOR');
        this.#engineState.set('PAUSED');
        this.#inputContext.set('EDITOR_EDITING');
        this.#authorityProfile.set(PROFILES.ADMIN_EDITING);
        break;
    }
  }

  public setInputContext(ctx: InputContext): void {
    this.#inputContext.set(ctx);
  }

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
    if (val) {
      this.#engineState.set('TRANSITIONING');
    } else {
      const currentMode = this.#mode();
      if (currentMode === GameMode.TEST_LIVE || currentMode === GameMode.PREVIEW_ADMIN || currentMode === GameMode.FINAL_USER) {
        this.#engineState.set('PLAYING');
      } else if (currentMode === GameMode.EDITING_IN_GAME) {
        this.#engineState.set('PAUSED');
      } else {
        this.#engineState.set('STOPPED');
      }
    }
  }

  public setInteracting(val: boolean): void { 
    this.#isInteracting.set(val);
    if (val) {
      this.#inputContext.set('UI');
    } else {
      if (this.#executionContext() === 'PLAYER_PREVIEW') {
        this.#inputContext.set('GAMEPLAY');
      } else if (this.#executionContext() === 'ADMIN_PREVIEW') {
        this.#inputContext.set('ADMIN_PREVIEW');
      } else if (this.#executionContext() === 'EDITOR') {
        this.#inputContext.set(
          this.#editorSubmode() === 'PLAYTEST_FPS' || this.#editorSubmode() === 'PLAYTEST_TPS'
            ? 'EDITOR_PLAYTEST'
            : 'EDITOR_EDITING'
        );
      }
    }
  }

  public setCameraView(view: CameraViewMode): void { this.#cameraView.set(view); }
  public setActivePlayer(entity: GameEntity | null): void { this.#activePlayerEntity.set(entity); }
  public setPointerLocked(locked: boolean): void { this.#isPointerLocked.set(locked); }

  public setSelectedNode(node: Node | null): void { this.#selectedNode.set(node); }
  public setSubSelectedObject(sub: 'collider' | 'camera' | 'light' | 'fog' | null): void { this.#subSelectedObject.set(sub); }
  public setHoveredObject(mesh: AbstractMesh | null): void { this.#hoveredObject.set(mesh); }
  public setInteractedObject(node: Node | null): void { this.#interactedObject.set(node); }

  public setCurrentTool(tool: ToolModeContext): void { this.#currentTool.set(tool); }
  
  public setAddObjectModalOpen(isOpen: boolean): void { 
    this.#isAddObjectModalOpen.set(isOpen);
    if (isOpen) {
      this.#inputContext.set('UI');
    } else {
      this.#inputContext.set('EDITOR_EDITING');
    }
  }
  
  public setFogDisabled(isDisabled: boolean): void { this.#isFogDisabled.set(isDisabled); }
  
  public setPreviewMissionModalOpen(isOpen: boolean): void { 
    this.#isPreviewMissionModalOpen.set(isOpen);
    if (isOpen) {
      this.#inputContext.set('UI');
    } else {
      if (this.#editorSubmode() === 'PLAYTEST_FPS' || this.#editorSubmode() === 'PLAYTEST_TPS') {
        this.#inputContext.set('EDITOR_PLAYTEST');
      } else {
        this.#inputContext.set('EDITOR_EDITING');
      }
    }
  }

  public setSceneNodes(nodes: Node[]): void { this.#sceneNodes.set(nodes); }
  public setActiveEpisode(data: any): void { this.#activeEpisode.set(data); }
  public setActivePlatformId(id: number | null): void { this.#activePlatformId.set(id); }
  public setActivePlatformData(data: any): void { this.#activePlatformData.set(data); }
  public setPlatforms(platforms: any[]): void { this.#platforms.set(platforms); }

  public startGameSession(player: GameEntity, view: CameraViewMode): void {
    this.setActivePlayer(player);
    this.setCameraView(view);
    this.#engineState.set('PLAYING');
    this.setPointerLocked(!!document.pointerLockElement);
  }

  public stopGameSession(): void {
    this.setActivePlayer(null);
    this.setPointerLocked(false);
    const m = this.#mode();
    if (m === GameMode.EDITOR) {
      this.#engineState.set('STOPPED');
    } else if (m === GameMode.EDITING_IN_GAME) {
      this.#engineState.set('PAUSED');
    }
  }
}