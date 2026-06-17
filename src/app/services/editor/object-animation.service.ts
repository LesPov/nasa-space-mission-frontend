
import { Injectable, inject } from '@angular/core';
import { AbstractMesh, Animation, EasingFunction, SineEase, Vector3, Mesh } from '@babylonjs/core';
import { Motor3dService } from '../motor-3d.service';
import { EntityManagerService } from '../../core/engine/entities/entity-manager.service';

@Injectable({ providedIn: 'root' })
export class ObjectAnimationService {
  private motor3d = inject(Motor3dService);
  private entityManager = inject(EntityManagerService);
  private animatables: any[] = [];

  public startAmbientAutoAnimations(): void {
    const scene = this.motor3d.scene;
    if (!scene) return;

    this.entityManager.getAllEntities().forEach(entity => {
      const mesh = entity.view as Mesh;
      if (!mesh) return;

      if (entity.autoAnim && entity.autoAnim.stopBaked) {
          const myAnimNames = entity.animationNames || [];
          scene.animationGroups.forEach(ag => {
              if (myAnimNames.includes(ag.name)) {
                  if (ag.isPlaying) {
                      const isTargetingMe = ag.targetedAnimations?.some((ta:any) => {
                          let current: any = ta.target;
                          while(current) {
                              if (current === mesh) return true;
                              current = current.parent;
                          }
                          return false;
                      });
                      if (isTargetingMe) {
                          ag.stop();
                      }
                  }
              }
          });
      }

      // Si tiene una animación procedimental programada
      if (entity.autoAnim && entity.autoAnim.enabled) {
        this.applyAutoAnim(mesh, entity.autoAnim);
      }
    });
  }

  public stopAmbientAutoAnimations(): void {
    this.animatables.forEach((anim) => {
      if (anim) anim.stop();
    });
    this.animatables = [];
  }

  private applyAutoAnim(mesh: Mesh, config: any): void {
    const fps = 60;
    const frames = Math.max(1, (config.duration || 2) * fps);
    const amount = Number(config.amount) || 0;
    const axis = config.axis || 'Y';
    const type = config.type || 'move';

    let anim: Animation;
    let keys = [];

    const easeInOut = new SineEase();
    easeInOut.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    if (type === 'move') {
      anim = new Animation('autoMove', 'position', fps, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
      const startPos = mesh.position.clone();
      const endPos = startPos.clone();

      if (axis === 'X') endPos.x += amount;
      if (axis === 'Y') endPos.y += amount;
      if (axis === 'Z') endPos.z += amount;

      keys.push({ frame: 0, value: startPos });
      keys.push({ frame: frames / 2, value: endPos });
      keys.push({ frame: frames, value: startPos });

      anim.setEasingFunction(easeInOut);

    } else if (type === 'rotate') {
      anim = new Animation('autoRot', 'rotation', fps, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
      const startRot = mesh.rotation.clone();
      const endRot = startRot.clone();
      
      const rads = amount * (Math.PI / 180);

      if (axis === 'X') endRot.x += rads;
      if (axis === 'Y') endRot.y += rads;
      if (axis === 'Z') endRot.z += rads;

      keys.push({ frame: 0, value: startRot });
      keys.push({ frame: frames, value: endRot });

    } else if (type === 'scale') {
      anim = new Animation('autoScale', 'scaling', fps, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
      const startScale = mesh.scaling.clone();
      const endScale = startScale.clone();

      if (axis === 'X') endScale.x += amount;
      else if (axis === 'Y') endScale.y += amount;
      else if (axis === 'Z') endScale.z += amount;
      else {
         endScale.x += amount;
         endScale.y += amount;
         endScale.z += amount;
      }

      keys.push({ frame: 0, value: startScale });
      keys.push({ frame: frames / 2, value: endScale });
      keys.push({ frame: frames, value: startScale });
      
      anim.setEasingFunction(easeInOut);

    } else if (type === 'float') {
      anim = new Animation('autoFloat', 'position', fps, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
      const startPos = mesh.position.clone();
      
      keys.push({ frame: 0, value: startPos });
      keys.push({ frame: frames / 2, value: startPos.add(new Vector3(0, amount, 0)) });
      keys.push({ frame: frames, value: startPos });

      anim.setEasingFunction(easeInOut);
    } else {
      return;
    }

    anim.setKeys(keys);
    mesh.animations = mesh.animations || [];
    mesh.animations.push(anim);

    const animatable = this.motor3d.scene.beginAnimation(mesh, 0, frames, true);
    this.animatables.push(animatable);
  }
}