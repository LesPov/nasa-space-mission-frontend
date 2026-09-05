
import { Injectable } from '@angular/core';
import { CinematicCameraDefinition } from '../../models/cinematic-camera.model';

@Injectable({ providedIn: 'root' })
export class CinematicCameraRegistryService {
  private cameras = new Map<string, CinematicCameraDefinition>();
  public deletedCameras: string[] = [];

  createCamera(name: string): CinematicCameraDefinition {
    return {
      id: 'cam_' + Math.random().toString(36).substring(2, 8),
      name,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      fov: 0.8
    };
  }

  registerCamera(cam: CinematicCameraDefinition): void {
    this.cameras.set(cam.id, cam);
  }

  getCamera(id: string): CinematicCameraDefinition | undefined {
    return this.cameras.get(id);
  }

  listCameras(): CinematicCameraDefinition[] {
    return Array.from(this.cameras.values());
  }

  deleteCamera(id: string): void {
    if (this.cameras.has(id)) {
      this.deletedCameras.push(id);
      this.cameras.delete(id);
    }
  }
  
  loadFromData(data: CinematicCameraDefinition[]): void {
    this.cameras.clear();
    this.deletedCameras = [];
    data.forEach(c => this.cameras.set(c.id, c));
  }
}
