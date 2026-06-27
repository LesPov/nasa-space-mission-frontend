
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Matrix, Mesh, MeshBuilder, Observer, PointerEventTypes, KeyboardEventTypes, Ray, Scene, StandardMaterial, Tags, Vector3, Quaternion } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { CameraOwnershipService } from '../../core/engine/runtime/cameras/camera-ownership.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { SceneObjectBuilderService } from './sceneservice/scene-object-builder.service';
import { Subscription } from 'rxjs';
import { GameMode } from '../../core/engine/session/game-mode.model';

@Injectable({ providedIn: 'root' })
export class LiveBuilderService {
  private motor3d = inject(Motor3dService);
  private eventBus = inject(GameEventBusService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private entityManager = inject(EntityManagerService);
  private builderSvc = inject(SceneObjectBuilderService);

  private _isBuilding = false;
  private _isBuildingExecuting = false;
  private ghostMesh: Mesh | null = null;
  private currentAsset: any = null;
  private subs: Subscription[] = [];
  
  private renderObserver: Observer<Scene> | null = null;
  private pointerObserver: Observer<any> | null = null;
  private keyboardObserver: Observer<any> | null = null;
  
  private placementDistance = 5.0; // Distancia base de colocación en el aire
  private currentScale = 1.0;

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
    
    // Crear el mesh fantasma basado en la selección actual
    this.createGhostMesh();

    const scene = this.motor3d.scene;

    // 🔥 FIX: Actualizar la posición de forma continua durante la fase de renderizado
    this.renderObserver = scene.onBeforeRenderObservable.add(() => {
       this.updateGhostPosition();
    });

    // Detectar clic para construir o cancelar
    this.pointerObserver = scene.onPointerObservable.add((pi) => {
      if (pi.type === PointerEventTypes.POINTERDOWN) {
        if (pi.event.button === 0) {
           this.buildObject();
        } else if (pi.event.button === 2) {
           this.stopBuilding();
           this.eventBus.emit({ type: 'RadialMenuToggled', payload: false });
        }
      }
    });

    // 🔥 FIX: Teclas +/- para agrandar o achicar el objeto en tiempo real
    this.keyboardObserver = scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        const key = kbInfo.event.key;
        if (key === '+' || key === 'Add') {
            this.currentScale += 0.25;
            this.updateGhostScale();
        } else if (key === '-' || key === 'Subtract') {
            this.currentScale = Math.max(0.25, this.currentScale - 0.25);
            this.updateGhostScale();
        }
      }
    });
  }

  public stopBuilding(): void {
    this._isBuilding = false;
    this.currentAsset = null;

    if (this.ghostMesh) {
      this.ghostMesh.dispose();
      this.ghostMesh = null;
    }

    const scene = this.motor3d.scene;
    if (scene) {
      if (this.renderObserver) {
        scene.onBeforeRenderObservable.remove(this.renderObserver);
        this.renderObserver = null;
      }
      if (this.pointerObserver) {
        scene.onPointerObservable.remove(this.pointerObserver);
        this.pointerObserver = null;
      }
      if (this.keyboardObserver) {
        scene.onKeyboardObservable.remove(this.keyboardObserver);
        this.keyboardObserver = null;
      }
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
       // Usamos un Box representativo de tamaño 1x1x1
       this.ghostMesh = MeshBuilder.CreateBox('ghost_preview', { size: 1 }, scene);
    } else {
       // Geometrías precisas para las primitivas
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
    
    // Tag clave para que el raycast siempre ignore a este fantasma y a los sistemas ocultos
    Tags.AddTagsTo(this.ghostMesh, "system_element editor_only ignore_raycast");
  }

  private updateGhostPosition(): void {
    if (!this.ghostMesh || !this._isBuilding) return;

    const scene = this.motor3d.scene;
    const camera = this.ownership.getCamera();
    if (!camera) return;

    // 🔥 FIX: Raycast exacto desde el centro de la pantalla, evitando offsets de la cámara física
    const ray = scene.createPickingRay(
        scene.getEngine().getRenderWidth() / 2,
        scene.getEngine().getRenderHeight() / 2,
        Matrix.Identity(),
        camera
    );

    const activePlayer = this.context.activePlayerEntity();

    const hit = scene.pickWithRay(ray, (mesh) => {
       // 1. Ignorar recursivamente el fantasma actual
       if (mesh === this.ghostMesh || mesh.isDescendantOf(this.ghostMesh!)) return false;
       
       // 2. 🔥 FIX CRÍTICO: Filtrar al Jugador Activo (Evita colisionar con la propia cabeza / cápsula)
       if (activePlayer && activePlayer.view) {
           if (mesh === activePlayer.view || mesh.isDescendantOf(activePlayer.view)) {
               return false;
           }
       }

       // 3. Ignorar utilidades del editor o sistemas ocultos, pero PERMITIR chocar con el piso invisible
       if (Tags.MatchesQuery(mesh, "ignore_raycast || proxy_collider || fog_element || editor_only || debug_element || system_element")) {
           if (!Tags.MatchesQuery(mesh, "invisible_floor")) {
               return false;
           }
       }

       // 4. Ignorar triggers si estamos en modo Test/Play, ya que atravesaríamos paredes invisibles
       const entity = this.entityManager.getEntityByMesh(mesh);
       if (entity && (entity.type === 'trigger' || entity.type === 'trigger_compuesto')) {
           return false; 
       }

       return mesh.isPickable && mesh.isVisible;
    });

    if (hit && hit.hit && hit.pickedPoint) {
       // 🔥 FIX: Orientación y posición adaptativa para que el objeto repose perfectamente sobre la superficie
       const normal = hit.getNormal(true) || Vector3.Up();
       
       // Desplazamiento dinámico en base a la escala actual
       let offsetSize = 0.5 * this.currentScale; 
       if (this.currentAsset.type === 'plane') {
           offsetSize = 0.01; // El plano descansa pegado a la pared
       }
       
       const positionOffset = normal.scale(offsetSize);
       this.ghostMesh.position.copyFrom(hit.pickedPoint.add(positionOffset));
       
       // 🔥 FIX: Rotar automáticamente el objeto para que se acople a la pared o suelo
       let upDir = normal;
       let fwdDir = camera.getDirection(Vector3.Forward());
       let rightDir = Vector3.Cross(upDir, fwdDir);
       
       if (rightDir.lengthSquared() < 0.001) {
           rightDir = Vector3.Cross(upDir, camera.getDirection(Vector3.Up()));
       }
       rightDir.normalize();
       fwdDir = Vector3.Cross(rightDir, upDir).normalize();

       const rotMatrix = Matrix.Identity();
       Matrix.FromXYZAxesToRef(rightDir, upDir, fwdDir, rotMatrix);
       
       if (!this.ghostMesh.rotationQuaternion) {
           this.ghostMesh.rotationQuaternion = Quaternion.Identity();
       }
       this.ghostMesh.rotationQuaternion.copyFrom(Quaternion.FromRotationMatrix(rotMatrix));
       
       // Indicador Verde (Válido)
       if (this.ghostMesh.material instanceof StandardMaterial) {
           this.ghostMesh.material.emissiveColor.set(0, 0.5, 0); 
       }
    } else {
       // 🔥 FIX: Fallback seguro flotando frente a la cámara a distancia controlada
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

       if (!this.ghostMesh.rotationQuaternion) {
           this.ghostMesh.rotationQuaternion = Quaternion.Identity();
       }
       this.ghostMesh.rotationQuaternion.copyFrom(Quaternion.FromRotationMatrix(rotMatrix));
       
       // Indicador Amarillo (Flotando / Sin colisión)
       if (this.ghostMesh.material instanceof StandardMaterial) {
           this.ghostMesh.material.emissiveColor.set(0.5, 0.5, 0);
       }
    }
  }

  private async buildObject(): Promise<void> {
    if (!this.ghostMesh || !this.currentAsset || this._isBuildingExecuting) return;
    this._isBuildingExecuting = true;

    // Extraemos los vectores finales calculados
    const finalPos = this.ghostMesh.position.clone();
    let finalRotQuat = this.ghostMesh.rotationQuaternion ? this.ghostMesh.rotationQuaternion.clone() : null;
    let finalRotEuler = this.ghostMesh.rotation.clone();
    
    const tipo = this.currentAsset.type || 'cube';
    const nombre = `${tipo}_${Math.floor(Math.random() * 10000)}`;
    const scale = this.currentScale;

    // Llamada al constructor de objetos
    await this.builderSvc.agregarObjetoCustom(
      tipo,
      nombre,
      'prop',
      '#ffffff', 
      scale, scale, scale,   
      this.currentAsset, 
      true,      
      true,      
      '',        
      null,      
      finalPos   
    );

    // 🔥 FIX: Aplicar la rotación y el anclaje físico calculado a la malla real
    const createdMesh = this.motor3d.scene.getMeshByName(nombre);
    if (createdMesh) {
        if (finalRotQuat) {
            createdMesh.rotationQuaternion = finalRotQuat;
            createdMesh.rotation.set(0, 0, 0);
        } else {
            createdMesh.rotation.copyFrom(finalRotEuler);
        }
        
        const entity = this.entityManager.getEntityByMesh(createdMesh);
        if (entity) {
            entity.syncTransformFromView();
            entity.isDirty = true;
        }
    }

    // Finalizar proceso y desactivar submenús
    this._isBuildingExecuting = false;
    this.stopBuilding();
    this.eventBus.emit({ type: 'RadialMenuToggled', payload: false });
  }
}