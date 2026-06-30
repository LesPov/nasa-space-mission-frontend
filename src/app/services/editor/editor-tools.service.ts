
import { Injectable, inject, effect } from '@angular/core';
import {
  DirectionalLight, KeyboardEventTypes, Light, Matrix, Mesh, PointerEventTypes,
  SpotLight, TransformNode, Vector3, Quaternion, AbstractMesh, Ray, Tags
} from '@babylonjs/core';

import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { EditorCameraService } from './editor-camera.service';
import { EditorSceneService } from './editor-scene.service';
import { EditorStateService, ToolMode } from './editor-state.service';
import { ToolsClipboardService } from './toolsservice/tools-clipboard.service';
import { ToolsDebugService } from './toolsservice/tools-debug.service';
import { ToolsFogService } from './toolsservice/tools-fog.service';
import { ToolsGizmoService } from './toolsservice/tools-gizmo.service';
import { ToolsHighlightService } from './toolsservice/tools-highlight.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { AuthService } from '../../core/services/auth';
import { CameraOwnershipService } from '../../core/engine/runtime/cameras/camera-ownership.service';
import { LiveBuilderService } from './live-builder.service';
import { PlayerInputService } from '../../core/engine/runtime/systems/player-input.service';
import { EditorMapaService } from '../editor-mapa.service';
import { DynamicLightingSystem } from '../../core/engine/runtime/systems/lighting/dynamic-lighting.system'; // AÑADIDO

