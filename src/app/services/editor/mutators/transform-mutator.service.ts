import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Engine, StandardMaterial, Texture, Vector3, Quaternion, Mesh } from '@babylonjs/core';
import { EditorMapaService } from '../../editor-mapa.service';
import { HistorialService } from '../../historial.service';
import { CoreSceneProjectionService } from '../../../core/engine/scene/utils/core-scene-projection.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../core/engine/world/world-settings.service';
import { CoreSceneMaterialService } from '../../../core/engine/scene/utils/core-scene-material.service';
import { DynamicLightingSystem } from '../../../core/engine/runtime/systems/lighting/dynamic-lighting.system';

export interface ProyeccionConfig {
  profundidadProyeccion: number;
  anguloProyeccion: number;
  proyeccionAncho: number;
  proyeccionAlto: number;
  proyeccionRepeticiones: number;
  proyeccionEspaciado: number;
  proyeccionEje: string;
  fadeDistance: number;
}

export interface VisualConfig {
  color: string;
  colorBW: string;
  ambientColor: string;
  ambientColorBW: string;
  ignoraNiebla: boolean;
  esEmisivo: boolean;
  brilloIntensidad: number;
  mostrarBorde?: boolean;
  isSelectable?: boolean;
}

export interface InteraccionConfig {
  interactDistanceFPS: number;
  interactDistanceTPS: number;
  interactSequenceIdFPS: string;
  interactSequenceIdTPS: string;
  mensaje: string;
}

@Injectable({ providedIn: 'root' })
export class TransformMutatorService {
  private mapaSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private projectionSvc = inject(CoreSceneProjectionService);
  private entityManager = inject(EntityManagerService); 
  private worldSettingsSvc = inject(WorldSettingsService);
  private materialSvc = inject(CoreSceneMaterialService);
  private dynamicLighting = inject(DynamicLightingSystem);

  public aplicarPosicion(objeto: AbstractMesh, localPos: { x: number, y: number, z: number }): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    
    this.historialSvc.registrarCambioTransform(objeto, () => {
      if (entity) {
        entity.transform.position = { ...localPos };
        entity.isDirty = true;
        entity.syncToView(); 
      } else {
        objeto.position.set(localPos.x, localPos.y, localPos.z);
      }
    });

