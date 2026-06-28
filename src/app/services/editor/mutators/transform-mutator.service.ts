
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Engine, StandardMaterial, Texture, Vector3, Quaternion, Mesh } from '@babylonjs/core';
import { EditorMapaService } from '../../editor-mapa.service';
import { HistorialService } from '../../historial.service';
import { CoreSceneProjectionService } from '../../../core/engine/scene/utils/core-scene-projection.service';
import { EntityManagerService } from '../../../core/engine/entities/entity-manager.service';
import { WorldSettingsService } from '../../../core/engine/world/world-settings.service';

@Injectable({ providedIn: 'root' })
export class TransformMutatorService {
  private editorSvc = inject(EditorMapaService);
  private historialSvc = inject(HistorialService);
  private projectionSvc = inject(CoreSceneProjectionService);
  private entityManager = inject(EntityManagerService); 
  private worldSettingsSvc = inject(WorldSettingsService);

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
        entity.isDirty = true;
        entity.syncToView();
      } else {
        objeto.rotationQuaternion = Quaternion.FromEulerAngles(rx, ry, rz);
        objeto.rotation.set(0, 0, 0);
      }
    });

    if (entity && entity.type === 'image_plane') {
       this.projectionSvc.actualizarProyeccion(objeto as Mesh);
    }
    this.editorSvc.triggerUpdate();
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
    this.editorSvc.triggerUpdate();
  }

  public aplicarProyeccion(objeto: AbstractMesh, config: any): void {
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
    
    // 🔥 GUARDADO: Registramos explícitamente en el componente Visual los cambios
    if (config.mostrarBorde !== undefined) {
       entity.visual.mostrarBorde = config.mostrarBorde;
    }
    
    if (config.isSelectable !== undefined) {
       entity.visual.isSelectable = config.isSelectable;
       objeto.isPickable = config.isSelectable;
       // Permite que la selección por raycast rebote correctamente en sus hijos
       objeto.getChildMeshes().forEach((m: AbstractMesh) => m.isPickable = config.isSelectable);
    }

    entity.isDirty = true;
    entity.syncToView();

    const isBW = this.worldSettingsSvc.settings().visualMode === 'bw';
    const activeColorHex = isBW ? config.colorBW : config.color;

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

    if (entity.type.startsWith('light_') && entity.light) {
        const activeLightColorHex = isBW ? entity.light.lightColorBW : entity.light.lightColor;
        const c3Light = Color3.FromHexString(activeLightColorHex || '#ffffff');
        
        if (objeto.material && (objeto.material as any).emissiveColor) {
            (objeto.material as StandardMaterial).emissiveColor = c3Light;
        }
        const lightObj = objeto.getDescendants(false).find(c => c.name.startsWith('l_')) as any;
        if (lightObj && lightObj.diffuse) {
            lightObj.diffuse = c3Light;
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
    
    entity.isDirty = true;
    entity.syncToView();
    this.editorSvc.triggerUpdate();
  }

  public forzarRecalculoProyeccion(objeto: AbstractMesh): void {
    if (objeto) {
      const entity = this.entityManager.getEntityByMesh(objeto);
      if (entity && entity.type === 'image_plane') {
         this.projectionSvc.actualizarProyeccion(objeto as Mesh);
         this.editorSvc.triggerUpdate();
      }
    }
  }

  private clampBrightness(v: number): number {
    if (Number.isNaN(v) || v === null || v === undefined) return 1.0;
    return Math.max(0, Math.min(10, Number(v)));
  }
}