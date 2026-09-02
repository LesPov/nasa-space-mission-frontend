import { Injectable, inject } from '@angular/core';
import { Observer, Scene, KeyboardEventTypes } from '@babylonjs/core';
import { PrefabRotationService } from './prefab-rotation.service';
import { InputRouterService } from '../../../core/engine/session/input-router.service';
import { Subscription } from 'rxjs';
import { GameContextService } from '../../../core/engine/session/game-context.service';

@Injectable({ providedIn: 'root' })
export class PrefabInputController {
  public isShiftDown = false;
  public isAltDown = false;
  
  private inputRouter = inject(InputRouterService);
  private gameContext = inject(GameContextService);
  
  private sub: Subscription | null = null;

  constructor(private rotationSvc: PrefabRotationService) {}

  public attach(scene: Scene, onCancel: () => void): void {
    if (this.sub) return;
    
    // Centralizado al router, escuchando exclusivamente cuando estamos en edición
    this.sub = this.inputRouter.getKeyboardStream(['EDITOR_EDITING']).subscribe((kbInfo) => {
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
        
        // Al estar colocando prefabs (LiveBuilder isBuilding() === true),
        // el EditorToolsService se pausa automáticamente cediendo la tecla 'Q' a este controlador
        // garantizando Un Solo Consumidor.
        if (key === 'q' || key === 'Q') this.rotationSvc.rotateY(-fineStep);
        if (key === 'e' || key === 'E') this.rotationSvc.rotateY(fineStep);

        if (key === 'PageUp') this.rotationSvc.changeHeight(heightStep);
        if (key === 'PageDown') this.rotationSvc.changeHeight(-heightStep);

        if (key === 'Escape') onCancel();
      }
    });
  }

  public detach(scene: Scene): void {
    if (this.sub) {
      this.sub.unsubscribe();
      this.sub = null;
    }
    this.isShiftDown = false;
    this.isAltDown = false;
  }
}