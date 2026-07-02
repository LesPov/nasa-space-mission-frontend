
import { Injectable, inject } from '@angular/core';
import { Mesh, MeshBuilder } from '@babylonjs/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../scene-access.token';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameEntity } from '../../entities/game.entity';
import { TriggerVisualizerService } from './trigger-visualizer.service';
import { EntityPersistenceMapperService } from './entity-persistence-mapper.service';

@Injectable({ providedIn: 'root' })
export class CoreTriggerLoaderService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private entityManager = inject(EntityManagerService);
  private triggerVisualizer = inject(TriggerVisualizerService);
  private persistenceMapper = inject(EntityPersistenceMapperService);

  public cargarTrigger(trigger: any, mallasCreadas: Map<string, Mesh>): void {
    const scene = this.motor3d.getScene();
    const shape = trigger.actionProperties?.triggerShape || trigger.properties?.triggerShape || 'cube';
    
    const isComposite = trigger.type === 'trigger_compuesto' || trigger.actionProperties?.isComposite || trigger.properties?.isComposite || false;

    let rawUid = trigger.uid || window.crypto.randomUUID();
    const isIncomingExit = rawUid.includes('_on_exit');
    const baseUid = rawUid.replace('_on_enter', '').replace('_on_exit', '');
    
    let entity = this.entityManager.getEntityByUid(baseUid);
    let mesh = scene.getMeshByName(trigger.name) as Mesh;

    // 🔥 BUSCAR ESCALA, TAMAÑO Y ROTACIÓN EN CUALQUIER PARTE DEL DTO PARA PREVENIR PÉRDIDA POR BACKEND
    const sourceScale = trigger.scale || trigger.size || trigger.properties?.scale || trigger.properties?.size || { x: 1, y: 1, z: 1 };
    const sourceRotation = trigger.rotation || trigger.properties?.rotation || trigger.actionProperties?.rotation || { x: 0, y: 0, z: 0 };
    
    const safePosition = trigger.position ? { ...trigger.position } : { x: 0, y: 0, z: 0 };
    const safeRotation = { x: sourceRotation.x ?? 0, y: sourceRotation.y ?? 0, z: sourceRotation.z ?? 0 };
    const safeScale = { x: sourceScale.x ?? 1, y: sourceScale.y ?? 1, z: sourceScale.z ?? 1 };

    // Validar que no haya escalas en 0 que desaparezcan el trigger en el espacio 3D
    if (safeScale.x === 0) safeScale.x = 1;
    if (safeScale.y === 0) safeScale.y = 1;
    if (safeScale.z === 0) safeScale.z = 1;

    if (!entity) {
      entity = new GameEntity(baseUid, trigger.name, isComposite ? 'trigger_compuesto' : 'trigger', 'trigger');

      this.persistenceMapper.applyDbToEntity(trigger, entity);

      // 🔥 FORZAR TRANSFORM AL CREAR (Protege la escala inicial de los datos corrompidos)
      entity.transform.position = safePosition;
      entity.transform.rotation = safeRotation;
      entity.transform.scale = safeScale;

      if (!mesh) {
        switch (shape) {
          case 'sphere': mesh = MeshBuilder.CreateSphere(trigger.name, { diameter: 1 }, scene); break;
          case 'cylinder': mesh = MeshBuilder.CreateCylinder(trigger.name, { height: 1, diameter: 1 }, scene); break;
          default: mesh = MeshBuilder.CreateBox(trigger.name, { size: 1 }, scene); break;
        }

        entity.bindView(mesh);
        mesh.visibility = 0; 
        mesh.material = null; 
        mesh.isPickable = true;
        mesh.checkCollisions = false;
        mesh.isVisible = true; 

        this.triggerVisualizer.createOrUpdateWireframe(mesh, shape, isComposite, entity.trigger!.actionType);
        mallasCreadas.set(entity.uid, mesh);
      } else {
        mesh.visibility = 0; 
        mesh.material = null;
        entity.bindView(mesh);
        this.triggerVisualizer.createOrUpdateWireframe(mesh, shape, isComposite, entity.trigger!.actionType);
      }
      this.entityManager.addEntity(entity);
      
      // Aplicar dimensiones reales inmediatamente
      entity.syncToView();
      
    } else {
      // 🔥 LA ENTIDAD YA EXISTE: Protegemos las dimensiones contra el segundo registro (_on_exit)
      const oldTransform = JSON.parse(JSON.stringify(entity.transform));
      const oldName = entity.name;
      
      this.persistenceMapper.applyDbToEntity(trigger, entity);
      
      // Si el trigger entrante es _on_exit, JAMÁS debe sobreescribir la escala/posición/rotación.
      if (isIncomingExit) {
          entity.transform = oldTransform;
      } else {
          // Si es el _on_enter, ES LA FUENTE DE VERDAD DE LA BASE DE DATOS
          entity.transform.position = safePosition;
          entity.transform.rotation = safeRotation;
          entity.transform.scale = safeScale;
      }
      
      entity.name = oldName;
      
      // Forzamos al mesh 3D a respetar las dimensiones rescatadas
      entity.syncToView();
    }
  }
}