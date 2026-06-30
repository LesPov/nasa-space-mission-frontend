
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Mesh, MeshBuilder, StandardMaterial } from '@babylonjs/core';
import { HistorialService } from '../../historial.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../core/engine/scene/scene-access.token';
import { EditorStateService } from '../editor-state.service';
import { SceneNodesService } from './scene-nodes.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { CoreTriggerLoaderService } from '../../../core/engine/scene/utils/core-trigger-loader.service';
import { AuthService } from '../../../core/services/auth';
import { EditorMapaService } from '../../editor-mapa.service';
  
@Injectable({ providedIn: 'root' })
export class BuilderTriggerService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private state = inject(EditorStateService);
  private mapaSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private nodesSvc = inject(SceneNodesService);
  private entityManager = inject(EntityManagerService);
  private triggerLoader = inject(CoreTriggerLoaderService);
  private authSvc = inject(AuthService);

  public reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    const scene = this.motor3d.getScene();
    const entity = this.entityManager.getEntityByMesh(oldMesh);
    let newMesh!: Mesh;

    switch (nuevaForma) {
      case 'sphere':
        newMesh = MeshBuilder.CreateSphere(oldMesh.name, { diameter: 1 }, scene);
        break;
      case 'cylinder':
        newMesh = MeshBuilder.CreateCylinder(oldMesh.name, { height: 1, diameter: 1 }, scene);
        break;
      default:
        newMesh = MeshBuilder.CreateBox(oldMesh.name, { size: 1 }, scene);
        break;
    }

    if (oldMesh.parent) {
      newMesh.setParent(oldMesh.parent);
    }

    const isComp = entity?.trigger?.isComposite ?? false;
    const actionT = entity?.trigger?.actionType ?? 'show_message';
    
    let color = new Color3(0, 1, 0); 
    let emissive = new Color3(0.2, 1, 0.2);
    if (!isComp) {
      if (actionT === 'change_scene') {
        color = new Color3(1, 0, 0); 
        emissive = new Color3(1, 0.2, 0.2);
      } else {
        color = new Color3(1, 0, 1); 
        emissive = new Color3(1, 0.2, 1);
      }
    } else {
        color = new Color3(0, 0.5, 1); 
        emissive = new Color3(0, 0.3, 0.8);
    }

    if (entity) {
      if (entity.trigger) entity.trigger.triggerShape = nuevaForma;
      entity.isDirty = true;
      entity.bindView(newMesh); 
    } else {
      newMesh.position = oldMesh.getAbsolutePosition().clone();
      if (oldMesh.rotationQuaternion) newMesh.rotationQuaternion = oldMesh.rotationQuaternion.clone();
      else newMesh.rotation = oldMesh.rotation.clone();
      newMesh.scaling = oldMesh.scaling.clone();
    }

    const mat = new StandardMaterial('mat_trigger_' + newMesh.name, scene);
    mat.diffuseColor = color;
    mat.emissiveColor = emissive;
    mat.alpha = 0.4;
    mat.wireframe = false; 
    mat.disableLighting = true;
    mat.maxSimultaneousLights = 6;
    newMesh.material = mat;

    newMesh.isPickable = true;
    newMesh.checkCollisions = false;
    newMesh.isVisible = this.authSvc.isAdmin();

    if (this.state.objetoSeleccionado() === oldMesh) {
      this.state.seleccionarObjeto(newMesh);
    }

    oldMesh.dispose();
    this.nodesSvc.actualizarListaNodos();
    return newMesh;
  }

  public agregarTriggerCustom(
    nombre: string, shape: string, isComposite: boolean, mensaje: string, 
    sizeX: number, sizeY: number, sizeZ: number, parentNode: AbstractMesh | null = null,
    actionType: string = 'show_message'
  ): void {
    const mockDbObject = {
      uid: window.crypto.randomUUID(),
      name: nombre,
      type: isComposite ? 'trigger_compuesto' : 'trigger',
      position: parentNode ? {x:0, y:0, z:0} : { x: 0, y: sizeY / 2, z: 0 },
      scale: { x: sizeX, y: sizeY, z: sizeZ }, 
      parentId: parentNode?.metadata?.uid || null,
      condition: isComposite ? 'on_enter' : 'on_enter',
      actionType: actionType,
      actionProperties: {
         isComposite: isComposite,
         triggerShape: shape || 'cube',
         mensaje: mensaje,
         actionType: actionType
      }
    };

    const mallasCreadas = new Map<string, Mesh>();
    this.triggerLoader.cargarTrigger(mockDbObject, mallasCreadas);
    
    const newMesh = mallasCreadas.get(mockDbObject.uid);
    if (newMesh) {
      const ent = this.entityManager.getEntityByMesh(newMesh);
      if (ent) ent.isDirty = true;
      if (parentNode) newMesh.setParent(parentNode);
      this.state.seleccionarObjeto(newMesh);
      this.nodesSvc.actualizarListaNodos();
      this.historialSvc.registrarAccionCrear(newMesh);
      this.mapaSvc.onMapChanged.next();
    }
  }
}