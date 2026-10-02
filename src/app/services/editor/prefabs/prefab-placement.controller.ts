import { Injectable, inject } from '@angular/core';
import { 
  Scene, Vector3, Matrix, AbstractMesh, Ray, 
  KeyboardEventTypes, PointerEventTypes, ArcRotateCamera
} from '@babylonjs/core';
import { GhostRendererService } from './ghost-renderer.service';
import { EditorSceneService } from '../editor-scene.service';
import { PlacementCalculatorService } from './placement-calculator.service';
import { GameEntity } from '../../../core/engine/entities/game.entity';
import { InputRouterService } from '../../../core/engine/session/input-router.service';
import { GameContextService } from '../../../core/engine/session/game-context.service';
import { GameEventBusService } from '../../../core/engine/events/game-event-bus.service';
import { Subscription } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PrefabPlacementController {
  private ghostRenderer = inject(GhostRendererService);
  private editorScene = inject(EditorSceneService);
  private placementCalculator = inject(PlacementCalculatorService);
  private inputRouter = inject(InputRouterService);
  private gameContext = inject(GameContextService);
  private eventBus = inject(GameEventBusService);

  public isBuilding = false;
  private currentAsset: any = null;
  private scene: Scene | null = null;
  private camera: any = null;
  private onCancel: () => void = () => {};
  private isModalOpenFn: () => boolean = () => false;
  private activePlayerFn: () => GameEntity | null = () => null;

  private kbSub: Subscription | null = null;
  private ptrSub: Subscription | null = null;
  private observerRender: any = null;

  private isAltPressed = false;
  private isGPressed = false;
  private isFPressed = false;
  private isShiftPressed = false; 
  private buildDistance = 15;
  
  private activeNudgeAxis: 'X' | 'Y' | 'Z' | null = null;
  private manualOffset = Vector3.Zero();
  private ghostConnIndex = -1; 

  private targetPosition = Vector3.Zero();
  private baseRotation = Vector3.Zero();
  private targetRotation = Vector3.Zero();
  private targetScale = Vector3.One(); 
  private ghostScale = Vector3.One();  
  private targetParent: AbstractMesh | null = null;
  private currentColor: 'green' | 'yellow' | 'blue' | 'red' = 'green';

  private keys = { w: false, a: false, s: false, d: false, space: false, c: false };
  private preventContextMenu = (e: Event) => e.preventDefault();

  private originalRadius: number = 10;
  private flyYaw = 0;
  private flyPitch = 0;

  public async start(asset: any, scene: Scene, camera: any, onCancel: () => void, isModalOpenFn: () => boolean, activePlayerFn: () => GameEntity | null) {
    this.stop(scene);
    this.isBuilding = true;
    this.currentAsset = asset;
    this.scene = scene;
    this.camera = camera;
    this.onCancel = onCancel;
    this.isModalOpenFn = isModalOpenFn;
    this.activePlayerFn = activePlayerFn;

    this.targetPosition = Vector3.Zero();
    this.baseRotation = Vector3.Zero();
    this.targetRotation = Vector3.Zero();
    this.targetParent = null;

    this.isAltPressed = false;
    this.isGPressed = false;
    this.isFPressed = false;
    this.isShiftPressed = false;
    this.activeNudgeAxis = null;
    this.manualOffset.setAll(0);
    this.buildDistance = 15;
    this.ghostConnIndex = -1;      
    this.keys = { w: false, a: false, s: false, d: false, space: false, c: false };
    
    if (this.camera && this.camera.getClassName() === 'ArcRotateCamera') {
        const arcCam = this.camera as ArcRotateCamera;
        this.originalRadius = arcCam.radius;
        
        const forward = arcCam.getDirection(Vector3.Forward());
        this.flyPitch = Math.asin(forward.y); 
        this.flyYaw = Math.atan2(forward.z, forward.x);
        
        arcCam.setTarget(arcCam.position.add(forward.scale(0.05)));
    }

    window.addEventListener('contextmenu', this.preventContextMenu);

    let sx = 1, sy = 1, sz = 1;
    const rootItem = asset.properties?.prefabHierarchy?.[0] || asset;
    
    if (rootItem.scale) {
      sx = rootItem.scale.x; sy = rootItem.scale.y; sz = rootItem.scale.z;
    } else if (asset.scale) {
      sx = asset.scale.x; sy = asset.scale.y; sz = asset.scale.z;
    }
    
    this.targetScale = new Vector3(sx, sy, sz);

    const internalScale = rootItem.properties?.internalScale;
    if (internalScale !== undefined && internalScale !== null) {
      this.ghostScale = new Vector3(sx * internalScale, sy * internalScale, sz * internalScale);
    } else {
      this.ghostScale = this.targetScale.clone();
    }

    await this.ghostRenderer.createGhost(asset, scene);
    
    if (!this.isBuilding) return; 

    this.ghostRenderer.setTransform(this.targetPosition, this.targetRotation, this.ghostScale);
    this.updateHUD(); 

    this.kbSub = this.inputRouter.getKeyboardStream(['EDITOR_EDITING', 'EDITOR_PLAYTEST', 'ADMIN_PREVIEW']).subscribe((kbInfo) => {
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        const code = kbInfo.event.code;
        const key = kbInfo.event.key.toLowerCase();

        if (code === 'KeyW' || key === 'w') this.keys.w = true;
        if (code === 'KeyA' || key === 'a') this.keys.a = true;
        if (code === 'KeyS' || key === 's') this.keys.s = true;
        if (code === 'KeyD' || key === 'd') this.keys.d = true;
        if (code === 'Space' || key === ' ') this.keys.space = true;
        if ((code === 'KeyC' || key === 'c') && !this.activeNudgeAxis) this.keys.c = true;
        
        if (kbInfo.event.key === 'Alt') this.isAltPressed = true;
        if (kbInfo.event.key === 'Shift') this.isShiftPressed = true;
        if (key === 'g') this.isGPressed = true;
        if (key === 'f') this.isFPressed = true;
        
        if (kbInfo.event.key === 'Escape') this.cancelBuild();
        
        if (key === 'x') { this.activeNudgeAxis = this.activeNudgeAxis === 'X' ? null : 'X'; this.updateHUD(); }
        if (key === 'y') { this.activeNudgeAxis = this.activeNudgeAxis === 'Y' ? null : 'Y'; this.updateHUD(); }
        if (key === 'z') { this.activeNudgeAxis = this.activeNudgeAxis === 'Z' ? null : 'Z'; this.updateHUD(); }
        if (key === 'c' && this.activeNudgeAxis) { this.manualOffset.setAll(0); this.updateHUD(); }

        if (key === 'r' && !kbInfo.event.repeat) {
          this.baseRotation.y += Math.PI / 2; 
          this.ghostConnIndex = -1; 
          this.updateHUD();
        }
      } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
        const code = kbInfo.event.code;
        const key = kbInfo.event.key.toLowerCase();

        if (code === 'KeyW' || key === 'w') this.keys.w = false;
        if (code === 'KeyA' || key === 'a') this.keys.a = false;
        if (code === 'KeyS' || key === 's') this.keys.s = false;
        if (code === 'KeyD' || key === 'd') this.keys.d = false;
        if (code === 'Space' || key === ' ') this.keys.space = false;
        if (code === 'KeyC' || key === 'c') this.keys.c = false;
        
        if (kbInfo.event.key === 'Alt') {
            this.isAltPressed = false;
            this.ghostConnIndex = -1; 
            this.ghostRenderer.updateDebugVisuals(false); 
            this.updateHUD();
        }
        if (kbInfo.event.key === 'Shift') this.isShiftPressed = false;
        if (key === 'g') this.isGPressed = false;
        if (key === 'f') this.isFPressed = false;
      }
    });

    this.ptrSub = this.inputRouter.getPointerStream(['EDITOR_EDITING', 'EDITOR_PLAYTEST', 'ADMIN_PREVIEW']).subscribe((pi) => {
      if (pi.type === PointerEventTypes.POINTERDOWN) {
        if (pi.event.button === 0) {
          if (!this.isModalOpenFn()) this.buildPrefab();
        } else if (pi.event.button === 2) {
          this.cancelBuild();
        }
      }
      
      if (pi.type === PointerEventTypes.POINTERMOVE) {
        if (this.gameContext.isPointerLocked() && this.camera && this.camera.getClassName() === 'ArcRotateCamera') {
           const arcCam = this.camera as ArcRotateCamera;
           const sens = 0.003;
           const moveX = pi.event.movementX || (pi.event as any).mozMovementX || (pi.event as any).webkitMovementX || 0;
           const moveY = pi.event.movementY || (pi.event as any).mozMovementY || (pi.event as any).webkitMovementY || 0;
           
           this.flyYaw -= moveX * sens;
           this.flyPitch -= moveY * sens;
           
           const halfPi = Math.PI / 2 - 0.01;
           if (this.flyPitch < -halfPi) this.flyPitch = -halfPi;
           if (this.flyPitch > halfPi) this.flyPitch = halfPi;
           
           const r = Math.cos(this.flyPitch);
           const dir = new Vector3(
              r * Math.cos(this.flyYaw),
              Math.sin(this.flyPitch),
              r * Math.sin(this.flyYaw)
           );
           
           const currentPos = arcCam.position.clone();
           arcCam.setTarget(currentPos.add(dir.scale(0.05)));
        }
      }

      if (pi.type === PointerEventTypes.POINTERWHEEL) {
        const event = pi.event as WheelEvent;
        const dir = Math.sign(event.deltaY) * -1;
        
        if (this.activeNudgeAxis) {
            event.preventDefault();
            const step = this.isShiftPressed ? 0.05 : 0.5; 
            const amount = dir * step;
            
            if (this.activeNudgeAxis === 'X') this.manualOffset.x += amount;
            if (this.activeNudgeAxis === 'Y') this.manualOffset.y += amount;
            if (this.activeNudgeAxis === 'Z') this.manualOffset.z += amount;
            
            this.updateHUD();
        } 
        else if (this.isAltPressed) {
            event.preventDefault(); 
            this.ghostConnIndex = (this.ghostConnIndex + dir + 6) % 6; 
        } 
        else {
            this.buildDistance = Math.max(2, Math.min(250, this.buildDistance + dir * 2));
        }
      }
    });

    this.observerRender = scene.onBeforeRenderObservable.add(() => {
      this.updatePlacementLogic();
    });
  }

  private updateHUD() {
    let msg = '';
    if (this.activeNudgeAxis) {
        msg = `[EJE ${this.activeNudgeAxis} ACTIVO] | Offset: (${this.manualOffset.x.toFixed(2)}, ${this.manualOffset.y.toFixed(2)}, ${this.manualOffset.z.toFixed(2)}) | [Wheel] Ajustar | [Shift] Fino | [C] Reset Offset | [X/Y/Z] Salir`;
    } else {
        msg = `[Click] Instanciar | [Click Der / ESC] Cancelar | [Mouse] Mirar | [WASD] Volar | [Espacio/C] Subir/Bajar | [F] Suelo | [ALT] Unir | [X/Y/Z] Offset | [R] Rotar`;
    }
    
    this.eventBus.emit({ 
        type: 'MessageRequested', 
        payload: { text: msg, durationMs: 999999 } 
    });
  }

  private handleCameraMovement() {
    if (!this.camera || this.camera.getClassName() !== 'ArcRotateCamera') return;
    const arcCam = this.camera as ArcRotateCamera;
    const engine = this.scene!.getEngine();
    
    let dt = engine.getDeltaTime() / 1000;
    if (dt > 0.1) dt = 0.1; 
    
    const speed = this.isShiftPressed ? 30 * dt : 12 * dt;
    const moveVector = Vector3.Zero();

    const forward = arcCam.getDirection(Vector3.Forward());
    const right = arcCam.getDirection(Vector3.Right());

    if (this.keys.w) moveVector.addInPlace(forward);
    if (this.keys.s) moveVector.addInPlace(forward.scale(-1));
    if (this.keys.d) moveVector.addInPlace(right);
    if (this.keys.a) moveVector.addInPlace(right.scale(-1));
    if (this.keys.space) moveVector.addInPlace(Vector3.Up());
    if (this.keys.c) moveVector.addInPlace(Vector3.Down());

    if (moveVector.lengthSquared() > 0) {
      moveVector.normalize().scaleInPlace(speed);
      arcCam.getTarget().addInPlace(moveVector);
      arcCam.getViewMatrix();
    }
  }

  private cancelBuild() {
    this.onCancel();
    this.stop(this.scene);
  }

  private updatePlacementLogic() {
    if (!this.scene || !this.camera || this.isModalOpenFn()) return;

    this.handleCameraMovement();

    let ray: Ray;
    if (this.gameContext.isPointerLocked()) {
      const engine = this.scene.getEngine();
      ray = this.scene.createPickingRay(engine.getRenderWidth() / 2, engine.getRenderHeight() / 2, Matrix.Identity(), this.camera);
    } else {
      ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), this.camera);
    }
    
    ray.length = this.buildDistance + 10;
    const playerEntity = this.activePlayerFn();

    const result = this.placementCalculator.calculatePlacement(
        this.scene, ray, playerEntity?.view, this.baseRotation, this.ghostScale,
        this.isAltPressed, this.isGPressed, this.isFPressed, this.buildDistance,
        this.ghostConnIndex,
        () => this.ghostRenderer.getLocalBoundingBox(),
        this.manualOffset 
    );

    this.targetPosition = result.position;
    this.targetRotation = result.rotation;
    this.currentColor = result.color;
    this.targetParent = result.parent;

    this.ghostRenderer.setColor(this.currentColor);
    this.ghostRenderer.setTransform(this.targetPosition, this.targetRotation, this.ghostScale);
    this.ghostRenderer.updateDebugVisuals(this.isAltPressed, result.debugTargetPos, result.debugGhostPos);
  }

  private buildPrefab() {
    if (!this.currentAsset || !this.scene) return;
    
    const asset = this.currentAsset;
    const pos = this.targetPosition.clone();
    const rot = this.targetRotation.clone();
    const parent = asset.targetParent !== undefined ? asset.targetParent : this.targetParent;

    if (asset.properties?.prefabHierarchy) {
      // AQUÍ ESTÁ EL ARREGLO: Pasamos this.targetScale.clone() en lugar de Vector3.One()
      this.editorScene.instanciarPrefabFull(asset, pos, rot, this.targetScale.clone(), parent || undefined);
    } else {
      const colorHex = asset.properties?.color || '#ffffff';
      const finalName = asset.exactName ? asset.name : `${asset.name}_${Math.floor(Math.random()*1000)}`;
      
      this.editorScene.agregarObjetoCustom(
        asset.type, finalName, asset.properties?.rol || 'prop', colorHex,
        this.targetScale.x, this.targetScale.y, this.targetScale.z,
        asset.asset || asset, asset.properties?.isSolid ?? true, asset.properties?.isSelectable ?? true, 
        asset.properties?.mensaje || '', parent, pos, rot
      );
    }
  }

  public stop(scene: Scene | null) {
    if (this.isBuilding) {
        this.eventBus.emit({ type: 'MessageRequested', payload: null });
    }
    
    if (this.camera && this.camera.getClassName() === 'ArcRotateCamera') {
        const arcCam = this.camera as ArcRotateCamera;
        const forward = arcCam.getDirection(Vector3.Forward());
        arcCam.setTarget(arcCam.position.add(forward.scale(this.originalRadius || 10)));
    }
    
    window.removeEventListener('contextmenu', this.preventContextMenu);
    this.isBuilding = false;
    this.ghostRenderer.destroyGhost();
    this.currentAsset = null;

    if (this.kbSub) { this.kbSub.unsubscribe(); this.kbSub = null; }
    if (this.ptrSub) { this.ptrSub.unsubscribe(); this.ptrSub = null; }
    
    if (scene && this.observerRender) {
      scene.onBeforeRenderObservable.remove(this.observerRender);
      this.observerRender = null;
    }
    
    this.targetParent = null;
  }
}