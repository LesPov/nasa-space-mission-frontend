import { Injectable, inject } from '@angular/core';
import { Color3, Mesh, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core';
import { Motor3dService } from '../../../motor-3d.service';
import { EditorStateService } from '../../editor-state.service';

@Injectable({ providedIn: 'root' })
export class LoaderTriggerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);

  public cargarTrigger(trigger: any, mallasCreadas: Map<string, Mesh>): void {
    const scene = this.motor3d.scene;
    const isAdmin = this.state.rolSimulado() === 'admin';
    const shape = trigger.actionProperties?.triggerShape || 'cube';
    const isComposite = trigger.actionProperties?.isComposite ?? false;

    let mesh = scene.getMeshByName(trigger.name) as Mesh;
    if (!mesh) {
      switch (shape) {
        case 'sphere': mesh = MeshBuilder.CreateSphere(trigger.name, { diameter: 1 }, scene); break;
        case 'cylinder': mesh = MeshBuilder.CreateCylinder(trigger.name, { height: 1, diameter: 1 }, scene); break;
        default: mesh = MeshBuilder.CreateBox(trigger.name, { size: 1 }, scene); break;
      }

      mesh.position = new Vector3(trigger.position.x, trigger.position.y, trigger.position.z);
      mesh.scaling = new Vector3(trigger.size.x, trigger.size.y, trigger.size.z);

      // 🔥 MATERIAL VERDE NEÓN AL CARGAR LA ESCENA
      const mat = new StandardMaterial('mat_trigger_' + trigger.name, scene);
      mat.diffuseColor = new Color3(0.0, 1.0, 0.0);
      mat.emissiveColor = new Color3(0.2, 1.0, 0.2);
      mat.alpha = 0.4;
      mat.wireframe = true;
      mat.disableLighting = true;
      mat.maxSimultaneousLights = 16;
      mesh.material = mat;
      
      mesh.isPickable = true;
      mesh.checkCollisions = false;
      mesh.isVisible = isAdmin;

      mesh.metadata = {
        uid: trigger.uid || window.crypto.randomUUID(),
        type: 'trigger',
        triggerShape: shape,
        isComposite: isComposite,
        parentId: trigger.parentId || null,
        conditions: [],
        mensajeEntrada: '', mensajeSalida: '',
        soundUrlEntrada: '', soundUrlSalida: '',
        seqEntrada: '', seqSalida: '',
        timeEntrada: 4.5, timeSalida: 4.5,
        videoEntrada: '', videoSalida: '',
        condition: 'on_enter',
        mensaje: '', soundUrl: '', interactSequenceId: '',
        timeNorm: 4.5, videoNorm: '',
        isRepeatable: trigger.isRepeatable,
        isEnabled: trigger.isEnabled,
        hasTriggeredEnter: false, hasTriggeredExit: false
      };

      mallasCreadas.set(mesh.metadata.uid, mesh);
    }

    if (isComposite) {
      if (trigger.condition && !mesh.metadata.conditions.includes(trigger.condition)) {
        mesh.metadata.conditions.push(trigger.condition);
      }
      if (trigger.condition === 'on_enter') {
        mesh.metadata.mensajeEntrada = trigger.actionProperties?.mensaje || '';
        mesh.metadata.soundUrlEntrada = trigger.actionProperties?.soundUrl || '';
        mesh.metadata.seqEntrada = trigger.actionProperties?.seqEntrada || '';
        mesh.metadata.timeEntrada = trigger.actionProperties?.timeEntrada ?? 4.5;
        mesh.metadata.videoEntrada = trigger.actionProperties?.videoEntrada || '';
      } else if (trigger.condition === 'on_exit') {
        mesh.metadata.mensajeSalida = trigger.actionProperties?.mensaje || '';
        mesh.metadata.soundUrlSalida = trigger.actionProperties?.soundUrl || '';
        mesh.metadata.seqSalida = trigger.actionProperties?.seqSalida || '';
        mesh.metadata.timeSalida = trigger.actionProperties?.timeSalida ?? 4.5;
        mesh.metadata.videoSalida = trigger.actionProperties?.videoSalida || '';
      }
    } else {
      mesh.metadata.condition = trigger.condition || 'on_enter';
      mesh.metadata.mensaje = trigger.actionProperties?.mensaje || '';
      mesh.metadata.soundUrl = trigger.actionProperties?.soundUrl || '';
      mesh.metadata.interactSequenceId = trigger.actionProperties?.interactSequenceId || '';
      mesh.metadata.timeNorm = trigger.actionProperties?.timeNorm ?? 4.5;
      mesh.metadata.videoNorm = trigger.actionProperties?.videoNorm || '';
    }
  }
}