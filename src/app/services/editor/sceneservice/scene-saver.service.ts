import { Injectable, inject } from '@angular/core'; 
import { AbstractMesh, Color3, HemisphericLight, Node } from '@babylonjs/core'; 
import { EditorStateService } from '../editor-state.service'; 
import { SceneUtilsService } from './scene-utils.service'; 
import { Motor3dService } from '../../motor-3d.service';

type SavedVector3 = { x: number; y: number; z: number };

@Injectable({ providedIn: 'root' }) 
export class SceneSaverService { 
  private motor3d = inject(Motor3dService); 
  private state = inject(EditorStateService);
  private utilsSvc = inject(SceneUtilsService);

  private hex7(value: any, fallback: string): string { 
    if (typeof value !== 'string' || !value.trim()) return fallback; 
    const v = value.trim(); 
    return v.length >= 7 ? v.substring(0, 7) : fallback; 
  }

  private safeNumber(value: any, fallback: number): number { 
    const n = Number(value); 
    return Number.isFinite(n) ? n : fallback; 
  }

  private safeBool(value: any, fallback = false): boolean { 
    return typeof value === 'boolean' ? value : fallback; 
  }

  private getRotationEuler(nodo: AbstractMesh): SavedVector3 { 
    const rot = nodo.rotationQuaternion ? nodo.rotationQuaternion.toEulerAngles() : nodo.rotation;
    return {
      x: this.safeNumber(rot?.x, 0),
      y: this.safeNumber(rot?.y, 0),
      z: this.safeNumber(rot?.z, 0)
    };
  }

  private getParentUid(nodo: AbstractMesh): string | null { 
    if (nodo.parent && nodo.parent.name !== 'root') { 
      return (nodo.parent as AbstractMesh).metadata?.uid || null; 
    } 
    return null; 
  }

  private buildCommonProperties(nodo: AbstractMesh, selectionRange: any): any {
    return { 
      color: this.hex7(nodo.metadata?.color, '#ffffff'), 
      colorBW: this.hex7(nodo.metadata?.colorBW, this.hex7(nodo.metadata?.color, '#ffffff')),
      rol: nodo.metadata?.rol, 
      isSolid: this.safeBool(nodo.metadata?.isSolid, true),
      isSelectable: this.safeBool(nodo.metadata?.isSelectable, true), 
      ignoraNiebla: this.safeBool(nodo.metadata?.ignoraNiebla, false), 
      esEmisivo: this.safeBool(nodo.metadata?.esEmisivo, false), 
      brilloIntensidad: this.safeNumber(nodo.metadata?.brilloIntensidad, 1.0), 
      mensaje: nodo.metadata?.mensaje || '', 
      respawnTime: this.safeNumber(nodo.metadata?.respawnTime, 8), 
      interactDistanceFPS: this.safeNumber(nodo.metadata?.interactDistanceFPS, 3.0), 
      interactDistanceTPS: this.safeNumber(nodo.metadata?.interactDistanceTPS, 5.0), 
      interactSequenceIdFPS: nodo.metadata?.interactSequenceIdFPS || '', 
      interactSequenceIdTPS: nodo.metadata?.interactSequenceIdTPS || '', 
      collider: nodo.metadata?.collider,
      camOffset: nodo.metadata?.camOffset, 
      // 🔥 FIX LÓGICO: Forzamos la clonación profunda al guardar para que NINGÚN campo nuevo desaparezca
      playerConfig: nodo.metadata?.playerConfig ? JSON.parse(JSON.stringify(nodo.metadata.playerConfig)) : null, 
      selectionRange, 
      animationNames: nodo.metadata?.animationNames || [],
      autoAnim: nodo.metadata?.autoAnim || null 
    }; 
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
      gravityY: this.safeNumber(scene.gravity?.y, 0),
      ambientIntensity: ambient ? this.safeNumber(ambient.intensity, 0.6) : 0.6,
      ambientDiffuse: ambient ? this.hex7(ambient.diffuse?.toHexString?.(), '#ffffff') : '#ffffff',
      ambientGround: ambient ? this.hex7(ambient.groundColor?.toHexString?.(), '#333333') : '#333333',
      ambientDirX: ambient ? this.safeNumber(ambient.direction?.x, 0) : 0,
      ambientDirY: ambient ? this.safeNumber(ambient.direction?.y, 1) : 1,
      ambientDirZ: ambient ? this.safeNumber(ambient.direction?.z, 0) : 0
    };

