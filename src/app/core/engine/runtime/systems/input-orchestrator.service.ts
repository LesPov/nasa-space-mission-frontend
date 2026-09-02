
import { Injectable, inject } from '@angular/core';
import { InputRouterService } from '../../session/input-router.service';
 
/**
 * Adaptador de compatibilidad para la gestión de Pointer Lock.
 * Centraliza las llamadas a través de InputRouterService.
 */
@Injectable({ providedIn: 'root' })
export class InputOrchestratorService {
  private inputRouter = inject(InputRouterService);

  public initializeListeners(): void {
    this.inputRouter.initializeListeners();
  }

  // 🔥 FIX: Permite forzar el enganche manual al canvas y la escena, solucionando el bug de movimiento en Producción
  public attachToScene(scene: any): void {
    this.inputRouter.attachToScene(scene);
  }

  public disposeListeners(): void {
    this.inputRouter.disposeListeners();
  }

  public lockPointer(): void {
    this.inputRouter.lockPointer();
  }

  public unlockPointer(): void {
    this.inputRouter.unlockPointer();
  }
}