@Injectable({ providedIn: 'root' })
export class EditorToolsService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private mapaSvc = inject(EditorMapaService);
  private sceneSvc = inject(EditorSceneService);
  private cameraSvc = inject(EditorCameraService);
  private entityManager = inject(EntityManagerService);
  private eventBus = inject(GameEventBusService);
  private authSvc = inject(AuthService);
  private ownership = inject(CameraOwnershipService);

  private highlightSvc = inject(ToolsHighlightService);
  private debugSvc = inject(ToolsDebugService);
  private clipboardSvc = inject(ToolsClipboardService);
  private fogSvc = inject(ToolsFogService);
  private gizmoSvc = inject(ToolsGizmoService);
  private liveBuilder = inject(LiveBuilderService);
  private playerInput = inject(PlayerInputService); 
  private dynamicLighting = inject(DynamicLightingSystem); // AÑADIDO

  private lastHoverCheckTime = 0;
  private isGizmoSyncAttached = false;
  private isInitialized = false;

  constructor() {
    effect(() => {
      const selected = this.state.objetoSeleccionado() as Mesh;
      const hovered = this.state.objetoHovereado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();

      if (!this.gizmoSvc.isDraggingGizmo) {
        this.debugSvc.actualizarDebugMeshes(selected);
      }

      this.highlightSvc.actualizarHighlights(selected, hovered);
      this.fogSvc.aplicarNieblaEnTiempoReal();
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
        if (document.pointerLockElement) {
          try { document.exitPointerLock(); } catch {}
        }
        if (editorCam && canvas) {
          editorCam.detachControl();
        }
        if (this.motor3d.getScene()) {
            this.motor3d.getScene().skipPointerMovePicking = true;
        }
      } else {
        if (editorCam && canvas && this.ownership.getOwner() === 'EDITOR') {
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
           if (playSt === 'PLAYING' && this.state.modoVistaPrueba === 'FPS') {
               this.state.objetoHovereado.set(e.payload.mesh as AbstractMesh | null);
           }
       }
    });
  }

  public limpiarEstado(): void {
    this.gizmoSvc.dispose();
    this.debugSvc.actualizarDebugMeshes(null);
    this.highlightSvc.actualizarHighlights(null, null);
    this.fogSvc.limpiarEstado();
    this.isInitialized = false; 
    this.isGizmoSyncAttached = false;
  }

  private castRayToSelectable(ray: Ray): AbstractMesh | null {
    const scene = this.motor3d.getScene();
    const jugador = this.state.jugadorActivo;
    const isAdmin = this.authSvc.isAdmin();

    const hit = scene.pickWithRay(ray, (mesh) => {
      if (!mesh.isPickable) return false;

      if (Tags.MatchesQuery(mesh, "system_element || fog_element || editor_only || invisible_floor || proxy_collider || debug_element")) {
          return false;
      }

      if (jugador && (mesh === jugador || mesh.isDescendantOf(jugador))) {
        return false;
      }

      const baseNode = this.state.resolverObjetoSeleccionable(mesh) as AbstractMesh;
      const entityMesh = this.entityManager.getEntityByMesh(baseNode);

      if (!isAdmin && (entityMesh?.type === 'trigger' || entityMesh?.type === 'trigger_compuesto')) {
        return false;
      }

      return true;
    });

    if (hit && hit.hit && hit.pickedMesh) {
      return this.state.resolverObjetoSeleccionable(hit.pickedMesh);
    }

    return null;
  }

  private manejarFPSAdminSelection(canvas: HTMLCanvasElement | null, isLocked: boolean): void {
    const scene = this.motor3d.getScene();
    const activeCam = this.ownership.getCamera();

    if (this.state.modoVistaPrueba !== 'FPS') {
      if (!isLocked && canvas) {
        try { canvas.requestPointerLock(); } catch {}
      }
      return;
    }

    if (!activeCam) return;

    const ray = isLocked
      ? activeCam.getForwardRay(10000)
      : scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), activeCam);

    ray.length = 10000;
    const rootNode = this.castRayToSelectable(ray);

    if (rootNode) {
      if (document.pointerLockElement) {
        try { document.exitPointerLock(); } catch {}
      }

      if (this.state.objetoSeleccionado() === rootNode) {
        this.state.objetoSeleccionado.set(null);
        this.state.objetoHovereado.set(null);
        if (canvas) { try { canvas.requestPointerLock(); } catch {} }
        return;
      }

      this.state.objetoSeleccionado.set(rootNode);
      this.state.objetoHovereado.set(rootNode);

      this.cameraSvc.transicionAEdicionEnVivo(rootNode);
      return;
    }

    this.state.objetoSeleccionado.set(null);
    this.state.objetoHovereado.set(null);

    if (!isLocked && canvas) {
      try { canvas.requestPointerLock(); } catch {}
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

    this.highlightSvc.initHighlights();
    this.gizmoSvc.initGizmos();
    this.clipboardSvc.initKeyboardListeners();

    if (!this.isGizmoSyncAttached) {
      this.mapaSvc.onGizmoDrag.subscribe(() => {
         this.syncEntityFromGizmoDrag();
      });
      this.isGizmoSyncAttached = true;
    }

    this.gizmoSvc.gizmoManager?.utilityLayer.utilityLayerScene.onPointerObservable.add((pi) => {
      this.gizmoSvc.syncCenterDragMeshVisuals(pi);
    });

    scene.onPointerObservable.add((pi) => {
      if (this.state.showAddObjectModal()) return; 

      const canvas = this.motor3d.getEngine().getRenderingCanvas();
      const playSt = this.state.playState();
      const isAdmin = this.authSvc.isAdmin();
      const isLocked = !!document.pointerLockElement;

      if (playSt === 'TRANSITIONING' || playSt === 'INTERACTING') return;

      if (this.playerInput.isRadialMenuOpen) return;

      if (pi.type === PointerEventTypes.POINTERDOUBLETAP && pi.event.button === 0) {
        if (isAdmin) {
          if (playSt === 'EDITOR') {
            const activeCam = this.ownership.getCamera();
            if (activeCam) {
                const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), activeCam);
                ray.length = 10000;
                const rootNode = this.castRayToSelectable(ray);
                if (rootNode) {
                  this.state.objetoSeleccionado.set(rootNode);
                }
            }
          } else if (playSt === 'PLAYING') {
            this.cameraSvc.pausarJuegoYActivarCamaraEditor();
          } else if (playSt === 'EDITING_IN_GAME') {
            const canvas = this.motor3d.getEngine().getRenderingCanvas();
            if (canvas) canvas.focus();
            this.cameraSvc.volverAJuego();
          }
        }
        return;
      }

      if (pi.type === PointerEventTypes.POINTERDOWN && pi.event.button === 0) {
        if (playSt === 'PLAYING') {
          if (isAdmin) {
             if (this.liveBuilder.isBuilding()) return; 
             this.manejarFPSAdminSelection(canvas, isLocked);
          }
          return;
        }
      }

      if (pi.type === PointerEventTypes.POINTERTAP && pi.event.button === 0) {
        if (isAdmin && (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME')) {
          const activeCam = this.ownership.getCamera();
          if (activeCam) {
              const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), activeCam);
              ray.length = 10000;

              const hitGizmo = scene.pickWithRay(
                ray,
                (mesh) => Tags.MatchesQuery(mesh, "gizmo") || mesh === this.gizmoSvc.centerDragMesh
              );
              if (hitGizmo && hitGizmo.hit) return;

              const rootNode = this.castRayToSelectable(ray);

              if (rootNode) {
                if (this.state.objetoSeleccionado() === rootNode) {
                  this.state.objetoSeleccionado.set(null);
                } else {
                  this.state.objetoSeleccionado.set(rootNode);
                }
              } else {
                this.state.objetoSeleccionado.set(null);
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
          if (isLocked) {
             return; 
          }

          if (!isAdmin) {
            this.state.objetoHovereado.set(null);
            return;
          }

          if (this.state.modoVistaPrueba !== 'FPS') {
            this.state.objetoHovereado.set(null);
            return;
          }

          if (this.liveBuilder.isBuilding()) return;

          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), activeCam);
          const rootNode = this.castRayToSelectable(ray);
          this.state.objetoHovereado.set(rootNode);
          return;
        }

        if (isAdmin && (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME')) {
          if (this.state.ratonBloqueado()) return;

          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), activeCam);
          ray.length = 10000;

          const hitGizmo = scene.pickWithRay(
            ray,
            (mesh) => Tags.MatchesQuery(mesh, "gizmo") || mesh === this.gizmoSvc.centerDragMesh
          );
          if (hitGizmo && hitGizmo.hit) {
            this.state.objetoHovereado.set(null);
            return;
          }

          const rootNode = this.castRayToSelectable(ray);
          this.state.objetoHovereado.set(rootNode);
        }
      }
    });

    scene.onKeyboardObservable.add((kbInfo) => {
      if (this.state.showAddObjectModal()) return; 

      const isAdmin = this.authSvc.isAdmin();

      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        if (kbInfo.event.key === 'Escape') {
          if (this.state.playState() === 'PLAYING' && isAdmin) {
            if (document.pointerLockElement) {
              document.exitPointerLock();
            }
          } else if (this.state.playState() === 'EDITING_IN_GAME') {
            const canvas = this.motor3d.getEngine().getRenderingCanvas();
            if (canvas) {
              canvas.focus();
            }
            this.cameraSvc.volverAJuego();
          }
        }

        if (isAdmin && (this.state.playState() === 'EDITOR' || this.state.playState() === 'EDITING_IN_GAME')) {
          if (kbInfo.event.key === '1') this.setToolMode('select');
          if (kbInfo.event.key === '2') this.setToolMode('translate');
          if (kbInfo.event.key === '3') this.setToolMode('rotate');
          if (kbInfo.event.key === '4') this.setToolMode('scale');

          if (kbInfo.event.key.toLowerCase() === 'f') {
            const obj = this.state.objetoSeleccionado();
            if (obj) this.cameraSvc.enfocarObjetoEnEditor(obj);
          }
        }
      }
    });

    this.mapaSvc.onMapChanged.subscribe(() => {
      if (!this.gizmoSvc.isDraggingGizmo) {
        this.debugSvc.actualizarDebugMeshes(this.state.objetoSeleccionado() as Mesh);
      }
      this.fogSvc.aplicarNieblaEnTiempoReal();
    });

    scene.onBeforeRenderObservable.add(() => {
      this.dynamicLighting.update(this.motor3d.getEngine().getDeltaTime()); // FIX

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

  private syncEntityFromGizmoDrag(): void {
    const mesh = this.state.objetoSeleccionado() as Mesh;
    const subSelected = this.state.subObjetoSeleccionado();
    if (!mesh) return;

    const entity = this.entityManager.getEntityByMesh(mesh);
    if (!entity) return;

    if (subSelected === 'collider' && this.debugSvc.debugCollider) {
      
      mesh.computeWorldMatrix(true);
      const invMat = Matrix.Invert(mesh.getWorldMatrix());
      const localPos = Vector3.TransformCoordinates(this.debugSvc.debugCollider.getAbsolutePosition(), invMat);
      
      entity.collider.offsetX = localPos.x;
      entity.collider.offsetY = localPos.y;
      entity.collider.offsetZ = localPos.z;

      entity.syncToView();

    } else if (subSelected === 'camera' && this.debugSvc.debugCameraBox) {
      
      mesh.computeWorldMatrix(true);
      const invMat = Matrix.Invert(mesh.getWorldMatrix());
      const localPos = Vector3.TransformCoordinates(this.debugSvc.debugCameraBox.getAbsolutePosition(), invMat);
      
      entity.camOffset.x = localPos.x;
      entity.camOffset.y = localPos.y * (mesh.scaling.y || 1);
      entity.camOffset.z = localPos.z;

      if (entity.characterConfig && entity.playerConfig) {
          entity.playerConfig.camera.fpsEyeLevel = entity.camOffset.y;
      }
      
      entity.syncToView();

    } else if (subSelected === 'light' && this.debugSvc.debugLightBox && entity.light) {
      
      mesh.computeWorldMatrix(true);
      const invMat = Matrix.Invert(mesh.getWorldMatrix());
      const localPos = Vector3.TransformCoordinates(this.debugSvc.debugLightBox.getAbsolutePosition(), invMat);

      entity.light.lightPosX = localPos.x;
      entity.light.lightPosY = localPos.y;
      entity.light.lightPosZ = localPos.z;
      
      entity.syncToView();

    } else if (subSelected === 'fog' && this.debugSvc.debugFogStartSphere) {
      
      const playerPos = mesh.getAbsolutePosition();
      const fogConfig = entity.playerConfig?.fog;
      if (!fogConfig || !entity.playerConfig) return;

      const isBW = this.motor3d.getScene()?.metadata?.globalVisualMode === 'bw';
      const isFPS = this.state.modoVistaPrueba === 'FPS';
      
      let fogHeightY = 4.0;
      if (isBW) {
          fogHeightY = Math.max(0.1, isFPS ? (fogConfig.fogHeightYStartFpsBW ?? 4.0) : (fogConfig.fogHeightYStartTpsBW ?? 4.0));
      } else {
          fogHeightY = Math.max(0.1, isFPS ? (fogConfig.fogHeightYStartFPS ?? 4.0) : (fogConfig.fogHeightYStartTPS ?? 4.0));
      }
      
      const shapeOffset = (fogConfig.fogShape === 'cylinder' ? (fogHeightY / 2) : 0);
      
      if (isFPS) {
          entity.playerConfig.fog.offsetXFPS = this.debugSvc.debugFogStartSphere.position.x - playerPos.x;
          entity.playerConfig.fog.offsetYFPS = this.debugSvc.debugFogStartSphere.position.y - playerPos.y - shapeOffset;
          entity.playerConfig.fog.offsetZFPS = this.debugSvc.debugFogStartSphere.position.z - playerPos.z;
      } else {
          entity.playerConfig.fog.offsetXTPS = this.debugSvc.debugFogStartSphere.position.x - playerPos.x;
          entity.playerConfig.fog.offsetYTPS = this.debugSvc.debugFogStartSphere.position.y - playerPos.y - shapeOffset;
          entity.playerConfig.fog.offsetZTPS = this.debugSvc.debugFogStartSphere.position.z - playerPos.z;
      }
      entity.syncToView();

    } else if (!subSelected) {
      entity.syncTransformFromView();
      entity.syncToView(); 
    }
  }

  public setToolMode(mode: ToolMode): void {
    this.state.currentTool.set(mode);
    this.gizmoSvc.actualizarGizmosActivos();
  }
}