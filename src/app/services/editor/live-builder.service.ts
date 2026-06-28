
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Matrix, Mesh, MeshBuilder, Observer, PointerEventTypes, KeyboardEventTypes, Ray, Scene, StandardMaterial, Tags, Vector3, Quaternion } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { CameraOwnershipService } from '../../core/engine/runtime/cameras/camera-ownership.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { SceneObjectBuilderService } from './sceneservice/scene-object-builder.service';
import { EditorStateService } from './editor-state.service';
import { Subscription } from 'rxjs';
import { GameEntity } from '../../core/engine/entities/game.entity';

export type PlacementMode = 'SURFACE' | 'CHILD' | 'SIBLING';

@Injectable({ providedIn: 'root' })
export class LiveBuilderService {
  private motor3d = inject(Motor3dService);
  private eventBus = inject(GameEventBusService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private entityManager = inject(EntityManagerService);
  private builderSvc = inject(SceneObjectBuilderService);
  private state = inject(EditorStateService);

  private _isBuilding = false;
  private _isBuildingExecuting = false;
  private ghostMesh: Mesh | null = null;
  private currentAsset: any = null;
  private subs: Subscription[] = [];
  
  private renderObserver: Observer<Scene> | null = null;
  private pointerObserver: Observer<any> | null = null;
  private keyboardObserver: Observer<any> | null = null;
  
  private placementDistance = 10.0;
  private currentScale = 1.0;

  private placementMode: PlacementMode = 'SURFACE';
  private targetParentEntity: GameEntity | null = null;
  
  private isValidPlacement = false;
  private isShiftDown = false;
  private isAltDown = false;

  public initialize(): void {
    if (this.subs.length > 0) return;

    this.subs.push(
      this.eventBus.events$.subscribe(e => {
        if (e.type === 'AssetSelectedForBuild') {
          if (e.payload) {
             this.startBuilding(e.payload);
          } else {
             this.stopBuilding();
          }
        }
      })
    );

    // Resetea las teclas si la ventana pierde el foco
    window.addEventListener('blur', () => {
        this.isShiftDown = false;
        this.isAltDown = false;
    });
  }

  public destroy(): void {
    this.stopBuilding();
    this.subs.forEach(s => s.unsubscribe());
    this.subs = [];
  }

  public isBuilding(): boolean {
    return this._isBuilding;
  }

  private startBuilding(assetPayload: any): void {
    this.stopBuilding();
    this._isBuilding = true;
    this._isBuildingExecuting = false;
    this.currentAsset = assetPayload;
    this.currentScale = 1.0;
    this.isShiftDown = false;
    this.isAltDown = false;
    
    this.createGhostMesh();

    const scene = this.motor3d.scene;

    // Actualiza la posición del Ghost constantemente (Necesario para cámaras FPS donde el ratón no se mueve en pantalla)
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
       if (this.state.showAddObjectModal()) return;
       this.updateGhostPosition();
    });

    this.pointerObserver = scene.onPointerObservable.add((pi) => {
      if (this.state.showAddObjectModal()) return;

      if (pi.type === PointerEventTypes.POINTERMOVE) {
          // Leer modificadores en tiempo real
          this.isShiftDown = pi.event.shiftKey;
          this.isAltDown = pi.event.altKey;
      } else if (pi.type === PointerEventTypes.POINTERDOWN) {
          // Previene spawns automáticos si se hizo clic para devolver el foco a la ventana
          if (!document.hasFocus()) return;

          if (pi.event.button === 0) {
             if (this.isValidPlacement) {
                 this.buildObject();
             }
          } else if (pi.event.button === 2) {
             this.stopBuilding();
             this.eventBus.emit({ type: 'RadialMenuToggled', payload: false });
          }
      }
    });

