
import { Injectable, inject } from '@angular/core'; 
import { HemisphericLight } from '@babylonjs/core'; 
import { Motor3dService } from '../../motor-3d.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { LightComponent, MediaComponent, PhysicsComponent, PlayerStateComponent, TransformComponent, TriggerComponent, VisualComponent } from '../../../core/engine/entities/game.entity';

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

  public obtenerDatosParaGuardar(forceFull: boolean = false): { sceneObjectsDelta: any[]; triggersDelta: any[]; deletedObjects: string[]; deletedTriggers: string[]; worldSettings: any } { 
    const sceneObjectsDelta: any[] = []; 
    const triggersDelta: any[] = [];

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
      // 🔥 DIRTY TRACKING: Procesamos todo si es "forceFull" (como en el modo Test), sino solo Deltas
      if (!forceFull && !entity.isDirty) return;

      entity.syncTransformFromView();

      const transform = entity.getComponent<TransformComponent>('transform')!;
      const visual = entity.getComponent<VisualComponent>('visual')!;
      const interaction = entity.interaction; // Mantenemos el fallback para no alargar más el código
      const playerState = entity.getComponent<PlayerStateComponent>('playerState')!;
      const physics = entity.getComponent<PhysicsComponent>('physics')!;
      const light = entity.getComponent<LightComponent>('light');
      const media = entity.getComponent<MediaComponent>('media');
      const trigger = entity.getComponent<TriggerComponent>('trigger');

      if (entity.type === 'trigger' || entity.type === 'trigger_compuesto') {
        const isComposite = entity.type === 'trigger_compuesto';
        const rawConditions = trigger?.conditions || ['on_enter'];

        if (isComposite) {
          rawConditions.forEach((cond: string) => {
             const actionProps: any = { triggerShape: trigger?.triggerShape || 'cube', isComposite: true };
             if (cond === 'on_enter') {
                actionProps.mensaje = trigger?.mensajeEntrada || '';
                actionProps.soundUrl = trigger?.soundUrlEntrada || '';
                actionProps.seqEntrada = trigger?.seqEntrada || '';
                actionProps.timeEntrada = trigger?.timeEntrada ?? 4.5;
                actionProps.videoEntrada = trigger?.videoEntrada || '';
             }
             if (cond === 'on_exit') {
                actionProps.mensaje = trigger?.mensajeSalida || '';
                actionProps.soundUrl = trigger?.soundUrlSalida || '';
                actionProps.seqSalida = trigger?.seqSalida || '';
                actionProps.timeSalida = trigger?.timeSalida ?? 4.5;
                actionProps.videoSalida = trigger?.videoSalida || '';
             }
             triggersDelta.push({
               uid: entity.uid, name: entity.name, parentId: entity.parentId,
               position: transform.position, scale: transform.scale,
               properties: { condition: cond, actionType: 'show_message', targetObjectName: '', isRepeatable: trigger?.isRepeatable ?? false, isEnabled: trigger?.isEnabled ?? true, ...actionProps }
             });
          });
        } else {
           triggersDelta.push({
             uid: entity.uid, name: entity.name, parentId: entity.parentId,
             position: transform.position, scale: transform.scale,
             properties: {
               condition: trigger?.condition || 'on_enter', actionType: 'show_message', targetObjectName: '',
               isRepeatable: trigger?.isRepeatable ?? false, isEnabled: trigger?.isEnabled ?? true,
               triggerShape: trigger?.triggerShape || 'cube', 
               mensaje: interaction.mensaje,
               soundUrl: trigger?.soundUrl || '', 
               interactSequenceId: interaction.interactSequenceId,
               timeNorm: trigger?.timeNorm ?? 4.5, 
               videoNorm: trigger?.videoNorm || '', 
               isComposite: false
             }
           });
        }
      } else {
        // OBJETOS COMUNES Y MODELOS
        const propertiesToSave = {
          color: visual.color,
          colorBW: visual.colorBW,
          rol: entity.rol,
          isSolid: visual.isSolid,
          isSelectable: visual.isSelectable,
          ignoraNiebla: visual.ignoraNiebla,
          esEmisivo: visual.esEmisivo,
          brilloIntensidad: visual.brilloIntensidad,
          mensaje: interaction.mensaje,
          interactDistanceFPS: interaction.interactDistanceFPS,
          interactDistanceTPS: interaction.interactDistanceTPS,
          interactSequenceIdFPS: interaction.interactSequenceIdFPS,
          interactSequenceIdTPS: interaction.interactSequenceIdTPS,
          interactSequenceId: interaction.interactSequenceId,
          respawnTime: interaction.respawnTime,
          collider: physics,
          camOffset: playerState.camOffset,
          playerConfig: playerState.playerConfig,
          selectionRange: playerState.selectionRange,
          animationNames: playerState.animationNames,
          autoAnim: playerState.autoAnim,
          path: visual.path 
        };

        const baseData = {
          uid: entity.uid, name: entity.name, parentId: entity.parentId,
          position: transform.position, rotation: transform.rotation, scale: transform.scale
        };

        if (entity.type.startsWith('light_') && light) {
          sceneObjectsDelta.push({
            ...baseData, type: entity.type, assetId: visual.assetId,
            properties: { ...propertiesToSave, ...light }
          });
        } else if ((entity.type === 'video_plane' || entity.type === 'image_plane') && media) {
          const mediaSafe: any = { ...media };
          delete mediaSafe.runtimeDecals;
          delete mediaSafe.runtimeDecalMaterial;
          delete mediaSafe.lastVisualModeBW;

          sceneObjectsDelta.push({
            ...baseData, type: entity.type, assetId: visual.assetId,
            properties: { ...propertiesToSave, ...mediaSafe }
          });
        } else {
          sceneObjectsDelta.push({
            ...baseData, type: entity.type, assetId: visual.assetId,
            properties: propertiesToSave
          });
        }
      }
    });

    return { 
      sceneObjectsDelta, 
      triggersDelta, 
      deletedObjects: [...this.entityManager.deletedObjects], 
      deletedTriggers: [...this.entityManager.deletedTriggers], 
      worldSettings 
    };
  } 
}