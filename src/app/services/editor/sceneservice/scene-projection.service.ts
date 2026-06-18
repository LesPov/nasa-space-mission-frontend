
import { Injectable, inject } from '@angular/core';
import { Color3, Engine, Mesh, MeshBuilder, Ray, Scene, StandardMaterial, Texture, Vector3 } from '@babylonjs/core';
import { LoopManagerService, GamePhase } from '../../../core/engine/behaviors/services/loop-manager.service';
 
@Injectable({ providedIn: 'root' })
export class SceneProjectionService {
  private loopManager = inject(LoopManagerService);

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
      console.warn('[SceneProjectionService] Error al disponer recurso:', error);
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
    const meta: any = mesh.metadata || {};

    if (Array.isArray(meta.decalMeshes)) {
      meta.decalMeshes.forEach((d: Mesh | null) => {
        if (d && !this.isDisposedSeguro(d)) {
          this.disposeSeguro(d);
        }
      });
    }

    if (meta.decalMesh && !this.isDisposedSeguro(meta.decalMesh)) {
      this.disposeSeguro(meta.decalMesh);
    }

    meta.decalMeshes = [];
    meta.decalMesh = null;
    mesh.metadata = meta;
  }

  public aplicarLogicaHolograma(mesh: Mesh, scene: Scene): void {
    if (!mesh.metadata) mesh.metadata = {};

    const callbackId = 'HologramaFade_' + mesh.uniqueId;

    // 🔥 FASE 2: MIGRACIÓN AL LOOP MANAGER
    this.loopManager.register(callbackId, GamePhase.POST_UPDATE, () => {
      if (!mesh || mesh.isDisposed?.()) return;

      const currentModeIsBW = scene.metadata?.globalVisualMode === 'bw';
      if (mesh.metadata._lastVisualMode !== currentModeIsBW) {
        mesh.metadata._lastVisualMode = currentModeIsBW;
        if (mesh.metadata.updateDecal) mesh.metadata.updateDecal();
      }

      // Vemos si este holograma tiene un Fade explícito configurado
      let fadeDist = Number(mesh.metadata.fadeDistance ?? 0);
      let isUsingFogFallback = false;

      // 🔥 LÓGICA VITAL: Si el objeto NO ignora niebla y su Fade está en 0, 
      // leemos el FOG del jugador para atenuar este panel simulando que la niebla lo oculta.
      if (fadeDist <= 0 && !mesh.metadata.ignoraNiebla) {
          const targetPlayer = scene.meshes.find(m => m.metadata?.rol === 'spawn_point' || m.metadata?.rol === 'npc');
          if (targetPlayer && targetPlayer.metadata?.playerConfig?.fog?.enabled) {
              // Obtenemos la distancia de renderizado de la niebla base
              const fog = targetPlayer.metadata.playerConfig.fog;
              const isFPS = scene.activeCamera?.name === 'playerCameraFPS';
              const maxZ = currentModeIsBW 
                  ? (isFPS ? fog.renderDistanceFpsBW : fog.renderDistanceTpsBW)
                  : (isFPS ? fog.renderDistanceFPS : fog.renderDistanceTPS);
              
              if (maxZ && maxZ > 0) {
                 // Si el objeto está en la mitad del abismo del fog, empieza a desaparecer
                 fadeDist = maxZ * 0.85; 
                 isUsingFogFallback = true;
              }
          }
      }

      if (fadeDist > 0 && scene.activeCamera) {
        const distanceToCam = Vector3.Distance(scene.activeCamera.globalPosition, mesh.getAbsolutePosition());
        const fadeStart = isUsingFogFallback ? (fadeDist * 0.7) : (fadeDist * 0.5); // Si es por niebla, aguanta más brillando

        let alphaMultiplier = 1.0;

        if (distanceToCam >= fadeDist) {
          alphaMultiplier = 0.0;
        } else if (distanceToCam > fadeStart) {
          let progress = (distanceToCam - fadeStart) / (fadeDist - fadeStart);
          progress = progress * progress * (3 - 2 * progress); // Smoothstep
          alphaMultiplier = Math.max(0, Math.min(1.0, 1.0 - progress));
        }

        if (mesh.metadata.decalMaterial) {
          const dMat = mesh.metadata.decalMaterial as StandardMaterial;
          const hasTexture = dMat.diffuseTexture != null;
          const brilloBase = Number(mesh.metadata.brilloIntensidad ?? 1.0);

          const baseAlpha = hasTexture ? 1.0 : Math.max(0.2, Math.min(1.0, brilloBase * 0.5));

          dMat.alpha = baseAlpha * alphaMultiplier;
          const colorReal = currentModeIsBW ? mesh.metadata.colorBW : mesh.metadata.color;
          dMat.emissiveColor = Color3.FromHexString(colorReal || '#ffffff').scale(brilloBase * alphaMultiplier);
        }

        if (Array.isArray(mesh.metadata.decalMeshes)) {
          mesh.metadata.decalMeshes.forEach((decal: Mesh) => {
            if (decal && !this.isDisposedSeguro(decal)) {
              decal.visibility = alphaMultiplier > 0.01 ? 1 : 0;
              decal.alwaysSelectAsActiveMesh = true;
            }
          });
        }
      }
      else if (fadeDist <= 0) {
        if (mesh.metadata.decalMaterial) {
          const dMat = mesh.metadata.decalMaterial as StandardMaterial;
          const hasTexture = dMat.diffuseTexture != null;
          const brilloBase = Number(mesh.metadata.brilloIntensidad ?? 1.0);
          dMat.alpha = hasTexture ? 1.0 : Math.max(0.2, Math.min(1.0, brilloBase * 0.5));

          const colorReal = currentModeIsBW ? mesh.metadata.colorBW : mesh.metadata.color;
          dMat.emissiveColor = Color3.FromHexString(colorReal || '#ffffff').scale(brilloBase);
        }
        if (Array.isArray(mesh.metadata.decalMeshes)) {
          mesh.metadata.decalMeshes.forEach((decal: Mesh) => {
            if (decal && !this.isDisposedSeguro(decal)) {
              decal.visibility = 1.0;
              decal.alwaysSelectAsActiveMesh = true;
            }
          });
        }
      }
    });

    // 🔥 LOGICA DEL RAYCAST Y CREACIÓN DE PATRONES (Muro / Decals)
    mesh.metadata.updateDecal = () => {
      this.limpiarDecalsImagen(mesh);

      try {
        const isNowBW = scene.metadata?.globalVisualMode === 'bw';
        const colorReal = isNowBW ? mesh.metadata.colorBW : mesh.metadata.color;
        const decalMat = mesh.metadata.decalMaterial as StandardMaterial | null | undefined;
        const decalTexture = decalMat?.diffuseTexture ?? null;

        if (!decalMat) {
          return;
        }

        this.configurarMaterialProyector(
          decalMat,
          colorReal,
          mesh.metadata.brilloIntensidad,
          mesh.metadata.ignoraNiebla,
          decalTexture instanceof Texture ? decalTexture : undefined
        );

        mesh.computeWorldMatrix(true);
        const origin = mesh.getAbsolutePosition();
        const direction = mesh.forward;

        const ray = new Ray(origin, direction, 500);

        const hit = scene.pickWithRay(ray, (m) => {
          if (!m.isPickable || !m.isVisible) return false;
          if (m === mesh) return false;

          const n = m.name.toLowerCase();
          if (n.includes('trigger') || m.metadata?.type === 'trigger') return false;
          if (n.includes('proxycol') || n.includes('gizmo') || n.includes('debug')) return false;
          if (m.metadata?.type === 'image_plane' || m.metadata?.type === 'bubble') return false;
          if (['ejex', 'ejey', 'ejez', 'gridhelper', 'sueloinvisible'].includes(n)) return false;

          return true;
        });

        if (hit && hit.hit && hit.pickedMesh && hit.pickedPoint) {
          const targetMesh = hit.pickedMesh as Mesh;

          const ancho = this.clampNum(Number(mesh.metadata.proyeccionAncho ?? 2), 0.05, 9999);
          const alto = this.clampNum(Number(mesh.metadata.proyeccionAlto ?? 2), 0.05, 9999);
          const prof = this.clampNum(Number(mesh.metadata.profundidadProyeccion ?? 10), 0.01, 9999);

          let angulo = Number(mesh.metadata.anguloProyeccion ?? 0) * (Math.PI / 180);
          if (mesh.rotationQuaternion) {
            angulo += mesh.rotationQuaternion.toEulerAngles().z;
          } else {
            angulo += mesh.rotation.z;
          }

          const normal = direction.scale(-1).normalize();
          const decalSize = new Vector3(ancho, alto, prof);

          const repeticiones = Math.floor(this.clampNum(Number(mesh.metadata.proyeccionRepeticiones ?? 1), 1, 50));
          const espaciado = Number(mesh.metadata.proyeccionEspaciado ?? 2);
          const ejeRepeticion = mesh.metadata.proyeccionEje === 'X' ? mesh.right : mesh.up;

          const totalDist = (repeticiones - 1) * espaciado;
          const centerDecalPos = hit.pickedPoint.add(direction.scale(prof * 0.5));
          const startPos = centerDecalPos.subtract(ejeRepeticion.scale(totalDist * 0.5));

          mesh.metadata.decalMeshes = [];

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
            decal.applyFog = !mesh.metadata.ignoraNiebla;
            decal.alwaysSelectAsActiveMesh = true;

            mesh.metadata.decalMeshes.push(decal);
          }
        }
      } catch (e) {
        console.warn('Error proyectando imagen con raycast:', e);
      }
    };

    // Limpieza de memoria al destruir el objeto base
    mesh.onDisposeObservable.add(() => {
      this.loopManager.unregister(callbackId);
      this.limpiarDecalsImagen(mesh);

      const decalMaterial = mesh.metadata?.decalMaterial;
      if (decalMaterial && !this.isDisposedSeguro(decalMaterial)) {
        this.disposeSeguro(decalMaterial);
      }

      if (mesh.metadata) {
        mesh.metadata.decalMaterial = null;
        mesh.metadata.decalMeshes = [];
        mesh.metadata.decalMesh = null;
      }
    });

    // Disparo inicial diferido para asegurar que la escena se actualice
    setTimeout(() => {
      if (mesh.metadata?.updateDecal) mesh.metadata.updateDecal();
    }, 150);
  }
}