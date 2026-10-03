// file: src/app/core/engine/runtime/systems/player-input.service.ts
import { Injectable, inject } from '@angular/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { InputRouterService } from '../../session/input-router.service';
import { Subscription } from 'rxjs';
import { GameMode } from '../../session/game-mode.model';

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

    // Escucha teclado global en GAMEPLAY, ADMIN_PREVIEW, EDITOR_PLAYTEST y EDITOR_EDITING
    this.inputSub = this.inputRouter.getGlobalKeyboardStream([
      'GAMEPLAY',
      'ADMIN_PREVIEW',
      'EDITOR_PLAYTEST',
      'EDITOR_EDITING'
    ]).subscribe(event => {
      this.handleKeyboardEvent(event);
    });

    this.enable();
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

    const mode = this.context.mode();
    const isPlayingMode = mode === GameMode.TEST_LIVE || mode === GameMode.FINAL_USER || mode === GameMode.PREVIEW_ADMIN;

    // En Test Live, si no hay menú radial abierto ni ventana de diálogo modal, procesamos el input siempre
    if (!isPlayingMode || this.isRadialMenuOpen) {
      playerEntity.playerRuntime.intentions.moveForward = false;
      playerEntity.playerRuntime.intentions.moveBackward = false;
      playerEntity.playerRuntime.intentions.moveLeft = false;
      playerEntity.playerRuntime.intentions.moveRight = false;
      playerEntity.playerRuntime.intentions.run = false;
      playerEntity.playerRuntime.intentions.jump = false;
      return;
    }

    const seqRuntime = playerEntity.playerRuntime.seqRuntime;
    const isInputLockedBySequence = !!(seqRuntime && seqRuntime.running && seqRuntime.lockInput);

    if (isInputLockedBySequence) {
      playerEntity.playerRuntime.intentions.moveForward = false;
      playerEntity.playerRuntime.intentions.moveBackward = false;
      playerEntity.playerRuntime.intentions.moveLeft = false;
      playerEntity.playerRuntime.intentions.moveRight = false;
      playerEntity.playerRuntime.intentions.run = false;
      playerEntity.playerRuntime.intentions.jump = false;
      return;
    }

    const stateComp = playerEntity.playerRuntime;
    stateComp.intentions.moveForward = !!(this.inputMap['w'] || this.inputMap['arrowup']);
    stateComp.intentions.moveBackward = !!(this.inputMap['s'] || this.inputMap['arrowdown']);
    stateComp.intentions.moveLeft = !!(this.inputMap['a'] || this.inputMap['arrowleft']);
    stateComp.intentions.moveRight = !!(this.inputMap['d'] || this.inputMap['arrowright']);
    stateComp.intentions.run = !!(this.inputMap['shiftleft'] || this.inputMap['shiftright'] || this.inputMap['shift']);
    stateComp.intentions.jump = !!(this.inputMap[' '] || this.inputMap['space']);
    
    if (stateComp.intentions.jump) {
      this.inputMap[' '] = false;
      this.inputMap['space'] = false;
    }
  }

  public postUpdate(dtMs: number): void {
    this.actionPressedThisFrame = false;
    this.inspectPressedThisFrame = false;
  }
  
  private handleKeyboardEvent(event: KeyboardEvent): void {
    if (!this.isEnabled) return;

    const keyStr = event.key ? event.key.toLowerCase() : '';
    const codeStr = event.code ? event.code.toLowerCase() : '';

    if (event.type === 'keydown') {
      this.inputMap[keyStr] = true;
      this.inputMap[codeStr] = true;

      if (keyStr === 'e' && !this.actionPressedThisFrame) this.actionPressedThisFrame = true;
      if (keyStr === 'i' && !this.inspectPressedThisFrame) this.inspectPressedThisFrame = true;

      if (keyStr === 'v' && !this.inputMap['v_handled']) {
        this.inputMap['v_handled'] = true;
        this.eventBus.emit({ type: 'ToggleCameraRequested' });
      }
    } else if (event.type === 'keyup') {
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
  }
}