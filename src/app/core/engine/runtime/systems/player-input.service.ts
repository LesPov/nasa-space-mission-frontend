
import { Injectable, inject, Injector } from '@angular/core';
import { Observer, KeyboardInfo, Scene, KeyboardEventTypes } from '@babylonjs/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { GameSession } from '../game-session';
import { EntityManagerService } from '../../entities/entity-manager.service';
import { Motor3dService } from '../../../../services/motor-3d.service';

@Injectable({ providedIn: 'root' })
export class PlayerInputService implements IUpdatable {
  public id = 'PlayerInputSystem';
  
  public inputMap: Record<string, boolean> = {};
  public actionPressedThisFrame = false;
  public inspectPressedThisFrame = false;

  private tecladoObserver: Observer<KeyboardInfo> | null = null;
  private isEnabled: boolean = false;

  private injector = inject(Injector);
  private motor3d = inject(Motor3dService);

  // Lazy Injection para evitar dependencias circulares
  private get session(): GameSession {
    return this.injector.get(GameSession);
  }

  public start(): void {
    this.iniciarEscuchaTeclado(this.motor3d.scene, {
      onToggleCamera: () => this.session.toggleCameraUser(),
    });
  }

  public stop(): void {
    this.detenerEscuchaTeclado(this.motor3d.scene);
  }

  public enable(): void {
    this.isEnabled = true;
  }

  public disable(): void {
    this.isEnabled = false;
    this.resetearInputs();
  }

  public update(dtMs: number): void {
    if (!this.isEnabled) return;
    
    const playerEntity = this.session.activePlayerEntity();
    if (!playerEntity) return;

    const seqRuntime = playerEntity.playerRuntime.seqRuntime;
    const canReceiveInput = this.session.pointerLocked() && (!seqRuntime || (!seqRuntime.lockInput && !seqRuntime.freezeOrientation));

    const stateComp = playerEntity.playerRuntime;
    if (canReceiveInput) {
      stateComp.intentions.moveForward = !!this.inputMap['w'];
      stateComp.intentions.moveBackward = !!this.inputMap['s'];
      stateComp.intentions.moveLeft = !!this.inputMap['a'];
      stateComp.intentions.moveRight = !!this.inputMap['d'];
      stateComp.intentions.run = !!this.inputMap['shiftleft'] || !!this.inputMap['shiftright'] || !!this.inputMap['shift'];
      stateComp.intentions.jump = !!this.inputMap[' '] || !!this.inputMap['space'];
      
      if (stateComp.intentions.jump) {
          this.inputMap[' '] = false;
          this.inputMap['space'] = false;
      }
    } else {
      stateComp.intentions.moveForward = false;
      stateComp.intentions.moveBackward = false;
      stateComp.intentions.moveLeft = false;
      stateComp.intentions.moveRight = false;
      stateComp.intentions.run = false;
      stateComp.intentions.jump = false;
    }
  }

  public postUpdate(dtMs: number): void {
    // Resetear los eventos de un solo frame
    this.actionPressedThisFrame = false;
    this.inspectPressedThisFrame = false;
  }
  
  private iniciarEscuchaTeclado(
    scene: Scene, 
    callbacks: { onToggleCamera: () => void }
  ): void {
    if (this.tecladoObserver) return; // Ya está escuchando

    this.tecladoObserver = scene.onKeyboardObservable.add((kbInfo: KeyboardInfo) => {
      if (!this.isEnabled) return;

      const keyStr = kbInfo.event.key ? kbInfo.event.key.toLowerCase() : '';
      const codeStr = kbInfo.event.code ? kbInfo.event.code.toLowerCase() : '';

      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        this.inputMap[keyStr] = true;
        this.inputMap[codeStr] = true;

        if (keyStr === 'e' && !this.actionPressedThisFrame) this.actionPressedThisFrame = true;
        if (keyStr === 'i' && !this.inspectPressedThisFrame) this.inspectPressedThisFrame = true;

        if (keyStr === 'v' && !this.inputMap['v_handled']) {
          this.inputMap['v_handled'] = true;
          callbacks.onToggleCamera();
        }
      } else {
        this.inputMap[keyStr] = false;
        this.inputMap[codeStr] = false;

        if (keyStr === 'v') this.inputMap['v_handled'] = false;
      }
    });
  }

  public detenerEscuchaTeclado(scene: Scene): void {
    if (this.tecladoObserver) {
      scene.onKeyboardObservable.remove(this.tecladoObserver);
      this.tecladoObserver = null;
    }
    this.disable();
  }

  public resetearInputs(): void {
    this.inputMap = {};
    this.actionPressedThisFrame = false;
    this.inspectPressedThisFrame = false;
  }
}