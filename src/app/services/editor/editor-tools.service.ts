import { Injectable, inject, effect } from '@angular/core';
import {
  Color3,
  GizmoManager,
  HighlightLayer,
  Mesh,
  PointerEventTypes,
  Matrix,
  AbstractMesh,
  KeyboardEventTypes
} from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService, ToolMode } from './editor-state.service';
import { HistorialService } from '../historial.service';
import { EditorSceneService } from './editor-scene.service';
import { EditorCameraService } from './editor-camera.service';
import { EditorInteractionService } from './editor-interaction.service';

@Injectable({ providedIn: 'root' })
export class EditorToolsService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);
  private sceneSvc = inject(EditorSceneService);
  private cameraSvc = inject(EditorCameraService);
  private interaction = inject(EditorInteractionService);

  private gizmoManager!: GizmoManager;
  private hlHover!: HighlightLayer;
  private hlSelected!: HighlightLayer;

  private estadoAntesDeArrastrar: any = null;
  private objetoEnPortapapeles: AbstractMesh | null = null;
  private listenerCtrlZAgregado = false;

  constructor() {
    effect(() => {
      const selected = this.state.objetoSeleccionado() as Mesh;
      const hovered = this.state.objetoHovereado() as Mesh;

      if (this.hlHover && this.hlSelected) {
        this.actualizarHighlights(selected, hovered);
      }

      if (this.gizmoManager) {
        if (selected) {
          this.gizmoManager.attachToMesh(selected);
        } else {
          this.gizmoManager.attachToMesh(null);
        }
        this.actualizarGizmosActivos();
      }
    });

    effect(() => {
      this.state.currentTool();
      this.actualizarGizmosActivos();
    });
  }

  activarEventosEditor(): void {
    const scene = this.motor3d.scene;
    this.state.playState.set('EDITOR');

    this.hlHover = new HighlightLayer('hlHover', scene, { isStroke: true, mainTextureRatio: 2 });
    this.hlHover.blurHorizontalSize = 1.0;
    this.hlHover.blurVerticalSize = 1.0;
    this.hlHover.innerGlow = false;

    this.hlSelected = new HighlightLayer('hlSelected', scene, { isStroke: true, mainTextureRatio: 2 });
    this.hlSelected.blurHorizontalSize = 2.0;
    this.hlSelected.blurVerticalSize = 2.0;
    this.hlSelected.innerGlow = false;

    this.gizmoManager = new GizmoManager(scene);
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.clearGizmoOnEmptyPointerEvent = true;

    // 🔥 EL SECRETO ESTABA AQUÍ: BabylonJS no crea los gizmos si no los habilitas al menos una vez.
    // Los habilitamos forzosamente un instante para que existan en memoria y poder pegarles los eventos.
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = true;
    this.gizmoManager.scaleGizmoEnabled = true;

    if (this.gizmoManager.gizmos.positionGizmo) {
      this.gizmoManager.gizmos.positionGizmo.snapDistance = 0;
    }

    if (this.gizmoManager.gizmos.rotationGizmo) {
      this.gizmoManager.gizmos.rotationGizmo.snapDistance = 0;
      this.gizmoManager.gizmos.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
    }

    if (this.gizmoManager.gizmos.scaleGizmo) {
      this.gizmoManager.gizmos.scaleGizmo.snapDistance = 0;
    }

    // Funciones del Historial de arrastre
    const onDragStart = () => {
      const mesh = this.state.objetoSeleccionado() as Mesh;
      if (mesh) {
        this.estadoAntesDeArrastrar = this.historialSvc.obtenerEstado(mesh);
        console.log('🔵 [Gizmo] Arrastre iniciado. Guardando estado original:', this.estadoAntesDeArrastrar);
      }
    };

    const onDragging = () => {
      this.state.onGizmoDrag.next(); // Actualiza el inspector visualmente
    };

    const onDragEnd = () => {
      const mesh = this.state.objetoSeleccionado() as Mesh;
      if (mesh && this.estadoAntesDeArrastrar) {
        console.log('🟢 [Gizmo] Arrastre soltado. Registrando en el historial.');
        this.historialSvc.registrarAccionTransform(mesh, this.estadoAntesDeArrastrar);
        this.estadoAntesDeArrastrar = null;

        queueMicrotask(() => {
          this.state.onGizmoDrag.next();
          this.state.triggerUpdate(); // Autoguardado a BD
        });
      }
    };

    // Agregar los eventos ahora que estamos SEGUROS de que los gizmos no son null
    if (this.gizmoManager.gizmos.positionGizmo) {
      this.gizmoManager.gizmos.positionGizmo.onDragStartObservable.add(onDragStart);
      this.gizmoManager.gizmos.positionGizmo.onDragObservable.add(onDragging);
      this.gizmoManager.gizmos.positionGizmo.onDragEndObservable.add(onDragEnd);
    }
    if (this.gizmoManager.gizmos.rotationGizmo) {
      this.gizmoManager.gizmos.rotationGizmo.onDragStartObservable.add(onDragStart);
      this.gizmoManager.gizmos.rotationGizmo.onDragObservable.add(onDragging);
      this.gizmoManager.gizmos.rotationGizmo.onDragEndObservable.add(onDragEnd);
    }
    if (this.gizmoManager.gizmos.scaleGizmo) {
      this.gizmoManager.gizmos.scaleGizmo.onDragStartObservable.add(onDragStart);
      this.gizmoManager.gizmos.scaleGizmo.onDragObservable.add(onDragging);
      this.gizmoManager.gizmos.scaleGizmo.onDragEndObservable.add(onDragEnd);
    }

    // Los apagamos de nuevo para que solo salgan cuando seleccionas una herramienta
    this.gizmoManager.positionGizmoEnabled = false;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;

    this.gizmoManager.onAttachedToMeshObservable.add((mesh) => {
      if (this.state.objetoSeleccionado() !== mesh) {
        this.state.objetoSeleccionado.set(mesh);
      }
    });

    // Control del puntero y selección
    scene.onPointerObservable.add((pi) => {
      const canvas = this.motor3d.engine.getRenderingCanvas();
      const playSt = this.state.playState();

      if (playSt === 'TRANSITIONING' || playSt === 'INTERACTING') return;

      if (pi.type === PointerEventTypes.POINTERDOWN && pi.event.button === 0) {
        if (playSt === 'PLAYING') {
          if (!this.state.ratonBloqueado()) {
            try { canvas?.requestPointerLock(); } catch (e) {}
            return;
          }

          if (this.state.modoVistaPrueba === 'FPS') {
            const w = this.motor3d.engine.getRenderWidth();
            const h = this.motor3d.engine.getRenderHeight();
            const crosshairRay = scene.createPickingRay(w / 2, h / 2, Matrix.Identity(), scene.activeCamera);
            const hitInfo = scene.pickWithRay(crosshairRay, this.state.esObjetoObstructor);

            if (hitInfo && hitInfo.hit && hitInfo.pickedMesh && this.state.puedeSeleccionarse(hitInfo.pickedMesh as AbstractMesh)) {
              const rootNode = this.state.encontrarRaiz(hitInfo.pickedMesh as AbstractMesh);
              if (rootNode) {
                if (this.state.rolSimulado() === 'admin') {
                  this.cameraSvc.transicionAEdicionEnVivo(rootNode);
                } else {
                  this.interaction.abrirInteraccionJugador(rootNode);
                }
              }
            }
          }
          return;
        }

        if (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME') {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
          ray.length = 10000;

          const hitGizmo = scene.pickWithRay(ray, (mesh) => !!mesh?.name?.toLowerCase().includes('gizmo'));
          if (hitGizmo && hitGizmo.hit) return;

          const hitInfo = scene.pickWithRay(ray, this.state.esObjetoObstructor);

          if (hitInfo && hitInfo.hit && hitInfo.pickedMesh && this.state.puedeSeleccionarse(hitInfo.pickedMesh as AbstractMesh)) {
            const rootNode = this.state.encontrarRaiz(hitInfo.pickedMesh as AbstractMesh);
            if (rootNode) {
              this.state.objetoSeleccionado.set(rootNode);
            }
          } else {
            this.state.objetoSeleccionado.set(null);
            if (playSt === 'EDITING_IN_GAME') {
              try { canvas?.requestPointerLock(); } catch (e) {}
              this.cameraSvc.volverAJuego();
            }
          }
        }
      }

      if (pi.type === PointerEventTypes.POINTERMOVE) {
        if (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME') {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
          ray.length = 10000;

          const hitGizmo = scene.pickWithRay(ray, (mesh) => !!mesh?.name?.toLowerCase().includes('gizmo'));
          if (hitGizmo && hitGizmo.hit) {
            this.state.objetoHovereado.set(null);
            return;
          }

          const hitInfo = scene.pickWithRay(ray, this.state.esObjetoObstructor);

          if (hitInfo && hitInfo.hit && hitInfo.pickedMesh && this.state.puedeSeleccionarse(hitInfo.pickedMesh as AbstractMesh)) {
            const rootNode = this.state.encontrarRaiz(hitInfo.pickedMesh as AbstractMesh);
            if (rootNode && rootNode instanceof AbstractMesh) {
              this.state.objetoHovereado.set(rootNode);
            }
          } else {
            this.state.objetoHovereado.set(null);
          }
        }
      }
    });

    scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        if (kbInfo.event.key === 'Escape' && this.state.playState() === 'EDITING_IN_GAME') {
          const canvas = this.motor3d.engine.getRenderingCanvas();
          try { canvas?.requestPointerLock(); } catch (e) {}
          this.cameraSvc.volverAJuego();
        }

        if (!this.state.showAddObjectModal() && (this.state.playState() === 'EDITOR' || this.state.playState() === 'EDITING_IN_GAME')) {
          if (kbInfo.event.key === '1') this.setToolMode('translate');
          if (kbInfo.event.key === '2') this.setToolMode('rotate');
          if (kbInfo.event.key === '3') this.setToolMode('scale');
        }
      }
    });

    if (!this.listenerCtrlZAgregado) {
      window.addEventListener('keydown', this.manejarCtrlZGlobal, true);
      this.listenerCtrlZAgregado = true;
    }

    this.motor3d.editorCamera.attachControl(this.motor3d.engine.getRenderingCanvas(), true);
    this.sceneSvc.crearEntornoVisual();
    this.sceneSvc.actualizarListaNodos();
    this.setToolMode('translate');
  }

  private manejarCtrlZGlobal = (event: KeyboardEvent) => {
    const state = this.state.playState();

    if (!(state === 'EDITOR' || state === 'EDITING_IN_GAME')) return;
    if (!event.ctrlKey && !event.metaKey) return;

    const key = event.key.toLowerCase();
    if (key !== 'z') return;

    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.deshacerAccion();
  };

  setToolMode(mode: ToolMode): void {
    this.state.currentTool.set(mode);
  }

  private actualizarGizmosActivos(): void {
    if (!this.gizmoManager) return;

    this.gizmoManager.positionGizmoEnabled = false;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;

    if (this.state.playState() === 'PLAYING' || this.state.playState() === 'INTERACTING') return;

    if (this.state.objetoSeleccionado()) {
      switch (this.state.currentTool()) {
        case 'translate':
          this.gizmoManager.positionGizmoEnabled = true;
          break;
        case 'rotate':
          this.gizmoManager.rotationGizmoEnabled = true;
          if (this.gizmoManager.gizmos.rotationGizmo) {
            this.gizmoManager.gizmos.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
          }
          break;
        case 'scale':
          this.gizmoManager.scaleGizmoEnabled = true;
          break;
      }
    }
  }

  private actualizarHighlights(selected: Mesh | null, hovered: Mesh | null): void {
    if (!this.hlHover || !this.hlSelected) return;

    this.hlHover.removeAllMeshes();
    this.hlSelected.removeAllMeshes();

    const colorHover = Color3.FromHexString('#3b82f6');
    const colorSelected = Color3.FromHexString('#fbbf24');

    if (hovered && hovered !== selected) {
      const childs = hovered.getChildMeshes();
      if (childs.length > 0) {
        childs.forEach(c => { if (c instanceof Mesh) this.hlHover.addMesh(c, colorHover); });
      } else {
        this.hlHover.addMesh(hovered, colorHover);
      }
    }

    if (selected) {
      const childs = selected.getChildMeshes();
      if (childs.length > 0) {
        childs.forEach(c => { if (c instanceof Mesh) this.hlSelected.addMesh(c, colorSelected); });
      } else {
        this.hlSelected.addMesh(selected, colorSelected);
      }
    }
  }

  copiarObjeto() {
    const obj = this.state.objetoSeleccionado() as AbstractMesh;
    if (obj) this.objetoEnPortapapeles = obj;
  }

  pegarObjeto() {
    if (!this.objetoEnPortapapeles) return;

    const objOriginal = this.objetoEnPortapapeles;
    let clon: AbstractMesh;
    const nuevoNombre = objOriginal.name + '_Copia_' + Math.floor(Math.random() * 1000);

    if (objOriginal.metadata?.type === 'model') {
      const parentClone = objOriginal.instantiateHierarchy(null, { doNotInstantiate: true });
      clon = parentClone as AbstractMesh;
      clon.name = nuevoNombre;
      clon.checkCollisions = objOriginal.checkCollisions;
      clon.isPickable = true;
      clon.getChildMeshes().forEach((m, i) => {
        m.isPickable = true;
        m.checkCollisions = objOriginal.getChildMeshes()[i]?.checkCollisions ?? true;
      });
    } else {
      clon = objOriginal.clone(nuevoNombre, null) as AbstractMesh;
    }

    clon.position = objOriginal.position.clone();
    clon.position.x += 1;
    clon.position.z += 1;

    if (objOriginal.rotationQuaternion) clon.rotationQuaternion = objOriginal.rotationQuaternion.clone();
    else clon.rotation = objOriginal.rotation.clone();

    clon.scaling = objOriginal.scaling.clone();
    clon.metadata = JSON.parse(JSON.stringify(objOriginal.metadata));
    clon.isPickable = true;

    this.sceneSvc.actualizarListaNodos();
    this.state.objetoSeleccionado.set(clon);
    this.historialSvc.registrarAccionCrear(clon);
    this.state.triggerUpdate();
  }

  deshacerAccion() {
    console.log('↩️ Ctrl+Z presionado. Intentando deshacer...');
    if (this.historialSvc.deshacer()) {
      this.sceneSvc.actualizarListaNodos();
      this.state.onGizmoDrag.next(); // Refresca los inputs del inspector
      this.state.triggerUpdate();    // Envia el cambio a BD
    } else {
      console.log('⚠️ No hay más acciones para deshacer en el historial.');
    }
  }
}