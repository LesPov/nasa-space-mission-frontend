
import { Injectable, inject } from '@angular/core'; 
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../core/engine/world/world-settings.service';
import { EntityPersistenceMapperService } from '../../../core/engine/scene/utils/entity-persistence-mapper.service';

@Injectable({ providedIn: 'root' }) 
export class SceneSaverService { 
  private entityManager = inject(EntityManagerService); 
  private worldSettingsSvc = inject(WorldSettingsService);
  private persistenceMapper = inject(EntityPersistenceMapperService);

  public obtenerDatosParaGuardar(forceFull: boolean = false): { sceneObjectsDelta: any[]; triggersDelta: any[]; deletedObjects: string[]; deletedTriggers: string[]; worldSettings: any; uiSettings: any } { 
    const sceneObjectsDelta: any[] = []; 
    const triggersDelta: any[] = [];

    const worldSettings = this.worldSettingsSvc.settings();
    const uiSettings = this.worldSettingsSvc.uiSettings();

    const allEntities = this.entityManager.getAllEntities();

    allEntities.forEach(entity => {
      if (!forceFull && !entity.isDirty) return;

      entity.syncTransformFromView();

      const propertiesToSave = this.persistenceMapper.extractEntityProperties(entity);
      const transform = entity.transform;
      const trigger = entity.trigger;

      if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') {
        const isComposite = entity.type === 'trigger_compuesto';
        const rawConditions = trigger?.conditions || ['on_enter'];

        if (isComposite) {
          rawConditions.forEach((cond: string) => {
             const actionProps: any = { triggerShape: trigger?.triggerShape || 'cube', isComposite: true };
             if (cond === 'on_enter') {
                actionProps.mensaje = trigger?.mensajeEntrada || '';
                actionProps.soundUrl = trigger?.soundUrlEntrada || '';
                actionProps.seqEntrada = trigger?.seqEntrada || '';
                actionProps.timeEntrada = trigger?.timeEntrada ?? 4.5;
                actionProps.videoEntrada = trigger?.videoEntrada || '';
             }
             if (cond === 'on_exit') {
                actionProps.mensaje = trigger?.mensajeSalida || '';
                actionProps.soundUrl = trigger?.soundUrlSalida || '';
                actionProps.seqSalida = trigger?.seqSalida || '';
                actionProps.timeSalida = trigger?.timeSalida ?? 4.5;
                actionProps.videoSalida = trigger?.videoSalida || '';
             }
             triggersDelta.push({
               uid: entity.uid, name: entity.name, parentId: entity.parentId,
               position: transform.position, scale: transform.scale,
               properties: { condition: cond, actionType: 'show_message', targetObjectName: '', isRepeatable: trigger?.isRepeatable ?? false, ...actionProps }
             });
          });
        } else {
           triggersDelta.push({
             uid: entity.uid, name: entity.name, parentId: entity.parentId,
             position: transform.position, scale: transform.scale,
             properties: {
               condition: trigger?.condition || 'on_enter', actionType: 'show_message', targetObjectName: '',
               isRepeatable: trigger?.isRepeatable ?? false,
               triggerShape: trigger?.triggerShape || 'cube', 
               mensaje: entity.interaction.mensaje,
               soundUrl: trigger?.soundUrl || '', 
               interactSequenceId: entity.interaction.interactSequenceId,
               timeNorm: trigger?.timeNorm ?? 4.5, 
               videoNorm: trigger?.videoNorm || '', 
               isComposite: false
             }
           });
        }
      } else {
        const baseData = {
          uid: entity.uid, name: entity.name, parentId: entity.parentId,
          position: transform.position, rotation: transform.rotation, scale: transform.scale
        };

        let finalProperties = { ...propertiesToSave };

        if (entity.type.startsWith('light_') && entity.light) {
          finalProperties = { ...finalProperties, ...entity.light };
        } else if ((entity.type === 'video_plane' || entity.type === 'image_plane') && entity.media) {
          finalProperties = { ...finalProperties, ...entity.media };
        }

        sceneObjectsDelta.push({
          ...baseData, type: entity.type, assetId: entity.visual.assetId,
          properties: finalProperties
        });
      }
    });

    return { 
      sceneObjectsDelta, 
      triggersDelta, 
      deletedObjects: [...this.entityManager.deletedObjects], 
      deletedTriggers: [...this.entityManager.deletedTriggers], 
      worldSettings,
      uiSettings
    };
  } 
}