
import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { EpisodiosService } from '../../services/api/episodios';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-ui-radial-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-radial-menu.html',
  styleUrls: ['./ui-radial-menu.css']
})
export class UiRadialMenu implements OnInit, OnDestroy {
  private eventBus = inject(GameEventBusService);
  private apiSvc = inject(EpisodiosService);
  private cdr = inject(ChangeDetectorRef);

  public isOpen = false;
  public hoveredAsset: any = null;
  public displayAssets: any[] = [];
  
  private sub!: Subscription;

  ngOnInit() {
    this.sub = this.eventBus.events$.subscribe(e => {
      if (e.type === 'RadialMenuToggled') {
        this.isOpen = e.payload;
        if (this.isOpen && this.displayAssets.length === 0) {
            this.fetchAssets();
        }
        this.cdr.detectChanges();
      }
    });

    // Mezclar primitivas base
    this.displayAssets = [
      { id: 'prim_1', name: 'Cubo', type: 'cube', path: null },
      { id: 'prim_2', name: 'Esfera', type: 'sphere', path: null },
      { id: 'prim_3', name: 'Cilindro', type: 'cylinder', path: null }
    ];
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  private fetchAssets() {
    this.apiSvc.obtenerAssets().subscribe(assets => {
       const models = assets.filter(a => a.type === 'model_glb').map(a => ({
           id: a.id,
           name: a.name,
           type: 'model',
           path: a.path
       }));
       // Tomar máximo 8 objetos para que el círculo no se rompa (estilo consola)
       // Primitivas + Modelos
       this.displayAssets = [...this.displayAssets.filter(a => !a.path), ...models].slice(0, 8);
       this.cdr.detectChanges();
    });
  }

  // Matemáticas para distribuir los ítems en un círculo
  public getItemTransform(index: number): string {
    const total = this.displayAssets.length;
    const angle = (360 / total) * index;
    // Empezar desde arriba (-90deg)
    const offsetAngle = angle - 90; 
    // Radio del círculo: 180px
    return `rotate(${offsetAngle}deg) translate(180px)`;
  }

  // Para que los iconos no giren de cabeza
  public getInverseRotation(index: number): string {
    const total = this.displayAssets.length;
    const angle = (360 / total) * index;
    const offsetAngle = angle - 90;
    return `rotate(${-offsetAngle}deg)`;
  }

  public selectAsset(asset: any) {
    this.eventBus.emit({ type: 'AssetSelectedForBuild', payload: asset });
    
    // Forzar el cierre simulando que el usuario soltó la tecla
    // Ojo: PlayerInputService aún cree que la tecla Q está abajo, pero se corregirá al soltarla.
    this.isOpen = false;
    this.eventBus.emit({ type: 'RadialMenuToggled', payload: false });
    
    // Devolvemos el ratón al juego
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.requestPointerLock();
    
    this.cdr.detectChanges();
  }
}