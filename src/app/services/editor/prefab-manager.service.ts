
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Tags } from '@babylonjs/core';
import { EpisodiosService } from '../api/episodios';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';
import { EntityPersistenceMapperService } from '../../core/engine/scene/utils/entity-persistence-mapper.service';

@Injectable({ providedIn: 'root' })
export class PrefabManagerService {
  private api = inject(EpisodiosService);
  private entityManager = inject(EntityManagerService);
  private persistenceMapper = inject(EntityPersistenceMapperService);

  public createPrefabFromMesh(rootMesh: AbstractMesh, prefabName: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const rootEntity = this.entityManager.getEntityByMesh(rootMesh);
      
      if (!rootEntity) {
        reject('El objeto raíz no tiene una entidad válida para ser un Prefab.');
        return;
      }

      // Serialización recursiva de la jerarquía completa
      const hierarchyData: any[] = [];

      const traverseAndSerialize = (mesh: AbstractMesh, parentUid: string | null) => {
        const entity = this.entityManager.getEntityByMesh(mesh);
        
        // Solo guardamos entidades válidas, ignoramos colliders generados o elementos del sistema
        if (entity && !Tags.MatchesQuery(mesh, "system_element")) {
          entity.syncTransformFromView();
          
          const props = this.persistenceMapper.extractEntityProperties(entity);
          let finalProps = { ...props };
          
          if (entity.type.startsWith('light_') && entity.light) {
            finalProps = { ...finalProps, ...entity.light };
          } else if ((entity.type === 'video_plane' || entity.type === 'image_plane') && entity.media) {
            finalProps = { ...finalProps, ...entity.media };
          }

          hierarchyData.push({
            originalUid: entity.uid,
            parentOriginalUid: parentUid,
            type: entity.type || 'model',
            name: entity.name,
            assetId: entity.visual.assetId || null,
            position: { ...entity.transform.position },
            rotation: { ...entity.transform.rotation },
            scale: { ...entity.transform.scale },
            properties: finalProps
          });

          mesh.getChildMeshes(true).forEach(child => traverseAndSerialize(child, entity.uid));
        }
      };

      traverseAndSerialize(rootMesh, null);

      if (hierarchyData.length === 0) {
        reject('No se pudo serializar la jerarquía del objeto.');
        return;
      }

      const rootData = hierarchyData[0];
      
      // 🔥 FIX: Rompemos la referencia circular. En lugar de mutar rootData.properties,
      // creamos un nuevo objeto properties para la petición al servidor que contiene
      // las propiedades del objeto padre y añade el array hierarchyData.
      const data = {
        name: prefabName,
        type: rootData.type,
        assetId: rootData.assetId,
        properties: {
            ...rootData.properties,
            prefabHierarchy: hierarchyData
        }
      };

      this.api.crearPrefab(data).subscribe({
        next: (res) => resolve(res),
        error: (err) => reject(err)
      });
    });
  }
}