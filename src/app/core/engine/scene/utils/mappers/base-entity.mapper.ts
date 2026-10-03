

import { inject } from '@angular/core';
import { GameEntity, PartOverridesComponent } from '../../../entities/game.entity';
import { SceneObjectDto, TriggerDto, SceneObjectPropertiesDto } from '../../../models/api-dto.model';
import { CoreSceneUtilsService } from '../core-scene-utils.service';
import { EntityMapperStrategy } from './entity-mapper-strategy.interface';
import { Quaternion } from '@babylonjs/core';

export abstract class BaseEntityMapper implements EntityMapperStrategy {
  protected utilsSvc = inject(CoreSceneUtilsService);

  abstract supports(entityType: string, obj?: any): boolean;

  applyDbToEntity(obj: SceneObjectDto | TriggerDto, entity: GameEntity): void {
    const props = obj.properties || {} as SceneObjectPropertiesDto;

    entity.transform.position = { x: obj.position?.x ?? 0, y: obj.position?.y ?? 0, z: obj.position?.z ?? 0 };
    entity.transform.rotation = { x: obj.rotation?.x ?? 0, y: obj.rotation?.y ?? 0, z: obj.rotation?.z ?? 0 };
    
    const scaleX = (obj.scale?.x !== undefined && obj.scale?.x !== null && !isNaN(Number(obj.scale?.x))) ? Number(obj.scale.x) : 1;
    const scaleY = (obj.scale?.y !== undefined && obj.scale?.y !== null && !isNaN(Number(obj.scale?.y))) ? Number(obj.scale.y) : 1;
    const scaleZ = (obj.scale?.z !== undefined && obj.scale?.z !== null && !isNaN(Number(obj.scale?.z))) ? Number(obj.scale.z) : 1;
    entity.transform.scale = { x: scaleX !== 0 ? scaleX : 1, y: scaleY !== 0 ? scaleY : 1, z: scaleZ !== 0 ? scaleZ : 1 };

    entity.parentId = obj.parentId || null;
    entity.transformSpace = props.transformSpace || 'LOCAL';
    
    entity.visual.color = props.color?.substring(0, 7) || (entity.type === 'model' ? '#ffffff' : '#888888');
    entity.visual.colorBW = props.colorBW?.substring(0, 7) || entity.visual.color;
    
    entity.visual.ambientColor = props.ambientColor?.substring(0, 7) || '#ffffff';
    entity.visual.ambientColorBW = props.ambientColorBW?.substring(0, 7) || entity.visual.ambientColor;
    
    entity.visual.isSolid = props.isSolid ?? true;
    entity.visual.isSelectable = props.isSelectable ?? true;
    entity.visual.ignoraNiebla = props.ignoraNiebla ?? false;
    entity.visual.esEmisivo = props.esEmisivo ?? false;
    entity.visual.brilloIntensidad = this.utilsSvc.normalizarNumero(props.brilloIntensidad, 1.0);
    entity.visual.mostrarBorde = props.mostrarBorde ?? (entity.type !== 'plane'); 
    
    // 🔥 NUEVO FASE CULLING
    entity.visual.disableCulling = props.disableCulling ?? false;

    entity.visual.path = props.path || obj.asset?.path || (obj as any).path || props.videoUrl || props.imageUrl || '';
    entity.visual.assetId = obj.assetId || null;
    
    entity.visual.internalScale = props.internalScale;
    
    entity.partOverrides = new PartOverridesComponent(props.partOverrides || {}); 

    entity.interaction.mensaje = props.mensaje || '';
    entity.interaction.interactDistanceFPS = this.utilsSvc.normalizarNumero(props.interactDistanceFPS, 3.0);
    entity.interaction.interactDistanceTPS = this.utilsSvc.normalizarNumero(props.interactDistanceTPS, 5.0);
    entity.interaction.interactSequenceIdFPS = props.interactSequenceIdFPS || '';
    entity.interaction.interactSequenceIdTPS = props.interactSequenceIdTPS || '';
    entity.interaction.interactSequenceId = props.interactSequenceId || '';
    entity.interaction.respawnTime = this.utilsSvc.normalizarNumero(props.respawnTime, 8);

    const defaultCollider = this.getDefaultCollider(entity);
    const savedCollider = props.collider || props.capsule || { ...defaultCollider };
    if (savedCollider.radiusX !== undefined) {
      savedCollider.sizeX = savedCollider.radiusX; savedCollider.sizeY = savedCollider.heightY; savedCollider.sizeZ = savedCollider.radiusZ;
      if (savedCollider.type !== 'mesh') savedCollider.type = 'capsule'; 
    }
    entity.collider = savedCollider as any;

    const savedSelectionRange = this.utilsSvc.extraerSelectionRange(props || obj);
    entity.selectionRange = { ...savedSelectionRange };
    
    entity.camOffset = props.camOffset || { x: 0, y: 1.6, z: 0 };
    entity.autoAnim = props.autoAnim || null;

    if (props.playerConfig) {
      entity.playerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(props.playerConfig || null, savedSelectionRange);
    }
    if (props.animationNames) {
      entity.animationNames = props.animationNames;
    }
  }

  protected getDefaultCollider(entity: GameEntity): any {
    return { type: 'box', sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 };
  }

  extractEntityProperties(entity: GameEntity): Partial<SceneObjectPropertiesDto> {
    return {
      rol: entity.characterConfig ? entity.characterConfig.characterType : entity.rol,
      transformSpace: entity.transformSpace,
      color: entity.visual.color,
      colorBW: entity.visual.colorBW,
      ambientColor: entity.visual.ambientColor,
      ambientColorBW: entity.visual.ambientColorBW,
      isSolid: entity.visual.isSolid,
      isSelectable: entity.visual.isSelectable,
      ignoraNiebla: entity.visual.ignoraNiebla,
      esEmisivo: entity.visual.esEmisivo,
      mostrarBorde: entity.visual.mostrarBorde,
      brilloIntensidad: entity.visual.brilloIntensidad,
      disableCulling: entity.visual.disableCulling, // 🔥 FASE CULLING
      internalScale: entity.visual.internalScale,
      partOverrides: entity.partOverrides?.overrides, 
      mensaje: entity.interaction.mensaje,
      interactDistanceFPS: entity.interaction.interactDistanceFPS,
      interactDistanceTPS: entity.interaction.interactDistanceTPS,
      interactSequenceIdFPS: entity.interaction.interactSequenceIdFPS,
      interactSequenceIdTPS: entity.interaction.interactSequenceIdTPS,
      interactSequenceId: entity.interaction.interactSequenceId,
      respawnTime: entity.interaction.respawnTime,
      collider: entity.collider as any,
      camOffset: entity.camOffset as any,
      selectionRange: entity.selectionRange,
      playerConfig: entity.playerConfig,
      animationNames: entity.animationNames,
      autoAnim: entity.autoAnim || undefined, 
      path: entity.visual.path 
    };
  }

  extractToDtos(entity: GameEntity): any[] {
    const props = this.extractEntityProperties(entity);

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

    return [{
      uid: entity.uid,
      name: entity.name,
      type: entity.type,
      parentId: entity.parentId,
      position: entity.transform.position,
      rotation: rot,
      scale: entity.transform.scale,
      assetId: entity.visual.assetId || null,
      properties: props
    }];
  }
}