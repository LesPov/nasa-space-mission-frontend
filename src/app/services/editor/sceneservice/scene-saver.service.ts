
import { Injectable, inject } from '@angular/core'; 
import { HemisphericLight } from '@babylonjs/core'; 
import { Motor3dService } from '../../motor-3d.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' }) 
export class SceneSaverService { 
  private motor3d = inject(Motor3dService); 
  private entityManager = inject(EntityManagerService); 

  private hex7(value: any, fallback: string): string { 
    if (typeof value !== 'string' || !value.trim()) return fallback; 
    const v = value.trim(); 
    return v.length >= 7 ? v.substring(0, 7) : fallback; 
  }

  private safeNumber(value: any, fallback: number): number { 
    const n = Number(value); 
    return Number.isFinite(n) ? n : fallback; 
  }

  public obtenerDatosParaGuardar(): { sceneObjects: any[]; triggers: any[]; worldSettings: any } { 
    const sceneObjects: any[] = []; 
    const triggers: any[] = [];

    const scene = this.motor3d.scene;
    const ambient = scene.lights.find(l => l.name === 'ambientLight') as HemisphericLight;

    const worldSettings = {
      visualMode: scene.metadata?.globalVisualMode || 'normal',
      clearColor: this.hex7(scene.metadata?.globalClearColor, '#0d1729'),
      clearColorBW: this.hex7(scene.metadata?.globalClearColorBW, '#555555'),
      gravityY: this.safeNumber(scene.gravity?.y, -0.25),
      ambientIntensity: ambient ? this.safeNumber(ambient.intensity, 0.6) : 0.6,
      ambientDiffuse: ambient ? this.hex7(ambient.diffuse?.toHexString?.(), '#ffffff') : '#ffffff',
      ambientGround: ambient ? this.hex7(ambient.groundColor?.toHexString?.(), '#333333') : '#333333',
      ambientDirX: ambient ? this.safeNumber(ambient.direction?.x, 0) : 0,
      ambientDirY: ambient ? this.safeNumber(ambient.direction?.y, 1) : 1,
      ambientDirZ: ambient ? this.safeNumber(ambient.direction?.z, 0) : 0
    };

    const allEntities = this.entityManager.getAllEntities();

    allEntities.forEach(entity => {
      // 1. Sincronizamos la transformación para asegurar tener la posición real
      entity.syncTransformFromView();

      // 2. Extracción limpia desde las interfaces del ECS
      if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') {
        const isComposite = entity.type === 'trigger_compuesto';
        const rawConditions = entity.view?.metadata?.conditions || ['on_enter'];

        if (isComposite) {
          rawConditions.forEach((cond: string) => {
             const actionProps: any = { triggerShape: entity.view?.metadata?.triggerShape || 'cube', isComposite: true };
             if (cond === 'on_enter') {
                actionProps.mensaje = entity.view?.metadata?.mensajeEntrada || '';
                actionProps.soundUrl = entity.view?.metadata?.soundUrlEntrada || '';
                actionProps.seqEntrada = entity.view?.metadata?.seqEntrada || '';
                actionProps.timeEntrada = entity.view?.metadata?.timeEntrada ?? 4.5;
                actionProps.videoEntrada = entity.view?.metadata?.videoEntrada || '';
             }
             if (cond === 'on_exit') {
                actionProps.mensaje = entity.view?.metadata?.mensajeSalida || '';
                actionProps.soundUrl = entity.view?.metadata?.soundUrlSalida || '';
                actionProps.seqSalida = entity.view?.metadata?.seqSalida || '';
                actionProps.timeSalida = entity.view?.metadata?.timeSalida ?? 4.5;
                actionProps.videoSalida = entity.view?.metadata?.videoSalida || '';
             }
             triggers.push({
               uid: entity.uid, name: entity.name, parentId: entity.parentId,
               position: entity.transform.position, scale: entity.transform.scale,
               properties: { condition: cond, actionType: 'show_message', targetObjectName: '', isRepeatable: entity.view?.metadata?.isRepeatable ?? false, isEnabled: entity.view?.metadata?.isEnabled ?? true, ...actionProps }
             });
          });
        } else {
           triggers.push({
             uid: entity.uid, name: entity.name, parentId: entity.parentId,
             position: entity.transform.position, scale: entity.transform.scale,
             properties: {
               condition: entity.view?.metadata?.condition || 'on_enter', actionType: 'show_message', targetObjectName: '',
               isRepeatable: entity.view?.metadata?.isRepeatable ?? false, isEnabled: entity.view?.metadata?.isEnabled ?? true,
               triggerShape: entity.view?.metadata?.triggerShape || 'cube', 
               mensaje: entity.interaction.mensaje,
               soundUrl: entity.view?.metadata?.soundUrl || '', 
               interactSequenceId: entity.interaction.interactSequenceId,
               timeNorm: entity.view?.metadata?.timeNorm ?? 4.5, 
               videoNorm: entity.view?.metadata?.videoNorm || '', 
               isComposite: false
             }
           });
        }
      } else {
        // OBJETOS COMUNES Y MODELOS
        const propertiesToSave = {
          color: entity.visual.color,
          colorBW: entity.visual.colorBW,
          rol: entity.rol,
          isSolid: entity.visual.isSolid,
          isSelectable: entity.visual.isSelectable,
          ignoraNiebla: entity.visual.ignoraNiebla,
          esEmisivo: entity.visual.esEmisivo,
          brilloIntensidad: entity.visual.brilloIntensidad,
          mensaje: entity.interaction.mensaje,
          interactDistanceFPS: entity.interaction.interactDistanceFPS,
          interactDistanceTPS: entity.interaction.interactDistanceTPS,
          interactSequenceIdFPS: entity.interaction.interactSequenceIdFPS,
          interactSequenceIdTPS: entity.interaction.interactSequenceIdTPS,
          collider: entity.collider,
          camOffset: entity.camOffset,
          playerConfig: entity.playerConfig,
          selectionRange: entity.selectionRange,
          animationNames: entity.animationNames,
          autoAnim: entity.autoAnim,
          path: entity.visual.path // 🔥 GUARDAMOS EL PATH CON SEGURIDAD
        };

        const baseData = {
          uid: entity.uid, name: entity.name, parentId: entity.parentId,
          position: entity.transform.position, rotation: entity.transform.rotation, scale: entity.transform.scale
        };

        if (entity.type.startsWith('light_') && entity.light) {
          sceneObjects.push({
            ...baseData, type: entity.type, assetId: entity.visual.assetId,
            properties: { ...propertiesToSave, ...entity.light }
          });
        } else if ((entity.type === 'video_plane' || entity.type === 'image_plane') && entity.media) {
          sceneObjects.push({
            ...baseData, type: entity.type, assetId: entity.visual.assetId,
            properties: { ...propertiesToSave, ...entity.media }
          });
        } else {
          sceneObjects.push({
            ...baseData, type: entity.type, assetId: entity.visual.assetId,
            properties: propertiesToSave
          });
        }
      }
    });

    return { sceneObjects, triggers, worldSettings };
  } 
}