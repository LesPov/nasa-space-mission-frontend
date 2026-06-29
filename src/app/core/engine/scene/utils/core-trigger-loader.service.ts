
import { Injectable, inject } from '@angular/core';
import { Color3, Mesh, MeshBuilder, StandardMaterial } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';

@Injectable({ providedIn: 'root' })
export class CoreTriggerLoaderService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);

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
    
    const actionT = entity.trigger.actionType;
    let color = new Color3(0, 1, 0); 
    let emissive = new Color3(0.2, 1.0, 0.2);
    
    if (!isComposite) {
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

    if (!mesh) {
      switch (shape) {
        case 'sphere': mesh = MeshBuilder.CreateSphere(trigger.name, { diameter: 1 }, scene); break;
        case 'cylinder': mesh = MeshBuilder.CreateCylinder(trigger.name, { height: 1, diameter: 1 }, scene); break;
        default: mesh = MeshBuilder.CreateBox(trigger.name, { size: 1 }, scene); break;
      }

      entity.bindView(mesh);

      const mat = new StandardMaterial('mat_trigger_' + trigger.name, scene);
      mat.diffuseColor = color;
      mat.emissiveColor = emissive;
      mat.alpha = 0.4; 
      mat.wireframe = false; 
      mat.disableLighting = true;
      mat.maxSimultaneousLights = 16; // 🔥 FIX LÍMITE LUCES
      mesh.material = mat;
      
      mesh.isPickable = true;
      mesh.checkCollisions = false;
      mesh.isVisible = true; 

      this.entityManager.addEntity(entity);
      mallasCreadas.set(entity.uid, mesh);
    } else {
      if (mesh.material instanceof StandardMaterial) {
          mesh.material.diffuseColor = color;
          mesh.material.emissiveColor = emissive;
          mesh.material.wireframe = false;
          mesh.material.alpha = 0.4;
      }
      entity.bindView(mesh);
      this.entityManager.addEntity(entity);
    }
  }
}