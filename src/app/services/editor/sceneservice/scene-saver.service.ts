
import { Injectable, inject } from '@angular/core'; 
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../core/engine/world/world-settings.service';
import { EntityPersistenceMapperService } from '../../../core/engine/scene/utils/entity-persistence-mapper.service';
import { EditorCinematicService } from '../editor-cinematic.service';
import { SceneSavePayload, SceneObjectDto, TriggerDto, CinematicDto } from '../../../core/engine/models/api-dto.model';

@Injectable({ providedIn: 'root' }) 
export class SceneSaverService { 
  private entityManager = inject(EntityManagerService); 
  private worldSettingsSvc = inject(WorldSettingsService);
  private persistenceMapper = inject(EntityPersistenceMapperService);
  private cinematicSvc = inject(EditorCinematicService);

  public obtenerDatosParaGuardar(escenaActualData: any, forceFull: boolean = false): SceneSavePayload & { uiSettings: any } { 
    const sceneObjectsDelta: SceneObjectDto[] = []; 
    const triggersDelta: TriggerDto[] = [];

    const environmentSettings = this.worldSettingsSvc.settings();
    const uiSettings = this.worldSettingsSvc.uiSettings();
    
    const cinematicsDelta: CinematicDto[] = JSON.parse(JSON.stringify(this.cinematicSvc.cinematics()));
    const deletedCinematics = [...this.cinematicSvc.deletedCinematics];
    
    let spawnPoint = { x: 0, y: 0, z: 0 };
    const allEntities = this.entityManager.getAllEntities();

    allEntities.forEach(entity => {
      entity.syncTransformFromView();

      if (entity.rol === 'spawn_point') {
        spawnPoint = { ...entity.transform.position };
      }

      const dtos = this.persistenceMapper.extractToDtos(entity);
      
      dtos.forEach(dto => {
          // 🔥 BLINDAJE DE GUARDADO PARA TRIGGERS COMPUESTOS: 
          // Aseguramos obligatoriamente que TODO DTO generado contenga exactamente 
          // las dimensiones físicas de la malla, ignorando fallos del Mapper.
          dto.position = { x: entity.transform.position.x, y: entity.transform.position.y, z: entity.transform.position.z };
          dto.rotation = { x: entity.transform.rotation.x, y: entity.transform.rotation.y, z: entity.transform.rotation.z };
          dto.scale = { x: entity.transform.scale.x, y: entity.transform.scale.y, z: entity.transform.scale.z };
          
          // Por seguridad con backends Legacy que esperan 'size' en lugar de 'scale'
          dto.size = { x: entity.transform.scale.x, y: entity.transform.scale.y, z: entity.transform.scale.z };

          if (dto.type === 'trigger' || dto.type === 'trigger_compuesto') {
              triggersDelta.push(dto as TriggerDto);
          } else {
              sceneObjectsDelta.push(dto);
          }
      });
    });

    return { 
      sceneObjectsDelta, 
      triggersDelta, 
      cinematicsDelta, 
      deletedObjects: [...this.entityManager.deletedObjects], 
      deletedTriggers: [...this.entityManager.deletedTriggers], 
      deletedCinematics, 
      environmentSettings,
      uiSettings, 
      spawnPoint
    } as any;
  } 
}