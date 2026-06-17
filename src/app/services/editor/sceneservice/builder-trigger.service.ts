// src/app/services/editor/sceneservice/builder-trigger.service.ts
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Mesh, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core';
import { HistorialService } from '../../historial.service';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { SceneNodesService } from './scene-nodes.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { GameEntity } from '../../../core/engine/entities/game.entity';
 
@Injectable({ providedIn: 'root' })
export class BuilderTriggerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);
  private nodesSvc = inject(SceneNodesService);
  private entityManager = inject(EntityManagerService);

  public reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    const scene = this.motor3d.scene;
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

    // 1. Si tenemos Entidad, la Malla absorbe todo de ella
    if (entity) {
      if (entity.trigger) entity.trigger.triggerShape = nuevaForma;
      entity.bindView(newMesh); // Empuja pos, rot, scale y metadata
      this.entityManager.addEntity(entity); // Actualiza la referencia en el Manager
    } else {
      // Fallback de emergencia si la entidad se perdió
      newMesh.position = oldMesh.getAbsolutePosition().clone();
      if (oldMesh.rotationQuaternion) newMesh.rotationQuaternion = oldMesh.rotationQuaternion.clone();
      else newMesh.rotation = oldMesh.rotation.clone();
      newMesh.scaling = oldMesh.scaling.clone();
      newMesh.metadata = JSON.parse(JSON.stringify(oldMesh.metadata));
      newMesh.metadata.triggerShape = nuevaForma;
    }

    // 2. Configuración Visual Exclusiva de Babylon
    const mat = new StandardMaterial('mat_trigger_' + newMesh.name, scene);
    mat.diffuseColor = new Color3(0.0, 1.0, 0.0);
    mat.emissiveColor = new Color3(0.2, 1.0, 0.2);
    mat.alpha = 0.4;
    mat.wireframe = true;
    mat.disableLighting = true;
    mat.maxSimultaneousLights = 16;
    newMesh.material = mat;

    newMesh.isPickable = true;
    newMesh.checkCollisions = false;
    newMesh.isVisible = this.state.rolSimulado() === 'admin';

    if (this.state.objetoSeleccionado() === oldMesh) {
      this.state.objetoSeleccionado.set(newMesh);
    }

    oldMesh.dispose();
    this.nodesSvc.actualizarListaNodos();
    return newMesh;
  }

  public agregarTriggerCustom(
    nombre: string,
    shape: string,
    isComposite: boolean,
    mensaje: string,
    sizeX: number,
    sizeY: number,
    sizeZ: number,
    parentNode: AbstractMesh | null = null
  ): void {
    const scene = this.motor3d.scene;
    
    // 1. FUENTE DE VERDAD: Crear y poblar Entidad Lógica primero
    const uid = window.crypto.randomUUID();
    const entity = new GameEntity(uid, nombre, 'trigger', 'trigger');

    entity.transform.scale = { x: sizeX, y: sizeY, z: sizeZ };

    if (parentNode) {
      entity.parentId = parentNode.metadata?.uid || null;
      entity.transform.position = { x: 0, y: 0, z: 0 };
    } else {
      entity.transform.position = { x: 0, y: sizeY / 2, z: 0 };
    }

    entity.trigger = {
      isComposite: isComposite,
      triggerShape: shape || 'cube',
      conditions: isComposite ? ['on_enter'] : [],
      mensajeEntrada: isComposite ? mensaje : '',
      mensajeSalida: '',
      soundUrlEntrada: '',
      soundUrlSalida: '',
      seqEntrada: '',
      seqSalida: '',
      timeEntrada: 4.5,
      timeSalida: 4.5,
      videoEntrada: '',
      videoSalida: '',
      condition: 'on_enter',
      mensaje: isComposite ? '' : mensaje,
      soundUrl: '',
      interactSequenceId: '',
      timeNorm: 4.5,
      videoNorm: '',
      isRepeatable: false,
      isEnabled: true,
      hasTriggeredEnter: false,
      hasTriggeredExit: false,
      gameConditions: [],
      stateMutations: []
    };

    // 2. CREAR MALLA
    let mesh!: Mesh;
    switch (shape) {
      case 'sphere': mesh = MeshBuilder.CreateSphere(nombre, { diameter: 1 }, scene); break;
      case 'cylinder': mesh = MeshBuilder.CreateCylinder(nombre, { height: 1, diameter: 1 }, scene); break;
      default: mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene); break;
    }

    if (parentNode) {
      mesh.setParent(parentNode);
    }

    // 3. VINCULAR LA VISTA: La malla adquiere la posición y escala de la entidad
    entity.bindView(mesh);

    // 4. CONFIGURACIÓN VISUAL
    const mat = new StandardMaterial('mat_trigger_' + nombre, scene);
    mat.diffuseColor = new Color3(0.0, 1.0, 0.0);
    mat.emissiveColor = new Color3(0.2, 1.0, 0.2);
    mat.alpha = 0.4;
    mat.wireframe = true;
    mat.disableLighting = true;
    mat.maxSimultaneousLights = 16;
    mesh.material = mat;

    mesh.isPickable = true;
    mesh.checkCollisions = false;
    mesh.isVisible = this.state.rolSimulado() === 'admin';

    // 5. REGISTRAR EN EL MOTOR Y ECS
    this.entityManager.addEntity(entity);
    this.state.objetoSeleccionado.set(mesh);
    this.nodesSvc.actualizarListaNodos();
    this.historialSvc.registrarAccionCrear(mesh);
    this.state.triggerUpdate();
  }
}