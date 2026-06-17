import { Injectable, inject } from '@angular/core';
import { AbstractMesh } from '@babylonjs/core';
import { EpisodiosService } from '../api/episodios';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class PrefabManagerService {
  private api = inject(EpisodiosService);
  private entityManager = inject(EntityManagerService);

  /**
   * Toma un objeto de la escena, extrae toda su metadata (PlayerConfig, Sequences, Físicas)
   * y lo guarda en la Base de Datos como un PREFAB reutilizable.
   */
  public createPrefabFromMesh(mesh: AbstractMesh, prefabName: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const entity = this.entityManager.getEntityByMesh(mesh);
      
      if (!entity) {
        reject('El objeto no tiene una entidad válida para ser un Prefab.');
        return;
      }

      entity.syncTransformFromView();

      const propertiesToSave = {
        color: entity.visual.color,
        colorBW: entity.visual.colorBW,
        rol: entity.rol,
        isSolid: entity.visual.isSolid,
        isSelectable: entity.visual.isSelectable,
        ignoraNiebla: entity.visual.ignoraNiebla,
        esEmisivo: entity.visual.esEmisivo,
        brilloIntensidad: entity.visual.brilloIntensidad,
        mensaje: entity.interaction.mensaje,
        interactDistanceFPS: entity.interaction.interactDistanceFPS,
        interactDistanceTPS: entity.interaction.interactDistanceTPS,
        interactSequenceIdFPS: entity.interaction.interactSequenceIdFPS,
        interactSequenceIdTPS: entity.interaction.interactSequenceIdTPS,
        collider: entity.collider,
        camOffset: entity.camOffset,
        playerConfig: entity.playerConfig,
        selectionRange: entity.selectionRange,
        animationNames: entity.animationNames,
        autoAnim: entity.autoAnim,
        path: entity.visual.path 
      };

      let finalProperties: any = { ...propertiesToSave };

      if (entity.type.startsWith('light_') && entity.light) {
        finalProperties = { ...finalProperties, ...entity.light };
      } else if ((entity.type === 'video_plane' || entity.type === 'image_plane') && entity.media) {
        finalProperties = { ...finalProperties, ...entity.media };
      }

      const data = {
        name: prefabName,
        type: entity.type || 'model',
        assetId: entity.visual.assetId || null,
        properties: finalProperties
      };

      this.api.crearPrefab(data).subscribe({
        next: (res) => resolve(res),
        error: (err) => reject(err)
      });
    });
  }
}