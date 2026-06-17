import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Engine, StandardMaterial, Texture, Vector3, Quaternion } from '@babylonjs/core';
import { EditorMapaService } from '../../editor-mapa.service';
import { HistorialService } from '../../historial.service';
import { Motor3dService } from '../../motor-3d.service';
import { SceneProjectionService } from '../sceneservice/scene-projection.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class TransformMutatorService {
  private editorSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private motor3dSvc = inject(Motor3dService);
  private projectionSvc = inject(SceneProjectionService);
  private entityManager = inject(EntityManagerService); 

  public aplicarPosicion(objeto: AbstractMesh, localPos: { x: number, y: number, z: number }): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    
    this.historialSvc.registrarCambioTransform(objeto, () => {
      if (entity) {
        entity.transform.position = { ...localPos };
        entity.syncToView(); 
      } else {
        objeto.position.set(localPos.x, localPos.y, localPos.z);
      }
    });

    if (objeto.metadata?.updateDecal) objeto.metadata.updateDecal();
    this.editorSvc.triggerUpdate();
  }

  public aplicarRotacion(objeto: AbstractMesh, localRotEulerDeg: { x: number, y: number, z: number }): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    const rx = localRotEulerDeg.x * (Math.PI / 180);
    const ry = localRotEulerDeg.y * (Math.PI / 180);
    const rz = localRotEulerDeg.z * (Math.PI / 180);

    this.historialSvc.registrarCambioTransform(objeto, () => {
      if (entity) {
        entity.transform.rotation = { x: rx, y: ry, z: rz };
        entity.syncToView();
      } else {
        objeto.rotationQuaternion = Quaternion.FromEulerAngles(rx, ry, rz);
        objeto.rotation.set(0, 0, 0);
      }
    });

    if (objeto.metadata?.updateDecal) objeto.metadata.updateDecal();
    this.editorSvc.triggerUpdate();
  }

  public aplicarEscala(objeto: AbstractMesh, localEscReal: { x: number, y: number, z: number }): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    
    this.historialSvc.registrarCambioTransform(objeto, () => {
      if (entity) {
         entity.transform.scale = { x: localEscReal.x, y: localEscReal.y, z: localEscReal.z };
         entity.syncToView();
      } else {
         objeto.scaling.set(localEscReal.x, localEscReal.y, localEscReal.z);
      }
    });

    if (objeto.metadata?.updateDecal) objeto.metadata.updateDecal();
    this.editorSvc.triggerUpdate();
  }

  public aplicarProyeccion(objeto: AbstractMesh, config: any): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    if (!entity || !entity.media) return;

    entity.media.profundidadProyeccion = this.clampPositive(Number(config.profundidadProyeccion), 0.08, 0.01, 1000);
    entity.media.anguloProyeccion = Number(config.anguloProyeccion);
    entity.media.proyeccionAncho = this.clampPositive(Number(config.proyeccionAncho), 1, 0.01, 1000);
    entity.media.proyeccionAlto = this.clampPositive(Number(config.proyeccionAlto), 1, 0.01, 1000);
    entity.media.proyeccionRepeticiones = Math.floor(this.clampPositive(Number(config.proyeccionRepeticiones), 1, 1, 50));
    entity.media.proyeccionEspaciado = Number(config.proyeccionEspaciado);
    entity.media.proyeccionEje = config.proyeccionEje;
    entity.media.fadeDistance = Math.max(0, Number(config.fadeDistance));

    entity.syncToView();

    if (objeto.metadata?.updateDecal) objeto.metadata.updateDecal();
    this.editorSvc.triggerUpdate();
  }

  public aplicarVisuales(objeto: AbstractMesh, config: any): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    if (!entity) return;

    entity.visual.color = config.color;
    entity.visual.colorBW = config.colorBW;
    entity.visual.ignoraNiebla = config.ignoraNiebla;
    entity.visual.esEmisivo = config.esEmisivo;
    entity.visual.brilloIntensidad = this.clampBrightness(config.brilloIntensidad);

    entity.syncToView();

    const isBW = this.motor3dSvc.scene.metadata?.globalVisualMode === 'bw';
    const activeColorHex = isBW ? config.colorBW : config.color;

    if (objeto.material && objeto.material instanceof StandardMaterial) {
      if (entity.type === 'image_plane') {
        const decalMat = objeto.metadata.decalMaterial as StandardMaterial;
        if (decalMat) {
          const tex = (decalMat.diffuseTexture || decalMat.opacityTexture) as any;
          this.aplicarMaterialHolograma(decalMat, activeColorHex, config.brilloIntensidad, config.ignoraNiebla, tex);
        }
        if (Array.isArray(objeto.metadata.decalMeshes)) {
          objeto.metadata.decalMeshes.forEach((m: AbstractMesh) => { if (m) m.applyFog = !config.ignoraNiebla; });
        }
      } else {
        const objMat = objeto.material as StandardMaterial;
        const c3 = Color3.FromHexString(activeColorHex);
        const brillo = this.clampBrightness(config.brilloIntensidad);

        objMat.diffuseColor = c3;
        objMat.specularColor = new Color3(0, 0, 0);

        if (config.esEmisivo) {
          objMat.emissiveColor = c3.scale(brillo);
          objMat.disableLighting = false;
        } else {
          objMat.emissiveColor = new Color3(0, 0, 0);
          objMat.ambientColor = c3.scale(Math.max(0.05, brillo * 0.2));
          objMat.disableLighting = false;
        }
      }
    }

    objeto.applyFog = !config.ignoraNiebla;
    objeto.getChildMeshes().forEach((m: AbstractMesh) => m.applyFog = !config.ignoraNiebla);
    
    this.editorSvc.triggerUpdate();
  }

  public aplicarInteraccion(objeto: AbstractMesh, config: any): void {
    const entity = this.entityManager.getEntityByMesh(objeto);
    if (!entity) return;

    entity.interaction.interactDistanceFPS = config.interactDistanceFPS;
    entity.interaction.interactDistanceTPS = config.interactDistanceTPS;
    entity.interaction.interactSequenceIdFPS = config.interactSequenceIdFPS.trim();
    entity.interaction.interactSequenceIdTPS = config.interactSequenceIdTPS.trim();
    entity.interaction.mensaje = config.mensaje.trim();
    
    entity.syncToView();
    this.editorSvc.triggerUpdate();
  }

  public forzarRecalculoProyeccion(objeto: AbstractMesh): void {
    if (objeto && objeto.metadata?.updateDecal) {
      objeto.metadata.updateDecal();
      this.editorSvc.triggerUpdate();
    }
  }

  private clampBrightness(v: number): number {
    if (Number.isNaN(v) || v === null || v === undefined) return 1.0;
    return Math.max(0, Math.min(10, Number(v)));
  }

  private clampPositive(v: number, fallback: number, min = 0.01, max = 9999): number {
    if (Number.isNaN(v) || v === null || v === undefined) return fallback;
    return Math.max(min, Math.min(max, Number(v)));
  }

  private aplicarMaterialHolograma(mat: StandardMaterial, colorHex: string, brilloIntensidad: number, ignoraNiebla: boolean, texture?: any): void {
    const c3 = Color3.FromHexString(colorHex || '#ffffff');
    const brillo = this.clampBrightness(brilloIntensidad);

    mat.disableLighting = true;
    mat.diffuseColor = c3;
    mat.ambientColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    mat.alphaMode = Engine.ALPHA_COMBINE;
    mat.disableDepthWrite = true; 
    mat.fogEnabled = !ignoraNiebla;
    mat.zOffset = -2; 

    if (texture) {
      texture.hasAlpha = true;
      texture.gammaSpace = true;
      mat.diffuseTexture = texture;
      mat.useAlphaFromDiffuseTexture = true;
      mat.opacityTexture = texture;
      mat.emissiveTexture = null as any;
      mat.emissiveColor = c3.scale(brillo);
      mat.alpha = 1.0;
    } else {
      mat.diffuseTexture = null as any;
      mat.opacityTexture = null as any;
      mat.emissiveTexture = null as any;
      mat.useAlphaFromDiffuseTexture = false;
      mat.emissiveColor = c3.scale(brillo);
      mat.alpha = Math.max(0.2, Math.min(1.0, brillo * 0.5));
    }
  }
}