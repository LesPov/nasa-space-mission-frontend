import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Mesh, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core';
import { HistorialService } from '../../historial.service';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { SceneNodesService } from './scene-nodes.service';
 
@Injectable({ providedIn: 'root' })
export class BuilderTriggerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private historialSvc = inject(HistorialService);
  private nodesSvc = inject(SceneNodesService);

  public reconstruirMallaTrigger(oldMesh: AbstractMesh, nuevaForma: string): Mesh {
    const scene = this.motor3d.scene;
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
      newMesh.position = oldMesh.getAbsolutePosition().clone();
      newMesh.setParent(oldMesh.parent);
    } else {
      newMesh.position = oldMesh.position.clone();
    }

    if (oldMesh.rotationQuaternion) newMesh.rotationQuaternion = oldMesh.rotationQuaternion.clone();
    else newMesh.rotation = oldMesh.rotation.clone();

    newMesh.scaling = oldMesh.scaling.clone();
    newMesh.metadata = JSON.parse(JSON.stringify(oldMesh.metadata));
    newMesh.metadata.triggerShape = nuevaForma;

    // 🔥 MATERIAL VERDE NEÓN PARA TRIGGERS
    const mat = new StandardMaterial('mat_trigger_' + newMesh.name, scene);
    mat.diffuseColor = new Color3(0.0, 1.0, 0.0);
    mat.emissiveColor = new Color3(0.2, 1.0, 0.2); // Emisión brillante
    mat.alpha = 0.4;
    mat.wireframe = true;
    mat.disableLighting = true; // No le afectan las sombras, siempre brilla
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
    let mesh!: Mesh;

    switch (shape) {
      case 'sphere':
        mesh = MeshBuilder.CreateSphere(nombre, { diameter: 1 }, scene);
        break;
      case 'cylinder':
        mesh = MeshBuilder.CreateCylinder(nombre, { height: 1, diameter: 1 }, scene);
        break;
      default:
        mesh = MeshBuilder.CreateBox(nombre, { size: 1 }, scene);
        break;
    }

    mesh.scaling = new Vector3(sizeX, sizeY, sizeZ);

    if (parentNode) {
      mesh.position = parentNode.getAbsolutePosition().clone();
      mesh.setParent(parentNode);
    } else {
      mesh.position = new Vector3(0, sizeY / 2, 0);
    }

    // 🔥 MATERIAL VERDE NEÓN PARA NUEVOS TRIGGERS
    const mat = new StandardMaterial('mat_trigger_' + nombre, scene);
    mat.diffuseColor = new Color3(0.0, 1.0, 0.0);
    mat.emissiveColor = new Color3(0.2, 1.0, 0.2);
    mat.alpha = 0.4;
    mat.wireframe = true;
    mat.disableLighting = true;
    mat.maxSimultaneousLights = 16;
    mesh.material = mat;

    mesh.metadata = {
      uid: window.crypto.randomUUID(),
      type: 'trigger',
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
      hasTriggeredExit: false
    };

    mesh.isPickable = true;
    mesh.checkCollisions = false;
    mesh.isVisible = this.state.rolSimulado() === 'admin';

    this.state.objetoSeleccionado.set(mesh);
    this.nodesSvc.actualizarListaNodos();
    this.historialSvc.registrarAccionCrear(mesh);
    this.state.triggerUpdate();
  }
}