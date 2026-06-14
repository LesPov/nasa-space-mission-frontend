import { Injectable } from '@angular/core';
import { Color3, Engine, Mesh, MeshBuilder, Ray, Scene, StandardMaterial, Texture, Vector3 } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class SceneProjectionService {

  public clampNum(v: number, min: number, max: number, fallback = min): number {
    if (Number.isNaN(v) || v === null || v === undefined) return fallback;
    return Math.max(min, Math.min(max, Number(v)));
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
        if (d && !d.isDisposed()) d.dispose();
      });
    }

    if (meta.decalMesh && !meta.decalMesh.isDisposed()) {
      meta.decalMesh.dispose();
    }

    meta.decalMeshes = [];
    meta.decalMesh = null;
    mesh.metadata = meta;
  }

  public aplicarLogicaHolograma(mesh: Mesh, scene: Scene): void {
    // 🔥 OBSERVADOR CINEMÁTICO DE DESVANECIMIENTO (SMOOTHSTEP FADE)
    const fadeObserver = scene.onBeforeRenderObservable.add(() => {
      const currentModeIsBW = scene.metadata?.globalVisualMode === 'bw';
      if (mesh.metadata._lastVisualMode !== currentModeIsBW) {
        mesh.metadata._lastVisualMode = currentModeIsBW;
        if (mesh.metadata.updateDecal) mesh.metadata.updateDecal();
      }

      const fadeDist = Number(mesh.metadata.fadeDistance ?? 0);
      
      if (fadeDist > 0 && scene.activeCamera) {
        const distanceToCam = Vector3.Distance(scene.activeCamera.globalPosition, mesh.getAbsolutePosition());
        const fadeStart = fadeDist * 0.5; // Empieza a desvanecer exactamente a la mitad (50%)
        
        let alphaMultiplier = 1.0;
        
        if (distanceToCam >= fadeDist) {
          alphaMultiplier = 0.0; 
        } else if (distanceToCam > fadeStart) {
          // 🔥 CURVA SMOOTHSTEP: Aceleración y desaceleración cinematográfica para el fade
          let progress = (distanceToCam - fadeStart) / (fadeDist - fadeStart);
          progress = progress * progress * (3 - 2 * progress); 
          alphaMultiplier = Math.max(0, Math.min(1.0, 1.0 - progress));
        }

        if (mesh.metadata.decalMaterial) {
          const dMat = mesh.metadata.decalMaterial as StandardMaterial;
          const hasTexture = dMat.diffuseTexture != null;
          const brilloBase = Number(mesh.metadata.brilloIntensidad ?? 1.0);
          
          const baseAlpha = hasTexture ? 1.0 : Math.max(0.2, Math.min(1.0, brilloBase * 0.5));
          
          // 🔥 FIX: Reducimos tanto la transparencia como la energía de luz (emissive)
          dMat.alpha = baseAlpha * alphaMultiplier;
          const colorReal = currentModeIsBW ? mesh.metadata.colorBW : mesh.metadata.color;
          dMat.emissiveColor = Color3.FromHexString(colorReal || '#ffffff').scale(brilloBase * alphaMultiplier);
        }

        if (Array.isArray(mesh.metadata.decalMeshes)) {
          mesh.metadata.decalMeshes.forEach((decal: Mesh) => {
            if (decal && !decal.isDisposed()) {
              decal.visibility = alphaMultiplier > 0 ? 1 : 0;
              decal.alwaysSelectAsActiveMesh = true;
            }
          });
        }
      } 
      else if (fadeDist <= 0) {
        // Restaurar estado si el fade está desactivado (distancia 0)
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
            if (decal && !decal.isDisposed()) {
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
        const decalTexture = (mesh.metadata.decalMaterial as StandardMaterial).diffuseTexture;
        
        this.configurarMaterialProyector(
          mesh.metadata.decalMaterial,
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

            decal.material = mesh.metadata.decalMaterial;
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
      scene.onBeforeRenderObservable.remove(fadeObserver);
      this.limpiarDecalsImagen(mesh);
      if (mesh.metadata.decalMaterial && !mesh.metadata.decalMaterial.isDisposed()) {
        mesh.metadata.decalMaterial.dispose();
      }
    });

    // Disparo inicial diferido para asegurar que la escena se actualice
    setTimeout(() => {
      if (mesh.metadata.updateDecal) mesh.metadata.updateDecal();
    }, 150);
  }
}