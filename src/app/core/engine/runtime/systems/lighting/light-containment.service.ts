import { Injectable, inject } from '@angular/core';
import { AbstractMesh, PointLight, SpotLight, Scene, Vector3, Tags } from '@babylonjs/core';
import { EntityManagerService } from '../../../entities/entity-manager.service';
import { GameEntity, LightContainmentMode } from '../../../entities/game.entity';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../../scene/scene-access.token';

@Injectable({ providedIn: 'root' })
export class LightContainmentService {
  private entityManager = inject(EntityManagerService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);

  // Caché de mallas interiores por UID de entidad lumínica (O(1) por frame)
  private interiorMeshesCache = new Map<string, AbstractMesh[]>();

  public markDirty(lightUid: string): void {
    this.interiorMeshesCache.delete(lightUid);
  }

  public clearAllCache(): void {
    this.interiorMeshesCache.clear();
  }

  /**
   * Resuelve la entidad que actúa como contenedor físico/arquitectónico de la luz interior.
   */
  public resolveContainerEntity(lightEntity: GameEntity, scene: Scene): GameEntity | null {
    const lightComp = lightEntity.light;
    if (!lightComp) return null;

    // 1. Contenedor explícitamente configurado por el usuario en el Inspector
    if (lightComp.containerEntityUid) {
      const explicit = this.entityManager.getEntityByUid(lightComp.containerEntityUid);
      if (explicit && explicit.view) return explicit;
    }

    // 2. Si la luz está emparentada lógicamente a un modelo
    if (lightEntity.parentId) {
      const parentEnt = this.entityManager.getEntityByUid(lightEntity.parentId);
      if (parentEnt && parentEnt.view && (parentEnt.type === 'model' || parentEnt.type === 'cube')) {
        return parentEnt;
      }
    }

    // 3. Detección automática por envolvente espacial (Bounding Box)
    const lightPos = lightEntity.view ? lightEntity.view.getAbsolutePosition() : new Vector3(
      lightEntity.transform.position.x,
      lightEntity.transform.position.y,
      lightEntity.transform.position.z
    );

    const candidates = this.entityManager.getAllEntities().filter(e => 
      e.uid !== lightEntity.uid && 
      (e.type === 'model' || e.type === 'cube') &&
      e.view && !e.view.isDisposed()
    );

    let closestContainer: GameEntity | null = null;
    let smallestVolume = Number.MAX_VALUE;

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (!cand.view) continue;

      cand.view.computeWorldMatrix(true);
      const bounds = cand.view.getHierarchyBoundingVectors(true);
      const min = bounds.min;
      const max = bounds.max;

      // Tolerancia ligera para luces en esquinas
      const margin = 0.2;
      const inside = (
        lightPos.x >= min.x - margin && lightPos.x <= max.x + margin &&
        lightPos.y >= min.y - margin && lightPos.y <= max.y + margin &&
        lightPos.z >= min.z - margin && lightPos.z <= max.z + margin
      );

      if (inside) {
        const size = max.subtract(min);
        const volume = Math.abs(size.x * size.y * size.z);
        if (volume < smallestVolume) {
          smallestVolume = volume;
          closestContainer = cand;
        }
      }
    }

    return closestContainer;
  }

  /**
   * Resuelve y memoriza la lista de mallas interiores que pueden recibir luz de esta fuente.
   */
  public getInteriorMeshes(lightEntity: GameEntity, scene: Scene): AbstractMesh[] {
    if (this.interiorMeshesCache.has(lightEntity.uid)) {
      return this.interiorMeshesCache.get(lightEntity.uid)!;
    }

    const container = this.resolveContainerEntity(lightEntity, scene);
    if (!container || !container.view) {
      // Si no hay contenedor delimitado, no confinar
      return [];
    }

    const result = new Set<AbstractMesh>();
    const lightComp = lightEntity.light;

    // 1. Mallas estructurales del modelo contenedor (paredes, techos, piso interior)
    const addContainerMesh = (m: AbstractMesh) => {
      if (!m || m.isDisposed()) return;
      if (Tags.MatchesQuery(m, "editor_only || fog_element || debug_element || proxy_collider || invisible_floor || light_visual")) {
        return;
      }

      // Si está configurada la exclusión de fachadas exteriores
      if (lightComp?.excludeExteriorMeshes) {
        const nameLower = m.name.toLowerCase();
        if (nameLower.includes('exterior') || nameLower.includes('facade') || nameLower.includes('outer') || nameLower.includes('roof_top')) {
          return;
        }
      }

      if (m.getTotalVertices() > 0) {
        result.add(m);
      }
    };

    addContainerMesh(container.view);
    container.view.getChildMeshes(false).forEach(addContainerMesh);

    // 2. Props, personajes y objetos dentro del volumen del contenedor
    if (!lightComp?.affectDescendantsOnly) {
      container.view.computeWorldMatrix(true);
      const bounds = container.view.getHierarchyBoundingVectors(true);
      const min = bounds.min;
      const max = bounds.max;
      const margin = 0.2;

      const allEntities = this.entityManager.getAllEntities();
      for (let i = 0; i < allEntities.length; i++) {
        const other = allEntities[i];
        if (other.uid === lightEntity.uid || other.uid === container.uid) continue;
        if (!other.view || other.view.isDisposed()) continue;
        if (other.type === 'trigger' || other.type === 'trigger_compuesto' || other.type.startsWith('light_')) continue;

        const pos = other.view.getAbsolutePosition();
        const isInside = (
          pos.x >= min.x - margin && pos.x <= max.x + margin &&
          pos.y >= min.y - margin && pos.y <= max.y + margin &&
          pos.z >= min.z - margin && pos.z <= max.z + margin
        );

        if (isInside) {
          const addInteriorProp = (m: AbstractMesh) => {
            if (m.getTotalVertices() > 0 && !Tags.MatchesQuery(m, "editor_only || fog_element || debug_element || proxy_collider || invisible_floor || light_visual")) {
              result.add(m);
            }
          };
          addInteriorProp(other.view);
          other.view.getChildMeshes(false).forEach(addInteriorProp);
        }
      }
    }

    const finalArray = Array.from(result);
    this.interiorMeshesCache.set(lightEntity.uid, finalArray);
    return finalArray;
  }

  /**
   * Aplica la configuración de contención directamente sobre la luz activa de BabylonJS.
   */
  public applyContainment(light: PointLight | SpotLight, entity: GameEntity, scene: Scene): void {
    const mode: LightContainmentMode = entity.light?.containmentMode || 'GLOBAL';

    if (mode === 'INTERIOR') {
      const interiorMeshes = this.getInteriorMeshes(entity, scene);
      if (interiorMeshes.length > 0) {
        light.includedOnlyMeshes = interiorMeshes;
        light.excludedMeshes = [];
      } else {
        light.includedOnlyMeshes = [];
        light.excludedMeshes = [];
      }
    } else {
      // Modo EXTERIOR o GLOBAL: se levanta cualquier restricción exclusiva interior
      light.includedOnlyMeshes = [];
      light.excludedMeshes = [];
    }
  }

  /**
   * Limpia las colecciones de contención de la luz para evitar residuos en slots reasignados.
   */
  public clearContainment(light: PointLight | SpotLight): void {
    light.includedOnlyMeshes = [];
    light.excludedMeshes = [];
  }
}