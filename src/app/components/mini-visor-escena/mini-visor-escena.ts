
import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, MeshBuilder, Color4 } from '@babylonjs/core';
import { EpisodiosService } from '../../services/api/episodios';

@Component({
  selector: 'app-mini-visor-escena',
  standalone: true,
  imports: [CommonModule],
  // 🔥 FIX: Alternamos entre el canvas (oculto temporalmente) y una imagen estática
  template: `
    <img *ngIf="snapshotUrl" [src]="snapshotUrl" class="canvas-mini" alt="Preview Escena" />
    <canvas *ngIf="!snapshotUrl" #previewCanvas class="canvas-mini" style="visibility: hidden;"></canvas>
  `,
  styles: [`
    .canvas-mini {
      width: 100%;
      height: 100%;
      touch-action: none;
      outline: none;
      border: none;
      object-fit: cover;
      border-radius: 8px 8px 0 0;
    }
  `]
})
export class MiniVisorEscena implements OnInit, OnDestroy {
  @Input() episodioId!: number;
  @ViewChild('previewCanvas', { static: false }) canvasRef?: ElementRef<HTMLCanvasElement>;
  
  private epiApiSvc = inject(EpisodiosService);
  private engine: Engine | null = null;
  private scene: Scene | null = null;

  public snapshotUrl: string | null = null;

  ngOnInit() {
    // Le damos un respiro al hilo principal antes de renderizar miniaturas para evitar tirones
    setTimeout(() => {
      this.generarSnapshot();
    }, 100);
  }

  private generarSnapshot() {
    if (!this.canvasRef) return;
    
    // 🔥 FIX: Creamos el motor, renderizamos 1 SOLO FRAME, tomamos una foto y destruimos el motor.
    // Esto salva la memoria de la tarjeta de video y evita el GL_CONTEXT_LOST (crasheo de WebGL).
    this.engine = new Engine(this.canvasRef.nativeElement, true, { preserveDrawingBuffer: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.09, 0.16, 1);

    const camera = new ArcRotateCamera('cam', Math.PI / 4, Math.PI / 3, 20, Vector3.Zero(), this.scene);
    
    const light = new HemisphericLight('light', new Vector3(0, 1, 0), this.scene);
    light.intensity = 0.8;

    const axesSize = 10; 
    MeshBuilder.CreateLines("ejeX", { points: [new Vector3(-axesSize, 0, 0), new Vector3(axesSize, 0, 0)], colors: [new Color4(1, 0.2, 0.2, 1), new Color4(1, 0.2, 0.2, 1)] }, this.scene);
    MeshBuilder.CreateLines("ejeY", { points: [new Vector3(0, -axesSize, 0), new Vector3(0, axesSize, 0)], colors: [new Color4(0.2, 1, 0.2, 1), new Color4(0.2, 1, 0.2, 1)] }, this.scene);
    MeshBuilder.CreateLines("ejeZ", { points: [new Vector3(0, 0, -axesSize), new Vector3(0, 0, axesSize)], colors: [new Color4(0.2, 0.5, 1, 1), new Color4(0.2, 0.5, 1, 1)] }, this.scene);
    
    const gridSize = 20; 
    const gridStep = 2;
    const ptsGrid: Vector3[][] = [];
    const colorsGrid: Color4[][] = [];
    const colorGris = new Color4(0.3, 0.3, 0.3, 0.5); 
    for (let i = -gridSize; i <= gridSize; i += gridStep) {
      if (i === 0) continue; 
      ptsGrid.push([new Vector3(i, 0, -gridSize), new Vector3(i, 0, gridSize)]);
      colorsGrid.push([colorGris, colorGris]);
      ptsGrid.push([new Vector3(-gridSize, 0, i), new Vector3(gridSize, 0, i)]);
      colorsGrid.push([colorGris, colorGris]);
    }
    MeshBuilder.CreateLineSystem("gridHelper", { lines: ptsGrid, colors: colorsGrid }, this.scene);

    this.epiApiSvc.obtenerEscenaCompleta(this.episodioId).subscribe({
       next: (res: any) => {
         const objects = res.sceneObjects || [];
         objects.forEach((obj: any) => {
            if (obj.type === 'cube') {
               const box = MeshBuilder.CreateBox(obj.name, {size: 1}, this.scene!);
               box.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
               box.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
            } else if (obj.type === 'sphere') {
               const sphere = MeshBuilder.CreateSphere(obj.name, {diameter: 1}, this.scene!);
               sphere.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
               sphere.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
            }
         });

         // Renderizamos y tomamos la captura
         this.scene!.executeWhenReady(() => {
            this.scene!.render();
            if (this.canvasRef) {
                this.snapshotUrl = this.canvasRef.nativeElement.toDataURL('image/jpeg', 0.8);
            }
            this.liberarMemoria();
         });
       },
       error: (err: any) => {
           console.error(err);
           this.liberarMemoria();
       }
    });
  }

  private liberarMemoria() {
    if (this.scene) { this.scene.dispose(); this.scene = null; }
    if (this.engine) { this.engine.dispose(); this.engine = null; }
  }

  ngOnDestroy() {
    this.liberarMemoria();
  }
}