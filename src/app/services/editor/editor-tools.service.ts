
// src/app/services/editor/editor-tools.service.ts

import { Injectable, inject, effect } from '@angular/core';
import {
  KeyboardEventTypes, Matrix, Mesh, PointerEventTypes,
  AbstractMesh, Tags, PointerInfo, KeyboardInfo, Observer, Scene, Vector3
} from '@babylonjs/core';

import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { EditorCameraService } from './editor-camera.service';
import { EditorSceneService } from './editor-scene.service';
import { EditorStateService, ToolMode } from './editor-state.service';
import { ToolsClipboardService } from './toolsservice/tools-clipboard.service';
import { ToolsDebugService } from './toolsservice/tools-debug.service';
import { ToolsGizmoService } from './toolsservice/tools-gizmo.service';
import { ToolsHighlightService } from './toolsservice/tools-highlight.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { CameraOwnershipService } from '../../core/engine/runtime/cameras/camera-ownership.service';
import { LiveBuilderService } from './live-builder.service';
import { EditorMapaService } from '../editor-mapa.service';
import { GizmoAdapterRegistryService } from './toolsservice/adapters/gizmo-adapter-registry.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { InputRouterService } from '../../core/engine/session/input-router.service';
import { Subscription } from 'rxjs';
import { InputOrchestratorService } from '../../core/engine/runtime/systems/input-orchestrator.service';
import { ToolsSelectionService } from './toolsservice/tools-selection.service';
import { BaseEntityGizmoAdapter } from './toolsservice/adapters/base-entity-gizmo.adapter';

