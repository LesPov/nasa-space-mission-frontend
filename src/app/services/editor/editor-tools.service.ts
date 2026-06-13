import { Injectable, inject, effect } from '@angular/core';
import {
  Color3,
  GizmoManager,
  HighlightLayer,
  Mesh,
  PointerEventTypes,
  Matrix,
  AbstractMesh,
  KeyboardEventTypes,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  TransformNode,
  Ray,
  PointerDragBehavior,
  Scene,
  Color4,
  TransformNode as BabylonTransformNode,
  Quaternion,
  CascadedShadowGenerator,
  SpotLight,
  DirectionalLight,
  ShadowGenerator
} from '@babylonjs/core';
import { HistorialService } from '../historial.service';
import { Motor3dService } from '../motor-3d.service';
import { EditorCameraService } from './editor-camera.service';
import { EditorSceneService } from './editor-scene.service';
import { EditorStateService, ToolMode } from './editor-state.service';

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

  private lastHoveredMesh: Mesh | null = null;
  private lastSelectedMesh: Mesh | null = null;

  private estadoAntesDeArrastrar: any = null;
  private objetoEnPortapapeles: AbstractMesh | null = null;
  private listenerCtrlZAgregado = false;

  private debugCollider: Mesh | null = null;
  private debugCameraBox: Mesh | null = null;
  
  private debugFogStartSphere: Mesh | null = null;
  private debugFogEndSphere: Mesh | null = null;

  private centerDragMesh!: Mesh;
  private gizmoPivotNode!: BabylonTransformNode;
  private isDraggingGizmo = false;

  private lastHoverCheckTime = 0;

  constructor() {
    effect(() => {
      const selected = this.state.objetoSeleccionado() as Mesh;
      const hovered = this.state.objetoHovereado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();

      if (!this.isDraggingGizmo) this.actualizarDebugMeshes(selected);
      if (this.hlHover && this.hlSelected) this.actualizarHighlights(selected, hovered);

      this.aplicarNieblaEnTiempoReal();

      if (this.gizmoManager) {
        const modoJuego = this.state.playState();
        const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

        if (modoJuego === 'PLAYING' || modoJuego === 'TRANSITIONING' || modoJuego === 'INTERACTING' || !isAdmin) {
          this.gizmoManager.attachToMesh(null);
          this.gizmoManager.positionGizmoEnabled = false;
          this.gizmoManager.rotationGizmoEnabled = false;
          this.gizmoManager.scaleGizmoEnabled = false;
          return;
        }

        if (subSelected === 'collider' && this.debugCollider) {
          this.gizmoManager.attachToMesh(this.debugCollider);
          this.gizmoPivotNode.parent = null;
        } else if (subSelected === 'camera' && this.debugCameraBox) {
          this.gizmoManager.attachToMesh(this.debugCameraBox);
          this.gizmoPivotNode.parent = null;
        } else if (selected && !subSelected) {
          this.gizmoPivotNode.position.copyFrom(this.centerDragMesh.position);
          if (selected.rotationQuaternion) {
            this.gizmoPivotNode.rotationQuaternion = selected.rotationQuaternion.clone();
          } else {
            this.gizmoPivotNode.rotation = selected.rotation.clone();
          }
          this.gizmoPivotNode.scaling.copyFrom(selected.scaling);

          this.gizmoManager.attachToMesh(this.gizmoPivotNode as any);
        } else {
          this.gizmoManager.attachToMesh(null);
          this.gizmoPivotNode.parent = null;
        }

        this.actualizarGizmosActivos();
      }
    });

    effect(() => {
      this.state.currentTool();
      this.actualizarGizmosActivos();
    });
  }

  private normalizarNumero(valor: any, fallback: number): number {
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  private esTriggerMesh(mesh: AbstractMesh | null | undefined): boolean {
    return !!mesh && (mesh.metadata?.type === 'trigger' || mesh.name?.toLowerCase().includes('trigger'));
  }

  private getSelectionRangeConfig(): { fpsAdminMax: number; fpsUserMax: number } {
    const fallback = { fpsAdminMax: 10000, fpsUserMax: 3 };
    const candidates: Array<any> = [];
    const jugadorActivo = this.state.jugadorActivo as AbstractMesh | null;
    if (jugadorActivo?.metadata) candidates.push(jugadorActivo.metadata);

    const seleccionado = this.state.objetoSeleccionado() as AbstractMesh | null;
    if (seleccionado?.metadata) candidates.push(seleccionado.metadata);

    const scenePlayer = this.motor3d.scene.meshes.find(
      m => m.metadata?.rol === 'spawn_point' || m.metadata?.rol === 'npc'
    );
    if (scenePlayer?.metadata) candidates.push(scenePlayer.metadata);

    for (const meta of candidates) {
      const source = meta?.playerConfig?.selectionRange || meta?.selectionRange;
      if (!source) continue;
      return {
        fpsAdminMax: this.normalizarNumero(source.fpsAdminMax, fallback.fpsAdminMax),
        fpsUserMax: this.normalizarNumero(source.fpsUserMax, fallback.fpsUserMax)
      };
    }
    return fallback;
  }

  private getSelectionMaxDistance(isAdmin: boolean): number {
    const range = this.getSelectionRangeConfig();
    return isAdmin ? range.fpsAdminMax : range.fpsUserMax;
  }

  private getMeshSelectionPoint(mesh: AbstractMesh): Vector3 {
    try {
      mesh.computeWorldMatrix(true);
      const bi = mesh.getBoundingInfo?.();
      const center = bi?.boundingBox?.centerWorld;
      if (center) return center.clone();
    } catch {}
    return mesh.getAbsolutePosition().clone();
  }

  private getFogDebugAnchor(selected: AbstractMesh): Vector3 {
    const meta = selected?.metadata || {};
    const camMeta = meta?.camOffset;
    if ((meta?.rol === 'npc' || meta?.rol === 'spawn_point') && camMeta) {
      return new Vector3(
        this.normalizarNumero(camMeta.x, 0),
        this.normalizarNumero(camMeta.y, 1.6),
        this.normalizarNumero(camMeta.z, 0)
      );
    }
    if (meta?.initialHeadLocal) {
      return new Vector3(
        this.normalizarNumero(meta.initialHeadLocal.x, 0),
        this.normalizarNumero(meta.initialHeadLocal.y, 1.6),
        this.normalizarNumero(meta.initialHeadLocal.z, 0)
      );
    }
    const colMeta = meta?.collider;
    if (colMeta) {
      const offsetY = this.normalizarNumero(colMeta.offsetY, 0);
      const sizeY = this.normalizarNumero(colMeta.sizeY, 1);
      return new Vector3(
        this.normalizarNumero(colMeta.offsetX, 0),
        offsetY + Math.max(sizeY, 0.8),
        this.normalizarNumero(colMeta.offsetZ, 0)
      );
    }
    return new Vector3(0, 1.6, 0);
  }

  private canSelectByDistance(ray: Ray, target: AbstractMesh, hit: any, isAdmin: boolean): boolean {
    const playSt = this.state.playState();
    if (playSt !== 'PLAYING' && playSt !== 'EDITING_IN_GAME') return true;
    if (this.state.modoVistaPrueba !== 'FPS') return true;

    const maxDistance = this.getSelectionMaxDistance(isAdmin);
    if (!Number.isFinite(maxDistance) || maxDistance <= 0) return true;

    const distanceFromPick = typeof hit?.distance === 'number' ? hit.distance : NaN;
    if (Number.isFinite(distanceFromPick)) return distanceFromPick <= maxDistance;

    const origin = ray?.origin ?? this.motor3d.scene.activeCamera?.globalPosition;
    if (!origin) return true;
    return Vector3.Distance(origin, this.getMeshSelectionPoint(target)) <= maxDistance;
  }

  private puedeTomarseParaSeleccion(mesh: AbstractMesh): boolean {
    if (!mesh) return false;
    if (this.state.esMeshIgnorable(mesh)) return false;

    const root = this.state.encontrarRaiz(mesh) as AbstractMesh | null;
    const base = root ?? mesh;
    const selectable = base.metadata?.isSelectable ?? mesh.metadata?.isSelectable ?? true;
    return selectable !== false;
  }

  private resolverRootDesdeRay(ray: Ray, isAdmin: boolean): AbstractMesh | null {
    const scene = this.motor3d.scene;
    const playSt = this.state.playState();

    const hit = scene.pickWithRay(ray, (m) => {
      if (!m.isVisible || !m.isPickable) return false;
      const nameStr = m.name.toLowerCase();
      if (nameStr.includes('highlight') || nameStr.includes('gizmo')) return false;
      if (nameStr.includes('proxycol') || nameStr.includes('suelo') || nameStr.includes('skybox') || nameStr.includes('debug')) return false;
      if (m === this.centerDragMesh) return false;
      if (m.metadata?.type === 'trigger' || nameStr.includes('trigger')) {
          if (playSt === 'PLAYING' || playSt === 'EDITING_IN_GAME') return false;
      }
      return true;
    });

    if (!hit || !hit.hit || !hit.pickedMesh) return null;

    const picked = hit.pickedMesh as AbstractMesh;
    if (this.state.esMeshIgnorable(picked)) return null;

    const rootNode = this.state.encontrarRaiz(picked);
    if (!(rootNode instanceof AbstractMesh)) return null;
    if (this.esTriggerMesh(rootNode) && !isAdmin) return null;

    if (playSt === 'PLAYING' || playSt === 'EDITING_IN_GAME') {
      if (!isAdmin) return null;
      if (!this.canSelectByDistance(ray, rootNode, hit, true)) return null;
      return rootNode;
    }

    if (playSt === 'EDITOR') {
      if (!isAdmin) return null;
      if (!this.puedeTomarseParaSeleccion(rootNode)) return null;
      return rootNode;
    }
    return null;
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

    if (this.gizmoManager.gizmos.positionGizmo) {
      this.gizmoManager.gizmos.positionGizmo.snapDistance = 0;
      this.gizmoManager.gizmos.positionGizmo.planarGizmoEnabled = false;
      // 🔥 FIX DEFINITIVO DE SALTOS Y TELETRANSPORTE AL INFINITO
      // Obliga al Gizmo de posición a usar el Mundo Global, evitando cálculos erróneos por escalas no uniformes.
      this.gizmoManager.gizmos.positionGizmo.updateGizmoRotationToMatchAttachedMesh = false;
    }

    if (this.gizmoManager.gizmos.rotationGizmo) {
      this.gizmoManager.gizmos.rotationGizmo.snapDistance = 0;
      // 🔥 FIX DE ROTACIÓN CON ESCALAS NO UNIFORMES
      this.gizmoManager.gizmos.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
    }

    if (this.gizmoManager.gizmos.scaleGizmo) {
      this.gizmoManager.gizmos.scaleGizmo.snapDistance = 0;
    }

    const utilityLayer = this.gizmoManager.utilityLayer;

    this.centerDragMesh = MeshBuilder.CreatePolyhedron('centerDragPos', { type: 1, size: 0.6 }, utilityLayer.utilityLayerScene);
    const centerDragMat = new StandardMaterial('centerDragPosMat', utilityLayer.utilityLayerScene);
    centerDragMat.emissiveColor = new Color3(1, 1, 1);
    centerDragMat.alpha = 0.65;
    centerDragMat.disableLighting = true;
    this.centerDragMesh.material = centerDragMat;
    this.centerDragMesh.isVisible = false;

    this.gizmoPivotNode = new BabylonTransformNode('gizmoPivotNode', utilityLayer.utilityLayerScene);

    const centerDragBehavior = new PointerDragBehavior();
    centerDragBehavior.moveAttached = false;
    this.centerDragMesh.addBehavior(centerDragBehavior);

    centerDragBehavior.onDragStartObservable.add(() => {
      this.isDraggingGizmo = true;
      const attached = this.state.objetoSeleccionado() as AbstractMesh;
      if (attached) {
        this.estadoAntesDeArrastrar = this.historialSvc.obtenerEstado(attached);
      }
    });

    centerDragBehavior.onDragObservable.add((event) => {
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();

      if (mesh) {
        if (subSelected === 'collider' && this.debugCollider) {
          this.debugCollider.setAbsolutePosition(this.debugCollider.getAbsolutePosition().add(event.delta));
          this.centerDragMesh.position.copyFrom(this.debugCollider.getAbsolutePosition());
          mesh.metadata.collider.offsetX = this.debugCollider.position.x;
          mesh.metadata.collider.offsetY = this.debugCollider.position.y;
          mesh.metadata.collider.offsetZ = this.debugCollider.position.z;
        } else if (subSelected === 'camera' && this.debugCameraBox) {
          this.debugCameraBox.setAbsolutePosition(this.debugCameraBox.getAbsolutePosition().add(event.delta));
          this.centerDragMesh.position.copyFrom(this.debugCameraBox.getAbsolutePosition());
          mesh.metadata.camOffset.x = this.debugCameraBox.position.x;
          mesh.metadata.camOffset.y = this.debugCameraBox.position.y;
          mesh.metadata.camOffset.z = this.debugCameraBox.position.z;
        } else {
          mesh.setAbsolutePosition(mesh.getAbsolutePosition().add(event.delta));

          if (mesh.metadata?.collider && mesh.metadata?.collider?.type !== 'mesh') {
            const colOffsetX = mesh.metadata.collider.offsetX || 0;
            const colOffsetY = mesh.metadata.collider.offsetY || 0;
            const colOffsetZ = mesh.metadata.collider.offsetZ || 0;
            const posMundo = Vector3.TransformCoordinates(new Vector3(colOffsetX, colOffsetY, colOffsetZ), mesh.getWorldMatrix());
            this.centerDragMesh.position.copyFrom(posMundo);
          } else {
            mesh.computeWorldMatrix(true);
            this.centerDragMesh.position.copyFrom(mesh.getBoundingInfo().boundingBox.centerWorld);
          }
          this.gizmoPivotNode.position.copyFrom(this.centerDragMesh.position);
        }
        this.state.onGizmoDrag.next();
      }
    });

    centerDragBehavior.onDragEndObservable.add(() => {
      this.isDraggingGizmo = false;
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();

      if (subSelected === 'collider' && this.debugCollider) {
        mesh.metadata.collider.sizeX *= this.debugCollider.scaling.x;
        mesh.metadata.collider.sizeY *= this.debugCollider.scaling.y;
        mesh.metadata.collider.sizeZ *= this.debugCollider.scaling.z;
        this.debugCollider.scaling.set(1, 1, 1);
        this.actualizarDebugMeshes(mesh);
        this.gizmoManager.attachToMesh(this.debugCollider);
        queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      } else if (subSelected === 'camera' && this.debugCameraBox) {
        queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      } else if (mesh && this.estadoAntesDeArrastrar) {
        this.historialSvc.registrarAccionTransform(mesh, this.estadoAntesDeArrastrar);
        this.estadoAntesDeArrastrar = null;
        queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      }
    });

    utilityLayer.utilityLayerScene.onPointerObservable.add((pi) => {
      if (pi.type === PointerEventTypes.POINTERMOVE) {
        if (pi.pickInfo?.pickedMesh === this.centerDragMesh) {
          centerDragMat.emissiveColor = new Color3(1, 0.9, 0);
          centerDragMat.alpha = 0.85;
        } else {
          centerDragMat.emissiveColor = new Color3(1, 1, 1);
          centerDragMat.alpha = 0.65;
        }
      }
    });

    const onDragStart = () => {
      this.isDraggingGizmo = true;
      const mesh = this.state.objetoSeleccionado() as Mesh;
      if (mesh) {
        this.estadoAntesDeArrastrar = this.historialSvc.obtenerEstado(mesh);
      }
    };

    const onDragging = () => {
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();

      if (!mesh) return;

      if (subSelected === 'collider' && this.debugCollider) {
        this.centerDragMesh.position.copyFrom(this.debugCollider.getAbsolutePosition());
        mesh.metadata.collider.offsetX = this.debugCollider.position.x;
        mesh.metadata.collider.offsetY = this.debugCollider.position.y;
        mesh.metadata.collider.offsetZ = this.debugCollider.position.z;
        this.state.onGizmoDrag.next();
        return;
      }

      if (subSelected === 'camera' && this.debugCameraBox) {
        this.centerDragMesh.position.copyFrom(this.debugCameraBox.getAbsolutePosition());
        mesh.metadata.camOffset.x = this.debugCameraBox.position.x;
        mesh.metadata.camOffset.y = this.debugCameraBox.position.y;
        mesh.metadata.camOffset.z = this.debugCameraBox.position.z;
        this.state.onGizmoDrag.next();
        return;
      }

      mesh.computeWorldMatrix(true);
      const pivotPos = this.gizmoPivotNode.getAbsolutePosition();

      if (!isNaN(pivotPos.x) && !isNaN(pivotPos.y) && !isNaN(pivotPos.z)) {
        let localOffset = Vector3.Zero();
        if (mesh.metadata?.collider && mesh.metadata.collider.type !== 'mesh') {
          localOffset = new Vector3(
            mesh.metadata.collider.offsetX || 0,
            mesh.metadata.collider.offsetY || 0,
            mesh.metadata.collider.offsetZ || 0
          );
        }
        
        const rotQuat = this.gizmoPivotNode.rotationQuaternion || Quaternion.FromEulerAngles(this.gizmoPivotNode.rotation.x, this.gizmoPivotNode.rotation.y, this.gizmoPivotNode.rotation.z);
        const offsetMatrix = Matrix.Compose(this.gizmoPivotNode.scaling, rotQuat, Vector3.Zero());
        const worldOffset = Vector3.TransformCoordinates(localOffset, offsetMatrix);
        
        mesh.setAbsolutePosition(pivotPos.subtract(worldOffset));
      }

      if (this.gizmoPivotNode.rotationQuaternion) {
        if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
        mesh.rotationQuaternion.copyFrom(this.gizmoPivotNode.rotationQuaternion);
      } else {
        mesh.rotation.copyFrom(this.gizmoPivotNode.rotation);
      }

      mesh.scaling.copyFrom(this.gizmoPivotNode.scaling);
      mesh.computeWorldMatrix(true);

      if (mesh.metadata?.collider && mesh.metadata.collider.type !== 'mesh') {
        const posMundo = Vector3.TransformCoordinates(
          new Vector3(
            mesh.metadata.collider.offsetX || 0,
            mesh.metadata.collider.offsetY || 0,
            mesh.metadata.collider.offsetZ || 0
          ),
          mesh.getWorldMatrix()
        );
        this.centerDragMesh.position.copyFrom(posMundo);
      } else {
        this.centerDragMesh.position.copyFrom(mesh.getBoundingInfo().boundingBox.centerWorld);
      }

      this.state.onGizmoDrag.next();
    };

    const onDragEnd = () => {
      this.isDraggingGizmo = false;
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();

      if (!mesh) return;

      if (subSelected === 'collider' && this.debugCollider) {
        mesh.metadata.collider.sizeX *= this.debugCollider.scaling.x;
        mesh.metadata.collider.sizeY *= this.debugCollider.scaling.y;
        mesh.metadata.collider.sizeZ *= this.debugCollider.scaling.z;
        this.debugCollider.scaling.set(1, 1, 1);
        this.actualizarDebugMeshes(mesh);
        this.gizmoManager.attachToMesh(this.debugCollider);
        queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      } else if (subSelected === 'camera' && this.debugCameraBox) {
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

    scene.onPointerObservable.add((pi) => {
      const canvas = this.motor3d.engine.getRenderingCanvas();
      const playSt = this.state.playState();
      const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

      if (playSt === 'TRANSITIONING' || playSt === 'INTERACTING') return;

      if (pi.type === PointerEventTypes.POINTERDOUBLETAP && pi.event.button === 0) {
        if (isAdmin && playSt === 'EDITOR') {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
          ray.length = 10000;
          const rootNode = this.resolverRootDesdeRay(ray, isAdmin);
          if (rootNode) {
            this.state.objetoSeleccionado.set(rootNode);
            this.cameraSvc.enfocarObjetoEnEditor(rootNode);
          }
        }
        return;
      }

      if (pi.type === PointerEventTypes.POINTERTAP && pi.event.button === 0) {
        if (playSt === 'PLAYING') {
          if (!this.state.ratonBloqueado()) {
            try { canvas?.requestPointerLock(); } catch {}
            return;
          }

          if (this.state.modoVistaPrueba === 'FPS') {
            const ray = scene.createPickingRay(
              this.motor3d.engine.getRenderWidth() / 2,
              this.motor3d.engine.getRenderHeight() / 2,
              Matrix.Identity(),
              scene.activeCamera
            );
            ray.length = 10000;

            const rootNode = this.resolverRootDesdeRay(ray, isAdmin);
            if (rootNode) {
              this.state.objetoSeleccionado.set(rootNode);
              this.state.objetoHovereado.set(rootNode);

              if (isAdmin) {
                this.cameraSvc.transicionAEdicionEnVivo(rootNode);
              }
            } else {
              this.state.objetoSeleccionado.set(null);
              this.state.objetoHovereado.set(null);
            }
          }
          return;
        }

        if (isAdmin && (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME')) {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
          ray.length = 10000;

          const hitGizmo = scene.pickWithRay(ray, (mesh) => !!mesh?.name?.toLowerCase().includes('gizmo') || mesh === this.centerDragMesh);
          if (hitGizmo && hitGizmo.hit) return;

          const rootNode = this.resolverRootDesdeRay(ray, isAdmin);

          if (rootNode) {
            if (this.state.objetoSeleccionado() !== rootNode) {
              this.state.objetoSeleccionado.set(rootNode);
            }
          } else {
            this.state.objetoSeleccionado.set(null);
            if (playSt === 'EDITING_IN_GAME') {
              if (canvas) {
                canvas.focus();
                try { canvas.requestPointerLock(); } catch {}
              }
              this.cameraSvc.volverAJuego();
            }
          }
        }
      }

      if (pi.type === PointerEventTypes.POINTERMOVE) {
        const now = performance.now();
        if (now - this.lastHoverCheckTime < 40) return;
        this.lastHoverCheckTime = now;

        if (this.state.ratonBloqueado()) return;

        if (playSt === 'PLAYING' && this.state.modoVistaPrueba === 'FPS') {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
          ray.length = 10000;

          const rootNode = this.resolverRootDesdeRay(ray, isAdmin);
          this.state.objetoHovereado.set(rootNode);
          return;
        }

        if (isAdmin && (playSt === 'EDITOR' || playSt === 'EDITING_IN_GAME')) {
          const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), scene.activeCamera);
          ray.length = 10000;

          const hitGizmo = scene.pickWithRay(ray, (mesh) => !!mesh?.name?.toLowerCase().includes('gizmo') || mesh === this.centerDragMesh);
          if (hitGizmo && hitGizmo.hit) {
            this.state.objetoHovereado.set(null);
            return;
          }

          const rootNode = this.resolverRootDesdeRay(ray, isAdmin);
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
          this.cameraSvc.volverAJuego();
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

    if (!this.listenerCtrlZAgregado) {
      window.addEventListener('keydown', this.manejarCtrlZGlobal, true);
      this.listenerCtrlZAgregado = true;
    }

    this.state.onMapChanged.subscribe(() => {
      if (!this.isDraggingGizmo) this.actualizarDebugMeshes(this.state.objetoSeleccionado() as Mesh);
      this.aplicarNieblaEnTiempoReal();
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
      const subSelected = this.state.subObjetoSeleccionado();

      if (obj && !this.isDraggingGizmo) {
        if (subSelected !== 'collider' && subSelected !== 'camera') {
          if (obj.metadata?.collider && obj.metadata?.collider?.type !== 'mesh') {
            const colOffsetX = obj.metadata.collider.offsetX || 0;
            const colOffsetY = obj.metadata.collider.offsetY || 0;
            const colOffsetZ = obj.metadata.collider.offsetZ || 0;
            const posMundo = Vector3.TransformCoordinates(new Vector3(colOffsetX, colOffsetY, colOffsetZ), obj.getWorldMatrix());
            this.centerDragMesh.position.copyFrom(posMundo);
          } else {
            obj.computeWorldMatrix(true);
            this.centerDragMesh.position.copyFrom(obj.getBoundingInfo().boundingBox.centerWorld);
          }
          this.gizmoPivotNode.position.copyFrom(this.centerDragMesh.position);

          if (obj.rotationQuaternion) {
            this.gizmoPivotNode.rotationQuaternion = obj.rotationQuaternion.clone();
          } else {
            this.gizmoPivotNode.rotation = obj.rotation.clone();
          }
        }
      }

      if (this.gizmoManager.attachedMesh && !this.gizmoManager.attachedMesh.isDisposed()) {
        this.centerDragMesh.isVisible = true;
        const cam = utilityLayer.utilityLayerScene.activeCamera || scene.activeCamera;
        if (cam) {
          const distance = Vector3.Distance(cam.globalPosition, this.centerDragMesh.position);
          const scale = Math.max(0.2, Math.min(distance * 0.035, 1.2));
          this.centerDragMesh.scaling.setAll(scale);
        }
      } else {
        this.centerDragMesh.isVisible = false;
      }

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

      const fogAnchor = this.getFogDebugAnchor(obj);
      if (this.debugFogStartSphere) {
        this.debugFogStartSphere.position.set(
          fogAnchor.x + breathX,
          fogAnchor.y + breathY,
          fogAnchor.z + breathZ
        );
      }
      if (this.debugFogEndSphere) {
        this.debugFogEndSphere.position.set(
          fogAnchor.x + breathX,
          fogAnchor.y + breathY,
          fogAnchor.z + breathZ
        );
      }
    });

    this.motor3d.editorCamera.attachControl(this.motor3d.engine.getRenderingCanvas(), true);
    this.sceneSvc.crearEntornoVisual();
    this.sceneSvc.actualizarListaNodos();
    this.setToolMode('translate');
  }

  public aplicarNieblaEnTiempoReal() {
    const scene = this.motor3d.scene;
    if (!scene) return;

    const modo = this.state.playState();
    let targetPlayer: AbstractMesh | null = null;
    let shadowLimit = 10000;

    const spawnOrNpc = scene.meshes.find(m => m.metadata?.rol === 'spawn_point' || m.metadata?.rol === 'npc');
    targetPlayer = spawnOrNpc || null;

    const globalClearHex = (scene.metadata && scene.metadata.globalClearColor) ? scene.metadata.globalClearColor : '#0d1729';
    const clearColor3 = Color3.FromHexString(globalClearHex);
    scene.clearColor = new Color4(clearColor3.r, clearColor3.g, clearColor3.b, 1);

    const isBW = scene.metadata?.globalVisualMode === 'bw';
    const isFPS = this.state.modoVistaPrueba === 'FPS';

    if (modo === 'PLAYING' || modo === 'EDITING_IN_GAME') {
      if (targetPlayer && targetPlayer.metadata?.playerConfig?.fog?.enabled) {
        const fog = targetPlayer.metadata.playerConfig.fog;
        
        const activeColor = isBW ? (fog.colorBW || '#888888') : (fog.color || '#0d1729');
        
        let activeStart = 0;
        let activeEnd = 50;
        let activeRenderDistance = 150;
        
        let activeDensityStart = 0;
        let activeDensityEnd = 100;

        if (isBW) {
          activeStart = isFPS ? (fog.startFpsBW ?? 0) : (fog.startTpsBW ?? 5);
          activeEnd = isFPS ? (fog.endFpsBW ?? 60) : (fog.endTpsBW ?? 90);
          activeRenderDistance = isFPS ? (fog.renderDistanceFpsBW ?? 100) : (fog.renderDistanceTpsBW ?? 150);
          
          activeDensityStart = isFPS ? (fog.densityStartFpsBW ?? 0) : (fog.densityStartTpsBW ?? 0);
          activeDensityEnd = isFPS ? (fog.densityEndFpsBW ?? 100) : (fog.densityEndTpsBW ?? 100);
        } else {
          activeStart = isFPS ? (fog.startFPS ?? 0) : (fog.startTPS ?? 5);
          activeEnd = isFPS ? (fog.endFPS ?? 80) : (fog.endTPS ?? 120);
          activeRenderDistance = isFPS ? (fog.renderDistanceFPS ?? 150) : (fog.renderDistanceTPS ?? 200);
          
          activeDensityStart = isFPS ? (fog.densityStartFPS ?? 0) : (fog.densityStartTPS ?? 0);
          activeDensityEnd = isFPS ? (fog.densityEndFPS ?? 100) : (fog.densityEndTPS ?? 100);
        }

        let distCamToPlayer = 0;
        if (targetPlayer && scene.activeCamera) {
          distCamToPlayer = Vector3.Distance(scene.activeCamera.globalPosition, targetPlayer.getAbsolutePosition());
        }

        const clampedStart = Math.max(0, Math.min(99.5, activeDensityStart));
        const clampedEnd = Math.max(1, Math.min(100, activeDensityEnd)); 

        const gap = activeEnd - activeStart;
        const targetFogEnd = activeStart + (gap / (clampedEnd / 100));
        const finalAdjustedEnd = activeStart + ((targetFogEnd - activeStart) * (1 - (clampedStart / 100)));

        scene.fogMode = Scene.FOGMODE_LINEAR;
        scene.fogStart = activeStart + distCamToPlayer; 
        scene.fogEnd = finalAdjustedEnd + distCamToPlayer; 
        
        scene.clearColor = Color4.FromHexString(activeColor + 'ff');
        scene.fogColor = Color3.FromHexString(activeColor);

        const renderMaxZ = activeRenderDistance + distCamToPlayer;
        this.motor3d.editorCamera.maxZ = renderMaxZ;
        this.motor3d.playerCameraFPS.maxZ = renderMaxZ;
        this.motor3d.playerCameraTPS.maxZ = renderMaxZ;

        shadowLimit = renderMaxZ;
      } else {
        this.restaurarEntornoLibreDeNiebla(scene);
      }
    } else {
      this.restaurarEntornoLibreDeNiebla(scene);
    }

    scene.lights.forEach(light => {
      const sg: any = light.getShadowGenerator();
      if (sg && sg instanceof CascadedShadowGenerator) {
        if (modo === 'PLAYING') {
          sg.shadowMaxZ = shadowLimit;
        } else {
          sg.shadowMaxZ = 10000;
        }
      }
    });
  }

  private restaurarEntornoLibreDeNiebla(scene: Scene) {
    scene.fogMode = Scene.FOGMODE_NONE;
    
    const isBW = scene.metadata?.globalVisualMode === 'bw';
    const globalClearHex = isBW ? (scene.metadata?.globalClearColorBW || '#555555') : (scene.metadata?.globalClearColor || '#0d1729');
    scene.clearColor = Color4.FromHexString(globalClearHex + 'ff');

    this.motor3d.editorCamera.maxZ = 10000;
    this.motor3d.playerCameraFPS.maxZ = 10000;
    this.motor3d.playerCameraTPS.maxZ = 10000;
  }

  private actualizarDebugMeshes(selected: Mesh | null) {
    if (!selected || (this.state.playState() !== 'EDITOR' && this.state.playState() !== 'EDITING_IN_GAME')) {
      if (this.debugCollider) { this.debugCollider.dispose(); this.debugCollider = null; }
      if (this.debugCameraBox) { this.debugCameraBox.dispose(); this.debugCameraBox = null; }
      if (this.debugFogStartSphere) { this.debugFogStartSphere.dispose(); this.debugFogStartSphere = null; }
      if (this.debugFogEndSphere) { this.debugFogEndSphere.dispose(); this.debugFogEndSphere = null; }
      return;
    }

    const scene = this.motor3d.scene;
    const colMeta = selected.metadata?.collider;

    if (colMeta && colMeta.type !== 'mesh') {
      if (this.debugCollider) this.debugCollider.dispose();
      if (colMeta.type === 'capsule') this.debugCollider = MeshBuilder.CreateCapsule('debugCollider', { radius: colMeta.sizeX, height: colMeta.sizeY * 2 }, scene);
      else if (colMeta.type === 'sphere') this.debugCollider = MeshBuilder.CreateSphere('debugCollider', { diameterX: colMeta.sizeX * 2, diameterY: colMeta.sizeY * 2, diameterZ: colMeta.sizeZ * 2 }, scene);
      else this.debugCollider = MeshBuilder.CreateBox('debugCollider', { width: colMeta.sizeX * 2, height: colMeta.sizeY * 2, depth: colMeta.sizeZ * 2 }, scene);

      this.debugCollider.position = new Vector3(colMeta.offsetX, colMeta.offsetY, colMeta.offsetZ);
      this.debugCollider.parent = selected;

      const matCol = new StandardMaterial('debugColMat', scene);
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
      this.debugCameraBox = MeshBuilder.CreateBox('debugCamBox', { size: 0.25 }, scene);
      this.debugCameraBox.position = new Vector3(camMeta.x, camMeta.y, camMeta.z);
      this.debugCameraBox.parent = selected;
      const matCam = new StandardMaterial('debugCamMat', scene);
      matCam.wireframe = true;
      matCam.emissiveColor = new Color3(0.9, 0.2, 0.2);
      matCam.disableLighting = true;
      this.debugCameraBox.material = matCam;
      this.debugCameraBox.isPickable = false;
    } else {
      if (this.debugCameraBox) { this.debugCameraBox.dispose(); this.debugCameraBox = null; }
    }

    if (this.debugFogStartSphere) { this.debugFogStartSphere.dispose(); this.debugFogStartSphere = null; }
    if (this.debugFogEndSphere) { this.debugFogEndSphere.dispose(); this.debugFogEndSphere = null; }

    const playerConfig = selected.metadata?.playerConfig;
    if (playerConfig && playerConfig.fog && playerConfig.fog.enabled && (selected.metadata?.rol === 'npc' || selected.metadata?.rol === 'spawn_point')) {
      
      const isBW = scene.metadata?.globalVisualMode === 'bw';
      const isFPS = this.state.modoVistaPrueba === 'FPS';
      const fog = playerConfig.fog;
      
      let activeStart = 0;
      let activeEnd = 50;

      if (isBW) {
        activeStart = isFPS ? (fog.startFpsBW ?? 0) : (fog.startTpsBW ?? 5);
        activeEnd = isFPS ? (fog.endFpsBW ?? 60) : (fog.endTpsBW ?? 90);
      } else {
        activeStart = isFPS ? (fog.startFPS ?? 0) : (fog.startTPS ?? 5);
        activeEnd = isFPS ? (fog.endFPS ?? 80) : (fog.endTPS ?? 120);
      }

      const fogAnchor = this.getFogDebugAnchor(selected);

      if (activeStart > 0.1) {
        this.debugFogStartSphere = MeshBuilder.CreateSphere('debugFogStartSphere', { diameter: activeStart * 2, segments: 32 }, scene);
        this.debugFogStartSphere.position = fogAnchor.clone();
        this.debugFogStartSphere.parent = selected;

        const matFogStart = new StandardMaterial('debugFogStartMat', scene);
        matFogStart.wireframe = true;
        matFogStart.emissiveColor = new Color3(0.2, 0.8, 1.0); 
        matFogStart.alpha = 0.15;
        matFogStart.disableLighting = true;

        this.debugFogStartSphere.material = matFogStart;
        this.debugFogStartSphere.isPickable = false;
      }

      if (activeEnd > 0.1) {
        this.debugFogEndSphere = MeshBuilder.CreateSphere('debugFogEndSphere', { diameter: activeEnd * 2, segments: 32 }, scene);
        this.debugFogEndSphere.position = fogAnchor.clone();
        this.debugFogEndSphere.parent = selected;

        const matFogEnd = new StandardMaterial('debugFogEndMat', scene);
        matFogEnd.wireframe = true;
        matFogEnd.emissiveColor = new Color3(1.0, 0.2, 0.2); 
        matFogEnd.alpha = 0.25;
        matFogEnd.disableLighting = true;

        this.debugFogEndSphere.material = matFogEnd;
        this.debugFogEndSphere.isPickable = false;
      }
    }
  }

  private manejarCtrlZGlobal = (event: KeyboardEvent) => {
    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';
    if (!isAdmin) return;

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
    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    if (!isAdmin) return;
    if (modo === 'PLAYING' || modo === 'INTERACTING' || modo === 'TRANSITIONING') return;

    if (this.state.objetoSeleccionado() || this.state.subObjetoSeleccionado()) {
      switch (this.state.currentTool()) {
        case 'select':
          break;
        case 'translate':
          this.gizmoManager.positionGizmoEnabled = true;
          break;
        case 'rotate':
          if (this.state.subObjetoSeleccionado()) this.gizmoManager.rotationGizmoEnabled = false;
          else this.gizmoManager.rotationGizmoEnabled = true;
          break;
        case 'scale':
          this.gizmoManager.scaleGizmoEnabled = true;
          break;
      }
    }
  }

  private actualizarHighlights(selected: Mesh | null, hovered: Mesh | null): void {
    if (!this.hlHover || !this.hlSelected) return;

    if (this.lastHoveredMesh === hovered && this.lastSelectedMesh === selected) {
      return;
    }
    this.lastHoveredMesh = hovered;
    this.lastSelectedMesh = selected;

    this.hlHover.removeAllMeshes();
    this.hlSelected.removeAllMeshes();

    const mode = this.state.playState();
    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    if (mode !== 'EDITOR' && mode !== 'EDITING_IN_GAME' && !(mode === 'PLAYING' && isAdmin)) {
      return;
    }

    if (!isAdmin && (mode === 'EDITOR' || mode === 'EDITING_IN_GAME')) return;

    const colorHover = Color3.FromHexString('#3b82f6');
    const colorSelected = Color3.FromHexString('#fbbf24');

    const addHighlightToAllVisible = (mesh: Mesh, hl: HighlightLayer, color: Color3) => {
      if (mesh.isVisible && !mesh.name.includes('proxyCol') && !mesh.name.includes('debug') && !mesh.name.includes('cameraPivot') && mesh.metadata?.type !== 'trigger') {
        hl.addMesh(mesh, color);
      }
      mesh.getChildMeshes().forEach(c => {
        if (c instanceof Mesh && c.isVisible && !c.name.includes('proxyCol') && !c.name.includes('debug') && !c.name.includes('cameraPivot') && c.metadata?.type !== 'trigger') {
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
    if (objOriginal.metadata?.initialHeadLocal) {
      clon.metadata.initialHeadLocal = new Vector3(
        objOriginal.metadata.initialHeadLocal.x,
        objOriginal.metadata.initialHeadLocal.y,
        objOriginal.metadata.initialHeadLocal.z
      );
    }

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