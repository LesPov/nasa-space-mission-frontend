
import { Injectable, inject, effect } from '@angular/core';
import { DirectionalLight, KeyboardEventTypes, Matrix, Mesh, PointerEventTypes, SpotLight, TransformNode, Vector3, Ray } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorCameraService } from './editor-camera.service';
import { EditorSceneService } from './editor-scene.service';
import { EditorStateService, ToolMode } from './editor-state.service';
import { PlayerCameraManagerService } from './playerservice/player-camera.service';
import { ToolsClipboardService } from './toolsservice/tools-clipboard.service';
import { ToolsDebugService } from './toolsservice/tools-debug.service';
import { ToolsFogService } from './toolsservice/tools-fog.service';
import { ToolsGizmoService } from './toolsservice/tools-gizmo.service';
import { ToolsHighlightService } from './toolsservice/tools-highlight.service';
import { ToolsSelectionService } from './toolsservice/tools-selection.service';
 
@Injectable({ providedIn: 'root' })
export class EditorToolsService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private sceneSvc = inject(EditorSceneService);
  private cameraSvc = inject(EditorCameraService);
  
  // 🔥 FIX PARA EL EDITING_IN_GAME: Volver a la cámara del jugador (no del editor)
  private playerCamSvc = inject(PlayerCameraManagerService);

  // Sub-Servicios Orquestados
  private selectionSvc = inject(ToolsSelectionService);
  private highlightSvc = inject(ToolsHighlightService);
  private debugSvc = inject(ToolsDebugService);
  private clipboardSvc = inject(ToolsClipboardService);
  private fogSvc = inject(ToolsFogService);
  private gizmoSvc = inject(ToolsGizmoService);

  private lastHoverCheckTime = 0;
  limpiarEstado: any;

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
  }

  activarEventosEditor(): void {
    const scene = this.motor3d.scene;
    this.state.playState.set('EDITOR');

    this.highlightSvc.initHighlights();
    this.gizmoSvc.initGizmos();
    this.clipboardSvc.initKeyboardListeners();

    this.gizmoSvc.gizmoManager.utilityLayer.utilityLayerScene.onPointerObservable.add((pi) => {
      this.gizmoSvc.syncCenterDragMeshVisuals(pi);
    });

    const castRayToSelectable = (ray: Ray, ignoreTriggers: boolean = false) => {
        const jugador = this.state.jugadorActivo;
        const hit = scene.pickWithRay(ray, (mesh) => {
            if (!mesh.isPickable || !mesh.isVisible) return false;
            
            // 🔥 FIX JUGADOR: Ignorar al jugador y sus hijos en 1ra persona para que el Admin no se seleccione a sí mismo
            if (this.state.modoVistaPrueba === 'FPS' && jugador && (mesh === jugador || mesh.isDescendantOf(jugador))) {
                return false;
            }

            const n = mesh.name.toLowerCase();
            if (n.includes('gizmo') || n.includes('proxycol') || n.includes('suelo') || n.includes('skybox') || n.includes('fogshell') || n.includes('fogwall')) return false;
            if (ignoreTriggers && (n.includes('trigger') || mesh.metadata?.type === 'trigger')) return false;
            return true;
        });
        if (hit && hit.hit && hit.pickedMesh) {
            return this.state.resolverObjetoSeleccionable(hit.pickedMesh);
        }
        return null;
    };

    scene.onPointerObservable.add((pi) => {
      const canvas = this.motor3d.engine.getRenderingCanvas();
      const playSt = this.state.playState();
      const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

      if (playSt === 'TRANSITIONING' || playSt === 'INTERACTING') return;

      // DOBLE CLICK (Enfocar en modo editor)
      if (pi.type === PointerEventTypes.POINTERDOUBLETAP && pi.event.button === 0) {
        if (isAdmin && playSt === 'EDITOR') {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
          ray.length = 10000;
          const rootNode = castRayToSelectable(ray);
          if (rootNode) {
            this.state.objetoSeleccionado.set(rootNode);
            this.cameraSvc.enfocarObjetoEnEditor(rootNode);
          }
        }
        return;
      }

      // CLICK NORMAL (Seleccionar / Deseleccionar / Transicionar)
      if (pi.type === PointerEventTypes.POINTERTAP && pi.event.button === 0) {
        
        // Comportamiento cuando estamos jugando y somos Admin (1ra persona modo edición)
        if (playSt === 'PLAYING') {
          if (!this.state.ratonBloqueado()) {
            try { canvas?.requestPointerLock(); } catch {}
            return;
          }

          if (this.state.modoVistaPrueba === 'FPS') {
            const ray = scene.createPickingRay(this.motor3d.engine.getRenderWidth() / 2, this.motor3d.engine.getRenderHeight() / 2, Matrix.Identity(), scene.activeCamera);
            ray.length = 10000;
            const rootNode = castRayToSelectable(ray, true); 
            
            if (rootNode) {
              // 🔥 LÓGICA DE DESELECCIÓN PARA ADMIN FPS
              if (this.state.objetoSeleccionado() === rootNode) {
                this.state.objetoSeleccionado.set(null);
                this.state.objetoHovereado.set(null);
              } else {
                this.state.objetoSeleccionado.set(rootNode);
                this.state.objetoHovereado.set(rootNode);
                if (isAdmin) this.cameraSvc.transicionAEdicionEnVivo(rootNode);
              }
            } else {
              this.state.objetoSeleccionado.set(null);
              this.state.objetoHovereado.set(null);
            }
          }
          return;
        }

        // Comportamiento para modo Editor Puro o Editando en Vivo
        if (isAdmin && (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME')) {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
          ray.length = 10000;

          const hitGizmo = scene.pickWithRay(ray, (mesh) => !!mesh?.name?.toLowerCase().includes('gizmo') || mesh === this.gizmoSvc.centerDragMesh);
          if (hitGizmo && hitGizmo.hit) return;

          const rootNode = castRayToSelectable(ray);

          if (rootNode) {
            // 🔥 LÓGICA DE DESELECCIÓN PARA MODO EDITOR
            if (this.state.objetoSeleccionado() === rootNode) {
              this.state.objetoSeleccionado.set(null); // Click al mismo = deseleccionar
            } else {
              this.state.objetoSeleccionado.set(rootNode); // Nuevo objeto
            }
          } else {
            this.state.objetoSeleccionado.set(null);
            if (playSt === 'EDITING_IN_GAME') {
              if (canvas) {
                canvas.focus();
                try { canvas.requestPointerLock(); } catch {}
              }
              // 🔥 FIX: Retorna a la cámara del jugador y no a la del editor
              this.playerCamSvc.volverAJuego();
            }
          }
        }
      }

      // HOVER (Mover el ratón)
      if (pi.type === PointerEventTypes.POINTERMOVE) {
        const now = performance.now();
        if (now - this.lastHoverCheckTime < 40) return;
        this.lastHoverCheckTime = now;

        if (this.state.ratonBloqueado()) return;

        if (playSt === 'PLAYING' && this.state.modoVistaPrueba === 'FPS') {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
          ray.length = 10000;
          const rootNode = castRayToSelectable(ray, true); 
          this.state.objetoHovereado.set(rootNode);
          return;
        }

        if (isAdmin && (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME')) {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
          ray.length = 10000;

          const hitGizmo = scene.pickWithRay(ray, (mesh) => !!mesh?.name?.toLowerCase().includes('gizmo') || mesh === this.gizmoSvc.centerDragMesh);
          if (hitGizmo && hitGizmo.hit) {
            this.state.objetoHovereado.set(null);
            return;
          }

          const rootNode = castRayToSelectable(ray);
          this.state.objetoHovereado.set(rootNode);
        }
      }
    });

    scene.onKeyboardObservable.add((kbInfo) => {
      const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        if (kbInfo.event.key === 'Escape' && this.state.playState() === 'EDITING_IN_GAME') {
          const canvas = this.motor3d.engine.getRenderingCanvas();
          if (canvas) {
            canvas.focus();
            try { canvas.requestPointerLock(); } catch {}
          }
          // 🔥 FIX: Si estabamos jugando, tocamos para editar en vivo y presionamos ESC, debemos regresar a jugar, no al editor libre
          this.playerCamSvc.volverAJuego();
        }

        if (isAdmin && !this.state.showAddObjectModal() && (this.state.playState() === 'EDITOR' || this.state.playState() === 'EDITING_IN_GAME')) {
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

    this.state.onMapChanged.subscribe(() => {
      if (!this.gizmoSvc.isDraggingGizmo) this.debugSvc.actualizarDebugMeshes(this.state.objetoSeleccionado() as Mesh);
      this.fogSvc.aplicarNieblaEnTiempoReal();
    });

    scene.onBeforeRenderObservable.add(() => {
      scene.lights.forEach(light => {
        if ((light instanceof SpotLight || light instanceof DirectionalLight) && light.name.startsWith('l_')) {
          if (light.parent) {
            const parentNode = light.parent as TransformNode;
            const worldMatrix = parentNode.getWorldMatrix();
            const localDown = Vector3.TransformNormal(new Vector3(0, -1, 0), worldMatrix);
            light.direction.copyFrom(localDown.normalize());
          } else {
            light.direction.copyFromFloats(0, -1, 0);
          }
        }
      });

      const obj = this.state.objetoSeleccionado() as Mesh;
      this.gizmoSvc.updateCenterDragMeshRenderState(obj, this.state.subObjetoSeleccionado());

      if (obj && !this.gizmoSvc.isDraggingGizmo) {
        this.debugSvc.syncBreathAnimations(obj);
      }
    });

    this.motor3d.editorCamera.attachControl(this.motor3d.engine.getRenderingCanvas(), true);
    this.sceneSvc.crearEntornoVisual();
    this.sceneSvc.actualizarListaNodos();
    this.setToolMode('translate');
  }

  setToolMode(mode: ToolMode): void {
    this.state.currentTool.set(mode);
    this.gizmoSvc.actualizarGizmosActivos();
  }

  copiarObjeto() { this.clipboardSvc.copiarObjeto(); }
  pegarObjeto() { this.clipboardSvc.pegarObjeto(); }
  deshacerAccion() { this.clipboardSvc.deshacerAccion(); }
}