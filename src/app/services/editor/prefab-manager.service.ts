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

      const hierarchyData: any[] = [];
      const serializedEntities = new Set<string>();

      const traverseAndSerialize = (mesh: AbstractMesh, parentUid: string | null) => {
        const entity = this.entityManager.getEntityByMesh(mesh);
        let currentParentUid = parentUid;
        
        if (entity && !Tags.MatchesQuery(mesh, "system_element")) {
          if (!serializedEntities.has(entity.uid)) {
            serializedEntities.add(entity.uid);
            entity.syncTransformFromView();
            
            const dtos = this.persistenceMapper.extractToDtos(entity);
            dtos.forEach(dto => {
               hierarchyData.push({
                  originalUid: dto.uid,
                  parentOriginalUid: parentUid,
                  type: dto.type || 'model',
                  name: dto.name,
                  assetId: dto.assetId || null,
                  position: dto.position,
                  rotation: dto.rotation,
                  scale: dto.scale,
                  properties: dto.properties
               });
            });
            currentParentUid = entity.uid;
          }
        }

        mesh.getChildMeshes(true).forEach(child => traverseAndSerialize(child, currentParentUid));
      };

      traverseAndSerialize(rootMesh, null);

      if (hierarchyData.length === 0) {
        reject('No se pudo serializar la jerarquía del objeto.');
        return;
      }

      const rootData = hierarchyData[0];
      
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