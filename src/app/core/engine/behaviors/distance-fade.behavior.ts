
import { Behavior, Mesh } from '@babylonjs/core';
import { LoopManagerService } from './services/loop-manager.service';
import { EntityManagerService } from '../entities/entity-manager.service';
import { CameraOwnershipService } from '../runtime/cameras/camera-ownership.service';
 
export class DistanceFadeBehavior implements Behavior<Mesh> {
  public attachedNode: Mesh | null = null;

  constructor(
    private loopManager: LoopManagerService,
    private entityManager: EntityManagerService,
    private ownership: CameraOwnershipService
  ) {}

  get name(): string {
    return 'DistanceFadeBehavior';
  }

  init(): void {}

  attach(target: Mesh): void {
    this.attachedNode = target;
    
    // 🔥 OPTIMIZACIÓN EXTREMA: A petición del creador, la niebla ya NO oculta ni desvanece 
    // objetos mediante cálculos por frame iterando mallas. 
    // Esto elimina el 100% del lag ocasionado por la niebla al cargar el nivel o activarla.
    // El culling de lo que no se ve lo gestionan las sombras y el frustum nativo de BabylonJS.
    if (this.attachedNode) {
      this.attachedNode.visibility = 1;
      this.attachedNode.getChildMeshes().forEach(child => child.visibility = 1);
    }
  }

  detach(): void {
    this.attachedNode = null;
  }
}