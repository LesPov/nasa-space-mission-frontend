
// src/app/core/engine/runtime/systems/player-input.service.ts

import { Injectable, inject } from '@angular/core';
import { KeyboardInfo, KeyboardEventTypes } from '@babylonjs/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { InputRouterService } from '../../session/input-router.service';
import { Subscription } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PlayerInputService implements IUpdatable {
  public id = 'PlayerInputSystem';
  
  public inputMap: Record<string, boolean> = {};
  public actionPressedThisFrame = false;
  public inspectPressedThisFrame = false;

  private isEnabled: boolean = false;
  private inputSub: Subscription | null = null;

  private context = inject(GameContextService);
  private eventBus = inject(GameEventBusService);
  private inputRouter = inject(InputRouterService);

  public isRadialMenuOpen = false;
  private wasPointerLockedBeforeMenu = false;

  constructor() {
    this.eventBus.events$.subscribe(e => {
      if (e.type === 'RadialMenuToggled') {
        this.isRadialMenuOpen = e.payload;
        if (this.isRadialMenuOpen) {
          this.wasPointerLockedBeforeMenu = this.context.isPointerLocked();
          if (this.wasPointerLockedBeforeMenu) {
            this.inputRouter.unlockPointer();
          }
        } else {
          this.lockPointerAfterMenu();
        }
      }
    });
  }

  public start(): void {
    if (this.inputSub) {
      this.inputSub.unsubscribe();
      this.inputSub = null;
    }

    // Consume input de gameplay exclusivamente en los contextos activos de juego
    this.inputSub = this.inputRouter.getKeyboardStream([
      'GAMEPLAY',
      'ADMIN_PREVIEW',
      'EDITOR_PLAYTEST'
    ]).subscribe(kbInfo => {
      this.handleKeyboardEvent(kbInfo);
    });
  }

  public stop(): void {
    if (this.inputSub) {
      this.inputSub.unsubscribe();
      this.inputSub = null;
    }
    this.disable();
  }

  public enable(): void {
    this.isEnabled = true;
  }

  public disable(): void {
    this.isEnabled = false;
    this.resetearInputs();
    
    try {
      const playerEntity = this.context.activePlayerEntity();
      if (playerEntity && playerEntity.playerRuntime) {
        playerEntity.playerRuntime.intentions = { 
          moveForward: false, moveBackward: false, moveLeft: false, 
          moveRight: false, run: false, jump: false 
        };
      }
    } catch(e) {}
  }

  public update(dtMs: number): void {
    if (!this.isEnabled) return;
    
    const playerEntity = this.context.activePlayerEntity();
    if (!playerEntity || !playerEntity.playerRuntime) return;

    const seqRuntime = playerEntity.playerRuntime.seqRuntime;
    
    const canReceiveInput = this.context.isPointerLocked() && 
      (!seqRuntime || (!seqRuntime.lockInput && !seqRuntime.freezeOrientation)) && 
      !this.isRadialMenuOpen;

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
    this.actionPressedThisFrame = false;
    this.inspectPressedThisFrame = false;
  }
  
  private handleKeyboardEvent(kbInfo: KeyboardInfo): void {
    const keyStr = kbInfo.event.key ? kbInfo.event.key.toLowerCase() : '';
    const codeStr = kbInfo.event.code ? kbInfo.event.code.toLowerCase() : '';

    if (!this.isEnabled) return;

    if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
      this.inputMap[keyStr] = true;
      this.inputMap[codeStr] = true;

      if (keyStr === 'e' && !this.actionPressedThisFrame) this.actionPressedThisFrame = true;
      if (keyStr === 'i' && !this.inspectPressedThisFrame) this.inspectPressedThisFrame = true;

      if (keyStr === 'v' && !this.inputMap['v_handled']) {
        this.inputMap['v_handled'] = true;
        this.eventBus.emit({ type: 'ToggleCameraRequested' });
      }
    } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
      this.inputMap[keyStr] = false;
      this.inputMap[codeStr] = false;

      if (keyStr === 'v') this.inputMap['v_handled'] = false;
    }
  }

  private lockPointerAfterMenu(): void {
    if (this.wasPointerLockedBeforeMenu) {
      this.inputRouter.lockPointer();
    }
  }

  public resetearInputs(): void {
    this.inputMap = {};
    this.actionPressedThisFrame = false;
    this.inspectPressedThisFrame = false;
    this.isRadialMenuOpen = false;
  }
}