import { Injectable } from '@angular/core';
import { Observer, KeyboardInfo, Scene, KeyboardEventTypes } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class PlayerInputService {
  
  public inputMap: Record<string, boolean> = {};
  public eKeyPressed = false;
  public iKeyPressed = false; 
  
  private tecladoObserver: Observer<KeyboardInfo> | null = null;
  private isEnabled: boolean = false;

  public enable(): void {
    this.isEnabled = true;
  }

  public disable(): void {
    this.isEnabled = false;
    this.resetearInputs();
  }

  public iniciarEscuchaTeclado(
    scene: Scene, 
    callbacks: { onToggleCamera: () => void, onAction: () => void, onInspect: () => void }
  ): void {
    this.tecladoObserver = scene.onKeyboardObservable.add((kbInfo: KeyboardInfo) => {
      if (!this.isEnabled) return; // 🔥 Controlado externamente, adiós GameSession

      const keyStr = kbInfo.event.key ? kbInfo.event.key.toLowerCase() : '';
      const codeStr = kbInfo.event.code ? kbInfo.event.code.toLowerCase() : '';

      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        this.inputMap[keyStr] = true;
        this.inputMap[codeStr] = true;

        if (keyStr === 'e') this.eKeyPressed = true;
        if (keyStr === 'i') this.iKeyPressed = true;

        if (keyStr === 'v' && !this.inputMap['v_handled']) {
          this.inputMap['v_handled'] = true;
          callbacks.onToggleCamera();
        }

        if (keyStr === 'e') callbacks.onAction();
        if (keyStr === 'i') callbacks.onInspect();
      } else {
        this.inputMap[keyStr] = false;
        this.inputMap[codeStr] = false;

        if (keyStr === 'e') this.eKeyPressed = false;
        if (keyStr === 'i') this.iKeyPressed = false;
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
    this.eKeyPressed = false;
    this.iKeyPressed = false;
  }
}