    const processNode = (nodo: Node) => {
      if (nodo instanceof AbstractMesh && nodo.metadata?.type) {
        if (!nodo.metadata.uid) {
          nodo.metadata.uid = window.crypto.randomUUID();
        }

        const rot = this.getRotationEuler(nodo);
        const selectionRange = this.utilsSvc.normalizarSelectionRange(
          nodo.metadata?.playerConfig?.selectionRange || nodo.metadata?.selectionRange || null
        );

        const parentUid = this.getParentUid(nodo);

        if (nodo.metadata.type === 'trigger') {
          if (nodo.metadata.isComposite) {
            const conditions = nodo.metadata.conditions || [];
            conditions.forEach((cond: string) => {
              const actionProps: any = {
                triggerShape: nodo.metadata.triggerShape,
                isComposite: true
              };

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
                uid: nodo.metadata.uid,
                name: nodo.name,
                parentId: parentUid,
                position: { x: nodo.position.x, y: nodo.position.y, z: nodo.position.z },
                scale: { x: nodo.scaling.x, y: nodo.scaling.y, z: nodo.scaling.z },
                properties: {
                  condition: cond,
                  actionType: 'show_message',
                  targetObjectName: '',
                  isRepeatable: nodo.metadata.isRepeatable,
                  isEnabled: nodo.metadata.isEnabled,
                  ...actionProps
                }
              });
            });
          } else {
            triggers.push({
              uid: nodo.metadata.uid,
              name: nodo.name,
              parentId: parentUid,
              position: { x: nodo.position.x, y: nodo.position.y, z: nodo.position.z },
              scale: { x: nodo.scaling.x, y: nodo.scaling.y, z: nodo.scaling.z },
              properties: {
                condition: nodo.metadata.condition,
                actionType: 'show_message',
                targetObjectName: '',
                isRepeatable: nodo.metadata.isRepeatable,
                isEnabled: nodo.metadata.isEnabled,
                triggerShape: nodo.metadata.triggerShape,
                mensaje: nodo.metadata.mensaje,
                soundUrl: nodo.metadata.soundUrl,
                interactSequenceId: nodo.metadata.interactSequenceId,
                timeNorm: nodo.metadata.timeNorm ?? 4.5,
                videoNorm: nodo.metadata.videoNorm || '',
                isComposite: false
              }
            });
          }
        } else {
          const baseData = {
            uid: nodo.metadata.uid,
            name: nodo.name,
            parentId: parentUid,
            position: { x: nodo.position.x, y: nodo.position.y, z: nodo.position.z },
            rotation: { x: rot.x, y: rot.y, z: rot.z },
            scale: { x: nodo.scaling.x, y: nodo.scaling.y, z: nodo.scaling.z }
          };

          const propertiesToSave = this.buildCommonProperties(nodo, selectionRange);

          if (nodo.metadata.type === 'model') {
            sceneObjects.push({
              ...baseData,
              type: 'model',
              assetId: nodo.metadata.assetId,
              properties: {
                path: nodo.metadata.path,
                ...propertiesToSave
              }
            });
          } else if (nodo.metadata.type?.startsWith('light_')) {
            sceneObjects.push({
              ...baseData,
              type: nodo.metadata.type,
              properties: {
                lightColor: nodo.metadata.lightColor,
                intensity: this.safeNumber(nodo.metadata.intensity, 1.0),
                range: this.safeNumber(nodo.metadata.range, 50),
                angle: this.safeNumber(nodo.metadata.angle, 60),
                path: nodo.metadata.path,
                attachedNodePath: nodo.metadata.attachedNodePath || '',
                attachedNodeName: nodo.metadata.attachedNodeName || '',
                lightPosX: this.safeNumber(nodo.metadata.lightPosX, 0),
                lightPosY: this.safeNumber(nodo.metadata.lightPosY, 0),
                lightPosZ: this.safeNumber(nodo.metadata.lightPosZ, 0),
                ...propertiesToSave
              },
              assetId: nodo.metadata.assetId
            });
          } else if (nodo.metadata.type === 'video_plane') {
            sceneObjects.push({
              ...baseData,
              type: 'video_plane',
              assetId: nodo.metadata.assetId,
              properties: {
                videoUrl: nodo.metadata.videoUrl,
                path: nodo.metadata.videoUrl,
                ...propertiesToSave
              }
            });
          } else if (nodo.metadata.type === 'image_plane') {
            sceneObjects.push({
              ...baseData,
              type: 'image_plane',
              assetId: nodo.metadata.assetId,
              properties: {
                imageUrl: nodo.metadata.imageUrl,
                path: nodo.metadata.imageUrl,
                profundidadProyeccion: this.safeNumber(nodo.metadata.profundidadProyeccion, 0.08),
                anguloProyeccion: this.safeNumber(nodo.metadata.anguloProyeccion, 0),
                proyeccionAncho: this.safeNumber(nodo.metadata.proyeccionAncho, nodo.scaling.x),
                proyeccionAlto: this.safeNumber(nodo.metadata.proyeccionAlto, nodo.scaling.y),
                proyeccionRepeticiones: this.safeNumber(nodo.metadata.proyeccionRepeticiones, 1),
                proyeccionEspaciado: this.safeNumber(nodo.metadata.proyeccionEspaciado, 2),
                proyeccionEje: nodo.metadata.proyeccionEje || 'Y',
                fadeDistance: this.safeNumber(nodo.metadata.fadeDistance, 0),
                ...propertiesToSave
              }
            });
          } else {
            sceneObjects.push({
              ...baseData,
              type: nodo.metadata.type,
              properties: {
                ...propertiesToSave
              }
            });
          }
        }
      }

      nodo.getChildren().forEach(child => processNode(child));
    };

    this.state.nodosEscena().forEach(nodo => processNode(nodo));

    return { sceneObjects, triggers, worldSettings };
  } 
}