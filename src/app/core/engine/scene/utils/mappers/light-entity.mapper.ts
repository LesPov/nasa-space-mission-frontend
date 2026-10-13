// file: src/app/core/engine/scene/utils/mappers/light-entity.mapper.ts
import { Injectable } from '@angular/core';
import { BaseEntityMapper } from './base-entity.mapper';
import { GameEntity, LightContainmentMode, LightDistanceReferenceMode, LightInteriorActivationMode } from '../../../entities/game.entity';
import { SceneObjectDto, TriggerDto, SceneObjectPropertiesDto, ConfiguredPortalDto } from '../../../models/api-dto.model';
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

    // Respetar la escala configurada por el usuario (local o del prefab)
    entity.transform.scale = TransformNormalizer.sanitizeScaleVector(
      obj.scale || (obj as any).size || entity.transform.scale, 
      entity.name
    );

    if (obj.parentId) {
      entity.transformSpace = 'LOCAL';
      entity.isLegacyLocalTransform = false;
    } else if (props.attachedNodeName) {
      entity.transformSpace = 'ATTACHED';
    } else {
      entity.transformSpace = props.transformSpace || 'WORLD';
    }

    if (entity.light) {
      entity.light.lightColor = props.lightColor?.substring(0, 7) || '#ffffff';
      entity.light.lightColorBW = props.lightColorBW?.substring(0, 7) || entity.light.lightColor;
      entity.light.intensity = props.intensity ?? 1.0;
      entity.light.range = props.range ?? 50;
      entity.light.angle = props.angle ?? 60;
      entity.light.exponent = props.exponent ?? 1.0;

      entity.light.attachedNodePath = props.attachedNodePath || '';
      entity.light.attachedNodeName = props.attachedNodeName || '';
      entity.light.renderIntensity = entity.light.intensity;
      entity.light.enabled = props.isEnabled ?? true;
      entity.light.castShadows = (props as any).castShadows ?? true;

      const defaultContainment = obj.parentId ? 'INTERIOR' : 'GLOBAL';
      entity.light.containmentMode = (props.containmentMode as LightContainmentMode) || defaultContainment;
      entity.light.interiorActivationMode = (props.interiorActivationMode as LightInteriorActivationMode) || (entity.light.containmentMode === 'INTERIOR' ? 'VOLUME' : 'DISTANCE');
      entity.light.preEntryEnabled = props.preEntryEnabled ?? true;
      entity.light.preEntryDistance = props.preEntryDistance ?? 8.0;

      entity.light.linkShadowPreEntryToLightPreEntry = props.linkShadowPreEntryToLightPreEntry !== false;
      entity.light.shadowPreEntryDistance = props.shadowPreEntryDistance ?? entity.light.preEntryDistance;

      entity.light.containerEntityUid = props.containerEntityUid || obj.parentId || '';
      entity.light.affectDescendantsOnly = props.affectDescendantsOnly ?? false;

      entity.light.shadowDarkness = props.shadowDarkness ?? 0.0;
      entity.light.shadowBias = props.shadowBias ?? 0.0008;
      entity.light.shadowNormalBias = props.shadowNormalBias ?? 0.002;
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

      if (Array.isArray(props.portals)) {
        entity.light.portals = props.portals.map((p: any) => {
          const rawRadius = p.radius !== undefined ? Number(p.radius) : (p.width !== undefined ? Number(p.width) / 2 : 1.75);
          const effectiveRadius = Math.max(0.2, Number.isFinite(rawRadius) ? rawRadius : 1.75);
          const effectiveWidth = p.width !== undefined ? Math.max(0.4, Number(p.width)) : (effectiveRadius * 2);

          return {
            id: p.id || window.crypto.randomUUID(),
            name: p.name || 'Portal',
            localPosition: { x: p.localPosition?.x ?? 0, y: p.localPosition?.y ?? 0, z: p.localPosition?.z ?? 0 },
            localNormal: { x: p.localNormal?.x ?? 0, y: p.localNormal?.y ?? 0, z: p.localNormal?.z ?? 1 },
            radius: effectiveRadius,
            width: effectiveWidth,
            height: p.height ?? 3.5,
            depth: p.depth ?? 1.0,
            preEntryDistance: p.preEntryDistance ?? entity.light!.preEntryDistance ?? 8.0,
            enabled: p.enabled !== false
          };
        });
      } else {
        entity.light.portals = [];
      }
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
        exponent: entity.light.exponent,
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
        distanceReferenceMode: entity.light.distanceReferenceMode,
        portals: entity.light.portals ? entity.light.portals.map(p => ({
          id: p.id,
          name: p.name,
          localPosition: { ...p.localPosition },
          localNormal: { ...p.localNormal },
          radius: p.radius,
          width: p.width,
          height: p.height,
          depth: p.depth,
          preEntryDistance: p.preEntryDistance,
          enabled: p.enabled
        })) : []
      } : {})
    };
  }

  override extractToDtos(entity: GameEntity): any[] {
    const dtos = super.extractToDtos(entity);
    const sanitizedScale = TransformNormalizer.sanitizeScaleVector(entity.transform.scale, entity.name);
    dtos.forEach(d => {
      d.scale = { ...sanitizedScale };
      if (d.properties) {
        d.properties.scale = { ...sanitizedScale };
        d.properties.size = { ...sanitizedScale };
      }
    });
    return dtos;
  }
}