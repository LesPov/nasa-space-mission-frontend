
import { Injectable, inject } from '@angular/core';
import { SCENE_ACCESS_TOKEN, ISceneAccess } from '../../core/engine/scene/scene-access.token';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { CameraOwnershipService } from '../../core/engine/runtime/cameras/camera-ownership.service';
import { EditorStateService } from './editor-state.service';
import { Subscription } from 'rxjs';
import { PrefabPlacementController } from './prefabs/prefab-placement.controller';

@Injectable({ providedIn: 'root' })
export class LiveBuilderService {
  private placementCtrl = inject(PrefabPlacementController);
  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private eventBus = inject(GameEventBusService);
  private context = inject(GameContextService);
  private ownership = inject(CameraOwnershipService);
  private state = inject(EditorStateService);

  private sub: Subscription | null = null;

  public initialize(): void {
    if (this.sub) return;

    this.sub = this.eventBus.events$.subscribe(e => {
      if (e.type === 'AssetSelectedForBuild') {
        if (e.payload) {
            const scene = this.motor3d.getScene();
            const camera = this.ownership.getCamera();
            
            // 🔥 FIX 2: SOLUCIÓN AL FANTASMA DEL PREFAB GIGANTE
            // Le forzamos la escala real extraída del Prefab al objeto Payload 
            // antes de mandarlo al PlacementController para que lo respete.
            if (e.payload.properties?.prefabHierarchy?.[0]?.scale) {
                const s = e.payload.properties.prefabHierarchy[0].scale;
                e.payload.scale = { ...s };
                e.payload.scaling = { ...s };
            }

            if (scene && camera) {
                this.placementCtrl.start(
                    e.payload, 
                    scene, 
                    camera, 
                    () => this.eventBus.emit({ type: 'RadialMenuToggled', payload: false }),
                    () => this.state.showAddObjectModal(),
                    () => this.context.activePlayerEntity()
                );
            }
        } else {
            this.placementCtrl.stop(this.motor3d.getScene());
        }
      }
    });

    window.addEventListener('blur', () => {
        this.placementCtrl.stop(this.motor3d.getScene());
        this.eventBus.emit({ type: 'RadialMenuToggled', payload: false });
    });
  }

  public isBuilding(): boolean {
    return this.placementCtrl.isBuilding;
  }

  public destroy(): void {
    this.placementCtrl.stop(this.motor3d.getScene());
    if (this.sub) {
        this.sub.unsubscribe();
        this.sub = null;
    }
  }
}