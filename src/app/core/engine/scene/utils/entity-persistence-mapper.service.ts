import { Injectable, inject } from '@angular/core';
import { GameEntity, CharacterConfigComponent } from '../../entities/game.entity';
import { CoreSceneUtilsService } from './core-scene-utils.service';
import { SceneObjectDto, TriggerDto, SceneObjectPropertiesDto } from '../../models/api-dto.model';

@Injectable({ providedIn: 'root' })
export class EntityPersistenceMapperService {
  private utilsSvc = inject(CoreSceneUtilsService);

  public applyDbToEntity(obj: SceneObjectDto | TriggerDto, entity: GameEntity): void {
    const props = obj.properties || {} as SceneObjectPropertiesDto;

    if (props.characterConfig) {
      entity.characterConfig = new CharacterConfigComponent(
        props.characterConfig.characterType,
        props.characterConfig.isPlayable,
        props.characterConfig.faction
      );
    }

    entity.transform.position = { x: obj.position?.x ?? 0, y: obj.position?.y ?? 0, z: obj.position?.z ?? 0 };
    entity.transform.rotation = { x: obj.rotation?.x ?? 0, y: obj.rotation?.y ?? 0, z: obj.rotation?.z ?? 0 };
    
    const scaleX = (obj.scale?.x !== undefined && obj.scale?.x !== null && !isNaN(Number(obj.scale?.x))) ? Number(obj.scale.x) : 1;
    const scaleY = (obj.scale?.y !== undefined && obj.scale?.y !== null && !isNaN(Number(obj.scale?.y))) ? Number(obj.scale.y) : 1;
    const scaleZ = (obj.scale?.z !== undefined && obj.scale?.z !== null && !isNaN(Number(obj.scale?.z))) ? Number(obj.scale.z) : 1;
    entity.transform.scale = { x: scaleX !== 0 ? scaleX : 1, y: scaleY !== 0 ? scaleY : 1, z: scaleZ !== 0 ? scaleZ : 1 };

    entity.parentId = obj.parentId || null;
    
    entity.visual.color = props.color?.substring(0, 7) || (entity.type === 'model' ? '#ffffff' : '#888888');
    entity.visual.colorBW = props.colorBW?.substring(0, 7) || entity.visual.color;
    entity.visual.isSolid = props.isSolid ?? true;
    entity.visual.isSelectable = props.isSelectable ?? true;
    entity.visual.ignoraNiebla = props.ignoraNiebla ?? false;
    entity.visual.esEmisivo = props.esEmisivo ?? false;
    entity.visual.brilloIntensidad = this.utilsSvc.normalizarNumero(props.brilloIntensidad, 1.0);
    entity.visual.mostrarBorde = props.mostrarBorde ?? (entity.type !== 'plane'); 
    entity.visual.path = props.path || obj.asset?.path || props.videoUrl || props.imageUrl || '';
    entity.visual.assetId = obj.assetId || null;

    entity.interaction.mensaje = props.mensaje || '';
    entity.interaction.interactDistanceFPS = this.utilsSvc.normalizarNumero(props.interactDistanceFPS, 3.0);
    entity.interaction.interactDistanceTPS = this.utilsSvc.normalizarNumero(props.interactDistanceTPS, 5.0);
    entity.interaction.interactSequenceIdFPS = props.interactSequenceIdFPS || '';
    entity.interaction.interactSequenceIdTPS = props.interactSequenceIdTPS || '';
    entity.interaction.interactSequenceId = props.interactSequenceId || '';
    entity.interaction.respawnTime = this.utilsSvc.normalizarNumero(props.respawnTime, 8);

    const isCharacter = !!entity.characterConfig;
    const defaultCollider = entity.type === 'model' 
      ? (!isCharacter ? { type: 'mesh', sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 } : { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }) 
      : { type: (entity.type === 'sphere' || entity.type === 'bubble') ? 'sphere' : (entity.type === 'cylinder' ? 'capsule' : 'box'), sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 };
    
    const savedCollider = props.collider || props.capsule || { ...defaultCollider };
    if (savedCollider.radiusX !== undefined) {
      savedCollider.sizeX = savedCollider.radiusX; savedCollider.sizeY = savedCollider.heightY; savedCollider.sizeZ = savedCollider.radiusZ;
      if (savedCollider.type !== 'mesh') savedCollider.type = 'capsule'; 
    }
    entity.collider = savedCollider as any;

    const savedSelectionRange = this.utilsSvc.extraerSelectionRange(props || obj);
    entity.selectionRange = { ...savedSelectionRange };
    
    if (props.playerConfig || isCharacter) {
      entity.playerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(props.playerConfig || null, savedSelectionRange);
    }

    entity.camOffset = props.camOffset || { x: 0, y: 1.6, z: 0 };
    entity.autoAnim = props.autoAnim || null;

    if (entity.media) {
      entity.media.videoUrl = entity.type === 'video_plane' ? (entity.visual.path || '') : '';
      entity.media.imageUrl = entity.type === 'image_plane' ? (entity.visual.path || '') : '';
      entity.media.profundidadProyeccion = props.profundidadProyeccion ?? 10;
      entity.media.anguloProyeccion = props.anguloProyeccion ?? 0;
      entity.media.proyeccionAncho = props.proyeccionAncho ?? 2;
      entity.media.proyeccionAlto = props.proyeccionAlto ?? 2;
      entity.media.proyeccionRepeticiones = props.proyeccionRepeticiones ?? 1;
      entity.media.proyeccionEspaciado = props.proyeccionEspaciado ?? 2;
      entity.media.proyeccionEje = props.proyeccionEje || 'Y';
      entity.media.fadeDistance = this.utilsSvc.normalizarNumero(props.fadeDistance, 0);
    }

    if (entity.type?.startsWith('light_') && entity.light) {
      entity.light.lightColor = props.lightColor?.substring(0, 7) || '#ffffff';
      entity.light.lightColorBW = props.lightColorBW?.substring(0, 7) || entity.light.lightColor;
      entity.light.intensity = props.intensity ?? 1.0;
      entity.light.range = props.range ?? 50;
      entity.light.angle = props.angle ?? 60;
      entity.light.lightPosX = props.lightPosX ?? 0;
      entity.light.lightPosY = props.lightPosY ?? 0;
      entity.light.lightPosZ = props.lightPosZ ?? 0;
      entity.light.attachedNodePath = props.attachedNodePath || '';
      entity.light.attachedNodeName = props.attachedNodeName || '';
    }
  }

