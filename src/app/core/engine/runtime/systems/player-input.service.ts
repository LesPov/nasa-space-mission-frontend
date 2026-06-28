
import { Injectable, inject } from '@angular/core';
import { Observer, KeyboardInfo, Scene, KeyboardEventTypes } from '@babylonjs/core';
import { IUpdatable } from '../../behaviors/services/loop-manager.service';
import { GameContextService } from '../../session/game-context.service';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../scene/scene-access.token';
import { GameEventBusService } from '../../events/game-event-bus.service';
import { AuthService } from '../../../services/auth';

@Injectable({ providedIn: 'root' })
export class PlayerInputService implements IUpdatable {
  public id = 'PlayerInputSystem';
  
  public inputMap: Record<string, boolean> = {};
  public actionPressedThisFrame = false;
  public inspectPressedThisFrame = false;

  private tecladoObserver: Observer<KeyboardInfo> | null = null;
  private isEnabled: boolean = false;

  private context = inject(GameContextService);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private eventBus = inject(GameEventBusService);
  private authSvc = inject(AuthService);

  public isRadialMenuOpen = false;
  private qPressed = false;
  private wasPointerLockedBeforeMenu = false; // 🔥 Guarda el estado del ratón para devolverte limpio al juego

  constructor() {
    this.eventBus.events$.subscribe(e => {
      if (e.type === 'RadialMenuToggled') {
        this.isRadialMenuOpen = e.payload;
        if (!e.payload) {
             this.lockPointerAfterMenu();
        }
      }
    });
  }

  public start(): void {
    this.tecladoObserver = null; 
    this.iniciarEscuchaTeclado(this.motor3d.getScene(), {
      onToggleCamera: () => {
         this.eventBus.emit({ type: 'ToggleCameraRequested' });
      },
    });
  }

  public stop(): void {
    this.detenerEscuchaTeclado(this.motor3d.getScene());
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
  
  private iniciarEscuchaTeclado(
    scene: Scene, 
    callbacks: { onToggleCamera: () => void }
  ): void {
    if (this.tecladoObserver) return; 

    this.tecladoObserver = scene.onKeyboardObservable.add((kbInfo: KeyboardInfo) => {
      const keyStr = kbInfo.event.key ? kbInfo.event.key.toLowerCase() : '';
      const codeStr = kbInfo.event.code ? kbInfo.event.code.toLowerCase() : '';

      if (keyStr === 'q' && this.authSvc.isAdmin() && this.context.isDebugMode() && this.context.cameraView() === 'FPS') {
        if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
          if (!this.qPressed) {
             this.qPressed = true;
             
             // Guardamos si el cursor estaba bloqueado antes de abrir el menú para saber si debemos restaurarlo
             if (!this.isRadialMenuOpen) {
                 this.wasPointerLockedBeforeMenu = !!document.pointerLockElement;
             }
             
             this.isRadialMenuOpen = !this.isRadialMenuOpen;
             this.eventBus.emit({ type: 'RadialMenuToggled', payload: this.isRadialMenuOpen });
             
             if (this.isRadialMenuOpen) {
                 this.unlockPointerForMenu();
             }
          }
        } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
          this.qPressed = false;
        }
      }

      if (!this.isEnabled) return; 

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

  private unlockPointerForMenu(): void {
    if (document.pointerLockElement) {
      try { document.exitPointerLock(); } catch(e) {}
    }
  }

  private lockPointerAfterMenu(): void {
    // 🔥 FIX: Solo re-bloqueamos el cursor al cerrar el menú si ESTABA bloqueado (jugando) antes de abrirlo
    if (this.wasPointerLockedBeforeMenu) {
      const canvas = this.motor3d.getEngine()?.getRenderingCanvas();
      if (canvas && !document.pointerLockElement) {
        try { 
          canvas.focus();
          canvas.requestPointerLock(); 
        } catch(e) {}
      }
    }
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
    this.isRadialMenuOpen = false;
    this.qPressed = false;
  }
}
