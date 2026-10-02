import { Injectable, inject } from '@angular/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { CameraOwnershipService } from '../../core/engine/runtime/cameras/camera-ownership.service';
import { EditorStateService } from './editor-state.service';
import { Subscription } from 'rxjs';
import { PrefabPlacementController } from './prefabs/prefab-placement.controller';
import { InputOrchestratorService } from '../../core/engine/runtime/systems/input-orchestrator.service';

@Injectable({ providedIn: 'root' })
export class LiveBuilderService {
  private placementCtrl = inject(PrefabPlacementController);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private eventBus = inject(GameEventBusService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private state = inject(EditorStateService);
  private inputOrchestrator = inject(InputOrchestratorService);
  private sub: Subscription | null = null;

  public initialize(): void {
    if (this.sub) return;
    this.sub = this.eventBus.events$.subscribe(e => {
      if (e.type === 'AssetSelectedForBuild') {
        if (e.payload) {
            const scene = this.motor3d.getScene();
            const camera = this.ownership.getCamera();
            
            if (scene && camera) {
                this.detachEditorCamera();
                
                const canvas = this.motor3d.getEngine().getRenderingCanvas();
                if (canvas) {
                    canvas.focus();
                    this.inputOrchestrator.lockPointer();
                }

                this.placementCtrl.start(
                    e.payload, 
                    scene, 
                    camera, 
                    () => {
                        this.eventBus.emit({ type: 'RadialMenuToggled', payload: false });
                        this.restoreEditorCamera(); 
                        this.inputOrchestrator.unlockPointer();
                    },
                    () => this.state.showAddObjectModal(),
                    () => this.context.activePlayerEntity()
                );
            }
        } else {
            this.stopBuilding();
        }
      }
    });

    window.addEventListener('blur', () => {
        this.stopBuilding();
        this.eventBus.emit({ type: 'RadialMenuToggled', payload: false });
    });
  }

  public isBuilding(): boolean {
    return this.placementCtrl.isBuilding;
  }

  public stopBuilding(): void {
    if (this.placementCtrl.isBuilding) {
        this.placementCtrl.stop(this.motor3d.getScene());
        this.inputOrchestrator.unlockPointer();
        this.restoreEditorCamera();
    }
  }

  public destroy(): void {
    this.stopBuilding();
    if (this.sub) {
        this.sub.unsubscribe();
        this.sub = null;
    }
  }

  private detachEditorCamera(): void {
    if (this.state.playState() === 'EDITOR' || this.state.playState() === 'EDITING_IN_GAME') {
        const editorCam = this.motor3d.getEditorCamera();
        if (editorCam) {
            editorCam.detachControl();
        }
    }
  }

  private restoreEditorCamera(): void {
    if (this.state.playState() === 'EDITOR' || this.state.playState() === 'EDITING_IN_GAME') {
        const editorCam = this.motor3d.getEditorCamera();
        const canvas = this.motor3d.getEngine().getRenderingCanvas();
        if (editorCam && canvas) {
            setTimeout(() => {
               try { editorCam.attachControl(canvas, true); } catch(e) {}
            }, 50);
        }
    }
  }
}