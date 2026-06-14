import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { EpisodiosService } from '../api/episodios';
import { SceneSaverService } from './sceneservice/scene-saver.service';

@Injectable({ providedIn: 'root' })
export class PrefabManagerService {
  private api = inject(EpisodiosService);
  private saverSvc = inject(SceneSaverService);

  /**
   * Toma un objeto de la escena, extrae toda su metadata (PlayerConfig, Sequences, Físicas)
   * y lo guarda en la Base de Datos como un PREFAB reutilizable.
   */
  public createPrefabFromMesh(mesh: AbstractMesh, prefabName: string): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!mesh || !mesh.metadata) {
        reject('El objeto no tiene metadata válida para ser un Prefab.');
        return;
      }

      // Usamos tu servicio de guardado actual para extraer las propiedades exactas
      // Le pasamos un rango falso porque solo necesitamos el objeto crudo.
      const properties = (this.saverSvc as any).buildCommonProperties(mesh, { fpsAdminMax: 10000, fpsUserMax: 3 });

      const data = {
        name: prefabName,
        type: mesh.metadata.type || 'model',
        assetId: mesh.metadata.assetId || null,
        properties: properties
      };

      this.api.crearPrefab(data).subscribe({
        next: (res) => resolve(res),
        error: (err) => reject(err)
      });
    });
  }
}