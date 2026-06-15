
import { Injectable, inject } from '@angular/core';
import { Color3, GizmoManager, Matrix, Mesh, MeshBuilder, PointerDragBehavior, Quaternion, StandardMaterial, TransformNode as BabylonTransformNode, Vector3, PointerEventTypes, Light } from '@babylonjs/core';
import { HistorialService } from '../../historial.service';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService, ToolMode } from '../editor-state.service';
import { ToolsDebugService } from './tools-debug.service';

@Injectable({ providedIn: 'root' })
export class ToolsGizmoService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);
  private debugSvc = inject(ToolsDebugService);

  public gizmoManager!: GizmoManager;
  public centerDragMesh!: Mesh;
  public gizmoPivotNode!: BabylonTransformNode;
  
  public isDraggingGizmo = false;
  private estadoAntesDeArrastrar: any = null;

  public initGizmos(): void {
    const scene = this.motor3d.scene;
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

    this.gizmoPivotNode = new BabylonTransformNode('gizmoPivotNode', utilityLayer.utilityLayerScene);

    const centerDragBehavior = new PointerDragBehavior();
    centerDragBehavior.moveAttached = false;
    this.centerDragMesh.addBehavior(centerDragBehavior);

    this.setupDragEvents(centerDragBehavior);
  }

  private setupDragEvents(centerDragBehavior: PointerDragBehavior): void {
    const onDragStart = () => {
      this.isDraggingGizmo = true;
      const mesh = this.state.objetoSeleccionado() as Mesh;
      if (mesh) {
        this.estadoAntesDeArrastrar = this.historialSvc.obtenerEstado(mesh);
      }
    };

    const onDraggingCenter = (event: any) => {
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();

      if (mesh) {
        if (subSelected === 'collider' && this.debugSvc.debugCollider) {
          this.debugSvc.debugCollider.setAbsolutePosition(this.debugSvc.debugCollider.getAbsolutePosition().add(event.delta));
          this.centerDragMesh.position.copyFrom(this.debugSvc.debugCollider.getAbsolutePosition());
          mesh.metadata.collider.offsetX = this.debugSvc.debugCollider.position.x;
          mesh.metadata.collider.offsetY = this.debugSvc.debugCollider.position.y;
          mesh.metadata.collider.offsetZ = this.debugSvc.debugCollider.position.z;
        } else if (subSelected === 'camera' && this.debugSvc.debugCameraBox) {
          this.debugSvc.debugCameraBox.setAbsolutePosition(this.debugSvc.debugCameraBox.getAbsolutePosition().add(event.delta));
          this.centerDragMesh.position.copyFrom(this.debugSvc.debugCameraBox.getAbsolutePosition());
          mesh.metadata.camOffset.x = this.debugSvc.debugCameraBox.position.x;
          mesh.metadata.camOffset.y = this.debugSvc.debugCameraBox.position.y;
          mesh.metadata.camOffset.z = this.debugSvc.debugCameraBox.position.z;
        } else if (subSelected === 'light' && this.debugSvc.debugLightBox) {
          this.debugSvc.debugLightBox.setAbsolutePosition(this.debugSvc.debugLightBox.getAbsolutePosition().add(event.delta));
          this.centerDragMesh.position.copyFrom(this.debugSvc.debugLightBox.getAbsolutePosition());
          mesh.metadata.lightPosX = this.debugSvc.debugLightBox.position.x;
          mesh.metadata.lightPosY = this.debugSvc.debugLightBox.position.y;
          mesh.metadata.lightPosZ = this.debugSvc.debugLightBox.position.z;
          
          const lightObj = mesh.getDescendants(false).find(c => c.name.startsWith('l_')) as Light;
          if (lightObj && (lightObj as any).position) {
              (lightObj as any).position.copyFromFloats(mesh.metadata.lightPosX, mesh.metadata.lightPosY, mesh.metadata.lightPosZ);
          }
        } else if (subSelected === 'fog' && this.debugSvc.debugFogStartSphere) {
          this.debugSvc.debugFogStartSphere.setAbsolutePosition(this.debugSvc.debugFogStartSphere.getAbsolutePosition().add(event.delta));
          this.centerDragMesh.position.copyFrom(this.debugSvc.debugFogStartSphere.getAbsolutePosition());
          
          const basePos = this.debugSvc.getFogBaseLocalPos(mesh);
          mesh.metadata.playerConfig.fog.offsetX = this.debugSvc.debugFogStartSphere.position.x - basePos.x;
          mesh.metadata.playerConfig.fog.offsetY = this.debugSvc.debugFogStartSphere.position.y - basePos.y;
          mesh.metadata.playerConfig.fog.offsetZ = this.debugSvc.debugFogStartSphere.position.z - basePos.z;
        } else {
          mesh.setAbsolutePosition(mesh.getAbsolutePosition().add(event.delta));

          if (mesh.metadata?.collider && mesh.metadata?.collider?.type !== 'mesh') {
            const posMundo = Vector3.TransformCoordinates(
              new Vector3(mesh.metadata.collider.offsetX || 0, mesh.metadata.collider.offsetY || 0, mesh.metadata.collider.offsetZ || 0), 
              mesh.getWorldMatrix()
            );
            this.centerDragMesh.position.copyFrom(posMundo);
          } else {
            mesh.computeWorldMatrix(true);
            this.centerDragMesh.position.copyFrom(mesh.getBoundingInfo().boundingBox.centerWorld);
          }
          this.gizmoPivotNode.position.copyFrom(this.centerDragMesh.position);
        }
        this.state.onGizmoDrag.next();
      }
    };

    const onDraggingGizmo = () => {
      const mesh = this.state.objetoSeleccionado() as Mesh;
      const subSelected = this.state.subObjetoSeleccionado();
      if (!mesh) return;

      if (subSelected === 'collider' && this.debugSvc.debugCollider) {
        this.centerDragMesh.position.copyFrom(this.debugSvc.debugCollider.getAbsolutePosition());
        mesh.metadata.collider.offsetX = this.debugSvc.debugCollider.position.x;
        mesh.metadata.collider.offsetY = this.debugSvc.debugCollider.position.y;
        mesh.metadata.collider.offsetZ = this.debugSvc.debugCollider.position.z;
        this.state.onGizmoDrag.next();
        return;
      }

      if (subSelected === 'camera' && this.debugSvc.debugCameraBox) {
        this.centerDragMesh.position.copyFrom(this.debugSvc.debugCameraBox.getAbsolutePosition());
        mesh.metadata.camOffset.x = this.debugSvc.debugCameraBox.position.x;
        mesh.metadata.camOffset.y = this.debugSvc.debugCameraBox.position.y;
        mesh.metadata.camOffset.z = this.debugSvc.debugCameraBox.position.z;
        this.state.onGizmoDrag.next();
        return;
      }

      if (subSelected === 'light' && this.debugSvc.debugLightBox) {
        this.centerDragMesh.position.copyFrom(this.debugSvc.debugLightBox.getAbsolutePosition());
        mesh.metadata.lightPosX = this.debugSvc.debugLightBox.position.x;
        mesh.metadata.lightPosY = this.debugSvc.debugLightBox.position.y;
        mesh.metadata.lightPosZ = this.debugSvc.debugLightBox.position.z;
        
        const lightObj = mesh.getDescendants(false).find(c => c.name.startsWith('l_')) as Light;
        if (lightObj && (lightObj as any).position) {
            (lightObj as any).position.copyFromFloats(mesh.metadata.lightPosX, mesh.metadata.lightPosY, mesh.metadata.lightPosZ);
        }
        
        this.state.onGizmoDrag.next();
        return;
      }

      if (subSelected === 'fog' && this.debugSvc.debugFogStartSphere) {
        this.centerDragMesh.position.copyFrom(this.debugSvc.debugFogStartSphere.getAbsolutePosition());
        const basePos = this.debugSvc.getFogBaseLocalPos(mesh);
        mesh.metadata.playerConfig.fog.offsetX = this.debugSvc.debugFogStartSphere.position.x - basePos.x;
        mesh.metadata.playerConfig.fog.offsetY = this.debugSvc.debugFogStartSphere.position.y - basePos.y;
        mesh.metadata.playerConfig.fog.offsetZ = this.debugSvc.debugFogStartSphere.position.z - basePos.z;
        this.state.onGizmoDrag.next();
        return;
      }

      mesh.computeWorldMatrix(true);
      const pivotPos = this.gizmoPivotNode.getAbsolutePosition();

      if (!isNaN(pivotPos.x) && !isNaN(pivotPos.y) && !isNaN(pivotPos.z)) {
        let localOffset = Vector3.Zero();
        if (mesh.metadata?.collider && mesh.metadata.collider.type !== 'mesh') {
          localOffset = new Vector3(mesh.metadata.collider.offsetX || 0, mesh.metadata.collider.offsetY || 0, mesh.metadata.collider.offsetZ || 0);
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
          new Vector3(mesh.metadata.collider.offsetX || 0, mesh.metadata.collider.offsetY || 0, mesh.metadata.collider.offsetZ || 0),
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

      if (subSelected === 'collider' && this.debugSvc.debugCollider) {
        mesh.metadata.collider.sizeX *= this.debugSvc.debugCollider.scaling.x;
        mesh.metadata.collider.sizeY *= this.debugSvc.debugCollider.scaling.y;
        mesh.metadata.collider.sizeZ *= this.debugSvc.debugCollider.scaling.z;
        this.debugSvc.debugCollider.scaling.set(1, 1, 1);
        this.debugSvc.actualizarDebugMeshes(mesh);
        this.gizmoManager.attachToMesh(this.debugSvc.debugCollider);
        queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      } else if (subSelected === 'camera' && this.debugSvc.debugCameraBox) {
        queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      } else if (subSelected === 'light' && this.debugSvc.debugLightBox) {
        queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      } else if (subSelected === 'fog' && this.debugSvc.debugFogStartSphere) {
        queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      } else if (mesh && this.estadoAntesDeArrastrar) {
        this.historialSvc.registrarAccionTransform(mesh, this.estadoAntesDeArrastrar);
        this.estadoAntesDeArrastrar = null;
        
        if (mesh.metadata?.updateDecal) mesh.metadata.updateDecal();

        queueMicrotask(() => { this.state.onGizmoDrag.next(); this.state.triggerUpdate(); });
      }
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
    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    if (!isAdmin || modo === 'PLAYING' || modo === 'INTERACTING' || modo === 'TRANSITIONING') return;

    if (this.state.objetoSeleccionado() || this.state.subObjetoSeleccionado()) {
      switch (this.state.currentTool()) {
        case 'select': break;
        case 'translate': this.gizmoManager.positionGizmoEnabled = true; break;
        case 'rotate': 
          if (!this.state.subObjetoSeleccionado()) this.gizmoManager.rotationGizmoEnabled = true;
          break;
        case 'scale': this.gizmoManager.scaleGizmoEnabled = true; break;
      }
    }
  }

  public attachGizmoToCurrentSelection(selected: Mesh | null, subSelected: string | null): void {
    if (!this.gizmoManager) return;

    const modoJuego = this.state.playState();
    const isAdmin = this.state.checkIsAdmin() && this.state.rolSimulado() === 'admin';

    if (modoJuego === 'PLAYING' || modoJuego === 'TRANSITIONING' || modoJuego === 'INTERACTING' || !isAdmin) {
      this.gizmoManager.attachToMesh(null);
      this.gizmoManager.positionGizmoEnabled = false;
      this.gizmoManager.rotationGizmoEnabled = false;
      this.gizmoManager.scaleGizmoEnabled = false;
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
      if (obj && !this.isDraggingGizmo) {
        if (subSelected !== 'collider' && subSelected !== 'camera' && subSelected !== 'light' && subSelected !== 'fog') {
          if (obj.metadata?.collider && obj.metadata?.collider?.type !== 'mesh') {
            const posMundo = Vector3.TransformCoordinates(
                new Vector3(obj.metadata.collider.offsetX || 0, obj.metadata.collider.offsetY || 0, obj.metadata.collider.offsetZ || 0), 
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

      if (this.gizmoManager.attachedMesh && !this.gizmoManager.attachedMesh.isDisposed()) {
        this.centerDragMesh.isVisible = true;
        const cam = this.gizmoManager.utilityLayer.utilityLayerScene.activeCamera || this.motor3d.scene.activeCamera;
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
