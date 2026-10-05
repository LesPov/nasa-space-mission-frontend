// file: src/app/core/engine/scene/utils/mappers/light-entity.mapper.ts
import { Injectable } from '@angular/core';
import { BaseEntityMapper } from './base-entity.mapper';
import { GameEntity, LightContainmentMode, LightDistanceReferenceMode, LightInteriorActivationMode } from '../../../entities/game.entity';
import { SceneObjectDto, TriggerDto, SceneObjectPropertiesDto } from '../../../models/api-dto.model';
import { TransformNormalizer } from '../transform-normalizer';

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

    const isPureLight = !entity.visual?.assetId && !entity.visual?.path;
    if (isPureLight) {
      entity.transform.scale = { x: 1, y: 1, z: 1 };
    } else {
      entity.transform.scale = TransformNormalizer.sanitizeScaleVector(entity.transform.scale, entity.name);
    }

    if (!props.transformSpace) {
      if (props.attachedNodeName) {
        entity.transformSpace = 'ATTACHED';
      } else if (obj.parentId) {
        entity.transformSpace = 'LOCAL';
        entity.isLegacyLocalTransform = false;
      } else {
        entity.transformSpace = 'WORLD';
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

      entity.light.attachedNodePath = props.attachedNodePath || '';
      entity.light.attachedNodeName = props.attachedNodeName || '';
      entity.light.renderIntensity = entity.light.intensity;
      entity.light.enabled = props.isEnabled ?? true;
      entity.light.castShadows = (props as any).castShadows ?? true;

      // Preservar la contención interior configurada y asegurar VOLUME por defecto en interiores
      const defaultContainment = obj.parentId ? 'INTERIOR' : 'GLOBAL';
      entity.light.containmentMode = (props.containmentMode as LightContainmentMode) || defaultContainment;
      entity.light.interiorActivationMode = (props.interiorActivationMode as LightInteriorActivationMode) || (entity.light.containmentMode === 'INTERIOR' ? 'VOLUME' : 'DISTANCE');
      entity.light.preEntryEnabled = props.preEntryEnabled ?? true;
      entity.light.preEntryDistance = props.preEntryDistance ?? 4.5;

      // Pre-entrada de sombras independiente con sincronización por defecto
      entity.light.linkShadowPreEntryToLightPreEntry = props.linkShadowPreEntryToLightPreEntry !== false;
      entity.light.shadowPreEntryDistance = props.shadowPreEntryDistance ?? entity.light.preEntryDistance;

      entity.light.containerEntityUid = props.containerEntityUid || obj.parentId || '';
      entity.light.affectDescendantsOnly = props.affectDescendantsOnly ?? false;

      // En interiores, el valor por defecto de darkness es 0.25 para que las sombras conserven penumbra natural
      entity.light.shadowDarkness = props.shadowDarkness ?? (entity.light.containmentMode === 'INTERIOR' ? 0.25 : 0.0);
      entity.light.shadowBias = props.shadowBias ?? 0.0005;
      entity.light.shadowNormalBias = props.shadowNormalBias ?? 0.01;
      entity.light.excludeExteriorMeshes = props.excludeExteriorMeshes ?? true;

      entity.light.distanceControlEnabled = props.distanceControlEnabled ?? true;

      const defaultAct = Math.max(15, (props.range ?? 25) * 0.8);
      entity.light.activationDistance = props.activationDistance ?? defaultAct;
      entity.light.deactivationDistance = props.deactivationDistance ?? (entity.light.activationDistance + 6);

      entity.light.distanceShadowsEnabled = props.distanceShadowsEnabled ?? true;
      const defaultShadowAct = Math.max(10, entity.light.activationDistance * 0.7);
      entity.light.shadowActivationDistance = props.shadowActivationDistance ?? defaultShadowAct;
      entity.light.shadowDeactivationDistance = props.shadowDeactivationDistance ?? (entity.light.shadowActivationDistance + 4);

      entity.light.distanceReferenceMode = (props.distanceReferenceMode as LightDistanceReferenceMode) || 'AUTO';
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
        interiorActivationMode: entity.light.interiorActivationMode,
        preEntryEnabled: entity.light.preEntryEnabled,
        preEntryDistance: entity.light.preEntryDistance,
        linkShadowPreEntryToLightPreEntry: entity.light.linkShadowPreEntryToLightPreEntry,
        shadowPreEntryDistance: entity.light.shadowPreEntryDistance,
        containerEntityUid: entity.light.containerEntityUid,
        affectDescendantsOnly: entity.light.affectDescendantsOnly,
        shadowDarkness: entity.light.shadowDarkness,
        shadowBias: entity.light.shadowBias,
        shadowNormalBias: entity.light.shadowNormalBias,
        excludeExteriorMeshes: entity.light.excludeExteriorMeshes,
        distanceControlEnabled: entity.light.distanceControlEnabled,
        activationDistance: entity.light.activationDistance,
        deactivationDistance: entity.light.deactivationDistance,
        distanceShadowsEnabled: entity.light.distanceShadowsEnabled,
        shadowActivationDistance: entity.light.shadowActivationDistance,
        shadowDeactivationDistance: entity.light.shadowDeactivationDistance,
        distanceReferenceMode: entity.light.distanceReferenceMode
      } : {})
    };
  }

  override extractToDtos(entity: GameEntity): any[] {
    const dtos = super.extractToDtos(entity);
    const isPureLight = !entity.visual?.assetId && !entity.visual?.path;
    if (isPureLight) {
      dtos.forEach(d => {
        d.scale = { x: 1, y: 1, z: 1 };
        if (d.properties) {
          d.properties.scale = { x: 1, y: 1, z: 1 };
          d.properties.size = { x: 1, y: 1, z: 1 };
        }
      });
    }
    return dtos;
  }
}