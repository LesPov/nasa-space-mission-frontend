import { Injectable, inject } from '@angular/core';
import { 
  Scene, Vector3, Matrix, AbstractMesh, Ray, 
  KeyboardEventTypes, PointerEventTypes, Observer 
} from '@babylonjs/core';
import { GhostRendererService } from './ghost-renderer.service';
import { EditorSceneService } from '../editor-scene.service';
import { PlacementCalculatorService } from './placement-calculator.service';
import { GameEntity } from '../../../core/engine/entities/game.entity';

@Injectable({ providedIn: 'root' })
export class PrefabPlacementController {
  private ghostRenderer = inject(GhostRendererService);
  private editorScene = inject(EditorSceneService);
  private placementCalculator = inject(PlacementCalculatorService);

  public isBuilding = false;
  private currentAsset: any = null;
  private scene: Scene | null = null;
  private camera: any = null;
  
  private onCancel: () => void = () => {};
  private isModalOpenFn: () => boolean = () => false;
  private activePlayerFn: () => GameEntity | null = () => null;

  private observerPointer: Observer<any> | null = null;
  private observerKeyboard: Observer<any> | null = null;
  private observerRender: Observer<any> | null = null;

  private isAltPressed = false;
  private isGPressed = false;
  private buildDistance = 15;

  private targetPosition = Vector3.Zero();
  private targetRotation = Vector3.Zero();
  private targetParent: AbstractMesh | null = null;
  private currentColor: 'green' | 'yellow' | 'blue' | 'red' = 'green';

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
    this.targetRotation = Vector3.Zero();
    this.targetParent = null;
    this.isAltPressed = false;
    this.isGPressed = false;
    this.buildDistance = 15;

    await this.ghostRenderer.createGhost(asset, scene);
    if (!this.isBuilding) return; 

    this.observerKeyboard = scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        if (kbInfo.event.key === 'Alt') this.isAltPressed = true;
        if (kbInfo.event.key.toLowerCase() === 'g') this.isGPressed = true;
        if (kbInfo.event.key === 'Escape') this.cancelBuild();
        
        if (kbInfo.event.key.toLowerCase() === 'r') {
          this.targetRotation.y += Math.PI / 2; 
        }
      } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
        if (kbInfo.event.key === 'Alt') this.isAltPressed = false;
        if (kbInfo.event.key.toLowerCase() === 'g') this.isGPressed = false;
      }
    });

    this.observerPointer = scene.onPointerObservable.add((pi) => {
      if (pi.type === PointerEventTypes.POINTERDOWN && pi.event.button === 0) {
        if (!this.isModalOpenFn()) this.buildPrefab();
      }
      if (pi.type === PointerEventTypes.POINTERDOWN && pi.event.button === 2) {
        this.cancelBuild();
      }
      if (pi.type === PointerEventTypes.POINTERWHEEL) {
        const event = pi.event as WheelEvent;
        const zoomDir = Math.sign(event.deltaY);
        this.buildDistance = Math.max(2, Math.min(100, this.buildDistance - zoomDir * 2));
      }
    });

    this.observerRender = scene.onBeforeRenderObservable.add(() => {
      this.updatePlacementLogic();
    });
  }

  private cancelBuild() {
    this.onCancel();
    this.stop(this.scene);
  }

  private updatePlacementLogic() {
    if (!this.scene || !this.camera || this.isModalOpenFn()) return;

    let ray: Ray;
    if (document.pointerLockElement) {
      const engine = this.scene.getEngine();
      ray = this.scene.createPickingRay(engine.getRenderWidth() / 2, engine.getRenderHeight() / 2, Matrix.Identity(), this.camera);
    } else {
      ray = this.scene.createPickingRay(this.scene.pointerX, this.scene.pointerY, Matrix.Identity(), this.camera);
    }
    
    ray.length = this.buildDistance + 10;
    
    const playerEntity = this.activePlayerFn();
    const bounds = this.ghostRenderer.getBoundingInfo(this.targetRotation);

    const result = this.placementCalculator.calculatePlacement(
        this.scene, 
        ray, 
        playerEntity?.view, 
        bounds, 
        this.isAltPressed, 
        this.isGPressed, 
        this.buildDistance
    );

    this.targetPosition = result.position;
    this.currentColor = result.color;
    this.targetParent = result.parent;

    this.ghostRenderer.setColor(this.currentColor);
    this.ghostRenderer.setTransform(this.targetPosition, this.targetRotation, Vector3.One());
  }

  private buildPrefab() {
    if (!this.currentAsset || !this.scene) return;

    const asset = this.currentAsset;
    const pos = this.targetPosition.clone();
    const rot = this.targetRotation.clone();
    const parent = this.targetParent;

    if (asset.isPrefab && asset.type) {
      const colorHex = asset.properties?.color || '#ffffff';
      this.editorScene.agregarObjetoCustom(
        asset.type,
        `${asset.name}_${Math.floor(Math.random()*1000)}`,
        'prop',
        colorHex,
        1, 1, 1,
        null,
        true, true, '',
        parent,
        pos, rot
      );
    } else {
      this.editorScene.instanciarPrefabFull(asset, pos, rot, Vector3.One(), parent || undefined);
    }
  }

  public stop(scene: Scene | null) {
    this.isBuilding = false;
    this.ghostRenderer.destroyGhost();
    this.currentAsset = null;

    if (scene) {
      if (this.observerKeyboard) scene.onKeyboardObservable.remove(this.observerKeyboard);
      if (this.observerPointer) scene.onPointerObservable.remove(this.observerPointer);
      if (this.observerRender) scene.onBeforeRenderObservable.remove(this.observerRender);
    }
    this.observerKeyboard = null;
    this.observerPointer = null;
    this.observerRender = null;
    this.targetParent = null;
  }
}