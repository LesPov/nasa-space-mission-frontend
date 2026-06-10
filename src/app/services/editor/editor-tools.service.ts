import { Injectable, inject, effect } from '@angular/core';
import { Color3, GizmoManager, HighlightLayer, Mesh, PointerEventTypes, Matrix, AbstractMesh, KeyboardEventTypes, MeshBuilder, StandardMaterial, Vector3, TransformNode, Ray } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { EditorStateService, ToolMode } from './editor-state.service';
import { HistorialService } from '../historial.service';
import { EditorSceneService } from './editor-scene.service';
import { EditorCameraService } from './editor-camera.service';

@Injectable({ providedIn: 'root' })
export class EditorToolsService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);
  private sceneSvc = inject(EditorSceneService);
  private cameraSvc = inject(EditorCameraService);

  private gizmoManager!: GizmoManager;
  private hlHover!: HighlightLayer;
  private hlSelected!: HighlightLayer;

  private estadoAntesDeArrastrar: any = null;
  private objetoEnPortapapeles: AbstractMesh | null = null;
  private listenerCtrlZAgregado = false;

  private debugCollider: Mesh | null = null;
  private debugCameraBox: Mesh | null = null;
  private isDraggingGizmo = false;

  constructor() {
    effect(() => {
      const selected = this.state.objetoSeleccionado() as Mesh;
      const hovered = this.state.objetoHovereado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();

      if (!this.isDraggingGizmo) this.actualizarDebugMeshes(selected);
      if (this.hlHover && this.hlSelected) this.actualizarHighlights(selected, hovered);

      if (this.gizmoManager) {
        const modoJuego = this.state.playState();
        if (modoJuego === 'PLAYING' || modoJuego === 'TRANSITIONING' || modoJuego === 'INTERACTING') {
            this.gizmoManager.attachToMesh(null);
            this.gizmoManager.positionGizmoEnabled = false;
            this.gizmoManager.rotationGizmoEnabled = false;
            this.gizmoManager.scaleGizmoEnabled = false;
            return;
        }

        if (subSelected === 'collider' && this.debugCollider) this.gizmoManager.attachToMesh(this.debugCollider);
        else if (subSelected === 'camera' && this.debugCameraBox) this.gizmoManager.attachToMesh(this.debugCameraBox);
        else if (selected && !subSelected) this.gizmoManager.attachToMesh(selected);
        else this.gizmoManager.attachToMesh(null);
        
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
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = true;
    this.gizmoManager.scaleGizmoEnabled = true;

    if (this.gizmoManager.gizmos.positionGizmo) this.gizmoManager.gizmos.positionGizmo.snapDistance = 0;
    if (this.gizmoManager.gizmos.rotationGizmo) {
      this.gizmoManager.gizmos.rotationGizmo.snapDistance = 0;
      this.gizmoManager.gizmos.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
    }
    if (this.gizmoManager.gizmos.scaleGizmo) this.gizmoManager.gizmos.scaleGizmo.snapDistance = 0;

    const onDragStart = () => {
      this.isDraggingGizmo = true;
      const mesh = this.gizmoManager.attachedMesh as AbstractMesh;
      if (mesh && mesh !== this.debugCollider && mesh !== this.debugCameraBox) {
        this.estadoAntesDeArrastrar = this.historialSvc.obtenerEstado(mesh);
      }
    };

    const onDragging = () => {
      const mesh = this.gizmoManager.attachedMesh as AbstractMesh;
      const parent = this.state.objetoSeleccionado() as Mesh;

      if (mesh === this.debugCollider && parent) {
          parent.metadata.collider.offsetX = mesh.position.x;
          parent.metadata.collider.offsetY = mesh.position.y;
          parent.metadata.collider.offsetZ = mesh.position.z;
      } else if (mesh === this.debugCameraBox && parent) {
          parent.metadata.camOffset.x = mesh.position.x;
          parent.metadata.camOffset.y = mesh.position.y;
          parent.metadata.camOffset.z = mesh.position.z;
      }
      this.state.onGizmoDrag.next(); 
    };

    const onDragEnd = () => {
      this.isDraggingGizmo = false;
      const mesh = this.gizmoManager.attachedMesh as AbstractMesh;
      const parent = this.state.objetoSeleccionado() as Mesh;

      if (mesh === this.debugCollider && parent) {
          parent.metadata.collider.sizeX *= mesh.scaling.x;
          parent.metadata.collider.sizeY *= mesh.scaling.y;
          parent.metadata.collider.sizeZ *= mesh.scaling.z;
          mesh.scaling.set(1, 1, 1);
          this.actualizarDebugMeshes(parent);
          this.gizmoManager.attachToMesh(this.debugCollider); 
          queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      } else if (mesh === this.debugCameraBox && parent) {
          queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      } else if (mesh && this.estadoAntesDeArrastrar) {
        this.historialSvc.registrarAccionTransform(mesh, this.estadoAntesDeArrastrar);
        this.estadoAntesDeArrastrar = null;
        queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      }
    };

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

    this.gizmoManager.onAttachedToMeshObservable.add((mesh) => {
      if (mesh && mesh !== this.debugCollider && mesh !== this.debugCameraBox) {
        if (this.state.objetoSeleccionado() !== mesh) {
          this.state.objetoSeleccionado.set(mesh);
          this.state.subObjetoSeleccionado.set(null); 
        }
      }
    });

    const pickingPredicate = (m: AbstractMesh) => {
      if (!m || !m.name) return false;
      if (this.state.esMeshIgnorable(m)) return false;
      return m.isVisible || m.isPickable;
    };

    const resolverRootDesdeRay = (ray: any): AbstractMesh | null => {
      const picks = scene.multiPickWithRay(ray, pickingPredicate) || [];
      for (const hit of picks) {
        const picked = hit.pickedMesh as AbstractMesh | null;
        if (!picked) continue;
        const rootNode = this.state.encontrarRaiz(picked);
        if (!(rootNode instanceof AbstractMesh)) continue;
        if (this.state.esMeshIgnorable(rootNode)) continue;
        if (!this.state.puedeSeleccionarse(rootNode)) continue;
        return rootNode;
      }
      return null;
    };

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

          // 🔥 FIX ADMIN CLICK: Solo el Admin entra a editar al dar click. Los Usuarios ahora usan Tecla 'I'
          if (this.state.rolSimulado() === 'admin' && this.state.modoVistaPrueba === 'FPS') {
            const cam = scene.activeCamera!;
            const ray = new Ray(cam.globalPosition, cam.getDirection(Vector3.Forward()), 20.0);
            const rootNode = resolverRootDesdeRay(ray);

            if (rootNode) this.cameraSvc.transicionAEdicionEnVivo(rootNode);
          }
          return;
        }

        if (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME') {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
          ray.length = 10000;

          const hitGizmo = scene.pickWithRay(ray, (mesh) => !!mesh?.name?.toLowerCase().includes('gizmo'));
          if (hitGizmo && hitGizmo.hit) return;

          const rootNode = resolverRootDesdeRay(ray);

          if (rootNode) {
            this.state.objetoSeleccionado.set(rootNode);
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

          const rootNode = resolverRootDesdeRay(ray);
          this.state.objetoHovereado.set(rootNode);
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

    this.state.onMapChanged.subscribe(() => {
      if (!this.isDraggingGizmo) this.actualizarDebugMeshes(this.state.objetoSeleccionado() as Mesh);
    });

    scene.onBeforeRenderObservable.add(() => {
        const obj = this.state.objetoSeleccionado() as Mesh;
        if (!obj || this.isDraggingGizmo) return;

        let breathX = 0, breathY = 0, breathZ = 0;
        if (obj.metadata?.initialHeadLocal) {
            const headNode = obj.getChildTransformNodes(false).find((n: any) => 
                n.name.toLowerCase() === 'head' || 
                n.name.toLowerCase() === 'neck' || 
                n.name.toLowerCase().includes('mixamorig:head') ||
                n.name.toLowerCase().includes('head')
            );
            if (headNode) {
                const currentGlobal = headNode.getAbsolutePosition();
                const currentLocal = Vector3.TransformCoordinates(currentGlobal, Matrix.Invert(obj.getWorldMatrix()));
                breathX = currentLocal.x - obj.metadata.initialHeadLocal.x;
                breathY = currentLocal.y - obj.metadata.initialHeadLocal.y;
                breathZ = currentLocal.z - obj.metadata.initialHeadLocal.z;
            }
        }

        const colMeta = obj.metadata?.collider;
        if (colMeta && this.debugCollider) {
           this.debugCollider.position.set(colMeta.offsetX + breathX, colMeta.offsetY + breathY, colMeta.offsetZ + breathZ);
        }

        const camMeta = obj.metadata?.camOffset;
        if (camMeta && this.debugCameraBox) {
           this.debugCameraBox.position.set(camMeta.x + breathX, camMeta.y + breathY, camMeta.z + breathZ);
        }
    });

    this.motor3d.editorCamera.attachControl(this.motor3d.engine.getRenderingCanvas(), true);
    this.sceneSvc.crearEntornoVisual();
    this.sceneSvc.actualizarListaNodos();
    this.setToolMode('translate');
  }

  private actualizarDebugMeshes(selected: Mesh | null) {
    if (!selected || (this.state.playState() !== 'EDITOR' && this.state.playState() !== 'EDITING_IN_GAME')) {
      if (this.debugCollider) { this.debugCollider.dispose(); this.debugCollider = null; }
      if (this.debugCameraBox) { this.debugCameraBox.dispose(); this.debugCameraBox = null; }
      return;
    }

    const scene = this.motor3d.scene;
    const colMeta = selected.metadata?.collider;
    if (colMeta && colMeta.type !== 'mesh') {
      if (this.debugCollider) this.debugCollider.dispose(); 
      if (colMeta.type === 'capsule') this.debugCollider = MeshBuilder.CreateCapsule("debugCollider", { radius: colMeta.sizeX, height: colMeta.sizeY * 2 }, scene);
      else if (colMeta.type === 'sphere') this.debugCollider = MeshBuilder.CreateSphere("debugCollider", { diameterX: colMeta.sizeX * 2, diameterY: colMeta.sizeY * 2, diameterZ: colMeta.sizeZ * 2 }, scene);
      else this.debugCollider = MeshBuilder.CreateBox("debugCollider", { width: colMeta.sizeX * 2, height: colMeta.sizeY * 2, depth: colMeta.sizeZ * 2 }, scene);
      
      this.debugCollider.position = new Vector3(colMeta.offsetX, colMeta.offsetY, colMeta.offsetZ);
      this.debugCollider.parent = selected;
      
      const matCol = new StandardMaterial("debugColMat", scene);
      matCol.wireframe = true;
      matCol.emissiveColor = colMeta.type === 'capsule' ? new Color3(0.2, 0.8, 0.2) : new Color3(0.8, 0.8, 0.2); 
      matCol.disableLighting = true;
      this.debugCollider.material = matCol;
      this.debugCollider.isPickable = false; 
    } else {
        if (this.debugCollider) { this.debugCollider.dispose(); this.debugCollider = null; }
    }

    const camMeta = selected.metadata?.camOffset;
    if (camMeta && (selected.metadata?.rol === 'npc' || selected.metadata?.rol === 'spawn_point')) {
      if (this.debugCameraBox) this.debugCameraBox.dispose();
      this.debugCameraBox = MeshBuilder.CreateBox("debugCamBox", { size: 0.25 }, scene);
      this.debugCameraBox.position = new Vector3(camMeta.x, camMeta.y, camMeta.z);
      this.debugCameraBox.parent = selected;
      const matCam = new StandardMaterial("debugCamMat", scene);
      matCam.wireframe = true;
      matCam.emissiveColor = new Color3(0.9, 0.2, 0.2); 
      matCam.disableLighting = true;
      this.debugCameraBox.material = matCam;
      this.debugCameraBox.isPickable = false;
    } else {
      if (this.debugCameraBox) { this.debugCameraBox.dispose(); this.debugCameraBox = null; }
    }
  }

  private manejarCtrlZGlobal = (event: KeyboardEvent) => {
    const state = this.state.playState();
    if (!(state === 'EDITOR' || state === 'EDITING_IN_GAME')) return;
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.key.toLowerCase() !== 'z') return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    event.preventDefault();
    event.stopPropagation();
    this.deshacerAccion();
  };

  setToolMode(mode: ToolMode): void {
    this.state.currentTool.set(mode);
    this.actualizarGizmosActivos(); 
  }

  private actualizarGizmosActivos(): void {
    if (!this.gizmoManager) return;
    this.gizmoManager.positionGizmoEnabled = false;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;

    const modo = this.state.playState();
    if (modo === 'PLAYING' || modo === 'INTERACTING' || modo === 'TRANSITIONING') return;

    if (this.state.objetoSeleccionado() || this.state.subObjetoSeleccionado()) {
      switch (this.state.currentTool()) {
        case 'translate': this.gizmoManager.positionGizmoEnabled = true; break;
        case 'rotate':
          if (this.state.subObjetoSeleccionado()) this.gizmoManager.rotationGizmoEnabled = false; 
          else {
              this.gizmoManager.rotationGizmoEnabled = true;
              if (this.gizmoManager.gizmos.rotationGizmo) this.gizmoManager.gizmos.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
          }
          break;
        case 'scale': this.gizmoManager.scaleGizmoEnabled = true; break;
      }
    }
  }

  private actualizarHighlights(selected: Mesh | null, hovered: Mesh | null): void {
    if (!this.hlHover || !this.hlSelected) return;

    this.hlHover.removeAllMeshes();
    this.hlSelected.removeAllMeshes();

    if (this.state.playState() !== 'EDITOR' && this.state.rolSimulado() === 'user') return;

    const colorHover = Color3.FromHexString('#3b82f6');
    const colorSelected = Color3.FromHexString('#fbbf24');

    const addHighlightToAllVisible = (mesh: Mesh, hl: HighlightLayer, color: Color3) => {
        if (mesh.isVisible && !mesh.name.includes("proxyCol") && !mesh.name.includes("debug") && !mesh.name.includes("cameraPivot")) {
            hl.addMesh(mesh, color);
        }
        mesh.getChildMeshes().forEach(c => {
            if (c instanceof Mesh && c.isVisible && !c.name.includes("proxyCol") && !c.name.includes("debug") && !c.name.includes("cameraPivot")) {
                hl.addMesh(c, color);
            }
        });
    };

    if (hovered && hovered !== selected) addHighlightToAllVisible(hovered, this.hlHover, colorHover);
    if (selected && !this.state.subObjetoSeleccionado()) addHighlightToAllVisible(selected, this.hlSelected, colorSelected);
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
    if (this.historialSvc.deshacer()) {
      this.sceneSvc.actualizarListaNodos();
      this.state.onGizmoDrag.next(); 
      this.state.triggerUpdate();    
    }
  }
}