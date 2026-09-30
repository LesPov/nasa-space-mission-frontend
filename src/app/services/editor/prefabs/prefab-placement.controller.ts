
import { Injectable, inject } from '@angular/core';
import { 
  Scene, Vector3, Matrix, AbstractMesh, Ray, 
  KeyboardEventTypes, PointerEventTypes
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
  private isShiftPressed = false; // 🔥 NUEVO: Ajuste fino
  private buildDistance = 15;

  // 🔥 Control de Ajuste Manual
  private activeNudgeAxis: 'X' | 'Y' | 'Z' | null = null;
  private manualOffset = Vector3.Zero();

  // 🔥 Control indexado para la rueda del ratón
  private ghostConnIndex = -1; 

  private targetPosition = Vector3.Zero();
  private baseRotation = Vector3.Zero();
  private targetRotation = Vector3.Zero();
  
  private targetScale = Vector3.One(); 
  private ghostScale = Vector3.One();  
  
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
    this.ghostConnIndex = -1; // -1 = Modo Automático

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
    this.updateHUD(); // 🔥 NUEVO: Mostrar UI Inicial

    this.kbSub = this.inputRouter.getKeyboardStream(['EDITOR_EDITING', 'EDITOR_PLAYTEST', 'ADMIN_PREVIEW']).subscribe((kbInfo) => {
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        if (kbInfo.event.key === 'Alt') this.isAltPressed = true;
        if (kbInfo.event.key === 'Shift') this.isShiftPressed = true;
        if (kbInfo.event.key.toLowerCase() === 'g') this.isGPressed = true;
        if (kbInfo.event.key.toLowerCase() === 'f') this.isFPressed = true;
        if (kbInfo.event.key === 'Escape') this.cancelBuild();
        
        // 🔥 NUEVO: Selección de Ejes y Limpieza
        if (kbInfo.event.key.toLowerCase() === 'x') { this.activeNudgeAxis = this.activeNudgeAxis === 'X' ? null : 'X'; this.updateHUD(); }
        if (kbInfo.event.key.toLowerCase() === 'y') { this.activeNudgeAxis = this.activeNudgeAxis === 'Y' ? null : 'Y'; this.updateHUD(); }
        if (kbInfo.event.key.toLowerCase() === 'z') { this.activeNudgeAxis = this.activeNudgeAxis === 'Z' ? null : 'Z'; this.updateHUD(); }
        if (kbInfo.event.key.toLowerCase() === 'c') { this.manualOffset.setAll(0); this.updateHUD(); }

        // 🔥 FIX ROTACIÓN: Devuelve el control a Automático (-1) para que el algoritmo busque el encaje perfecto con la nueva base 
        if (kbInfo.event.key.toLowerCase() === 'r' && !kbInfo.event.repeat) {
          this.baseRotation.y += Math.PI / 2; 
          this.ghostConnIndex = -1; 
          this.updateHUD();
        }
      } else if (kbInfo.type === KeyboardEventTypes.KEYUP) {
        if (kbInfo.event.key === 'Alt') {
            this.isAltPressed = false;
            this.ghostConnIndex = -1; // Resetear anclaje manual al soltar
            this.ghostRenderer.updateDebugVisuals(false); // Ocultar debug points
            this.updateHUD();
        }
        if (kbInfo.event.key === 'Shift') this.isShiftPressed = false;
        if (kbInfo.event.key.toLowerCase() === 'g') this.isGPressed = false;
        if (kbInfo.event.key.toLowerCase() === 'f') this.isFPressed = false;
      }
    });

    this.ptrSub = this.inputRouter.getPointerStream(['EDITOR_EDITING', 'EDITOR_PLAYTEST', 'ADMIN_PREVIEW']).subscribe((pi) => {
      if (pi.type === PointerEventTypes.POINTERDOWN && pi.event.button === 0) {
        if (!this.isModalOpenFn()) this.buildPrefab();
      }
      if (pi.type === PointerEventTypes.POINTERDOWN && pi.event.button === 2) {
        this.cancelBuild();
      }
      if (pi.type === PointerEventTypes.POINTERWHEEL) {
        const event = pi.event as WheelEvent;
        const dir = Math.sign(event.deltaY) * -1; // -1 invierte para que wheel up = positivo
        
        // 🔥 LÓGICA DE CONTROL MANUAL DE OFFSET (Prioridad Máxima si hay eje activo)
        if (this.activeNudgeAxis) {
            event.preventDefault();
            const step = this.isShiftPressed ? 0.05 : 0.5; // Ajuste Fino / Ajuste Normal (Metros)
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

  // 🔥 NUEVO: Función para mantener el HUD sincronizado con el estado
  private updateHUD() {
    let msg = '';
    if (this.activeNudgeAxis) {
        msg = `⚙️ EJE [${this.activeNudgeAxis}] ACTIVO | Offset: (${this.manualOffset.x.toFixed(2)}, ${this.manualOffset.y.toFixed(2)}, ${this.manualOffset.z.toFixed(2)}) | [Wheel] Ajustar | [Shift] Fino | [C] Reset Offset | [X/Y/Z] Salir`;
    } else {
        msg = `Construcción: [Clic] Colocar | [Clic Der] Cancelar | [F] Suelo | [ALT] Unir | [X/Y/Z] Mover Manual | [R] Rotar`;
    }
    
    this.eventBus.emit({ 
        type: 'MessageRequested', 
        payload: { text: msg, durationMs: 999999 } 
    });
  }

  private cancelBuild() {
    this.onCancel();
    this.stop(this.scene);
  }

  private updatePlacementLogic() {
    if (!this.scene || !this.camera || this.isModalOpenFn()) return;

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
        this.manualOffset // 🔥 Pasamos el Offset al calculador
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
    const rot = this.targetRotation.clone(); // 🔥 Se guarda la rotación combinada final
    const parent = asset.targetParent !== undefined ? asset.targetParent : this.targetParent;

    if (asset.properties?.prefabHierarchy) {
      this.editorScene.instanciarPrefabFull(asset, pos, rot, this.targetScale, parent || undefined);
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