    this.keyboardObserver = scene.onKeyboardObservable.add((kbInfo) => {
      if (this.state.showAddObjectModal()) return;

      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        const key = kbInfo.event.key;
        if (key === 'Shift') this.isShiftDown = true;
        if (key === 'Alt') this.isAltDown = true;
        
        if (key === '+' || key === 'Add') {
            this.currentScale += 0.25;
            this.updateGhostScale();
        } else if (key === '-' || key === 'Subtract') {
            this.currentScale = Math.max(0.25, this.currentScale - 0.25);
            this.updateGhostScale();
        } else if (key === 'Escape') {
            this.stopBuilding();
            this.eventBus.emit({ type: 'RadialMenuToggled', payload: false });
        }
      } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
        if (kbInfo.event.key === 'Shift') this.isShiftDown = false;
        if (kbInfo.event.key === 'Alt') this.isAltDown = false;
      }
    });
  }

  public stopBuilding(): void {
    this._isBuilding = false;
    this.currentAsset = null;
    this.targetParentEntity = null;
    this.isValidPlacement = false;

    if (this.ghostMesh) {
      this.ghostMesh.dispose();
      this.ghostMesh = null;
    }

    const scene = this.motor3d.scene;
    if (scene) {
      if (this.renderObserver) scene.onBeforeRenderObservable.remove(this.renderObserver);
      if (this.pointerObserver) scene.onPointerObservable.remove(this.pointerObserver);
      if (this.keyboardObserver) scene.onKeyboardObservable.remove(this.keyboardObserver);
      this.renderObserver = null;
      this.pointerObserver = null;
      this.keyboardObserver = null;
    }
  }

  private updateGhostScale(): void {
      if (this.ghostMesh) {
          this.ghostMesh.scaling.setAll(this.currentScale);
      }
  }

  private createGhostMesh(): void {
    const scene = this.motor3d.scene;
    
    if (this.currentAsset.type === 'model' || this.currentAsset.type?.startsWith('light_')) {
       this.ghostMesh = MeshBuilder.CreateBox('ghost_preview', { size: 1 }, scene);
    } else {
       switch (this.currentAsset.type) {
         case 'sphere': this.ghostMesh = MeshBuilder.CreateSphere('ghost_preview', { diameter: 1 }, scene); break;
         case 'cylinder': this.ghostMesh = MeshBuilder.CreateCylinder('ghost_preview', { diameter: 1, height: 1 }, scene); break;
         case 'plane': this.ghostMesh = MeshBuilder.CreateGround('ghost_preview', { width: 1, height: 1 }, scene); break;
         default: this.ghostMesh = MeshBuilder.CreateBox('ghost_preview', { size: 1 }, scene); break;
       }
    }

    const mat = new StandardMaterial('ghost_mat', scene);
    mat.diffuseColor = new Color3(0, 1, 0);
    mat.emissiveColor = new Color3(0, 0.5, 0);
    mat.alpha = 0.6;
    mat.disableLighting = true;
    
    this.ghostMesh.material = mat;
    this.ghostMesh.isPickable = false;
    this.ghostMesh.checkCollisions = false;
    this.ghostMesh.scaling.setAll(this.currentScale);
    
    Tags.AddTagsTo(this.ghostMesh, "system_element editor_only ignore_raycast");
  }

  private setGhostColor(color: 'GREEN' | 'YELLOW' | 'BLUE' | 'RED') {
      if (!this.ghostMesh || !(this.ghostMesh.material instanceof StandardMaterial)) return;
      const mat = this.ghostMesh.material as StandardMaterial;
      
      switch(color) {
          case 'GREEN': 
              mat.diffuseColor.set(0, 1, 0);
              mat.emissiveColor.set(0, 0.5, 0);
              break;
          case 'YELLOW': 
              mat.diffuseColor.set(1, 1, 0);
              mat.emissiveColor.set(0.6, 0.6, 0);
              break;
          case 'BLUE': 
              mat.diffuseColor.set(0, 0.5, 1);
              mat.emissiveColor.set(0, 0.3, 0.8);
              break;
          case 'RED': 
              mat.diffuseColor.set(1, 0, 0);
              mat.emissiveColor.set(0.5, 0, 0);
              break;
      }
  }

  private getRootSelectableMesh(mesh: AbstractMesh): AbstractMesh {
      let current: AbstractMesh | null = mesh;
      while (current && current.parent instanceof AbstractMesh && current.name !== '__root__') {
          if (this.entityManager.getEntityByMesh(current)) break;
          current = current.parent;
      }
      return current || mesh;
  }

  private updateGhostPosition(): void {
    if (!this.ghostMesh || !this._isBuilding) return;

    const scene = this.motor3d.scene;
    const camera = this.ownership.getCamera();
    if (!camera) return;

    // Dependiendo del modo, el ratón puede estar libre o anclado al centro
    let pickX = scene.pointerX;
    let pickY = scene.pointerY;

    if (document.pointerLockElement) {
        pickX = scene.getEngine().getRenderWidth() / 2;
        pickY = scene.getEngine().getRenderHeight() / 2;
    }

    const ray = scene.createPickingRay(pickX, pickY, Matrix.Identity(), camera);
    const activePlayer = this.context.activePlayerEntity();

    const hit = scene.pickWithRay(ray, (mesh) => {
       if (mesh === this.ghostMesh || mesh.isDescendantOf(this.ghostMesh!)) return false;
       if (activePlayer && activePlayer.view) {
           if (mesh === activePlayer.view || mesh.isDescendantOf(activePlayer.view)) return false;
       }
       if (Tags.MatchesQuery(mesh, "ignore_raycast || proxy_collider || fog_element || editor_only || debug_element || system_element")) {
           if (!Tags.MatchesQuery(mesh, "invisible_floor")) return false;
       }
       const entity = this.entityManager.getEntityByMesh(mesh);
       if (entity && (entity.type === 'trigger' || entity.type === 'trigger_compuesto')) return false; 

       return mesh.isPickable && mesh.isVisible;
    });

    if (hit && hit.hit && hit.pickedPoint && hit.pickedMesh) {
       this.isValidPlacement = true;
       const hitNormal = hit.getNormal(true) || Vector3.Up();
       const rootHitMesh = this.getRootSelectableMesh(hit.pickedMesh);
       const hitEntity = this.entityManager.getEntityByMesh(rootHitMesh);

       // 1. REGLAS DE PARENTING BASADAS EN TECLADO
       if (Tags.MatchesQuery(hit.pickedMesh, "invisible_floor")) {
           this.placementMode = 'SURFACE';
           this.targetParentEntity = null;
           this.setGhostColor('GREEN');
       } else if (hitEntity) {
           if (this.isShiftDown) {
               this.placementMode = 'CHILD';
               this.targetParentEntity = hitEntity;
               this.setGhostColor('YELLOW');
           } else if (this.isAltDown) {
               this.placementMode = 'SIBLING';
               this.targetParentEntity = hitEntity.parentId ? this.entityManager.getEntityByUid(hitEntity.parentId) || null : null;
               this.setGhostColor('BLUE');
           } else {
               this.placementMode = 'SURFACE';
               this.targetParentEntity = null;
               this.setGhostColor('GREEN');
           }
       }

       // ORIENTATION CALCULATION (Alinear eje Y a la Normal de la superficie)
       let upDir = hitNormal;
       let fwdDir = camera.getDirection(Vector3.Forward());
       let rightDir = Vector3.Cross(upDir, fwdDir);
       
       if (rightDir.lengthSquared() < 0.001) rightDir = Vector3.Cross(upDir, camera.getDirection(Vector3.Up()));
       rightDir.normalize();
       fwdDir = Vector3.Cross(rightDir, upDir).normalize();

       const rotMatrix = Matrix.Identity();
       Matrix.FromXYZAxesToRef(rightDir, upDir, fwdDir, rotMatrix);
       const targetQuat = Quaternion.FromRotationMatrix(rotMatrix);

       if (!this.ghostMesh.rotationQuaternion) this.ghostMesh.rotationQuaternion = Quaternion.Identity();
       this.ghostMesh.rotationQuaternion.copyFrom(targetQuat);
       
       // Asegurar cálculo correcto de la caja delimitadora en tiempo real
       this.ghostMesh.scaling.setAll(this.currentScale);
       this.ghostMesh.computeWorldMatrix(true);

       // 2. POSICIONAMIENTO MATEMÁTICO PRECISO (Soporte Bounding Box)
       if (this.placementMode === 'SIBLING' && rootHitMesh) {
           const centerPos = rootHitMesh.getAbsolutePosition();
           const targetScaleX = Math.abs(rootHitMesh.absoluteScaling.x);
           const targetScaleY = Math.abs(rootHitMesh.absoluteScaling.y);
           const targetScaleZ = Math.abs(rootHitMesh.absoluteScaling.z);
           
           rootHitMesh.computeWorldMatrix(true);
           const invMat = Matrix.Invert(rootHitMesh.getWorldMatrix().getRotationMatrix());
           const localNormal = Vector3.TransformNormal(hitNormal, invMat); 
           
           const targetExtents = rootHitMesh.getBoundingInfo().boundingBox.extendSize;
           const ghostExtents = this.ghostMesh.getBoundingInfo().boundingBox.extendSize;
           
           // 🔥 FIX HERMANOS EXTREMO: Detectar el eje dominante de la normal para un Snap perfecto
           const absX = Math.abs(localNormal.x);
           const absY = Math.abs(localNormal.y);
           const absZ = Math.abs(localNormal.z);

           const localOffset = Vector3.Zero();

           if (absX > absY && absX > absZ) {
               localOffset.x = Math.sign(localNormal.x) * ((targetExtents.x * targetScaleX) + (ghostExtents.x * this.ghostMesh.scaling.x));
           } else if (absY > absX && absY > absZ) {
               localOffset.y = Math.sign(localNormal.y) * ((targetExtents.y * targetScaleY) + (ghostExtents.y * this.ghostMesh.scaling.y));
           } else {
               localOffset.z = Math.sign(localNormal.z) * ((targetExtents.z * targetScaleZ) + (ghostExtents.z * this.ghostMesh.scaling.z));
           }
           
           const worldOffset = Vector3.TransformNormal(localOffset, rootHitMesh.getWorldMatrix().getRotationMatrix());
           this.ghostMesh.position.copyFrom(centerPos.add(worldOffset));

           if (rootHitMesh.rotationQuaternion) {
               this.ghostMesh.rotationQuaternion.copyFrom(rootHitMesh.rotationQuaternion);
           } else {
               this.ghostMesh.rotationQuaternion.copyFrom(Quaternion.FromEulerAngles(rootHitMesh.rotation.x, rootHitMesh.rotation.y, rootHitMesh.rotation.z));
           }

       } else {
           // Independiente o Hijo (Soporta offset por extents reales para no hundirse)
           const extents = this.ghostMesh.getBoundingInfo().boundingBox.extendSize;
           const ghostInvRot = Matrix.Invert(rotMatrix);
           const ghostLocalNormal = Vector3.TransformNormal(hitNormal, ghostInvRot);
           
           let offsetDist = Math.abs(ghostLocalNormal.x) * extents.x * this.ghostMesh.scaling.x
                          + Math.abs(ghostLocalNormal.y) * extents.y * this.ghostMesh.scaling.y
                          + Math.abs(ghostLocalNormal.z) * extents.z * this.ghostMesh.scaling.z;
           
           if (this.currentAsset.type === 'plane') offsetDist = 0.01; 
           
           const positionOffset = hitNormal.scale(offsetDist);
           this.ghostMesh.position.copyFrom(hit.pickedPoint.add(positionOffset));
       }
    } else {
       // Raycast en el vacío (Aire)
       this.isValidPlacement = false;
       this.placementMode = 'SURFACE';
       this.targetParentEntity = null;
       this.setGhostColor('RED');

       const fallbackPos = camera.globalPosition.add(ray.direction.scale(this.placementDistance));
       this.ghostMesh.position.copyFrom(fallbackPos);
       
       const upDir = Vector3.Up();
       const fwdDir = ray.direction;
       let rightDir = Vector3.Cross(upDir, fwdDir);
       if (rightDir.lengthSquared() < 0.001) rightDir = Vector3.Right();
       rightDir.normalize();
       const fwdDirOrthogonal = Vector3.Cross(rightDir, upDir).normalize();

       const rotMatrix = Matrix.Identity();
       Matrix.FromXYZAxesToRef(rightDir, upDir, fwdDirOrthogonal, rotMatrix);

       if (!this.ghostMesh.rotationQuaternion) this.ghostMesh.rotationQuaternion = Quaternion.Identity();
       this.ghostMesh.rotationQuaternion.copyFrom(Quaternion.FromRotationMatrix(rotMatrix));
    }
  }

  private async buildObject(): Promise<void> {
    if (!this.ghostMesh || !this.currentAsset || this._isBuildingExecuting || !this.isValidPlacement) return;
    this._isBuildingExecuting = true;

    const finalPosWorld = this.ghostMesh.getAbsolutePosition();
    const finalRotQuatWorld = this.ghostMesh.absoluteRotationQuaternion || Quaternion.FromRotationMatrix(this.ghostMesh.getWorldMatrix());
    
    const tipo = this.currentAsset.type || 'cube';
    const nombre = `${tipo}_${Math.floor(Math.random() * 100000)}`;

    let parentNode: AbstractMesh | null = null;

    if (this.targetParentEntity && this.placementMode !== 'SURFACE') {
       if (this.placementMode === 'CHILD') {
           parentNode = this.targetParentEntity.view as AbstractMesh;
       } else if (this.placementMode === 'SIBLING') {
           if (this.targetParentEntity.parentId) {
               const parentEntity = this.entityManager.getEntityByUid(this.targetParentEntity.parentId);
               if (parentEntity && parentEntity.view) {
                   parentNode = parentEntity.view as AbstractMesh;
               }
           }
       }
    }

    let spawnPosLocal = finalPosWorld.clone();
    let spawnRotLocalEuler = finalRotQuatWorld.toEulerAngles();
    
    let scaleX = this.ghostMesh.scaling.x;
    let scaleY = this.ghostMesh.scaling.y;
    let scaleZ = this.ghostMesh.scaling.z;

    // 🔥 FIX HERENCIA (Counter-Scaling): Mantener escala mundial intacta calculando la inversa
    if (parentNode) {
        parentNode.computeWorldMatrix(true);
        const invParentMat = Matrix.Invert(parentNode.getWorldMatrix());
        
        spawnPosLocal = Vector3.TransformCoordinates(finalPosWorld, invParentMat);
        
        const parentRotWorld = parentNode.absoluteRotationQuaternion || Quaternion.FromRotationMatrix(parentNode.getWorldMatrix().getRotationMatrix());
        const invParentRot = Quaternion.Inverse(parentRotWorld);
        const localQuat = invParentRot.multiply(finalRotQuatWorld);
        spawnRotLocalEuler = localQuat.toEulerAngles();

        const parentScale = parentNode.absoluteScaling;
        const pSX = Math.abs(parentScale.x) > 0.001 ? Math.abs(parentScale.x) : 1;
        const pSY = Math.abs(parentScale.y) > 0.001 ? Math.abs(parentScale.y) : 1;
        const pSZ = Math.abs(parentScale.z) > 0.001 ? Math.abs(parentScale.z) : 1;

        scaleX = scaleX / pSX;
        scaleY = scaleY / pSY;
        scaleZ = scaleZ / pSZ;
    }

    await this.builderSvc.agregarObjetoCustom(
      tipo, nombre, 'prop', '#ffffff', 
      scaleX, scaleY, scaleZ,   
      this.currentAsset, 
      true, true, '',        
      parentNode,      
      spawnPosLocal,
      spawnRotLocalEuler
    );

    this._isBuildingExecuting = false;
  }
}