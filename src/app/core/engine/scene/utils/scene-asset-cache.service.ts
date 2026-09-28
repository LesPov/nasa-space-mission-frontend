import { Injectable } from '@angular/core';
import { AssetContainer, Scene, SceneLoader } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class SceneAssetCacheService {
  private blobCache = new Map<string, Blob>();
  private pendingRequests = new Map<string, Promise<Blob>>();
  
  public async getFreshAssetContainer(fullPath: string, scene: Scene, extension: string = '.glb'): Promise<AssetContainer> {
    let blob: Blob;

    if (this.blobCache.has(fullPath)) {
      blob = this.blobCache.get(fullPath)!;
    } else if (this.pendingRequests.has(fullPath)) {
      blob = await this.pendingRequests.get(fullPath)!;
    } else {
      const request = fetch(fullPath).then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.blob();
      });
      this.pendingRequests.set(fullPath, request);
      
      try {
        blob = await request;
        this.blobCache.set(fullPath, blob);
      } finally {
        this.pendingRequests.delete(fullPath);
      }
    }

    const file = new File([blob], "asset" + extension);
    const container = await SceneLoader.LoadAssetContainerAsync("file:", file, scene);
    return container;
  }

  public clearAllCache(): void {
    this.blobCache.clear();
    this.pendingRequests.clear();
  }
}