
import { Injectable } from '@angular/core';
import { Light, AbstractMesh } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class ShadowCache {
  private staticHashes = new Map<string, string>();
  private lightHashes = new Map<string, string>();

  public getMeshHash(mesh: AbstractMesh): string {
    const pos = mesh.getAbsolutePosition();
    const rot = mesh.rotationQuaternion || mesh.rotation;
    const scl = mesh.scaling;
    return `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}|${rot.x.toFixed(2)},${rot.y.toFixed(2)},${rot.z.toFixed(2)}|${scl.x.toFixed(2)},${scl.y.toFixed(2)},${scl.z.toFixed(2)}`;
  }

  public getLightHash(light: Light): string {
    const pos = (light as any).position ? (light as any).position : (light as any).direction;
    return pos ? `${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}` : 'static';
  }

  public hasMeshChanged(meshId: string, currentHash: string): boolean {
    const oldHash = this.staticHashes.get(meshId);
    if (oldHash !== currentHash) {
      this.staticHashes.set(meshId, currentHash);
      return true;
    }
    return false;
  }

  public hasLightChanged(lightId: string, currentHash: string): boolean {
    const oldHash = this.lightHashes.get(lightId);
    if (oldHash !== currentHash) {
      this.lightHashes.set(lightId, currentHash);
      return true;
    }
    return false;
  }

  public invalidate(id: string): void {
    this.staticHashes.delete(id);
    this.lightHashes.delete(id);
  }

  public clear(): void {
    this.staticHashes.clear();
    this.lightHashes.clear();
  }
}