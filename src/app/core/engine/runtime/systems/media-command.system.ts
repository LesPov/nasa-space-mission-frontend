
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { StandardMaterial, Color3, Mesh } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class MediaCommandSystem implements IUpdatable {
  public id = 'MediaCommandSystem';
  private entityManager = inject(EntityManagerService);

  update(dtMs: number): void {
    const entities = this.entityManager.getAllEntities();

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const view = entity.view as Mesh;
      if (!view) continue;

      if (entity.mediaRuntime?.videoCommand) {
        const mat = view.material as StandardMaterial;
        if (mat && mat.diffuseTexture && (mat.diffuseTexture as any).video) {
          const video = (mat.diffuseTexture as any).video;
          
          if (entity.mediaRuntime.videoCommand === 'play') {
            video.play();
            mat.emissiveColor = new Color3(0.4, 0.4, 0.4);
          } else if (entity.mediaRuntime.videoCommand === 'pause') {
            video.pause();
            mat.emissiveColor = new Color3(0.2, 0.2, 0.2);
          } else if (entity.mediaRuntime.videoCommand === 'stop') {
            video.pause();
            video.currentTime = 0;
            mat.emissiveColor = new Color3(0, 0, 0);
          }
          
          entity.mediaRuntime.videoCommand = undefined;
        }
      }

      if (entity.playerRuntime?.stopBakedRequested && view.getScene) {
        const scene = view.getScene();
        const myAnimNames = entity.animationNames || [];
        
        scene.animationGroups.forEach(ag => {
          if (myAnimNames.includes(ag.name) && ag.isPlaying) {
            const isTargetingMe = ag.targetedAnimations?.some(ta => {
              let current: any = ta.target;
              while (current) {
                if (current === view) return true;
                current = current.parent;
              }
              return false;
            });
            
            if (isTargetingMe) {
              ag.stop();
            }
          }
        });
        
        entity.playerRuntime.stopBakedRequested = false;
      }
    }
  }
}
  