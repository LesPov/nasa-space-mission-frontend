
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

    let rawUid = trigger.uid || window.crypto.randomUUID();
    const baseUid = rawUid.replace('_on_enter', '').replace('_on_exit', '');
    
    let entity = this.entityManager.getEntityByUid(baseUid);
    let mesh = scene.getMeshByName(trigger.name) as Mesh;

    if (!entity) {
      entity = new GameEntity(baseUid, trigger.name, isComposite ? 'trigger_compuesto' : 'trigger', 'trigger');

      entity.transform.position = { x: trigger.position.x, y: trigger.position.y, z: trigger.position.z };
      
      const scl = trigger.scale || trigger.size || { x: 1, y: 1, z: 1 };
      entity.transform.scale = { x: scl.x, y: scl.y, z: scl.z };
      entity.parentId = trigger.parentId || null;

      entity.trigger = {
        isComposite: isComposite,
        triggerShape: shape,
        conditions: [],
        mensajeEntrada: '', mensajeSalida: '',
        soundUrlEntrada: '', soundUrlSalida: '',
        seqEntrada: '', seqSalida: '',
        timeEntrada: 4.5, timeSalida: 4.5,
        videoEntrada: '', videoSalida: '',
        
        condition: 'on_enter',
        mensaje: '', soundUrl: '', interactSequenceId: '', timeNorm: 4.5, videoNorm: '',
        
        isRepeatable: trigger.properties?.isRepeatable ?? trigger.isRepeatable ?? false,
        gameConditions: trigger.properties?.gameConditions || trigger.actionProperties?.gameConditions || [],
        stateMutations: trigger.properties?.stateMutations || trigger.actionProperties?.stateMutations || [],
        actionType: trigger.properties?.actionType || trigger.actionType || trigger.actionProperties?.actionType || 'show_message',
        targetSceneId: trigger.properties?.targetSceneId || trigger.actionProperties?.targetSceneId || null,
        
        // 🔥 AUDIO DATA
        audioLoopEntrada: trigger.actionProperties?.audioLoopEntrada ?? trigger.properties?.audioLoopEntrada ?? false,
        audioVolumeEntrada: trigger.actionProperties?.audioVolumeEntrada ?? trigger.properties?.audioVolumeEntrada ?? 0.8,
        audioMaxDistEntrada: trigger.actionProperties?.audioMaxDistEntrada ?? trigger.properties?.audioMaxDistEntrada ?? 50,
        audioFadeInEntrada: trigger.actionProperties?.audioFadeInEntrada ?? trigger.properties?.audioFadeInEntrada ?? 1.0,

        audioLoopSalida: trigger.actionProperties?.audioLoopSalida ?? trigger.properties?.audioLoopSalida ?? false,
        audioVolumeSalida: trigger.actionProperties?.audioVolumeSalida ?? trigger.properties?.audioVolumeSalida ?? 0.8,
        audioMaxDistSalida: trigger.actionProperties?.audioMaxDistSalida ?? trigger.properties?.audioMaxDistSalida ?? 50,
        audioFadeInSalida: trigger.actionProperties?.audioFadeInSalida ?? trigger.properties?.audioFadeInSalida ?? 1.0,

        audioLoopNorm: trigger.actionProperties?.audioLoopNorm ?? trigger.properties?.audioLoopNorm ?? false,
        audioVolumeNorm: trigger.actionProperties?.audioVolumeNorm ?? trigger.properties?.audioVolumeNorm ?? 0.8,
        audioMaxDistNorm: trigger.actionProperties?.audioMaxDistNorm ?? trigger.properties?.audioMaxDistNorm ?? 50,
        audioFadeInNorm: trigger.actionProperties?.audioFadeInNorm ?? trigger.properties?.audioFadeInNorm ?? 1.0
      };

      if (entity.triggerRuntime) {
         entity.triggerRuntime.isEnabled = trigger.properties?.isEnabled ?? trigger.isEnabled ?? true;
         entity.triggerRuntime.hasTriggeredEnter = false;
         entity.triggerRuntime.hasTriggeredExit = false;
      }

      if (!mesh) {
        switch (shape) {
          case 'sphere': mesh = MeshBuilder.CreateSphere(trigger.name, { diameter: 1 }, scene); break;
          case 'cylinder': mesh = MeshBuilder.CreateCylinder(trigger.name, { height: 1, diameter: 1 }, scene); break;
          default: mesh = MeshBuilder.CreateBox(trigger.name, { size: 1 }, scene); break;
        }

        entity.bindView(mesh);
        mesh.visibility = 0; 
        mesh.material = null; 
        mesh.isPickable = true;
        mesh.checkCollisions = false;
        mesh.isVisible = true; 

        this.triggerVisualizer.createOrUpdateWireframe(mesh, shape, isComposite, entity.trigger.actionType);
        mallasCreadas.set(entity.uid, mesh);
      } else {
        mesh.visibility = 0; 
        mesh.material = null;
        entity.bindView(mesh);
        this.triggerVisualizer.createOrUpdateWireframe(mesh, shape, isComposite, entity.trigger.actionType);
      }
      this.entityManager.addEntity(entity);
    }

    const cond = trigger.properties?.condition || trigger.condition || 'on_enter';
    if (isComposite) {
        if (!entity.trigger!.conditions.includes(cond)) {
            entity.trigger!.conditions.push(cond);
        }
        if (cond === 'on_enter') {
           entity.trigger!.mensajeEntrada = trigger.actionProperties?.mensaje || trigger.properties?.mensaje || '';
           entity.trigger!.soundUrlEntrada = trigger.actionProperties?.soundUrl || trigger.properties?.soundUrl || '';
           entity.trigger!.seqEntrada = trigger.actionProperties?.seqEntrada || trigger.properties?.seqEntrada || '';
           entity.trigger!.timeEntrada = trigger.actionProperties?.timeEntrada ?? trigger.properties?.timeEntrada ?? 4.5;
           entity.trigger!.videoEntrada = trigger.actionProperties?.videoEntrada || trigger.properties?.videoEntrada || '';
           entity.trigger!.audioLoopEntrada = trigger.actionProperties?.audioLoopEntrada ?? trigger.properties?.audioLoopEntrada ?? false;
           entity.trigger!.audioVolumeEntrada = trigger.actionProperties?.audioVolumeEntrada ?? trigger.properties?.audioVolumeEntrada ?? 0.8;
           entity.trigger!.audioMaxDistEntrada = trigger.actionProperties?.audioMaxDistEntrada ?? trigger.properties?.audioMaxDistEntrada ?? 50;
           entity.trigger!.audioFadeInEntrada = trigger.actionProperties?.audioFadeInEntrada ?? trigger.properties?.audioFadeInEntrada ?? 1.0;
        }
        if (cond === 'on_exit') {
           entity.trigger!.mensajeSalida = trigger.actionProperties?.mensaje || trigger.properties?.mensaje || '';
           entity.trigger!.soundUrlSalida = trigger.actionProperties?.soundUrl || trigger.properties?.soundUrl || '';
           entity.trigger!.seqSalida = trigger.actionProperties?.seqSalida || trigger.properties?.seqSalida || '';
           entity.trigger!.timeSalida = trigger.actionProperties?.timeSalida ?? trigger.properties?.timeSalida ?? 4.5;
           entity.trigger!.videoSalida = trigger.actionProperties?.videoSalida || trigger.properties?.videoSalida || '';
           entity.trigger!.audioLoopSalida = trigger.actionProperties?.audioLoopSalida ?? trigger.properties?.audioLoopSalida ?? false;
           entity.trigger!.audioVolumeSalida = trigger.actionProperties?.audioVolumeSalida ?? trigger.properties?.audioVolumeSalida ?? 0.8;
           entity.trigger!.audioMaxDistSalida = trigger.actionProperties?.audioMaxDistSalida ?? trigger.properties?.audioMaxDistSalida ?? 50;
           entity.trigger!.audioFadeInSalida = trigger.actionProperties?.audioFadeInSalida ?? trigger.properties?.audioFadeInSalida ?? 1.0;
        }
    } else {
        entity.trigger!.condition = cond;
        entity.trigger!.mensaje = trigger.actionProperties?.mensaje || trigger.properties?.mensaje || '';
        entity.trigger!.soundUrl = trigger.actionProperties?.soundUrl || trigger.properties?.soundUrl || '';
        entity.trigger!.interactSequenceId = trigger.actionProperties?.interactSequenceId || trigger.properties?.interactSequenceId || '';
        entity.trigger!.timeNorm = trigger.actionProperties?.timeNorm ?? trigger.properties?.timeNorm ?? 4.5;
        entity.trigger!.videoNorm = trigger.actionProperties?.videoNorm || trigger.properties?.videoNorm || '';
        entity.trigger!.audioLoopNorm = trigger.actionProperties?.audioLoopNorm ?? trigger.properties?.audioLoopNorm ?? false;
        entity.trigger!.audioVolumeNorm = trigger.actionProperties?.audioVolumeNorm ?? trigger.properties?.audioVolumeNorm ?? 0.8;
        entity.trigger!.audioMaxDistNorm = trigger.actionProperties?.audioMaxDistNorm ?? trigger.properties?.audioMaxDistNorm ?? 50;
        entity.trigger!.audioFadeInNorm = trigger.actionProperties?.audioFadeInNorm ?? trigger.properties?.audioFadeInNorm ?? 1.0;
    }
  }
}