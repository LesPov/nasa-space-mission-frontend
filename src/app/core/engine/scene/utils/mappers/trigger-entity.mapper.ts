
import { Injectable } from '@angular/core';
import { BaseEntityMapper } from './base-entity.mapper';
import { GameEntity, TriggerConfigComponent } from '../../../entities/game.entity';
import { SceneObjectDto, TriggerDto } from '../../../models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class TriggerEntityMapper extends BaseEntityMapper {
  supports(entityType: string): boolean {
    return entityType === 'trigger' || entityType === 'trigger_compuesto';
  }

  protected override getDefaultCollider(): any {
    return { type: 'box', sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 };
  }

  override applyDbToEntity(obj: SceneObjectDto | TriggerDto, entity: GameEntity): void {
    super.applyDbToEntity(obj, entity);
    
    const trigger = obj as TriggerDto;
    
    // 🔥 FIX LÓGICO: Reconocer un trigger compuesto cargado de la base de datos sin fallar.
    const isComposite = trigger.type === 'trigger_compuesto' || trigger.properties?.isComposite || trigger.actionProperties?.isComposite || false;
    const shape = trigger.properties?.triggerShape || trigger.actionProperties?.triggerShape || 'cube';

    if (!entity.trigger) {
      entity.trigger = new TriggerConfigComponent();
    }

    // 🔥 FIX LÓGICO: Ahora sí forzamos estas propiedades para que la UI sepa que es Compuesto.
    entity.trigger.isComposite = isComposite;
    entity.trigger.triggerShape = shape;
    
    if (!entity.trigger.conditions) {
        entity.trigger.conditions = [];
    }

    if (entity.triggerRuntime) {
       entity.triggerRuntime.isEnabled = trigger.properties?.isEnabled ?? trigger.isEnabled ?? true;
    }

    const cond = trigger.properties?.condition || trigger.condition || 'on_enter';

    if (isComposite) {
        if (!entity.trigger.conditions.includes(cond)) {
            entity.trigger.conditions.push(cond);
        }
        if (cond === 'on_enter') {
           entity.trigger.mensajeEntrada = trigger.actionProperties?.mensaje || trigger.properties?.mensaje || '';
           entity.trigger.soundUrlEntrada = trigger.actionProperties?.soundUrl || trigger.properties?.soundUrl || '';
           entity.trigger.seqEntrada = trigger.actionProperties?.seqEntrada || trigger.properties?.seqEntrada || '';
           entity.trigger.timeEntrada = trigger.actionProperties?.timeEntrada ?? trigger.properties?.timeEntrada ?? 4.5;
           entity.trigger.videoEntrada = trigger.actionProperties?.videoEntrada || trigger.properties?.videoEntrada || '';
           entity.trigger.audioLoopEntrada = trigger.actionProperties?.audioLoopEntrada ?? trigger.properties?.audioLoopEntrada ?? false;
           entity.trigger.audioVolumeEntrada = trigger.actionProperties?.audioVolumeEntrada ?? trigger.properties?.audioVolumeEntrada ?? 0.8;
           entity.trigger.audioMaxDistEntrada = trigger.actionProperties?.audioMaxDistEntrada ?? trigger.properties?.audioMaxDistEntrada ?? 50;
           entity.trigger.audioFadeInEntrada = trigger.actionProperties?.audioFadeInEntrada ?? trigger.properties?.audioFadeInEntrada ?? 1.0;
        }
        if (cond === 'on_exit') {
           entity.trigger.mensajeSalida = trigger.actionProperties?.mensaje || trigger.properties?.mensaje || '';
           entity.trigger.soundUrlSalida = trigger.actionProperties?.soundUrl || trigger.properties?.soundUrl || '';
           entity.trigger.seqSalida = trigger.actionProperties?.seqSalida || trigger.properties?.seqSalida || '';
           entity.trigger.timeSalida = trigger.actionProperties?.timeSalida ?? trigger.properties?.timeSalida ?? 4.5;
           entity.trigger.videoSalida = trigger.actionProperties?.videoSalida || trigger.properties?.videoSalida || '';
           entity.trigger.audioLoopSalida = trigger.actionProperties?.audioLoopSalida ?? trigger.properties?.audioLoopSalida ?? false;
           entity.trigger.audioVolumeSalida = trigger.actionProperties?.audioVolumeSalida ?? trigger.properties?.audioVolumeSalida ?? 0.8;
           entity.trigger.audioMaxDistSalida = trigger.actionProperties?.audioMaxDistSalida ?? trigger.properties?.audioMaxDistSalida ?? 50;
           entity.trigger.audioFadeInSalida = trigger.actionProperties?.audioFadeInSalida ?? trigger.properties?.audioFadeInSalida ?? 1.0;
        }
    } else {
        entity.trigger.condition = cond;
        entity.trigger.mensaje = trigger.actionProperties?.mensaje || trigger.properties?.mensaje || '';
        entity.trigger.soundUrl = trigger.actionProperties?.soundUrl || trigger.properties?.soundUrl || '';
        entity.trigger.interactSequenceId = trigger.actionProperties?.interactSequenceId || trigger.properties?.interactSequenceId || '';
        entity.trigger.timeNorm = trigger.actionProperties?.timeNorm ?? trigger.properties?.timeNorm ?? 4.5;
        entity.trigger.videoNorm = trigger.actionProperties?.videoNorm || trigger.properties?.videoNorm || '';
        entity.trigger.audioLoopNorm = trigger.actionProperties?.audioLoopNorm ?? trigger.properties?.audioLoopNorm ?? false;
        entity.trigger.audioVolumeNorm = trigger.actionProperties?.audioVolumeNorm ?? trigger.properties?.audioVolumeNorm ?? 0.8;
        entity.trigger.audioMaxDistNorm = trigger.actionProperties?.audioMaxDistNorm ?? trigger.properties?.audioMaxDistNorm ?? 50;
        entity.trigger.audioFadeInNorm = trigger.actionProperties?.audioFadeInNorm ?? trigger.properties?.audioFadeInNorm ?? 1.0;
    }

    entity.trigger.isRepeatable = trigger.properties?.isRepeatable ?? trigger.isRepeatable ?? false;
    entity.trigger.gameConditions = trigger.properties?.gameConditions || trigger.actionProperties?.gameConditions || [];
    entity.trigger.stateMutations = trigger.properties?.stateMutations || trigger.actionProperties?.stateMutations || [];
    
    // 🔥 FIX TypeScript TS2322: Casteo estricto del ActionType garantizando los 2 valores válidos
    const rawActionType = trigger.properties?.actionType || trigger.actionType || trigger.actionProperties?.actionType;
    entity.trigger.actionType = (rawActionType === 'change_scene') ? 'change_scene' : 'show_message';
    
    entity.trigger.targetSceneId = trigger.properties?.targetSceneId || trigger.actionProperties?.targetSceneId || null;
  }

  override extractToDtos(entity: GameEntity): any[] {
    const dtos: any[] = [];
    const transform = entity.transform;
    const trigger = entity.trigger;

    // 🔥 FIX: Clonamos las propiedades base para no pasar referencias mutables que alteren los ejes
    const baseData = {
      name: entity.name, parentId: entity.parentId, type: entity.type,
      position: { ...transform.position }, 
      scale: { ...transform.scale },
      rotation: { ...transform.rotation }
    };

    if (entity.type === 'trigger_compuesto') {
      const rawConditions = trigger?.conditions || ['on_enter'];
      rawConditions.forEach((cond: string) => {
         const actionProps: any = { triggerShape: trigger?.triggerShape || 'cube', isComposite: true };
         if (cond === 'on_enter') {
            actionProps.mensaje = trigger?.mensajeEntrada || '';
            actionProps.soundUrl = trigger?.soundUrlEntrada || '';
            actionProps.seqEntrada = trigger?.seqEntrada || '';
            actionProps.timeEntrada = trigger?.timeEntrada ?? 4.5;
            actionProps.videoEntrada = trigger?.videoEntrada || '';
            actionProps.audioLoopEntrada = trigger?.audioLoopEntrada ?? false;
            actionProps.audioVolumeEntrada = trigger?.audioVolumeEntrada ?? 0.8;
            actionProps.audioMaxDistEntrada = trigger?.audioMaxDistEntrada ?? 50;
            actionProps.audioFadeInEntrada = trigger?.audioFadeInEntrada ?? 1.0;
         }
         if (cond === 'on_exit') {
            actionProps.mensaje = trigger?.mensajeSalida || '';
            actionProps.soundUrl = trigger?.soundUrlSalida || '';
            actionProps.seqSalida = trigger?.seqSalida || '';
            actionProps.timeSalida = trigger?.timeSalida ?? 4.5;
            actionProps.videoSalida = trigger?.videoSalida || '';
            actionProps.audioLoopSalida = trigger?.audioLoopSalida ?? false;
            actionProps.audioVolumeSalida = trigger?.audioVolumeSalida ?? 0.8;
            actionProps.audioMaxDistSalida = trigger?.audioMaxDistSalida ?? 50;
            actionProps.audioFadeInSalida = trigger?.audioFadeInSalida ?? 1.0;
         }
         dtos.push({
           uid: `${entity.uid}_${cond}`, 
           ...baseData,
           properties: { 
             condition: cond, 
             actionType: trigger?.actionType === 'change_scene' ? 'change_scene' : 'show_message', 
             targetSceneId: trigger?.targetSceneId || null,
             gameConditions: trigger?.gameConditions || [],
             targetObjectName: '', 
             isRepeatable: trigger?.isRepeatable ?? false, 
             ...actionProps 
           }
         });
      });
    } else {
       dtos.push({
         uid: entity.uid, 
         ...baseData,
         properties: {
           condition: trigger?.condition || 'on_enter', 
           actionType: trigger?.actionType === 'change_scene' ? 'change_scene' : 'show_message', 
           targetSceneId: trigger?.targetSceneId || null,
           gameConditions: trigger?.gameConditions || [],
           targetObjectName: '',
           isRepeatable: trigger?.isRepeatable ?? false,
           triggerShape: trigger?.triggerShape || 'cube', 
           mensaje: entity.interaction.mensaje,
           soundUrl: trigger?.soundUrl || '', 
           interactSequenceId: entity.interaction.interactSequenceId,
           timeNorm: trigger?.timeNorm ?? 4.5, 
           videoNorm: trigger?.videoNorm || '', 
           isComposite: false,
           audioLoopNorm: trigger?.audioLoopNorm ?? false,
           audioVolumeNorm: trigger?.audioVolumeNorm ?? 0.8,
           audioMaxDistNorm: trigger?.audioMaxDistNorm ?? 50,
           audioFadeInNorm: trigger?.audioFadeInNorm ?? 1.0
         }
       });
    }

    return dtos;
  }
}