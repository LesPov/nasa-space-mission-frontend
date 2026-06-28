import { Injectable, inject } from '@angular/core';
import { GameEntity, CharacterConfigComponent } from '../../entities/game.entity';
import { CoreSceneUtilsService } from './core-scene-utils.service';

@Injectable({ providedIn: 'root' })
export class EntityPersistenceMapperService {
  private utilsSvc = inject(CoreSceneUtilsService);

  public applyDbToEntity(obj: any, entity: GameEntity): void {
    if (obj.properties?.characterConfig) {
      entity.characterConfig = new CharacterConfigComponent(
        obj.properties.characterConfig.characterType,
        obj.properties.characterConfig.isPlayable,
        obj.properties.characterConfig.faction
      );
    }

    entity.transform.position = { x: obj.position?.x ?? 0, y: obj.position?.y ?? 0, z: obj.position?.z ?? 0 };
    entity.transform.rotation = { x: obj.rotation?.x ?? 0, y: obj.rotation?.y ?? 0, z: obj.rotation?.z ?? 0 };
    
    const scaleX = (obj.scale?.x !== undefined && obj.scale?.x !== null && !isNaN(Number(obj.scale?.x))) ? Number(obj.scale.x) : 1;
    const scaleY = (obj.scale?.y !== undefined && obj.scale?.y !== null && !isNaN(Number(obj.scale?.y))) ? Number(obj.scale.y) : 1;
    const scaleZ = (obj.scale?.z !== undefined && obj.scale?.z !== null && !isNaN(Number(obj.scale?.z))) ? Number(obj.scale.z) : 1;
    entity.transform.scale = { x: scaleX !== 0 ? scaleX : 1, y: scaleY !== 0 ? scaleY : 1, z: scaleZ !== 0 ? scaleZ : 1 };

    entity.parentId = obj.parentId || null;
    
    entity.visual.color = obj.properties?.color?.substring(0, 7) || (entity.type === 'model' ? '#ffffff' : '#888888');
    entity.visual.colorBW = obj.properties?.colorBW?.substring(0, 7) || entity.visual.color;
    entity.visual.isSolid = obj.properties?.isSolid ?? true;
    entity.visual.isSelectable = obj.properties?.isSelectable ?? true;
    entity.visual.ignoraNiebla = obj.properties?.ignoraNiebla ?? false;
    entity.visual.esEmisivo = obj.properties?.esEmisivo ?? false;
    entity.visual.brilloIntensidad = this.utilsSvc.normalizarNumero(obj.properties?.brilloIntensidad, 1.0);
    entity.visual.mostrarBorde = obj.properties?.mostrarBorde ?? (entity.type !== 'plane'); 
    entity.visual.path = obj.properties?.path || obj.asset?.path || obj.properties?.videoUrl || obj.properties?.imageUrl || '';
    entity.visual.assetId = obj.assetId;

    entity.interaction.mensaje = obj.properties?.mensaje || '';
    entity.interaction.interactDistanceFPS = this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceFPS, 3.0);
    entity.interaction.interactDistanceTPS = this.utilsSvc.normalizarNumero(obj.properties?.interactDistanceTPS, 5.0);
    entity.interaction.interactSequenceIdFPS = obj.properties?.interactSequenceIdFPS || '';
    entity.interaction.interactSequenceIdTPS = obj.properties?.interactSequenceIdTPS || '';
    entity.interaction.interactSequenceId = obj.properties?.interactSequenceId || '';
    entity.interaction.respawnTime = this.utilsSvc.normalizarNumero(obj.properties?.respawnTime, 8);

    const isCharacter = !!entity.characterConfig;
    const defaultCollider = entity.type === 'model' 
      ? (!isCharacter ? { type: 'mesh', sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 } : { type: 'capsule', sizeX: 0.4, sizeY: 0.9, sizeZ: 0.4, offsetX: 0, offsetY: 0.9, offsetZ: 0 }) 
      : { type: (entity.type === 'sphere' || entity.type === 'bubble') ? 'sphere' : (entity.type === 'cylinder' ? 'capsule' : 'box'), sizeX: 1, sizeY: 1, sizeZ: 1, offsetX: 0, offsetY: 0, offsetZ: 0 };
    
    const savedCollider = obj.properties?.collider || obj.properties?.capsule || { ...defaultCollider };
    if (savedCollider.radiusX !== undefined) {
      savedCollider.sizeX = savedCollider.radiusX; savedCollider.sizeY = savedCollider.heightY; savedCollider.sizeZ = savedCollider.radiusZ;
      if (savedCollider.type !== 'mesh') savedCollider.type = 'capsule'; 
    }
    entity.collider = savedCollider;

    const savedSelectionRange = this.utilsSvc.extraerSelectionRange(obj.properties || obj);
    entity.selectionRange = { ...savedSelectionRange };
    
    if (obj.properties?.playerConfig || isCharacter) {
      // 🔥 FASE 2: Preparar y setear el objeto UNA vez como componente atómico
      entity.playerConfig = this.utilsSvc.prepararPlayerConfigConSelectionRange(obj.properties?.playerConfig || null, savedSelectionRange);
    }

    entity.camOffset = obj.properties?.camOffset || { x: 0, y: 1.6, z: 0 };
    entity.autoAnim = obj.properties?.autoAnim || null;

    if (entity.media) {
      entity.media.videoUrl = entity.type === 'video_plane' ? (entity.visual.path || '') : '';
      entity.media.imageUrl = entity.type === 'image_plane' ? (entity.visual.path || '') : '';
      entity.media.profundidadProyeccion = obj.properties?.profundidadProyeccion ?? 10;
      entity.media.anguloProyeccion = obj.properties?.anguloProyeccion ?? 0;
      entity.media.proyeccionAncho = obj.properties?.proyeccionAncho ?? 2;
      entity.media.proyeccionAlto = obj.properties?.proyeccionAlto ?? 2;
      entity.media.proyeccionRepeticiones = obj.properties?.proyeccionRepeticiones ?? 1;
      entity.media.proyeccionEspaciado = obj.properties?.proyeccionEspaciado ?? 2;
      entity.media.proyeccionEje = obj.properties?.proyeccionEje || 'Y';
      entity.media.fadeDistance = this.utilsSvc.normalizarNumero(obj.properties?.fadeDistance, 0);
    }

    if (entity.type?.startsWith('light_') && entity.light) {
      entity.light.lightColor = obj.properties?.lightColor?.substring(0, 7) || '#ffffff';
      entity.light.lightColorBW = obj.properties?.lightColorBW?.substring(0, 7) || entity.light.lightColor;
      entity.light.intensity = obj.properties?.intensity ?? 1.0;
      entity.light.range = obj.properties?.range ?? 50;
      entity.light.angle = obj.properties?.angle ?? 60;
      entity.light.lightPosX = obj.properties?.lightPosX ?? 0;
      entity.light.lightPosY = obj.properties?.lightPosY ?? 0;
      entity.light.lightPosZ = obj.properties?.lightPosZ ?? 0;
      entity.light.attachedNodePath = obj.properties?.attachedNodePath || '';
      entity.light.attachedNodeName = obj.properties?.attachedNodeName || '';
    }
  }

  public extractEntityProperties(entity: GameEntity): any {
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
      collider: entity.collider,
      camOffset: entity.camOffset,
      playerConfig: entity.playerConfig,
      selectionRange: entity.selectionRange,
      animationNames: entity.animationNames,
      autoAnim: entity.autoAnim,
      path: entity.visual.path 
    };
  }
}