    if (entity && entity.type === 'image_plane') {
       this.projectionSvc.actualizarProyeccion(objeto as Mesh);
    }
    if (entity && entity.type.startsWith('light_')) {
       this.dynamicLighting.syncLightImmediate(entity);
    }
    this.mapaSvc.onMapChanged.next();
  }

  public aplicarRotacion(objeto: AbstractMesh, localRotEulerDeg: { x: number, y: number, z: number }): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    const rx = localRotEulerDeg.x * (Math.PI / 180);
    const ry = localRotEulerDeg.y * (Math.PI / 180);
    const rz = localRotEulerDeg.z * (Math.PI / 180);

    this.historialSvc.registrarCambioTransform(objeto, () => {
      if (entity) {
        entity.transform.rotation = { x: rx, y: ry, z: rz };
        if (entity.transform.rotationQuaternion) {
            const q = Quaternion.FromEulerAngles(rx, ry, rz);
            entity.transform.rotationQuaternion = { x: q.x, y: q.y, z: q.z, w: q.w };
        }
        entity.isDirty = true;
        entity.syncToView();
      } else {
        if (objeto.rotationQuaternion) {
            objeto.rotationQuaternion = Quaternion.FromEulerAngles(rx, ry, rz);
            objeto.rotation.set(0, 0, 0);
        } else {
            objeto.rotation.set(rx, ry, rz);
        }
      }
    });

    if (entity && entity.type === 'image_plane') {
       this.projectionSvc.actualizarProyeccion(objeto as Mesh);
    }
    if (entity && entity.type.startsWith('light_')) {
       this.dynamicLighting.syncLightImmediate(entity);
    }
    this.mapaSvc.onMapChanged.next();
  }

  public aplicarEscala(objeto: AbstractMesh, localEscReal: { x: number, y: number, z: number }): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    
    this.historialSvc.registrarCambioTransform(objeto, () => {
      if (entity) {
         entity.transform.scale = { x: localEscReal.x, y: localEscReal.y, z: localEscReal.z };
         entity.isDirty = true;
         entity.syncToView();
      } else {
         objeto.scaling.set(localEscReal.x, localEscReal.y, localEscReal.z);
      }
    });

    if (entity && entity.type === 'image_plane') {
       this.projectionSvc.actualizarProyeccion(objeto as Mesh);
    }
    this.mapaSvc.onMapChanged.next();
  }

  public aplicarProyeccion(objeto: AbstractMesh, config: ProyeccionConfig): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    if (!entity || !entity.media) return;

    entity.media.profundidadProyeccion = this.projectionSvc.clampNum(Number(config.profundidadProyeccion), 0.08, 1000, 0.01);
    entity.media.anguloProyeccion = Number(config.anguloProyeccion);
    entity.media.proyeccionAncho = this.projectionSvc.clampNum(Number(config.proyeccionAncho), 1, 1000, 0.01);
    entity.media.proyeccionAlto = this.projectionSvc.clampNum(Number(config.proyeccionAlto), 1, 1000, 0.01);
    entity.media.proyeccionRepeticiones = Math.floor(this.projectionSvc.clampNum(Number(config.proyeccionRepeticiones), 1, 50, 1));
    entity.media.proyeccionEspaciado = Number(config.proyeccionEspaciado);
    entity.media.proyeccionEje = config.proyeccionEje;
    entity.media.fadeDistance = Math.max(0, Number(config.fadeDistance));

    entity.isDirty = true;
    entity.syncToView();

    if (entity.type === 'image_plane') {
       this.projectionSvc.actualizarProyeccion(objeto as Mesh);
    }
    this.mapaSvc.onMapChanged.next();
  }

  public aplicarVisuales(objeto: AbstractMesh, config: VisualConfig): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    if (!entity) return;

    entity.visual.color = config.color;
    entity.visual.colorBW = config.colorBW;
    entity.visual.ambientColor = config.ambientColor || '#ffffff';
    entity.visual.ambientColorBW = config.ambientColorBW || '#ffffff';
    entity.visual.ignoraNiebla = config.ignoraNiebla;
    entity.visual.esEmisivo = config.esEmisivo;
    entity.visual.brilloIntensidad = this.clampBrightness(config.brilloIntensidad);
    
    if (config.mostrarBorde !== undefined) {
       entity.visual.mostrarBorde = config.mostrarBorde;
    }
    
    if (config.isSelectable !== undefined) {
       entity.visual.isSelectable = config.isSelectable;
       objeto.isPickable = config.isSelectable;
       objeto.getChildMeshes().forEach((m: AbstractMesh) => m.isPickable = config.isSelectable!);
    }

    entity.isDirty = true;
    entity.syncToView();

    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    const activeColorHex = isBW ? config.colorBW : config.color;
    const activeAmbientHex = isBW ? config.ambientColorBW : config.ambientColor;

    const isModelBased = entity.type === 'model' || (entity.type.startsWith('light_') && (!!entity.visual.assetId || !!entity.visual.path));

    if (isModelBased) {
        const scene = objeto.getScene();
        objeto.getChildMeshes().forEach((m: AbstractMesh) => {
            if (m.material) {
                const override = entity.partOverrides?.overrides[m.name];
                if (override) {
                    this.materialSvc.asegurarMaterialUnicoParaParte(m, entity.uid, m.name);
                    const activeColorOverride = isBW ? (override.colorBW || override.color) : override.color;
                    this.materialSvc.ajustarMaterialGLB(
                        m.material, isBW, scene, 
                        activeAmbientHex, 
                        activeColorOverride || activeColorHex, 
                        override.esEmisivo ?? config.esEmisivo, 
                        override.brilloIntensidad ?? config.brilloIntensidad,
                        override.texturePath,
                        override.textureSource || (override.texturePath ? 'asset' : 'original') 
                    );
                } else {
                    this.materialSvc.asegurarMaterialUnico(m, entity.uid);
                    this.materialSvc.ajustarMaterialGLB(m.material, isBW, scene, activeAmbientHex, activeColorHex, config.esEmisivo, config.brilloIntensidad);
                }
            }
        });
    }

    if (objeto.material && objeto.material instanceof StandardMaterial) {
      if (entity.type === 'image_plane') {
        const decalMat = entity.mediaRuntime?.runtimeDecalMaterial as StandardMaterial | undefined;
        
        if (decalMat) {
          const tex = (decalMat.diffuseTexture || decalMat.opacityTexture) as Texture | null;
          this.projectionSvc.configurarMaterialProyector(decalMat, activeColorHex, config.brilloIntensidad, config.ignoraNiebla, tex);
        }
        
        if (Array.isArray(entity.mediaRuntime?.runtimeDecals)) {
          entity.mediaRuntime!.runtimeDecals.forEach((m: AbstractMesh) => { 
            if (m) m.applyFog = !config.ignoraNiebla; 
          });
        }
      } else if (!isModelBased) {
        this.materialSvc.asegurarMaterialUnico(objeto, entity.uid);
        const objMat = objeto.material as StandardMaterial;
        
        const c3 = Color3.FromHexString(activeColorHex);
        const c3Amb = Color3.FromHexString(activeAmbientHex);
        const brillo = this.clampBrightness(config.brilloIntensidad);

        objMat.diffuseColor = c3;
        objMat.specularColor = new Color3(0, 0, 0);

        if (config.esEmisivo) {
          objMat.emissiveColor = c3.scale(brillo);
          objMat.disableLighting = false;
        } else {
          objMat.emissiveColor = new Color3(0, 0, 0);
          objMat.ambientColor = c3Amb;
          objMat.disableLighting = false;
        }
      }
    }

    if (entity.type.startsWith('light_') && entity.light) {
        const activeLightColorHex = isBW ? entity.light.lightColorBW : entity.light.lightColor;
        const c3Light = Color3.FromHexString(activeLightColorHex || '#ffffff');
        
        if (objeto.material && (objeto.material as any).emissiveColor && !isModelBased) {
            (objeto.material as StandardMaterial).emissiveColor = c3Light;
        }

        objeto.getChildMeshes().forEach((m: AbstractMesh) => {
           if (m.material) { 
               const nL = m.name.toLowerCase();
               const mL = m.material.name.toLowerCase();
               if (nL.includes('bulb') || nL.includes('light') || nL.includes('emit') || mL.includes('bulb') || mL.includes('light') || mL.includes('emit')) {
                   const override = entity.partOverrides?.overrides[m.name];
                   if (!override || (override.color === undefined && override.esEmisivo === undefined)) {
                       if ((m.material as any).emissiveColor) {
                           (m.material as any).emissiveColor = c3Light;
                       }
                   }
               }
           }
        });

        entity.light.renderIntensity = (config.brilloIntensidad !== undefined) ? (this.clampBrightness(config.brilloIntensidad) * 5) : (entity.light.intensity || 5);
        entity.light.intensity = entity.light.renderIntensity;

        // 🔥 Notificar inmediatamente al runtime de iluminación
        this.dynamicLighting.syncLightImmediate(entity);
    }

    objeto.applyFog = !config.ignoraNiebla;
    objeto.getChildMeshes().forEach((m: AbstractMesh) => m.applyFog = !config.ignoraNiebla);
    
    this.mapaSvc.onMapChanged.next();
  }

  public aplicarInteraccion(objeto: AbstractMesh, config: InteraccionConfig): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    if (!entity) return;

    entity.interaction.interactDistanceFPS = config.interactDistanceFPS;
    entity.interaction.interactDistanceTPS = config.interactDistanceTPS;
    entity.interaction.interactSequenceIdFPS = config.interactSequenceIdFPS.trim();
    entity.interaction.interactSequenceIdTPS = config.interactSequenceIdTPS.trim();
    entity.interaction.mensaje = config.mensaje.trim();
    
    entity.isDirty = true;
    entity.syncToView();
    this.mapaSvc.onMapChanged.next();
  }

  public forzarRecalculoProyeccion(objeto: AbstractMesh): void {
    if (objeto) {
      const entity = this.entityManager.getEntityByMesh(objeto);
      if (entity && entity.type === 'image_plane') {
         this.projectionSvc.actualizarProyeccion(objeto as Mesh);
         this.mapaSvc.onMapChanged.next();
      }
    }
  }

  private clampBrightness(v: number): number {
    if (Number.isNaN(v) || v === null || v === undefined) return 1.0;
    return Math.max(0, Math.min(10, Number(v)));
  }
}