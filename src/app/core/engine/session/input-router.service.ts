// src/app/core/engine/session/input-router.service.ts

import { Injectable, inject } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { 
  KeyboardInfo, 
  PointerInfo, 
  Scene, 
  Observer as BabylonObserver, 
  Nullable 
} from '@babylonjs/core';
import { ISceneAccess, SCENE_ACCESS_TOKEN } from '../scene/scene-access.token';
import { GameContextService } from './game-context.service';
import { GameEventBusService } from '../events/game-event-bus.service';
import { InputContext } from './game-context.model';

@Injectable({ providedIn: 'root' })
export class InputRouterService {
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private context = inject(GameContextService);
  private eventBus = inject(GameEventBusService);

  private keyboardSubject = new Subject<KeyboardInfo>();
  private pointerSubject = new Subject<PointerInfo>();
  private globalKeySubject = new Subject<KeyboardEvent>();

  private isListening = false;
  private sceneKbObserver: Nullable<BabylonObserver<KeyboardInfo>> = null;
  private scenePtrObserver: Nullable<BabylonObserver<PointerInfo>> = null;

  public initializeListeners(): void {
    if (this.isListening) return;

    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    window.addEventListener('keydown', this.handleGlobalKeydown, true);
    window.addEventListener('keyup', this.handleGlobalKeyup, true);

    const scene = this.motor3d.getScene();
    if (scene) {
      this.attachToScene(scene);
    }

    this.isListening = true;
  }

  public attachToScene(scene: Scene): void {
    if (this.sceneKbObserver) {
      scene.onKeyboardObservable.remove(this.sceneKbObserver);
      this.sceneKbObserver = null;
    }
    if (this.scenePtrObserver) {
      scene.onPointerObservable.remove(this.scenePtrObserver);
      this.scenePtrObserver = null;
    }

    this.sceneKbObserver = scene.onKeyboardObservable.add((kbInfo) => {
      this.keyboardSubject.next(kbInfo);
    });

    this.scenePtrObserver = scene.onPointerObservable.add((pi) => {
      this.pointerSubject.next(pi);
    });
  }

  public disposeListeners(): void {
    if (!this.isListening) return;

    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    window.removeEventListener('keydown', this.handleGlobalKeydown, true);
    window.removeEventListener('keyup', this.handleGlobalKeyup, true);

    const scene = this.motor3d.getScene();
    if (scene) {
      if (this.sceneKbObserver) {
        scene.onKeyboardObservable.remove(this.sceneKbObserver);
        this.sceneKbObserver = null;
      }
      if (this.scenePtrObserver) {
        scene.onPointerObservable.remove(this.scenePtrObserver);
        this.scenePtrObserver = null;
      }
    }

    this.isListening = false;
  }

  public lockPointer(): void {
    const canvas = this.motor3d.getEngine()?.getRenderingCanvas();
    if (canvas && document.pointerLockElement !== canvas) {
      try { 
        canvas.focus();
        canvas.requestPointerLock(); 
      } catch (e) { 
        console.warn('[InputRouter] Fallo al bloquear el ratón:', e); 
      }
    }
  }

  public unlockPointer(): void {
    if (document.pointerLockElement) {
      try { 
        document.exitPointerLock(); 
      } catch (e) { 
        console.warn('[InputRouter] Fallo al liberar el ratón:', e); 
      }
    }
  }

  private handlePointerLockChange = () => {
    const isLocked = !!document.pointerLockElement;
    this.context.setPointerLocked(isLocked);
    if (isLocked) {
      this.eventBus.emit({ type: 'GameResumed' });
    } else {
      this.eventBus.emit({ type: 'GamePaused' });
    }
  };

  private isUiInputElement(target: HTMLElement | null): boolean {
    if (!target) return false;
    return target.tagName === 'INPUT' || 
           target.tagName === 'TEXTAREA' || 
           target.tagName === 'SELECT' || 
           target.isContentEditable;
  }

  private handleGlobalKeydown = (event: KeyboardEvent) => {
    if (this.isUiInputElement(event.target as HTMLElement)) return;
    this.globalKeySubject.next(event);
  };

  private handleGlobalKeyup = (event: KeyboardEvent) => {
    if (this.isUiInputElement(event.target as HTMLElement)) return;
    this.globalKeySubject.next(event);
  };

  public getKeyboardStream(allowedContexts: InputContext[]): Observable<KeyboardInfo> {
    return this.keyboardSubject.pipe(
      filter(() => {
        const currentCtx = this.context.inputContext();
        return allowedContexts.includes(currentCtx);
      })
    );
  }

  public getPointerStream(allowedContexts: InputContext[]): Observable<PointerInfo> {
    return this.pointerSubject.pipe(
      filter(() => {
        const currentCtx = this.context.inputContext();
        return allowedContexts.includes(currentCtx);
      })
    );
  }

  public getGlobalKeyboardStream(allowedContexts: InputContext[]): Observable<KeyboardEvent> {
    return this.globalKeySubject.pipe(
      filter(() => {
        const currentCtx = this.context.inputContext();
        return allowedContexts.includes(currentCtx);
      })
    );
  }
}