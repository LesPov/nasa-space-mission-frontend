import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Engine, Mesh, Quaternion, StandardMaterial, Texture, Vector3 } from '@babylonjs/core';
import { EditorMapaService } from '../../editor-mapa.service';
import { HistorialService } from '../../historial.service';
import { Motor3dService } from '../../motor-3d.service';
import { SceneProjectionService } from '../sceneservice/scene-projection.service';

@Injectable({ providedIn: 'root' })
export class TransformMutatorService {
  private editorSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private motor3dSvc = inject(Motor3dService);
  private projectionSvc = inject(SceneProjectionService);

  public aplicarPosicion(objeto: AbstractMesh, localPos: { x: number, y: number, z: number }): void {
    this.historialSvc.registrarCambioTransform(objeto, () => {
      objeto.position.set(localPos.x, localPos.y, localPos.z);
    });
    if (objeto.metadata?.updateDecal) objeto.metadata.updateDecal();
    this.editorSvc.triggerUpdate();
  }

  public aplicarRotacion(objeto: AbstractMesh, localRotEulerDeg: { x: number, y: number, z: number }): void {
    const rx = localRotEulerDeg.x * (Math.PI / 180);
    const ry = localRotEulerDeg.y * (Math.PI / 180);
    const rz = localRotEulerDeg.z * (Math.PI / 180);

    this.historialSvc.registrarCambioTransform(objeto, () => {
      objeto.rotationQuaternion = Quaternion.FromEulerAngles(rx, ry, rz);
      objeto.rotation.set(0, 0, 0);
    });
    if (objeto.metadata?.updateDecal) objeto.metadata.updateDecal();
    this.editorSvc.triggerUpdate();
  }

  public aplicarEscala(objeto: AbstractMesh, localEscReal: { x: number, y: number, z: number }): void {
    this.historialSvc.registrarCambioTransform(objeto, () => {
      if (objeto.parent && (objeto.parent as any).getWorldMatrix) {
        const parentWorldScale = new Vector3();
        (objeto.parent as any).getWorldMatrix().decompose(parentWorldScale);
        
        const localX = localEscReal.x / (Math.abs(parentWorldScale.x) || 1);
        const localY = localEscReal.y / (Math.abs(parentWorldScale.y) || 1);
        const localZ = localEscReal.z / (Math.abs(parentWorldScale.z) || 1);
        
        objeto.scaling.set(localX, localY, localZ);
      } else {
        objeto.scaling.set(localEscReal.x, localEscReal.y, localEscReal.z);
      }
    });
    if (objeto.metadata?.updateDecal) objeto.metadata.updateDecal();
    this.editorSvc.triggerUpdate();
  }

  public aplicarProyeccion(objeto: AbstractMesh, config: any): void {
    if (!objeto.metadata) objeto.metadata = {};

    objeto.metadata.profundidadProyeccion = this.clampPositive(Number(config.profundidadProyeccion), 0.08, 0.01, 1000);
    objeto.metadata.anguloProyeccion = Number(config.anguloProyeccion);
    objeto.metadata.proyeccionAncho = this.clampPositive(Number(config.proyeccionAncho), 1, 0.01, 1000);
    objeto.metadata.proyeccionAlto = this.clampPositive(Number(config.proyeccionAlto), 1, 0.01, 1000);
    objeto.metadata.proyeccionRepeticiones = Math.floor(this.clampPositive(Number(config.proyeccionRepeticiones), 1, 1, 50));
    objeto.metadata.proyeccionEspaciado = Number(config.proyeccionEspaciado);
    objeto.metadata.proyeccionEje = config.proyeccionEje;
    objeto.metadata.fadeDistance = Math.max(0, Number(config.fadeDistance));

    if (objeto.metadata.updateDecal) objeto.metadata.updateDecal();
    this.editorSvc.triggerUpdate();
  }

  public aplicarVisuales(objeto: AbstractMesh, config: any): void {
    if (!objeto.metadata) objeto.metadata = {};

    objeto.metadata.color = config.color;
    objeto.metadata.colorBW = config.colorBW;
    objeto.metadata.ignoraNiebla = config.ignoraNiebla;
    objeto.metadata.esEmisivo = config.esEmisivo;
    objeto.metadata.brilloIntensidad = this.clampBrightness(config.brilloIntensidad);

    const isBW = this.motor3dSvc.scene.metadata?.globalVisualMode === 'bw';
    const activeColorHex = isBW ? config.colorBW : config.color;

    if (objeto.material && objeto.material instanceof StandardMaterial) {
      if (objeto.metadata.type === 'image_plane') {
        const decalMat = objeto.metadata.decalMaterial as StandardMaterial;
        if (decalMat) {
          const tex = (decalMat.diffuseTexture || decalMat.opacityTexture) as any;
          this.aplicarMaterialHolograma(decalMat, activeColorHex, config.brilloIntensidad, config.ignoraNiebla, tex);
        }
        if (Array.isArray(objeto.metadata.decalMeshes)) {
          // SE CORRIGIÓ AQUÍ DECLARANDO EL TIPO (m: AbstractMesh)
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
    // SE CORRIGIÓ AQUÍ DECLARANDO EL TIPO (m: AbstractMesh)
    objeto.getChildMeshes().forEach((m: AbstractMesh) => m.applyFog = !config.ignoraNiebla);
    this.editorSvc.triggerUpdate();
  }

  public aplicarInteraccion(objeto: AbstractMesh, config: any): void {
    if (!objeto.metadata) objeto.metadata = {};
    objeto.metadata.interactDistanceFPS = config.interactDistanceFPS;
    objeto.metadata.interactDistanceTPS = config.interactDistanceTPS;
    objeto.metadata.interactSequenceIdFPS = config.interactSequenceIdFPS.trim();
    objeto.metadata.interactSequenceIdTPS = config.interactSequenceIdTPS.trim();
    objeto.metadata.mensaje = config.mensaje.trim();
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