@Injectable({ providedIn: 'root' })
export class EditorToolsService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private mapaSvc = inject(EditorMapaService);
  private sceneSvc = inject(EditorSceneService);
  private cameraSvc = inject(EditorCameraService);
  private entityManager = inject(EntityManagerService);
  private eventBus = inject(GameEventBusService);
  private ownership = inject(CameraOwnershipService);
  private gameContext = inject(GameContextService);
  private inputRouter = inject(InputRouterService);
  private inputOrchestrator = inject(InputOrchestratorService);

  private highlightSvc = inject(ToolsHighlightService);
  private debugSvc = inject(ToolsDebugService);
  private clipboardSvc = inject(ToolsClipboardService);
  private gizmoSvc = inject(ToolsGizmoService);
  private liveBuilder = inject(LiveBuilderService);
  private registry = inject(GizmoAdapterRegistryService);
  
  private selectionSvc = inject(ToolsSelectionService);

  private lastHoverCheckTime = 0;
  private isInitialized = false;
  private qPressed = false;

  private pointerSub: Subscription | null = null;
  private keyboardSub: Subscription | null = null;
  private gizmoDragSub: Subscription | null = null;
  private renderObserver: Observer<Scene> | null = null;

  private baseGizmoAdapter = new BaseEntityGizmoAdapter();

  constructor() {
    effect(() => {
      const selected = this.state.objetoSeleccionado() as Mesh;
      const hovered = this.state.objetoHovereado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();

      if (!this.gizmoSvc.isDraggingGizmo) {
        this.debugSvc.actualizarDebugMeshes(selected);
      }

      this.highlightSvc.actualizarHighlights(selected, hovered);
      this.gizmoSvc.attachGizmoToCurrentSelection(selected, subSelected);
    });

    effect(() => {
      this.state.currentTool();
      this.gizmoSvc.actualizarGizmosActivos();
    });

    effect(() => {
      const isModalOpen = this.state.showAddObjectModal();
      if (!this.motor3d.getEngine() || !this.motor3d.getScene()) return;

      const canvas = this.motor3d.getEngine().getRenderingCanvas();
      const editorCam = this.motor3d.getEditorCamera();

      if (isModalOpen) {
        this.inputRouter.unlockPointer();
        if (editorCam && canvas) {
          editorCam.detachControl();
        }
        if (this.motor3d.getScene()) {
          this.motor3d.getScene().skipPointerMovePicking = true;
        }
      } else {
        if (editorCam && canvas && this.ownership.getOwner() === 'EDITOR' && !this.liveBuilder.isBuilding()) {
          setTimeout(() => {
            try { editorCam.attachControl(canvas, true); } catch {}
          }, 10);
        }
        if (this.motor3d.getScene()) {
          this.motor3d.getScene().skipPointerMovePicking = false;
        }
      }
    });

    this.eventBus.events$.subscribe(e => {
      if (e.type === 'ObjectFocused') {
        const playSt = this.state.playState();
        if ((playSt === 'PLAYING' || playSt === 'EDITING_IN_GAME') && this.state.modoVistaPrueba === 'FPS') {
          this.state.setObjetoHovereado(e.payload.mesh as AbstractMesh | null);
        }
      }
    });
  }

  public forceResetVisuals(): void {
    this.highlightSvc.forceResetLightVisuals();
  }

  public limpiarEstado(): void {
    if (this.pointerSub) {
      this.pointerSub.unsubscribe();
      this.pointerSub = null;
    }
    if (this.keyboardSub) {
      this.keyboardSub.unsubscribe();
      this.keyboardSub = null;
    }
    if (this.gizmoDragSub) {
      this.gizmoDragSub.unsubscribe();
      this.gizmoDragSub = null;
    }
    if (this.renderObserver) {
      const scene = this.motor3d.getScene();
      if (scene) scene.onBeforeRenderObservable.remove(this.renderObserver);
      this.renderObserver = null;
    }

    this.clipboardSvc.disposeKeyboardListeners();
    this.gizmoSvc.dispose();
    this.debugSvc.actualizarDebugMeshes(null);
    this.highlightSvc.dispose();
    this.isInitialized = false; 
  }

  private manejarFPSAdminSelection(canvas: HTMLCanvasElement | null, isLocked: boolean): void {
    const scene = this.motor3d.getScene();
    const activeCam = this.ownership.getCamera();

    if (this.state.modoVistaPrueba !== 'FPS') {
      if (!isLocked && canvas) {
        this.inputRouter.lockPointer();
      }
      return;
    }

    if (!activeCam) return;

    const rootNode = this.state.objetoHovereado() as AbstractMesh;

    if (rootNode) {
      this.inputRouter.unlockPointer();

      if (this.state.objetoSeleccionado() === rootNode) {
        this.state.seleccionarObjeto(null);
        this.state.setObjetoHovereado(null);
        if (canvas) { this.inputRouter.lockPointer(); }
        return;
      }

      this.state.seleccionarObjeto(rootNode);
      this.state.setObjetoHovereado(rootNode);

      this.cameraSvc.transicionAEdicionEnVivo(rootNode);
      return;
    }

    this.state.seleccionarObjeto(null);
    this.state.setObjetoHovereado(null);

    if (!isLocked && canvas) {
      this.inputRouter.lockPointer();
    }
  }

  activarEventosEditor(): void {
    if (this.isInitialized) return;
    
    const scene = this.motor3d.getScene();
    if (!scene) {
      console.warn('⚠️ No se puede activar eventos del editor sin Scene de Babylon');
      return;
    }

    this.isInitialized = true;

    this.inputRouter.initializeListeners();
    this.inputRouter.attachToScene(scene);

    this.highlightSvc.initHighlights();
    this.gizmoSvc.initGizmos();
    this.clipboardSvc.initKeyboardListeners();

    if (!this.gizmoDragSub) {
      this.gizmoDragSub = this.mapaSvc.onGizmoDrag.subscribe(() => {
        this.syncEntityFromGizmoDrag();
      });
    }

    this.gizmoSvc.gizmoManager?.utilityLayer.utilityLayerScene.onPointerObservable.add((pi) => {
      this.gizmoSvc.syncCenterDragMeshVisuals(pi);
    });

    this.pointerSub = this.inputRouter.getPointerStream([
      'EDITOR_EDITING',
      'EDITOR_PLAYTEST'
    ]).subscribe((pi) => {
      this.handlePointerEvent(pi);
    });

    this.keyboardSub = this.inputRouter.getKeyboardStream([
      'EDITOR_EDITING',
      'EDITOR_PLAYTEST'
    ]).subscribe((kbInfo) => {
      this.handleKeyboardEvent(kbInfo);
    });

    this.mapaSvc.onMapChanged.subscribe(() => {
      if (!this.gizmoSvc.isDraggingGizmo) {
        this.debugSvc.actualizarDebugMeshes(this.state.objetoSeleccionado() as Mesh);
        this.gizmoSvc.attachGizmoToCurrentSelection(this.state.objetoSeleccionado() as Mesh, this.state.subObjetoSeleccionado());
      }
    });

    // 🔥 FIX DE RENDIMIENTO: Se removió el bucle pesado `scene.meshes.forEach` en cada frame.
    // La compensación de escala visual ahora se ejecuta puntualmente durante eventos de gizmo o selección.
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
      const obj = this.state.objetoSeleccionado() as Mesh;
      this.gizmoSvc.updateCenterDragMeshRenderState(obj, this.state.subObjetoSeleccionado());

      if (obj && !this.gizmoSvc.isDraggingGizmo) {
        this.debugSvc.syncBreathAnimations(obj);
      }
    });

    this.motor3d.getEditorCamera().attachControl(this.motor3d.getEngine().getRenderingCanvas(), true);
    this.sceneSvc.crearEntornoVisual();
    this.sceneSvc.actualizarListaNodos();
    this.setToolMode('translate');
  }

  private handlePointerEvent(pi: PointerInfo): void {
    if (this.liveBuilder.isBuilding() || this.state.showAddObjectModal()) return; 

    const scene = this.motor3d.getScene();
    const canvas = this.motor3d.getEngine().getRenderingCanvas();
    const playSt = this.state.playState();
    const profile = this.gameContext.authorityProfile();
    const isLocked = this.gameContext.isPointerLocked();

    if (playSt === 'TRANSITIONING' || playSt === 'INTERACTING') return;
    if (this.gameContext.inputContext() === 'UI') return;

    if (pi.type === PointerEventTypes.POINTERDOUBLETAP && pi.event.button === 0) {
      if (profile.canUseAdminFeatures || profile.canEdit) {
        if (playSt === 'EDITOR') {
          const activeCam = this.ownership.getCamera();
          if (activeCam) {
            const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), activeCam);
            ray.length = 10000;
            const rootNode = this.selectionSvc.resolverRootDesdeRay(ray, this.gizmoSvc.centerDragMesh as AbstractMesh);
            if (rootNode) {
              this.state.seleccionarObjeto(rootNode);
            }
          }
        } else if (playSt === 'PLAYING') {
          this.cameraSvc.pausarJuegoYActivarCamaraEditor();
        } else if (playSt === 'EDITING_IN_GAME') {
          if (canvas) canvas.focus();
          this.inputOrchestrator.lockPointer();
          this.cameraSvc.volverAJuego();
        }
      }
      return;
    }

    if (pi.type === PointerEventTypes.POINTERDOWN && pi.event.button === 0) {
      if (playSt === 'PLAYING') {
        if (!isLocked) {
          this.inputRouter.lockPointer();
          return;
        }
        if (profile.canSelect) {
          this.manejarFPSAdminSelection(canvas, isLocked);
        }
        return;
      }
    }

    if (pi.type === PointerEventTypes.POINTERTAP && pi.event.button === 0) {
      if (profile.canSelect && (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME')) {
        const activeCam = this.ownership.getCamera();
        if (activeCam) {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), activeCam);
          ray.length = 10000;

          const hitGizmo = scene.pickWithRay(
            ray,
            (mesh) => Tags.MatchesQuery(mesh, "gizmo") || mesh === this.gizmoSvc.centerDragMesh
          );
          if (hitGizmo && hitGizmo.hit) return;

          const rootNode = this.selectionSvc.resolverRootDesdeRay(ray, this.gizmoSvc.centerDragMesh as AbstractMesh);

          if (rootNode) {
            if (this.state.objetoSeleccionado() === rootNode) {
              this.state.seleccionarObjeto(null);
            } else {
              this.state.seleccionarObjeto(rootNode);
            }
          } else {
            this.state.seleccionarObjeto(null);
          }
        }
      }
    }

    if (pi.type === PointerEventTypes.POINTERMOVE) {
      const now = performance.now();
      if (now - this.lastHoverCheckTime < 32) return;
      this.lastHoverCheckTime = now;

      const activeCam = this.ownership.getCamera();
      if (!activeCam) return;

      if (playSt === 'PLAYING') {
        return;
      }

      if (profile.canSelect && (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME')) {
        if (this.state.ratonBloqueado()) return;

        const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), activeCam);
        ray.length = 10000;

        const hitGizmo = scene.pickWithRay(
          ray,
          (mesh) => Tags.MatchesQuery(mesh, "gizmo") || mesh === this.gizmoSvc.centerDragMesh
        );
        if (hitGizmo && hitGizmo.hit) {
          this.state.setObjetoHovereado(null);
          return;
        }

        const rootNode = this.selectionSvc.resolverRootDesdeRay(ray, this.gizmoSvc.centerDragMesh as AbstractMesh);
        this.state.setObjetoHovereado(rootNode);
      }
    }
  }

  private handleKeyboardEvent(kbInfo: KeyboardInfo): void {
    if (this.state.showAddObjectModal() || this.liveBuilder.isBuilding()) return; 

    const profile = this.gameContext.authorityProfile();
    const playSt = this.state.playState();

    if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
      
      if (kbInfo.event.key.toLowerCase() === 'q' && profile.canViewDebug && (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME' || playSt === 'PLAYING')) {
        if (!this.qPressed) {
          this.qPressed = true;
          this.eventBus.emit({ type: 'RadialMenuToggled', payload: true });
        }
      }

      if (kbInfo.event.key === 'Escape') {
        if (playSt === 'PLAYING' && profile.canUseAdminFeatures) {
          this.inputRouter.unlockPointer();
        } else if (playSt === 'EDITING_IN_GAME') {
          const canvas = this.motor3d.getEngine().getRenderingCanvas();
          if (canvas) canvas.focus();
          this.cameraSvc.volverAJuego();
        }
      }

      if (profile.canEdit && (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME')) {
        if (kbInfo.event.key === '1') this.setToolMode('select');
        if (kbInfo.event.key === '2') this.setToolMode('translate');
        if (kbInfo.event.key === '3') this.setToolMode('rotate');
        if (kbInfo.event.key === '4') this.setToolMode('scale');

        if (kbInfo.event.key.toLowerCase() === 'f') {
          const obj = this.state.objetoSeleccionado();
          if (obj) this.cameraSvc.enfocarObjetoEnEditor(obj);
        }
      }
    } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
      if (kbInfo.event.key.toLowerCase() === 'q') {
        this.qPressed = false;
      }
    }
  }

  private syncEntityFromGizmoDrag(): void {
    const mesh = this.state.objetoSeleccionado() as Mesh;
    const subSelected = this.state.subObjetoSeleccionado();
    if (!mesh) return;

    const entity = this.entityManager.getEntityByMesh(mesh);
    if (!entity) return;

    const adapter = this.registry.getAdapter(subSelected, entity);
    if (adapter) {
      adapter.syncEntity(mesh, entity, this.debugSvc, this.state, this.motor3d);
    }
  }

  public setToolMode(mode: ToolMode): void {
    this.state.setCurrentTool(mode);
    this.gizmoSvc.actualizarGizmosActivos();
  }
}