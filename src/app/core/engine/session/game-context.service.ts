
import { Injectable, signal, computed } from '@angular/core';
import { GameMode } from './game-mode.model';
import { CameraViewMode, ToolModeContext } from './game-context.model';
import { GameEntity } from '../entities/game.entity';
import { Node, AbstractMesh } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class GameContextService {
  // ==========================================
  // ESTADO PRIVADO (SINGLE SOURCE OF TRUTH)
  // ==========================================
  
  // Runtime Session
  readonly #mode = signal<GameMode>(GameMode.EDITOR);
  readonly #cameraView = signal<CameraViewMode>('FPS');
  readonly #activePlayerEntity = signal<GameEntity | null>(null);
  readonly #isPointerLocked = signal<boolean>(false);
  readonly #isTransitioning = signal<boolean>(false);
  readonly #isInteracting = signal<boolean>(false);

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

  public readonly mode = computed(() => this.#mode());
  public readonly cameraView = computed(() => this.#cameraView());
  public readonly activePlayerEntity = computed(() => this.#activePlayerEntity());
  public readonly isPointerLocked = computed(() => this.#isPointerLocked());
  public readonly isTransitioning = computed(() => this.#isTransitioning());
  public readonly isInteracting = computed(() => this.#isInteracting());

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
    this.#mode() === GameMode.TEST_LIVE || 
    this.#mode() === GameMode.PREVIEW_ADMIN || 
    this.#mode() === GameMode.FINAL_USER
  );
  
  public readonly isDebugMode = computed(() => 
    this.#mode() === GameMode.TEST_LIVE || 
    this.#mode() === GameMode.PREVIEW_ADMIN ||
    this.#mode() === GameMode.EDITING_IN_GAME ||
    this.#mode() === GameMode.EDITOR
  );

  // ==========================================
  // MÉTODOS DE MUTACIÓN CONTROLADOS (SETTERS)
  // ==========================================

  public setMode(newMode: GameMode): void { if (this.#mode() !== newMode) this.#mode.set(newMode); }
  public setCameraView(view: CameraViewMode): void { this.#cameraView.set(view); }
  public setActivePlayer(entity: GameEntity | null): void { this.#activePlayerEntity.set(entity); }
  public setPointerLocked(locked: boolean): void { this.#isPointerLocked.set(locked); }
  public setTransitioning(val: boolean): void { this.#isTransitioning.set(val); }
  public setInteracting(val: boolean): void { this.#isInteracting.set(val); }

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

  // Flujos de Alto Nivel
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