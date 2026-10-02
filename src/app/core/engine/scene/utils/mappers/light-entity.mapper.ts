
import { Injectable } from '@angular/core';
import { BaseEntityMapper } from './base-entity.mapper';
import { GameEntity, LightContainmentMode, LightDistanceReferenceMode } from '../../../entities/game.entity';
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

    // 🔥 FIX LUZ LOCAL: Permitimos que las luces respeten a sus padres si los tienen.
    // Solo forzamos la corrección posicional (isLegacyLocalTransform) si antes eran WORLD pero tenían un ParentID.
    if (!props.transformSpace) {
        if (props.attachedNodeName) {
            entity.transformSpace = 'ATTACHED';
        } else if (obj.parentId) {
            entity.transformSpace = 'LOCAL';
            entity.isLegacyLocalTransform = true; // Notificamos al cargador que convierta las coordenadas de WORLD a LOCAL.
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

      // 🔥 FIX LUZ INTERIOR: Si la luz es hija de un modelo (tiene parentId), por defecto se confina
      // al INTERIOR del modelo para evitar filtraciones de luz hacia el exterior, a menos que el usuario indique lo contrario explícitamente.
      const defaultContainment = obj.parentId ? 'INTERIOR' : 'GLOBAL';
      entity.light.containmentMode = (props.containmentMode as LightContainmentMode) || defaultContainment;
      
      entity.light.containerEntityUid = props.containerEntityUid || '';
      entity.light.affectDescendantsOnly = props.affectDescendantsOnly ?? true;
      entity.light.shadowDarkness = props.shadowDarkness ?? 0.0;
      entity.light.shadowBias = props.shadowBias ?? 0.0005;
      entity.light.shadowNormalBias = props.shadowNormalBias ?? 0.01;
      entity.light.excludeExteriorMeshes = props.excludeExteriorMeshes ?? true;

      entity.light.distanceControlEnabled = props.distanceControlEnabled ?? true;
      
      const defaultAct = Math.max(20, (props.range ?? 50) * 1.3);
      entity.light.activationDistance = props.activationDistance ?? defaultAct;
      entity.light.deactivationDistance = props.deactivationDistance ?? (entity.light.activationDistance + 10);
      
      entity.light.distanceShadowsEnabled = props.distanceShadowsEnabled ?? true;
      const defaultShadowAct = Math.max(10, entity.light.activationDistance * 0.5);
      entity.light.shadowActivationDistance = props.shadowActivationDistance ?? defaultShadowAct;
      entity.light.shadowDeactivationDistance = props.shadowDeactivationDistance ?? (entity.light.shadowActivationDistance + 6);
      
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
}