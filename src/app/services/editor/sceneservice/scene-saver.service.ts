
import { Injectable, inject } from '@angular/core'; 
import { Quaternion } from '@babylonjs/core';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../core/engine/world/world-settings.service';
import { EntityPersistenceMapperService } from '../../../core/engine/scene/utils/entity-persistence-mapper.service';
import { EditorCinematicService } from '../editor-cinematic.service';
import { CinematicCameraRegistryService } from '../../../core/engine/runtime/cameras/cinematic-camera-registry.service';
import { SceneSavePayload, SceneObjectDto, TriggerDto, CinematicDto } from '../../../core/engine/models/api-dto.model';

@Injectable({ providedIn: 'root' }) 
export class SceneSaverService { 
  private entityManager = inject(EntityManagerService); 
  private worldSettingsSvc = inject(WorldSettingsService);
  private persistenceMapper = inject(EntityPersistenceMapperService);
  private cinematicSvc = inject(EditorCinematicService);
  private cameraRegistry = inject(CinematicCameraRegistryService);

  public obtenerDatosParaGuardar(escenaActualData: any, forceFull: boolean = false): SceneSavePayload & { uiSettings: any } { 
    const sceneObjectsDelta: SceneObjectDto[] = []; 
    const triggersDelta: TriggerDto[] = [];

    const environmentSettings = this.worldSettingsSvc.settings();
    const uiSettings = this.worldSettingsSvc.uiSettings();
    
    const cinematicsDelta: CinematicDto[] = JSON.parse(JSON.stringify(this.cinematicSvc.cinematics()));
    const deletedCinematics = [...this.cinematicSvc.deletedCinematics];

    const cinematicCamerasDelta = JSON.parse(JSON.stringify(this.cameraRegistry.listCameras()));
    const deletedCinematicCameras = [...this.cameraRegistry.deletedCameras];
    
    let spawnPoint = { x: 0, y: 0, z: 0 };
    const allEntities = this.entityManager.getAllEntities();

    allEntities.forEach(entity => {
      entity.syncTransformFromView();

      if (entity.rol === 'spawn_point') {
        spawnPoint = { ...entity.transform.position };
      }

      const dtos = this.persistenceMapper.extractToDtos(entity);
      
      dtos.forEach(dto => {
          dto.position = { x: entity.transform.position.x, y: entity.transform.position.y, z: entity.transform.position.z };
          
          let rot = entity.transform.rotation;
          if (entity.transform.rotationQuaternion) {
             const q = new Quaternion(
                entity.transform.rotationQuaternion.x, 
                entity.transform.rotationQuaternion.y, 
                entity.transform.rotationQuaternion.z, 
                entity.transform.rotationQuaternion.w
             );
             const euler = q.toEulerAngles();
             rot = { x: euler.x, y: euler.y, z: euler.z };
          }
          dto.rotation = { x: rot.x, y: rot.y, z: rot.z };
          
          dto.scale = { x: entity.transform.scale.x, y: entity.transform.scale.y, z: entity.transform.scale.z };
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
      cinematicCamerasDelta,
      deletedObjects: [...this.entityManager.deletedObjects], 
      deletedTriggers: [...this.entityManager.deletedTriggers], 
      deletedCinematics, 
      deletedCinematicCameras,
      environmentSettings,
      uiSettings, 
      spawnPoint
    } as any;
  } 
}