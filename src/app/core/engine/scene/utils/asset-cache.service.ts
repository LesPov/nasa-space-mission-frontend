import { Injectable } from '@angular/core';
import { AssetContainer, Scene } from '@babylonjs/core';

interface CacheEntry {
  container: AssetContainer;
  scene: Scene;
}

@Injectable({ providedIn: 'root' })
export class AssetCacheService {
  private cache = new Map<string, CacheEntry>();

  public get(fullPath: string, scene: Scene): AssetContainer | null {
    const entry = this.cache.get(fullPath);
    if (!entry) return null;

    // Si la escena fue descartada o no coincide con la actual, el contenedor ya no es utilizable
    if (entry.scene !== scene || entry.scene.isDisposed) {
      this.cache.delete(fullPath);
      return null;
    }

    return entry.container;
  }

  public set(fullPath: string, container: AssetContainer): void {
    const scene = container.scene;
    this.cache.set(fullPath, { container, scene });
  }

  public purgeInvalidContainers(currentScene: Scene): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.scene !== currentScene || entry.scene.isDisposed) {
        try {
          entry.container.dispose();
        } catch {
          // Ignorar errores si la escena ya limpió los recursos
        }
        this.cache.delete(key);
      }
    }
  }

  public clear(): void {
    for (const [, entry] of this.cache.entries()) {
      try {
        entry.container.dispose();
      } catch {
        // Ignorar
      }
    }
    this.cache.clear();
  }
}