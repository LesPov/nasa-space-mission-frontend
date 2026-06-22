import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, MeshBuilder, Color4 } from '@babylonjs/core';
import { EpisodiosService } from '../../services/api/episodios';

@Component({
  selector: 'app-mini-visor-escena',
  standalone: true,
  template: `<canvas #previewCanvas class="canvas-mini"></canvas>`,
  styles: [`
    .canvas-mini {
      width: 100%;
      height: 100%;
      touch-action: none;
      outline: none;
      border: none;
      cursor: grab;
      border-radius: 8px 8px 0 0;
    }
    .canvas-mini:active { cursor: grabbing; }
  `]
})
export class MiniVisorEscena implements OnInit, OnDestroy {
  @Input() episodioId!: number;
  @ViewChild('previewCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  
  private epiApiSvc = inject(EpisodiosService);
  private engine!: Engine;
  private scene!: Scene;

  ngOnInit() {
    this.engine = new Engine(this.canvasRef.nativeElement, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.09, 0.16, 1);

    const camera = new ArcRotateCamera('cam', Math.PI / 4, Math.PI / 3, 20, Vector3.Zero(), this.scene);
    camera.attachControl(this.canvasRef.nativeElement, true);
    camera.wheelPrecision = 30;

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
               const box = MeshBuilder.CreateBox(obj.name, {size: 1}, this.scene);
               box.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
               box.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
            } else if (obj.type === 'sphere') {
               const sphere = MeshBuilder.CreateSphere(obj.name, {diameter: 1}, this.scene);
               sphere.position = new Vector3(obj.position.x, obj.position.y, obj.position.z);
               sphere.scaling = new Vector3(obj.scale.x, obj.scale.y, obj.scale.z);
            }
         });
       },
       error: (err: any) => console.error(err)
    });

    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
    
    const resizeObserver = new ResizeObserver(() => this.engine.resize());
    resizeObserver.observe(this.canvasRef.nativeElement);
  }

  ngOnDestroy() {
    if(this.engine) {
      this.engine.stopRenderLoop();
      this.scene.dispose();
      this.engine.dispose();
    }
  }
}