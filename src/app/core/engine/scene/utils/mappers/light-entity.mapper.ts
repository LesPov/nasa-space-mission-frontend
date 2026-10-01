
import { Injectable } from '@angular/core';
import { BaseEntityMapper } from './base-entity.mapper';
import { GameEntity, LightContainmentMode } from '../../../entities/game.entity';
import { SceneObjectDto, TriggerDto, SceneObjectPropertiesDto } from '../../../models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class LightEntityMapper extends BaseEntityMapper {
  supports(entityType: string): boolean {
    return entityType.startsWith('light_');
  }

  protected override getDefaultCollider(entity: GameEntity): any {
    return { type: 'sphere', sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 };
  }

  override applyDbToEntity(obj: SceneObjectDto | TriggerDto, entity: GameEntity): void {
    super.applyDbToEntity(obj, entity);
    const props = obj.properties || {} as SceneObjectPropertiesDto;

    // Migración Legacy a Transform Space
    if (!props.transformSpace) {
        if (props.attachedNodeName) {
            entity.transformSpace = 'ATTACHED';
        } else {
            entity.transformSpace = 'WORLD';
            if (obj.parentId) {
                entity.isLegacyLocalTransform = true;
            }
        }
    } else {
        entity.transformSpace = props.transformSpace;
    }

    if (entity.light) {
      entity.light.lightColor = props.lightColor?.substring(0, 7) || '#ffffff';
      entity.light.lightColorBW = props.lightColorBW?.substring(0, 7) || entity.light.lightColor;
      entity.light.intensity = props.intensity ?? 1.0;
      entity.light.range = props.range ?? 50;
      entity.light.angle = props.angle ?? 60;
      
      if ((props as any).lightPosX !== undefined) {
         entity.transform.position.x = (props as any).lightPosX;
         entity.transform.position.y = (props as any).lightPosY ?? 0;
         entity.transform.position.z = (props as any).lightPosZ ?? 0;
         entity.transform.rotation.x = ((props as any).lightRotX ?? 0) * Math.PI / 180;
         entity.transform.rotation.y = ((props as any).lightRotY ?? 0) * Math.PI / 180;
         entity.transform.rotation.z = ((props as any).lightRotZ ?? 0) * Math.PI / 180;
         entity.transform.rotationQuaternion = null;
      }

      entity.light.attachedNodePath = props.attachedNodePath || '';
      entity.light.attachedNodeName = props.attachedNodeName || '';
      entity.light.renderIntensity = entity.light.intensity;
      entity.light.enabled = props.isEnabled ?? true;
      entity.light.castShadows = (props as any).castShadows ?? true;

      // --- MAPPING DE LIGHT CONTAINMENT ---
      entity.light.containmentMode = (props.containmentMode as LightContainmentMode) || 'GLOBAL';
      entity.light.containerEntityUid = props.containerEntityUid || '';
      entity.light.affectDescendantsOnly = props.affectDescendantsOnly ?? true;
      entity.light.shadowDarkness = props.shadowDarkness ?? 0.0;
      entity.light.shadowBias = props.shadowBias ?? 0.0005;
      entity.light.shadowNormalBias = props.shadowNormalBias ?? 0.01;
      entity.light.excludeExteriorMeshes = props.excludeExteriorMeshes ?? true;
    }
  }

  override extractEntityProperties(entity: GameEntity): Partial<SceneObjectPropertiesDto> {
    const base = super.extractEntityProperties(entity);
    return {
      ...base,
      ...(entity.light ? {
        lightColor: entity.light.lightColor,
        lightColorBW: entity.light.lightColorBW,
        intensity: entity.light.intensity,
        renderIntensity: entity.light.renderIntensity,
        range: entity.light.range,
        angle: entity.light.angle,
        attachedNodePath: entity.light.attachedNodePath,
        attachedNodeName: entity.light.attachedNodeName,
        isEnabled: entity.light.enabled,
        castShadows: entity.light.castShadows,
        containmentMode: entity.light.containmentMode,
        containerEntityUid: entity.light.containerEntityUid,
        affectDescendantsOnly: entity.light.affectDescendantsOnly,
        shadowDarkness: entity.light.shadowDarkness,
        shadowBias: entity.light.shadowBias,
        shadowNormalBias: entity.light.shadowNormalBias,
        excludeExteriorMeshes: entity.light.excludeExteriorMeshes
      } : {})
    };
  }
}