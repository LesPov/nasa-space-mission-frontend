import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { CameraOwnershipService } from '../cameras/camera-ownership.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { AbstractMesh, Vector3 } from '@babylonjs/core';
import { GameMode } from '../../session/game-mode.model';

@Injectable({ providedIn: 'root' })
export class LocalRenderingSystem implements IUpdatable {
  public id = 'LocalRenderingSystem';
  
  private entityManager = inject(EntityManagerService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);

  private frameCounter = 0;

  // 🔥 DISTANCIAS DE RENDIMIENTO AJUSTADAS Y CON HYSTERESIS
  // Pre-warm de mallas a los 200m para evitar popping con neblina habilitada
  // Cull destructivo a los 250m, suficiente para limpiar mallas fuera de la ciudad.
  private readonly PREWARM_RADIUS_SQ = 200 * 200; 
  private readonly CULL_RADIUS_SQ = 250 * 250; 

  private getReferencePosition(): Vector3 {
      const playerEntity = this.context.activePlayerEntity();
      if (playerEntity && playerEntity.view) {
          return playerEntity.view.getAbsolutePosition();
      }
      const camera = this.ownership.getCamera() || this.motor3d.getEditorCamera();
      return camera ? camera.globalPosition : Vector3.Zero();
  }

  public update(dtMs: number): void {
      this.frameCounter++;
      
      // Mantenemos la CPU libre ejecutando esto en intervalos ultra holgados (~2 veces por segundo a 60fps)
      if (this.frameCounter % 30 !== 0) return;

      const mode = this.context.mode();
      const isEditor = mode === GameMode.EDITOR || mode === GameMode.EDITING_IN_GAME;
      
      const refPos = this.getReferencePosition();
      const entities = this.entityManager.getAllEntities();

      for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          const mesh = e.view as AbstractMesh;
          if (!mesh || mesh.isDisposed()) continue;

          // Nunca cullamos al jugador, npcs, ni puntos lógicos críticos
          if (e.isPersistent || e.characterConfig || e.rol === 'spawn_point') continue;
          
          // Triggers y luces se manejan con sus propios sistemas de proximidad
          if (e.type === 'trigger' || e.type === 'trigger_compuesto' || e.type.startsWith('light_')) continue;

          // Si el Creador está editando, siempre lo mostramos todo para no frustrarlo
          if (isEditor) {
              if (!mesh.isEnabled()) {
                  mesh.setEnabled(true);
              }
              continue;
          }

          const meshPos = mesh.getAbsolutePosition();
          
          // 🔥 OPTIMIZACIÓN MATEMÁTICA RÁPIDA: Rectángulo delimitador
          const dx = Math.abs(refPos.x - meshPos.x);
          const dz = Math.abs(refPos.z - meshPos.z);

          if (dx > 300 || dz > 300) {
              if (mesh.isEnabled()) {
                  mesh.setEnabled(false); // Retira 100% de la carga de Draw Calls
              }
              continue;
          }

          const distSq = Vector3.DistanceSquared(refPos, meshPos);

          if (distSq > this.CULL_RADIUS_SQ) {
              if (mesh.isEnabled()) {
                  mesh.setEnabled(false); 
              }
          } else if (distSq < this.PREWARM_RADIUS_SQ) {
              if (!mesh.isEnabled()) {
                  mesh.setEnabled(true); // Precarga segura (Zero Popping)
              }
          }
      }
  }
}