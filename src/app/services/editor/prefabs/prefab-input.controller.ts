
import { Injectable } from '@angular/core';
import { Observer, Scene, KeyboardEventTypes } from '@babylonjs/core';
import { PrefabRotationService } from './prefab-rotation.service';

@Injectable({ providedIn: 'root' })
export class PrefabInputController {
  public isShiftDown = false;
  public isAltDown = false;
  private observer: Observer<any> | null = null;

  constructor(private rotationSvc: PrefabRotationService) {}

  public attach(scene: Scene, onCancel: () => void): void {
    if (this.observer) return;
    this.observer = scene.onKeyboardObservable.add((kbInfo) => {
      const isDown = kbInfo.type === KeyboardEventTypes.KEYDOWN;
      const key = kbInfo.event.key;

      if (key === 'Shift') this.isShiftDown = isDown;
      if (key === 'Alt') this.isAltDown = isDown;

      if (isDown) {
        const step = this.isShiftDown ? 45 : 15;
        const fineStep = this.isShiftDown ? 5 : 1;
        const heightStep = this.isShiftDown ? 1.0 : 0.1;

        if (key === 'ArrowLeft') this.rotationSvc.rotateY(-step);
        if (key === 'ArrowRight') this.rotationSvc.rotateY(step);
        if (key === 'ArrowUp') this.rotationSvc.rotateX(-step);
        if (key === 'ArrowDown') this.rotationSvc.rotateX(step);
        
        if (key === 'q' || key === 'Q') this.rotationSvc.rotateY(-fineStep);
        if (key === 'e' || key === 'E') this.rotationSvc.rotateY(fineStep);

        if (key === 'PageUp') this.rotationSvc.changeHeight(heightStep);
        if (key === 'PageDown') this.rotationSvc.changeHeight(-heightStep);

        if (key === 'Escape') onCancel();
      }
    });
  }

  public detach(scene: Scene): void {
    if (this.observer) {
      scene.onKeyboardObservable.remove(this.observer);
      this.observer = null;
    }
    this.isShiftDown = false;
    this.isAltDown = false;
  }
}