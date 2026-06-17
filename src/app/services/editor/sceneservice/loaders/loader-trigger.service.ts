// src/app/services/editor/sceneservice/loaders/loader-trigger.service.ts
import { Injectable, inject } from '@angular/core';
import { Color3, Mesh, MeshBuilder, StandardMaterial } from '@babylonjs/core';
import { Motor3dService } from '../../../motor-3d.service';
import { EditorStateService } from '../../editor-state.service';
import { EntityManagerService } from '../../../../core/engine/entities/entity-manager.service';
import { GameEntity } from '../../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class LoaderTriggerService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private entityManager = inject(EntityManagerService);

  public cargarTrigger(trigger: any, mallasCreadas: Map<string, Mesh>): void {
    const scene = this.motor3d.scene;
    const isAdmin = this.state.rolSimulado() === 'admin';
    const shape = trigger.actionProperties?.triggerShape || 'cube';
    const isComposite = trigger.actionProperties?.isComposite ?? false;

    // 1. FUENTE DE VERDAD: Creación de la Entidad
    const uid = trigger.uid || window.crypto.randomUUID();
    const entity = new GameEntity(uid, trigger.name, 'trigger', 'trigger');

    entity.transform.position = { x: trigger.position.x, y: trigger.position.y, z: trigger.position.z };
    entity.transform.scale = { x: trigger.scale?.x ?? 1, y: trigger.scale?.y ?? 1, z: trigger.scale?.z ?? 1 };
    entity.parentId = trigger.parentId || null;

    entity.trigger = {
      isComposite: isComposite,
      triggerShape: shape,
      conditions: isComposite && trigger.condition ? [trigger.condition] : [],
      mensajeEntrada: isComposite && trigger.condition === 'on_enter' ? (trigger.actionProperties?.mensaje || '') : '',
      mensajeSalida: isComposite && trigger.condition === 'on_exit' ? (trigger.actionProperties?.mensaje || '') : '',
      soundUrlEntrada: isComposite && trigger.condition === 'on_enter' ? (trigger.actionProperties?.soundUrl || '') : '',
      soundUrlSalida: isComposite && trigger.condition === 'on_exit' ? (trigger.actionProperties?.soundUrl || '') : '',
      seqEntrada: isComposite && trigger.condition === 'on_enter' ? (trigger.actionProperties?.seqEntrada || '') : '',
      seqSalida: isComposite && trigger.condition === 'on_exit' ? (trigger.actionProperties?.seqSalida || '') : '',
      timeEntrada: isComposite && trigger.condition === 'on_enter' ? (trigger.actionProperties?.timeEntrada ?? 4.5) : 4.5,
      timeSalida: isComposite && trigger.condition === 'on_exit' ? (trigger.actionProperties?.timeSalida ?? 4.5) : 4.5,
      videoEntrada: isComposite && trigger.condition === 'on_enter' ? (trigger.actionProperties?.videoEntrada || '') : '',
      videoSalida: isComposite && trigger.condition === 'on_exit' ? (trigger.actionProperties?.videoSalida || '') : '',
      
      condition: !isComposite ? (trigger.condition || 'on_enter') : 'on_enter',
      mensaje: !isComposite ? (trigger.actionProperties?.mensaje || '') : '',
      soundUrl: !isComposite ? (trigger.actionProperties?.soundUrl || '') : '',
      interactSequenceId: !isComposite ? (trigger.actionProperties?.interactSequenceId || '') : '',
      timeNorm: !isComposite ? (trigger.actionProperties?.timeNorm ?? 4.5) : 4.5,
      videoNorm: !isComposite ? (trigger.actionProperties?.videoNorm || '') : '',
      
      isRepeatable: trigger.isRepeatable ?? false,
      isEnabled: trigger.isEnabled ?? true,
      hasTriggeredEnter: false,
      hasTriggeredExit: false,
      gameConditions: [],
      stateMutations: []
    };

    // 2. CREACIÓN O RECUPERACIÓN DE LA MALLA
    let mesh = scene.getMeshByName(trigger.name) as Mesh;
    
    if (!mesh) {
      switch (shape) {
        case 'sphere': mesh = MeshBuilder.CreateSphere(trigger.name, { diameter: 1 }, scene); break;
        case 'cylinder': mesh = MeshBuilder.CreateCylinder(trigger.name, { height: 1, diameter: 1 }, scene); break;
        default: mesh = MeshBuilder.CreateBox(trigger.name, { size: 1 }, scene); break;
      }

      // 3. VINCULACIÓN ECS -> VISTA (Aquí la malla absorbe posición y metadatos)
      entity.bindView(mesh);

      // 4. CONFIGURACIÓN VISUAL BABYLON
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

      this.entityManager.addEntity(entity);
      mallasCreadas.set(entity.uid, mesh);
    } else {
      // Si la malla ya existía, igual la atamos a la entidad
      entity.bindView(mesh);
      this.entityManager.addEntity(entity);
    }
  }
}