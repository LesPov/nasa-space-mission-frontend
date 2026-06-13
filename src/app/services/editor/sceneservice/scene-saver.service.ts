import { Injectable, inject } from '@angular/core';
import { AbstractMesh, HemisphericLight } from '@babylonjs/core';
import { Motor3dService } from '../../motor-3d.service';
import { EditorStateService } from '../editor-state.service';
import { SceneUtilsService } from './scene-utils.service';

@Injectable({ providedIn: 'root' })
export class SceneSaverService {
  private motor3d = inject(Motor3dService);
  private state = inject(EditorStateService);
  private utilsSvc = inject(SceneUtilsService);

  public obtenerDatosParaGuardar(): { sceneObjects: any[], triggers: any[], worldSettings: any } {
    const sceneObjects: any[] = [];
    const triggers: any[] = [];

    const scene = this.motor3d.scene;
    const ambient = scene.lights.find(l => l.name === 'ambientLight') as HemisphericLight;

    const worldSettings = {
      visualMode: scene.metadata?.globalVisualMode || 'normal',
      clearColor: scene.metadata?.globalClearColor || '#0d1729',
      clearColorBW: scene.metadata?.globalClearColorBW || '#555555',
      gravityY: scene.gravity.y,
      ambientIntensity: ambient ? ambient.intensity : 0.6,
      ambientDiffuse: ambient ? ambient.diffuse.toHexString().substring(0, 7) : '#ffffff',
      ambientGround: ambient ? ambient.groundColor.toHexString().substring(0, 7) : '#333333',
      ambientDirX: ambient ? ambient.direction.x : 0,
      ambientDirY: ambient ? ambient.direction.y : 1,
      ambientDirZ: ambient ? ambient.direction.z : 0
    };

    this.state.nodosEscena().forEach(nodo => {
      if (nodo instanceof AbstractMesh && nodo.metadata?.type) {
        const rot = nodo.rotationQuaternion ? nodo.rotationQuaternion.toEulerAngles() : nodo.rotation;
        const selectionRange = this.utilsSvc.normalizarSelectionRange(
          nodo.metadata?.playerConfig?.selectionRange || nodo.metadata?.selectionRange || null
        );

        if (nodo.metadata.type === 'trigger') {
          if (nodo.metadata.isComposite) {
            const conditions = nodo.metadata.conditions || [];
            conditions.forEach((cond: string) => {
              let actionProps: any = { triggerShape: nodo.metadata.triggerShape, isComposite: true };
              if (cond === 'on_enter') {
                actionProps.mensaje = nodo.metadata.mensajeEntrada || '';
                actionProps.soundUrl = nodo.metadata.soundUrlEntrada || '';
                actionProps.seqEntrada = nodo.metadata.seqEntrada || '';
                actionProps.timeEntrada = nodo.metadata.timeEntrada ?? 4.5;
                actionProps.videoEntrada = nodo.metadata.videoEntrada || '';
              }
              if (cond === 'on_exit') {
                actionProps.mensaje = nodo.metadata.mensajeSalida || '';
                actionProps.soundUrl = nodo.metadata.soundUrlSalida || '';
                actionProps.seqSalida = nodo.metadata.seqSalida || '';
                actionProps.timeSalida = nodo.metadata.timeSalida ?? 4.5;
                actionProps.videoSalida = nodo.metadata.videoSalida || '';
              }

              triggers.push({
                name: nodo.name,
                position: { x: nodo.position.x, y: nodo.position.y, z: nodo.position.z },
                scale: { x: nodo.scaling.x, y: nodo.scaling.y, z: nodo.scaling.z },
                properties: { condition: cond, actionType: 'show_message', targetObjectName: '', isRepeatable: nodo.metadata.isRepeatable, isEnabled: nodo.metadata.isEnabled, ...actionProps }
              });
            });
          } else {
            triggers.push({
              name: nodo.name,
              position: { x: nodo.position.x, y: nodo.position.y, z: nodo.position.z },
              scale: { x: nodo.scaling.x, y: nodo.scaling.y, z: nodo.scaling.z },
              properties: {
                condition: nodo.metadata.condition, actionType: 'show_message', targetObjectName: '', isRepeatable: nodo.metadata.isRepeatable, isEnabled: nodo.metadata.isEnabled,
                triggerShape: nodo.metadata.triggerShape, mensaje: nodo.metadata.mensaje, soundUrl: nodo.metadata.soundUrl, interactSequenceId: nodo.metadata.interactSequenceId,
                timeNorm: nodo.metadata.timeNorm ?? 4.5, videoNorm: nodo.metadata.videoNorm || '', isComposite: false
              }
            });
          }
          return;
        }

        const baseData = {
          name: nodo.name,
          position: { x: nodo.position.x, y: nodo.position.y, z: nodo.position.z },
          rotation: { x: rot.x, y: rot.y, z: rot.z },
          scale: { x: nodo.scaling.x, y: nodo.scaling.y, z: nodo.scaling.z }
        };

        const propertiesToSave = {
          rol: nodo.metadata.rol,
          isSolid: nodo.metadata.isSolid,
          isSelectable: nodo.metadata.isSelectable,
          ignoraNiebla: nodo.metadata.ignoraNiebla ?? false,
          mensaje: nodo.metadata.mensaje,
          respawnTime: nodo.metadata.respawnTime ?? 8, 
          interactDistanceFPS: nodo.metadata.interactDistanceFPS ?? 3.0,
          interactDistanceTPS: nodo.metadata.interactDistanceTPS ?? 5.0,
          interactSequenceIdFPS: nodo.metadata.interactSequenceIdFPS || '',
          interactSequenceIdTPS: nodo.metadata.interactSequenceIdTPS || '',
          collider: nodo.metadata.collider,
          camOffset: nodo.metadata.camOffset,
          playerConfig: nodo.metadata.playerConfig || null,
          selectionRange,
          animationNames: nodo.metadata.animationNames || [],
          colorBW: nodo.metadata.colorBW
        };

        if (nodo.metadata.type === 'model') {
          sceneObjects.push({ ...baseData, type: 'model', assetId: nodo.metadata.assetId, properties: { path: nodo.metadata.path, ...propertiesToSave } });
        } else if (nodo.metadata.type?.startsWith('light_')) {
          sceneObjects.push({
            ...baseData, type: nodo.metadata.type,
            properties: {
              lightColor: nodo.metadata.lightColor, intensity: nodo.metadata.intensity, range: nodo.metadata.range, angle: nodo.metadata.angle, path: nodo.metadata.path,
              attachedNodePath: nodo.metadata.attachedNodePath || '', attachedNodeName: nodo.metadata.attachedNodeName || '', ...propertiesToSave
            },
            assetId: nodo.metadata.assetId
          });
        } else if (nodo.metadata.type === 'video_plane') {
           sceneObjects.push({
             ...baseData, type: 'video_plane', assetId: nodo.metadata.assetId,
             properties: { videoUrl: nodo.metadata.videoUrl, path: nodo.metadata.videoUrl, ...propertiesToSave }
           });
        } else {
          sceneObjects.push({ ...baseData, type: nodo.metadata.type, properties: { color: nodo.metadata.color, ...propertiesToSave } });
        }
      }
    });

    return { sceneObjects, triggers, worldSettings };
  }
}