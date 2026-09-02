
import { Injectable, inject } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { KeyboardInfo, PointerInfo, Scene } from '@babylonjs/core';
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

  public initializeListeners(): void {
    if (this.isListening) return;
    
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    window.addEventListener('keydown', this.handleGlobalKeydown, true);
    window.addEventListener('keyup', this.handleGlobalKeydown, true);

    const scene = this.motor3d.getScene();
    if (scene) {
      scene.onKeyboardObservable.add((kbInfo) => {
        this.keyboardSubject.next(kbInfo);
      });
      scene.onPointerObservable.add((pi) => {
        this.pointerSubject.next(pi);
      });
    }

    this.isListening = true;
  }

  public disposeListeners(): void {
    if (!this.isListening) return;
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    window.removeEventListener('keydown', this.handleGlobalKeydown, true);
    window.removeEventListener('keyup', this.handleGlobalKeydown, true);
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

  private handleGlobalKeydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    
    this.globalKeySubject.next(event);
  };

  public getKeyboardStream(allowedContexts: InputContext[]): Observable<KeyboardInfo> {
    return this.keyboardSubject.pipe(
      filter(() => allowedContexts.includes(this.context.inputContext()))
    );
  }

  public getPointerStream(allowedContexts: InputContext[]): Observable<PointerInfo> {
    return this.pointerSubject.pipe(
      filter(() => allowedContexts.includes(this.context.inputContext()))
    );
  }

  public getGlobalKeyboardStream(): Observable<KeyboardEvent> {
    return this.globalKeySubject.asObservable();
  }
}