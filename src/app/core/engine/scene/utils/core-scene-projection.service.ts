
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Color3, Engine, Mesh, MeshBuilder, Ray, Scene, StandardMaterial, Texture, Vector3, Tags } from '@babylonjs/core';
import { LoopManagerService, GamePhase } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class CoreSceneProjectionService {
  private loopManager = inject(LoopManagerService);
  private entityManager = inject(EntityManagerService);

  public clampNum(v: number, min: number, max: number, fallback = min): number {
    if (Number.isNaN(v) || v === null || v === undefined) return fallback;
    return Math.max(min, Math.min(max, Number(v)));
  }

  private isFunc(value: any, methodName: string): boolean {
    return !!value && typeof value[methodName] === 'function';
  }

  private isDisposedSeguro(value: any): boolean {
    try {
      if (!value) return true;
      if (this.isFunc(value, 'isDisposed')) {
        return value.isDisposed();
      }
      return false;
    } catch {
      return true;
    }
  }

  private disposeSeguro(value: any): void {
    try {
      if (!value) return;
      if (this.isFunc(value, 'dispose')) {
        value.dispose();
      }
    } catch (error) {
      console.warn('[CoreSceneProjectionService] Error al disponer recurso:', error);
    }
  }

  public configurarMaterialProyector(
    mat: StandardMaterial,
    colorHex: string,
    brilloIntensidad: number,
    ignoraNiebla: boolean,
    texture?: Texture | null
  ): void {
    const colorSeguro = colorHex || '#ffffff';
    const c3 = Color3.FromHexString(colorSeguro);
    const brillo = this.clampNum(Number(brilloIntensidad), 0, 10, 1.0);

    mat.disableLighting = true;
    mat.diffuseColor = c3;
    mat.ambientColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    mat.alphaMode = Engine.ALPHA_COMBINE;
    mat.fogEnabled = !ignoraNiebla;
    mat.zOffset = -10;

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

  public limpiarDecalsImagen(mesh: Mesh): void {
    const entity = this.entityManager.getEntityByMesh(mesh);
    if (!entity || !entity.media) return;

    if (Array.isArray(entity.media.runtimeDecals)) {
      entity.media.runtimeDecals.forEach((d: AbstractMesh) => {
        if (d && !this.isDisposedSeguro(d)) {
          this.disposeSeguro(d);
        }
      });
    }

    entity.media.runtimeDecals = [];
  }

  public actualizarProyeccion(mesh: Mesh): void {
    this.limpiarDecalsImagen(mesh);

    const entity = this.entityManager.getEntityByMesh(mesh);
    if (!entity || !entity.media) return;

    const scene = mesh.getScene();

    try {
      const isNowBW = scene.metadata?.globalVisualMode === 'bw';
      const colorReal = isNowBW ? entity.visual.colorBW : entity.visual.color;
      
      const decalMat = entity.media.runtimeDecalMaterial;
      const decalTexture = decalMat?.diffuseTexture ?? null;

      if (!decalMat) return;

      this.configurarMaterialProyector(
        decalMat,
        colorReal,
        entity.visual.brilloIntensidad,
        entity.visual.ignoraNiebla,
        decalTexture instanceof Texture ? decalTexture : undefined
      );

      mesh.computeWorldMatrix(true);
      const origin = mesh.getAbsolutePosition();
      const direction = mesh.forward;

      const ray = new Ray(origin, direction, 500);

      const hit = scene.pickWithRay(ray, (m) => {
        if (!m.isPickable || !m.isVisible) return false;
        if (m === mesh) return false;

        if (Tags.MatchesQuery(m, "system_element || fog_element || debug_element || editor_only || invisible_floor")) return false;

        const targetEntity = this.entityManager.getEntityByMesh(m);
        if (targetEntity?.type === 'trigger' || targetEntity?.type === 'trigger_compuesto') return false;
        if (targetEntity?.type === 'image_plane' || targetEntity?.type === 'bubble') return false;

        return true;
      });

      if (hit && hit.hit && hit.pickedMesh && hit.pickedPoint) {
        const targetMesh = hit.pickedMesh as Mesh;

        const ancho = this.clampNum(Number(entity.media.proyeccionAncho ?? 2), 0.05, 9999);
        const alto = this.clampNum(Number(entity.media.proyeccionAlto ?? 2), 0.05, 9999);
        const prof = this.clampNum(Number(entity.media.profundidadProyeccion ?? 10), 0.01, 9999);

        let angulo = Number(entity.media.anguloProyeccion ?? 0) * (Math.PI / 180);
        if (mesh.rotationQuaternion) {
          angulo += mesh.rotationQuaternion.toEulerAngles().z;
        } else {
          angulo += mesh.rotation.z;
        }

        const normal = direction.scale(-1).normalize();
        const decalSize = new Vector3(ancho, alto, prof);

        const repeticiones = Math.floor(this.clampNum(Number(entity.media.proyeccionRepeticiones ?? 1), 1, 50));
        const espaciado = Number(entity.media.proyeccionEspaciado ?? 2);
        const ejeRepeticion = entity.media.proyeccionEje === 'X' ? mesh.right : mesh.up;

        const totalDist = (repeticiones - 1) * espaciado;
        const centerDecalPos = hit.pickedPoint.add(direction.scale(prof * 0.5));
        const startPos = centerDecalPos.subtract(ejeRepeticion.scale(totalDist * 0.5));

        entity.media.runtimeDecals = [];

        for (let i = 0; i < repeticiones; i++) {
          const currentDecalPos = startPos.add(ejeRepeticion.scale(i * espaciado));

          const decal = MeshBuilder.CreateDecal('decal_' + mesh.name + '_' + i, targetMesh, {
            position: currentDecalPos,
            normal: normal,
            size: decalSize,
            angle: angulo
          });

          decal.material = decalMat;
          decal.setParent(targetMesh);
          decal.isPickable = false;
          decal.receiveShadows = false;
          decal.applyFog = !entity.visual.ignoraNiebla;
          decal.alwaysSelectAsActiveMesh = true;
          Tags.AddTagsTo(decal, "decal system_element ignore_raycast");

          entity.media.runtimeDecals.push(decal);
        }
      }
    } catch (e) {
      console.warn('Error proyectando imagen con raycast:', e);
    }
  }

  public aplicarLogicaHolograma(mesh: Mesh, scene: Scene): void {
    const callbackId = 'HologramaFade_' + mesh.uniqueId;

    this.loopManager.register(callbackId, GamePhase.POST_UPDATE, () => {
      if (!mesh || mesh.isDisposed?.()) return;

      const entity = this.entityManager.getEntityByMesh(mesh);
      if (!entity || !entity.media) return;

      const currentModeIsBW = scene.metadata?.globalVisualMode === 'bw';
      if (entity.media.lastVisualModeBW !== currentModeIsBW) {
        entity.media.lastVisualModeBW = currentModeIsBW;
        this.actualizarProyeccion(mesh);
      }

      let fadeDist = Number(entity.media.fadeDistance ?? 0);
      let isUsingFogFallback = false;

      if (fadeDist <= 0 && !entity.visual.ignoraNiebla) {
          const targetPlayer = scene.meshes.find(m => {
              const ent = this.entityManager.getEntityByMesh(m);
              return ent?.rol === 'spawn_point' || ent?.rol === 'npc';
          });
          const targetEntity = this.entityManager.getEntityByMesh(targetPlayer);

          if (targetEntity && targetEntity.playerConfig?.fog?.enabled) {
              const fog = targetEntity.playerConfig.fog;
              const isFPS = scene.activeCamera?.name === 'playerCameraFPS';
              const maxZ = currentModeIsBW 
                  ? (isFPS ? fog.renderDistanceFpsBW : fog.renderDistanceTpsBW)
                  : (isFPS ? fog.renderDistanceFPS : fog.renderDistanceTPS);
              
              if (maxZ && maxZ > 0) {
                 fadeDist = maxZ * 0.85; 
                 isUsingFogFallback = true;
              }
          }
      }

      if (fadeDist > 0 && scene.activeCamera) {
        const distanceToCam = Vector3.Distance(scene.activeCamera.globalPosition, mesh.getAbsolutePosition());
        const fadeStart = isUsingFogFallback ? (fadeDist * 0.7) : (fadeDist * 0.5); 

        let alphaMultiplier = 1.0;

        if (distanceToCam >= fadeDist) {
          alphaMultiplier = 0.0;
        } else if (distanceToCam > fadeStart) {
          let progress = (distanceToCam - fadeStart) / (fadeDist - fadeStart);
          progress = progress * progress * (3 - 2 * progress); 
          alphaMultiplier = Math.max(0, Math.min(1.0, 1.0 - progress));
        }

        if (entity.media.runtimeDecalMaterial) {
          const dMat = entity.media.runtimeDecalMaterial as StandardMaterial;
          const hasTexture = dMat.diffuseTexture != null;
          const brilloBase = Number(entity.visual.brilloIntensidad ?? 1.0);

          const baseAlpha = hasTexture ? 1.0 : Math.max(0.2, Math.min(1.0, brilloBase * 0.5));

          dMat.alpha = baseAlpha * alphaMultiplier;
          const colorReal = currentModeIsBW ? entity.visual.colorBW : entity.visual.color;
          dMat.emissiveColor = Color3.FromHexString(colorReal || '#ffffff').scale(brilloBase * alphaMultiplier);
        }

        if (Array.isArray(entity.media.runtimeDecals)) {
          entity.media.runtimeDecals.forEach((decal: AbstractMesh) => {
            if (decal && !this.isDisposedSeguro(decal)) {
              decal.visibility = alphaMultiplier > 0.01 ? 1 : 0;
              decal.alwaysSelectAsActiveMesh = true;
            }
          });
        }
      }
      else if (fadeDist <= 0) {
        if (entity.media.runtimeDecalMaterial) {
          const dMat = entity.media.runtimeDecalMaterial as StandardMaterial;
          const hasTexture = dMat.diffuseTexture != null;
          const brilloBase = Number(entity.visual.brilloIntensidad ?? 1.0);
          dMat.alpha = hasTexture ? 1.0 : Math.max(0.2, Math.min(1.0, brilloBase * 0.5));

          const colorReal = currentModeIsBW ? entity.visual.colorBW : entity.visual.color;
          dMat.emissiveColor = Color3.FromHexString(colorReal || '#ffffff').scale(brilloBase);
        }
        if (Array.isArray(entity.media.runtimeDecals)) {
          entity.media.runtimeDecals.forEach((decal: AbstractMesh) => {
            if (decal && !this.isDisposedSeguro(decal)) {
              decal.visibility = 1.0;
              decal.alwaysSelectAsActiveMesh = true;
            }
          });
        }
      }
    });

    mesh.onDisposeObservable.add(() => {
      this.loopManager.unregister(callbackId);
      this.limpiarDecalsImagen(mesh);

      const entity = this.entityManager.getEntityByMesh(mesh);
      const decalMaterial = entity?.media?.runtimeDecalMaterial;
      if (decalMaterial && !this.isDisposedSeguro(decalMaterial)) {
        this.disposeSeguro(decalMaterial);
      }
      
      if (entity?.media) {
        entity.media.runtimeDecalMaterial = undefined;
      }
    });

    setTimeout(() => {
      this.actualizarProyeccion(mesh);
    }, 150);
  }
}