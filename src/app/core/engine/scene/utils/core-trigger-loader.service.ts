// src/app/core/engine/scene/utils/core-trigger-loader.service.ts
import { Injectable, inject } from '@angular/core';
import { Mesh, MeshBuilder } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { TriggerVisualizerService } from './trigger-visualizer.service';

@Injectable({ providedIn: 'root' })
export class CoreTriggerLoaderService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private triggerVisualizer = inject(TriggerVisualizerService);

  public cargarTrigger(trigger: any, mallasCreadas: Map<string, Mesh>): void {
    const scene = this.motor3d.getScene();
    const shape = trigger.actionProperties?.triggerShape || trigger.properties?.triggerShape || 'cube';
    const isComposite = trigger.actionProperties?.isComposite ?? trigger.properties?.isComposite ?? false;

    const uid = trigger.uid || window.crypto.randomUUID();
    const entity = new GameEntity(uid, trigger.name, isComposite ? 'trigger_compuesto' : 'trigger', 'trigger');

    entity.transform.position = { x: trigger.position.x, y: trigger.position.y, z: trigger.position.z };
    
    const scl = trigger.scale || trigger.size || { x: 1, y: 1, z: 1 };
    entity.transform.scale = { x: scl.x, y: scl.y, z: scl.z };
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
      
      isRepeatable: trigger.properties?.isRepeatable ?? trigger.isRepeatable ?? false,
      gameConditions: trigger.properties?.gameConditions || trigger.actionProperties?.gameConditions || [],
      stateMutations: trigger.properties?.stateMutations || trigger.actionProperties?.stateMutations || [],
      actionType: trigger.properties?.actionType || trigger.actionType || trigger.actionProperties?.actionType || 'show_message',
      targetSceneId: trigger.properties?.targetSceneId || trigger.actionProperties?.targetSceneId || null
    };

    if (entity.triggerRuntime) {
       entity.triggerRuntime.isEnabled = trigger.properties?.isEnabled ?? trigger.isEnabled ?? true;
       entity.triggerRuntime.hasTriggeredEnter = false;
       entity.triggerRuntime.hasTriggeredExit = false;
    }

    let mesh = scene.getMeshByName(trigger.name) as Mesh;

    if (!mesh) {
      switch (shape) {
        case 'sphere': mesh = MeshBuilder.CreateSphere(trigger.name, { diameter: 1 }, scene); break;
        case 'cylinder': mesh = MeshBuilder.CreateCylinder(trigger.name, { height: 1, diameter: 1 }, scene); break;
        default: mesh = MeshBuilder.CreateBox(trigger.name, { size: 1 }, scene); break;
      }

      entity.bindView(mesh);

      // 🔥 OPTIMIZACIÓN: visibility 0 omite totalmente los Draw Calls de la GPU
      // pero mantiene a Babylon consciente para el Raycast. Muerte al Overdraw.
      mesh.visibility = 0; 
      mesh.material = null; 
      mesh.isPickable = true;
      mesh.checkCollisions = false;
      mesh.isVisible = true; 

      this.triggerVisualizer.createOrUpdateWireframe(mesh, shape, isComposite, entity.trigger.actionType);

      this.entityManager.addEntity(entity);
      mallasCreadas.set(entity.uid, mesh);
    } else {
      mesh.visibility = 0; 
      mesh.material = null;
      entity.bindView(mesh);
      this.triggerVisualizer.createOrUpdateWireframe(mesh, shape, isComposite, entity.trigger.actionType);
      this.entityManager.addEntity(entity);
    }
  }
}