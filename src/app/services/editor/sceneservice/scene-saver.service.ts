import { Injectable, inject } from '@angular/core'; 
import { Quaternion } from '@babylonjs/core';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../core/engine/world/world-settings.service';
import { EntityPersistenceMapperService } from '../../../core/engine/scene/utils/entity-persistence-mapper.service';
import { EditorCinematicService } from '../editor-cinematic.service';
import { CinematicCameraRegistryService } from '../../../core/engine/runtime/cameras/cinematic-camera-registry.service';
import { SceneSavePayload, SceneObjectDto, TriggerDto, CinematicDto } from '../../../core/engine/models/api-dto.model';
import { TransformNormalizer } from '../../../core/engine/scene/utils/transform-normalizer';

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

      const isPureLight = entity.type.startsWith('light_') && !entity.visual?.assetId && !entity.visual?.path;
      const sanitizedScale = isPureLight 
        ? { x: 1, y: 1, z: 1 } 
        : TransformNormalizer.sanitizeScaleVector(entity.transform.scale, entity.name);
      const sanitizedPos = TransformNormalizer.sanitizePositionVector(entity.transform.position);

      entity.transform.position = { ...sanitizedPos };
      entity.transform.scale = { ...sanitizedScale };

      if (entity.rol === 'spawn_point') {
        spawnPoint = { ...sanitizedPos };
      }

      const dtos = this.persistenceMapper.extractToDtos(entity);
      
      dtos.forEach(dto => {
          dto.position = { ...sanitizedPos };
          
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
          dto.rotation = TransformNormalizer.sanitizeRotationVector(rot);
          
          dto.scale = { ...sanitizedScale };
          dto.size = { ...sanitizedScale };
          if (dto.properties) {
            dto.properties.scale = { ...sanitizedScale };
            dto.properties.size = { ...sanitizedScale };
          }

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