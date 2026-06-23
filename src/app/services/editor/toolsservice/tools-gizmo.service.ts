
import { Injectable, inject } from '@angular/core';
import { Color3, GizmoManager, Mesh, MeshBuilder, PointerDragBehavior, Quaternion, StandardMaterial, TransformNode as BabylonTransformNode, Vector3, PointerEventTypes, Tags, AbstractMesh } from '@babylonjs/core';
import { HistorialService } from '../../historial.service';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { ToolsDebugService } from './tools-debug.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { CoreSceneProjectionService } from '../../../core/engine/scene/utils/core-scene-projection.service';
import { AuthService } from '../../../core/services/auth';
import { CameraOwnershipService } from '../../../core/engine/runtime/cameras/camera-ownership.service';
import { WindowSyncService } from '../../../core/services/window-sync.service';
import { EditorCinematicService } from '../editor-cinematic.service';

@Injectable({ providedIn: 'root' })
export class ToolsGizmoService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);
  private debugSvc = inject(ToolsDebugService);
  private entityManager = inject(EntityManagerService);
  private projectionSvc = inject(CoreSceneProjectionService);
  private authSvc = inject(AuthService);
  private ownership = inject(CameraOwnershipService);
  private windowSync = inject(WindowSyncService);
  private cinematicSvc = inject(EditorCinematicService); // 🔥 Para notificar a la timeline

  public gizmoManager!: GizmoManager;
  public centerDragMesh!: Mesh;
  public gizmoPivotNode!: BabylonTransformNode;
  
  public isDraggingGizmo = false;
  private estadoAntesDeArrastrar: any = null;
  private dragOffset: Vector3 = Vector3.Zero();

  public initGizmos(): void {
    if (this.gizmoManager) return;
    const scene = this.motor3d.scene;
    if (!scene) return;

    this.gizmoManager = new GizmoManager(scene);
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.clearGizmoOnEmptyPointerEvent = true;

    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = true;
    this.gizmoManager.scaleGizmoEnabled = true;

    if (this.gizmoManager.gizmos.positionGizmo) {
      this.gizmoManager.gizmos.positionGizmo.snapDistance = 0;
      this.gizmoManager.gizmos.positionGizmo.planarGizmoEnabled = false;
      this.gizmoManager.gizmos.positionGizmo.updateGizmoRotationToMatchAttachedMesh = false;
    }

    if (this.gizmoManager.gizmos.rotationGizmo) {
      this.gizmoManager.gizmos.rotationGizmo.snapDistance = 0;
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
    Tags.AddTagsTo(this.centerDragMesh, "system_element editor_only gizmo ignore_raycast");

    this.gizmoPivotNode = new BabylonTransformNode('gizmoPivotNode', utilityLayer.utilityLayerScene);

    const centerDragBehavior = new PointerDragBehavior();
    centerDragBehavior.moveAttached = false;
    this.centerDragMesh.addBehavior(centerDragBehavior);

    this.setupDragEvents(centerDragBehavior);
  }

  private broadcastLiveTransform(mesh: AbstractMesh): void {
    // 🔥 FIX: Actualizar los proxies cinemáticos para que el timeline los vea en vivo
    if (Tags.MatchesQuery(mesh, "cinematic_proxy")) {
        const clipId = mesh.name.replace('proxy_cam_', '');
        const euler = mesh.rotationQuaternion ? mesh.rotationQuaternion.toEulerAngles() : mesh.rotation;
        this.cinematicSvc.onProxyMoved.next({
            clipId,
            position: mesh.position,
            rotation: new Vector3(euler.x * 180/Math.PI, euler.y * 180/Math.PI, euler.z * 180/Math.PI)
        });
        return;
    }

    const entity = this.entityManager.getEntityByMesh(mesh);
    if (entity) {
      this.windowSync.broadcast({
        type: 'SYNC_TRANSFORM_LIVE',
        payload: {
          uid: entity.uid,
          position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
          rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
          rotationQuaternion: mesh.rotationQuaternion ? { x: mesh.rotationQuaternion.x, y: mesh.rotationQuaternion.y, z: mesh.rotationQuaternion.z, w: mesh.rotationQuaternion.w } : null,
          scaling: { x: mesh.scaling.x, y: mesh.scaling.y, z: mesh.scaling.z }
        }
      });
    }
  }

  private setupDragEvents(centerDragBehavior: PointerDragBehavior): void {
    const onDragStart = () => {
      this.isDraggingGizmo = true;
      const mesh = this.state.objetoSeleccionado() as Mesh;
      if (mesh && !Tags.MatchesQuery(mesh, "cinematic_proxy")) {
        this.estadoAntesDeArrastrar = this.historialSvc.obtenerEstado(mesh);
        mesh.computeWorldMatrix(true);
        this.gizmoPivotNode.computeWorldMatrix(true);
        this.dragOffset = mesh.getAbsolutePosition().subtract(this.gizmoPivotNode.getAbsolutePosition());
      }
    };

    const onDraggingCenter = (event: any) => {
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();

      if (mesh) {
        if (subSelected === 'collider' && this.debugSvc.debugCollider) {
          this.debugSvc.debugCollider.setAbsolutePosition(this.debugSvc.debugCollider.getAbsolutePosition().add(event.delta));
          this.centerDragMesh.position.copyFrom(this.debugSvc.debugCollider.getAbsolutePosition());
        } else if (!subSelected) {
          mesh.setAbsolutePosition(mesh.getAbsolutePosition().add(event.delta));
          this.updateCenterDragMeshRenderState(mesh, subSelected);
          this.broadcastLiveTransform(mesh); 
        }
        this.state.onGizmoDrag.next();
      }
    };

    const onDraggingGizmo = () => {
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();
      if (!mesh) return;

      if (!subSelected) {
        mesh.computeWorldMatrix(true);
        const pivotPos = this.gizmoPivotNode.getAbsolutePosition();

        if (!isNaN(pivotPos.x) && !isNaN(pivotPos.y) && !isNaN(pivotPos.z)) {
          mesh.setAbsolutePosition(pivotPos.add(this.dragOffset));
        }

        if (this.gizmoPivotNode.rotationQuaternion) {
          if (!mesh.rotationQuaternion) mesh.rotationQuaternion = Quaternion.Identity();
          mesh.rotationQuaternion.copyFrom(this.gizmoPivotNode.rotationQuaternion);
        } else {
          mesh.rotation.copyFrom(this.gizmoPivotNode.rotation);
        }

        mesh.scaling.copyFrom(this.gizmoPivotNode.scaling);
        mesh.computeWorldMatrix(true);

        this.updateCenterDragMeshRenderState(mesh, subSelected);
        this.broadcastLiveTransform(mesh); 
      }
      this.state.onGizmoDrag.next();
    };

    const onDragEnd = () => {
      this.isDraggingGizmo = false;
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();
      
      if (!mesh) return;

      if (!subSelected && this.estadoAntesDeArrastrar && !Tags.MatchesQuery(mesh, "cinematic_proxy")) {
        this.historialSvc.registrarAccionTransform(mesh, this.estadoAntesDeArrastrar);
        this.estadoAntesDeArrastrar = null;
        
        const entity = this.entityManager.getEntityByMesh(mesh);
        if (entity && entity.type === 'image_plane') {
            this.projectionSvc.actualizarProyeccion(mesh);
        }
      }

      queueMicrotask(() => { 
        this.state.onGizmoDrag.next(); 
        this.state.triggerUpdate(); 
      });
    };

    centerDragBehavior.onDragStartObservable.add(onDragStart);
    centerDragBehavior.onDragObservable.add(onDraggingCenter);
    centerDragBehavior.onDragEndObservable.add(onDragEnd);

    if (this.gizmoManager.gizmos.positionGizmo) {
      this.gizmoManager.gizmos.positionGizmo.onDragStartObservable.add(onDragStart);
      this.gizmoManager.gizmos.positionGizmo.onDragObservable.add(onDraggingGizmo);
      this.gizmoManager.gizmos.positionGizmo.onDragEndObservable.add(onDragEnd);
    }
    if (this.gizmoManager.gizmos.rotationGizmo) {
      this.gizmoManager.gizmos.rotationGizmo.onDragStartObservable.add(onDragStart);
      this.gizmoManager.gizmos.rotationGizmo.onDragObservable.add(onDraggingGizmo);
      this.gizmoManager.gizmos.rotationGizmo.onDragEndObservable.add(onDragEnd);
    }
    if (this.gizmoManager.gizmos.scaleGizmo) {
      this.gizmoManager.gizmos.scaleGizmo.onDragStartObservable.add(onDragStart);
      this.gizmoManager.gizmos.scaleGizmo.onDragObservable.add(onDraggingGizmo);
      this.gizmoManager.gizmos.scaleGizmo.onDragEndObservable.add(onDragEnd);
    }
  }

  public actualizarGizmosActivos(): void {
    if (!this.gizmoManager) return;

    this.gizmoManager.positionGizmoEnabled = false;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;

    const modo = this.state.playState();
    const isAdmin = this.authSvc.isAdmin();

    if (!isAdmin || modo === 'PLAYING' || modo === 'INTERACTING' || modo === 'TRANSITIONING') {
      const obj = this.state.objetoSeleccionado() as Mesh;
      this.updateCenterDragMeshRenderState(obj, this.state.subObjetoSeleccionado());
      return;
    }

    if (this.state.objetoSeleccionado() || this.state.subObjetoSeleccionado()) {
      switch (this.state.currentTool()) {
        case 'select': 
          break; // 🔥 Sin gizmos en modo Select
        case 'translate': this.gizmoManager.positionGizmoEnabled = true; break;
        case 'rotate': 
          if (!this.state.subObjetoSeleccionado()) this.gizmoManager.rotationGizmoEnabled = true;
          break;
        case 'scale': this.gizmoManager.scaleGizmoEnabled = true; break;
      }
    }
    
    const obj = this.state.objetoSeleccionado() as Mesh;
    this.updateCenterDragMeshRenderState(obj, this.state.subObjetoSeleccionado());
  }

  public attachGizmoToCurrentSelection(selected: Mesh | null, subSelected: string | null): void {
    if (!this.gizmoManager) return;

    const modoJuego = this.state.playState();
    const isAdmin = this.authSvc.isAdmin();

    if (modoJuego === 'PLAYING' || modoJuego === 'TRANSITIONING' || modoJuego === 'INTERACTING' || !isAdmin) {
      this.gizmoManager.attachToMesh(null);
      this.gizmoManager.positionGizmoEnabled = false;
      this.gizmoManager.rotationGizmoEnabled = false;
      this.gizmoManager.scaleGizmoEnabled = false;
      return;
    }

    // 🔥 FIX: Proxies de Cinemática soportan Gizmo puro
    if (selected && Tags.MatchesQuery(selected, "cinematic_proxy")) {
      this.gizmoManager.attachToMesh(selected);
      this.actualizarGizmosActivos();
      return;
    }

    if (subSelected === 'collider' && this.debugSvc.debugCollider) {
      this.gizmoManager.attachToMesh(this.debugSvc.debugCollider);
      this.gizmoPivotNode.parent = null;
    } else if (subSelected === 'camera' && this.debugSvc.debugCameraBox) {
      this.gizmoManager.attachToMesh(this.debugSvc.debugCameraBox);
      this.gizmoPivotNode.parent = null;
    } else if (subSelected === 'light' && this.debugSvc.debugLightBox) {
      this.gizmoManager.attachToMesh(this.debugSvc.debugLightBox);
      this.gizmoPivotNode.parent = null;
    } else if (subSelected === 'fog' && this.debugSvc.debugFogStartSphere) {
      this.gizmoManager.attachToMesh(this.debugSvc.debugFogStartSphere);
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

  public syncCenterDragMeshVisuals(pi: any): void {
      if (pi.type === PointerEventTypes.POINTERMOVE && this.centerDragMesh.material) {
        const mat = this.centerDragMesh.material as StandardMaterial;
        if (pi.pickInfo?.pickedMesh === this.centerDragMesh) {
          mat.emissiveColor = new Color3(1, 0.9, 0);
          mat.alpha = 0.85;
        } else {
          mat.emissiveColor = new Color3(1, 1, 1);
          mat.alpha = 0.65;
        }
      }
  }

  public updateCenterDragMeshRenderState(obj: Mesh | null, subSelected: string | null): void {
      if (obj && !this.isDraggingGizmo && !Tags.MatchesQuery(obj, "cinematic_proxy")) {
        if (subSelected !== 'collider' && subSelected !== 'camera' && subSelected !== 'light' && subSelected !== 'fog') {
          const entity = this.entityManager.getEntityByMesh(obj);
          if (entity && entity.collider && entity.collider.type !== 'mesh') {
            const posMundo = Vector3.TransformCoordinates(
                new Vector3(entity.collider.offsetX || 0, entity.collider.offsetY || 0, entity.collider.offsetZ || 0), 
                obj.getWorldMatrix()
            );
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

      const isSelectMode = this.state.currentTool() === 'select';

      // 🔥 Ocultamos el center drag box para proxies cinemáticos para que no estorbe
      const isProxy = obj && Tags.MatchesQuery(obj, "cinematic_proxy");

      if (this.gizmoManager.attachedMesh && !this.gizmoManager.attachedMesh.isDisposed() && !isSelectMode && !isProxy) {
        this.centerDragMesh.isVisible = true;
        const cam = this.gizmoManager.utilityLayer.utilityLayerScene.activeCamera || this.ownership.getCamera();
        if (cam) {
          const distance = Vector3.Distance(cam.globalPosition, this.centerDragMesh.position);
          const scale = Math.max(0.2, Math.min(distance * 0.035, 1.2));
          this.centerDragMesh.scaling.setAll(scale);
        }
      } else {
        this.centerDragMesh.isVisible = false;
      }
  }
}