  public extractEntityProperties(entity: GameEntity): SceneObjectPropertiesDto {
    return {
      rol: entity.characterConfig ? entity.characterConfig.characterType : entity.rol,
      characterConfig: entity.characterConfig ? { ...entity.characterConfig } : undefined,
      color: entity.visual.color,
      colorBW: entity.visual.colorBW,
      isSolid: entity.visual.isSolid,
      isSelectable: entity.visual.isSelectable,
      ignoraNiebla: entity.visual.ignoraNiebla,
      esEmisivo: entity.visual.esEmisivo,
      mostrarBorde: entity.visual.mostrarBorde,
      brilloIntensidad: entity.visual.brilloIntensidad,
      mensaje: entity.interaction.mensaje,
      interactDistanceFPS: entity.interaction.interactDistanceFPS,
      interactDistanceTPS: entity.interaction.interactDistanceTPS,
      interactSequenceIdFPS: entity.interaction.interactSequenceIdFPS,
      interactSequenceIdTPS: entity.interaction.interactSequenceIdTPS,
      interactSequenceId: entity.interaction.interactSequenceId,
      respawnTime: entity.interaction.respawnTime,
      collider: entity.collider as any,
      camOffset: entity.camOffset as any,
      playerConfig: entity.playerConfig,
      selectionRange: entity.selectionRange,
      animationNames: entity.animationNames,
      autoAnim: entity.autoAnim,
      path: entity.visual.path 
    };
  }
}