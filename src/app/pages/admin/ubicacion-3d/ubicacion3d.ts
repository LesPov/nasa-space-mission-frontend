
import { Component, ElementRef, OnInit, OnDestroy, ViewChild, inject, signal, NgZone } from '@angular/core';
import { Vector3, Observer, Scene, ArcRotateCamera, Camera, Animation, CubicEase, EasingFunction } from '@babylonjs/core';
import { CameraOwnershipService } from '../../../core/engine/runtime/cameras/camera-ownership.service';
import { ISceneAccess, SCENE_ACCESS_TOKEN } from '../../../core/engine/scene/scene-access.token';

interface AxisObj {
  id: string; 
  vec: Vector3; 
  color: string; 
  label: string;
  lineEl?: SVGLineElement; 
  hitEl?: SVGLineElement;
  textEl?: SVGTextElement;
  currentGroup?: 'front' | 'back';
  targetAlpha?: number;
  targetBeta?: number;
}

@Component({
  selector: 'app-ubicacion3d',
  standalone: true,
  templateUrl: './ubicacion3d.html',
  styleUrls: ['./ubicacion3d.css']
})
export class Ubicacion3D implements OnInit, OnDestroy {
  @ViewChild('backLines', { static: true }) backLines!: ElementRef<SVGGElement>;
  @ViewChild('frontLines', { static: true }) frontLines!: ElementRef<SVGGElement>;
  @ViewChild('hitGroup', { static: true }) hitGroup!: ElementRef<SVGGElement>;
  @ViewChild('labelsGroup', { static: true }) labelsGroup!: ElementRef<SVGGElement>;

  private motor3d: ISceneAccess = inject(SCENE_ACCESS_TOKEN);
  private ownership = inject(CameraOwnershipService);
  private ngZone = inject(NgZone);
  private observer: Observer<Scene> | null = null;
  private cleanupEvents: Array<() => void> = [];

  // Estado Reactivo Angular
  public isOrtho = signal<boolean>(false);
  public widgetSize = signal<'normal' | 'large'>('normal');
  
  private axes: AxisObj[] = [
    { id: 'XPos', vec: new Vector3(1,0,0), color: '#ef4444', label: 'X', targetAlpha: 0, targetBeta: Math.PI / 2 },
    { id: 'XNeg', vec: new Vector3(-1,0,0), color: '#ef4444', label: '-X', targetAlpha: Math.PI, targetBeta: Math.PI / 2 },
    { id: 'YPos', vec: new Vector3(0,1,0), color: '#4ade80', label: 'Y', targetAlpha: undefined, targetBeta: 0.01 }, // Top
    { id: 'YNeg', vec: new Vector3(0,-1,0), color: '#4ade80', label: '-Y', targetAlpha: undefined, targetBeta: Math.PI - 0.01 }, // Bottom
    { id: 'ZPos', vec: new Vector3(0,0,1), color: '#3b82f6', label: 'Z', targetAlpha: Math.PI / 2, targetBeta: Math.PI / 2 }, // Front
    { id: 'ZNeg', vec: new Vector3(0,0,-1), color: '#3b82f6', label: '-Z', targetAlpha: -Math.PI / 2, targetBeta: Math.PI / 2 } // Back
  ];

  ngOnInit() {
    this.initializeSVG();
    const scene = this.motor3d.getScene();
    if (scene) {
      this.observer = scene.onBeforeRenderObservable.add(() => this.updateOrientation());
    }
  }

  private initializeSVG() {
    const NS = 'http://www.w3.org/2000/svg';
    this.axes.forEach(axis => {
      // 1. Línea Visual
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('stroke', axis.color);
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('marker-end', `url(#arrow-${axis.id})`);
      line.setAttribute('x1', '60');
      line.setAttribute('y1', '60');
      line.style.transition = 'all 0.1s ease-out';
      axis.lineEl = line;

      // 2. Zona de Impacto (Hit Area invisible)
      const hitLine = document.createElementNS(NS, 'line');
      hitLine.setAttribute('stroke', 'transparent');
      hitLine.setAttribute('stroke-width', '16'); 
      hitLine.setAttribute('stroke-linecap', 'round');
      hitLine.setAttribute('x1', '60');
      hitLine.setAttribute('y1', '60');
      hitLine.style.cursor = 'pointer';
      hitLine.style.pointerEvents = 'stroke';
      axis.hitEl = hitLine;
      this.hitGroup.nativeElement.appendChild(hitLine);

      // 3. Etiqueta de Texto
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('fill', axis.color);
      text.textContent = axis.label;
      text.style.paintOrder = 'stroke fill';
      text.style.stroke = 'rgba(15, 23, 42, 0.9)';
      text.style.strokeWidth = '4px';
      text.style.strokeLinecap = 'round';
      text.style.strokeLinejoin = 'round';
      text.style.cursor = 'pointer';
      text.style.pointerEvents = 'all';
      text.style.transition = 'all 0.1s ease-out';
      axis.textEl = text;
      this.labelsGroup.nativeElement.appendChild(text);

      // 4. Lógica de Interacción (Hover y Click)
      const onEnter = () => {
          axis.lineEl!.setAttribute('stroke-width', '5');
          axis.lineEl!.style.filter = 'brightness(1.4)';
          axis.textEl!.style.filter = 'brightness(1.5)';
          axis.textEl!.setAttribute('font-size', '13');
      };
      
      const onLeave = () => {
          axis.lineEl!.setAttribute('stroke-width', '3');
          axis.lineEl!.style.filter = 'none';
          axis.textEl!.style.filter = 'none';
          axis.textEl!.setAttribute('font-size', '11');
      };

      const onClick = (e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
          this.goToAxis(axis);
      };

      // Adjuntar escuchadores
      hitLine.addEventListener('mouseenter', onEnter);
      hitLine.addEventListener('mouseleave', onLeave);
      hitLine.addEventListener('click', onClick);

      text.addEventListener('mouseenter', onEnter);
      text.addEventListener('mouseleave', onLeave);
      text.addEventListener('click', onClick);

      // Registrar para limpieza
      this.cleanupEvents.push(() => {
         hitLine.removeEventListener('mouseenter', onEnter);
         hitLine.removeEventListener('mouseleave', onLeave);
         hitLine.removeEventListener('click', onClick);
         text.removeEventListener('mouseenter', onEnter);
         text.removeEventListener('mouseleave', onLeave);
         text.removeEventListener('click', onClick);
      });
    });
  }

  private updateOrientation() {
    const cam = this.ownership.getCamera() || this.motor3d.getEditorCamera();
    if (!cam) return;

    // Actualiza Dinámicamente Configuración de la Cámara
    if (cam.getClassName() === 'ArcRotateCamera') {
       const arcCam = cam as ArcRotateCamera;
       const orthoState = arcCam.mode === Camera.ORTHOGRAPHIC_CAMERA;
       
       if (this.isOrtho() !== orthoState) {
           this.ngZone.run(() => this.isOrtho.set(orthoState));
       }

       // Si está en 2D, el zoom de la rueda modifica el radio; esto lo refleja en el marco ortográfico
       if (orthoState) {
           const engine = this.motor3d.getEngine();
           const ratio = engine.getRenderWidth() / engine.getRenderHeight();
           const halfHeight = arcCam.radius * Math.tan(arcCam.fov / 2);
           arcCam.orthoTop = halfHeight;
           arcCam.orthoBottom = -halfHeight;
           arcCam.orthoLeft = -halfHeight * ratio;
           arcCam.orthoRight = halfHeight * ratio;
       }
    }

    // Actualiza Renderizado 3D del Widget
    const viewMatrix = cam.getViewMatrix().getRotationMatrix();
    const center = 60;
    const length = 40;
    const textOffset = 18;

    this.axes.forEach(axis => {
      const transformed = Vector3.TransformCoordinates(axis.vec, viewMatrix);
      
      const endX = center + transformed.x * length;
      const endY = center - transformed.y * length; 
      
      axis.lineEl!.setAttribute('x2', endX.toString());
      axis.lineEl!.setAttribute('y2', endY.toString());
      
      axis.hitEl!.setAttribute('x2', endX.toString());
      axis.hitEl!.setAttribute('y2', endY.toString());

      const labelX = center + transformed.x * (length + textOffset);
      const labelY = center - transformed.y * (length + textOffset);
      axis.textEl!.setAttribute('x', labelX.toString());
      axis.textEl!.setAttribute('y', (labelY + 4).toString());

      if (transformed.z > 0) {
         if (axis.currentGroup !== 'back') {
             axis.lineEl!.setAttribute('opacity', '0.35');
             this.backLines.nativeElement.appendChild(axis.lineEl!);
             axis.textEl!.setAttribute('opacity', '0.6');
             axis.currentGroup = 'back';
         }
      } else {
         if (axis.currentGroup !== 'front') {
             axis.lineEl!.setAttribute('opacity', '1.0');
             this.frontLines.nativeElement.appendChild(axis.lineEl!);
             axis.textEl!.setAttribute('opacity', '1.0');
             axis.currentGroup = 'front';
         }
      }
    });
  }

  private getShortestAngle(current: number, target: number): number {
    const tau = Math.PI * 2;
    current = ((current % tau) + tau) % tau;
    target = ((target % tau) + tau) % tau;
    
    let diff = target - current;
    if (diff > Math.PI) diff -= tau;
    if (diff < -Math.PI) diff += tau;
    
    return diff;
  }

  private goToAxis(axis: AxisObj) {
    const cam = this.ownership.getCamera();
    // Previene interferir con el juego en Live Test
    if (!cam || this.ownership.getOwner() !== 'EDITOR') return;
    if (cam.getClassName() !== 'ArcRotateCamera') return;

    const arcCam = cam as ArcRotateCamera;
    
    const currentAlpha = arcCam.alpha;
    const targetAlpha = axis.targetAlpha !== undefined ? axis.targetAlpha : currentAlpha;
    const targetBeta = axis.targetBeta !== undefined ? axis.targetBeta : arcCam.beta;

    const diff = this.getShortestAngle(currentAlpha, targetAlpha);
    const finalAlpha = currentAlpha + diff;

    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const fps = 60;
    const frames = 30; // 0.5 segundos

    const animAlpha = new Animation("camAlpha", "alpha", fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    animAlpha.setKeys([{ frame: 0, value: currentAlpha }, { frame: frames, value: finalAlpha }]);
    animAlpha.setEasingFunction(ease);

    const animBeta = new Animation("camBeta", "beta", fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    animBeta.setKeys([{ frame: 0, value: arcCam.beta }, { frame: frames, value: targetBeta }]);
    animBeta.setEasingFunction(ease);

    this.motor3d.getScene()?.beginDirectAnimation(arcCam, [animAlpha, animBeta], 0, frames, false);
  }

  public on2DClick() {
    const cam = this.ownership.getCamera();
    if (!cam || this.ownership.getOwner() !== 'EDITOR') return;
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.isOrtho.set(true);
  }

  public on3DClick() {
    const cam = this.ownership.getCamera();
    if (!cam || this.ownership.getOwner() !== 'EDITOR') return;
    cam.mode = Camera.PERSPECTIVE_CAMERA;
    this.isOrtho.set(false);
  }

  public onSizeClick() {
    this.widgetSize.set(this.widgetSize() === 'normal' ? 'large' : 'normal');
  }

  ngOnDestroy() {
    const scene = this.motor3d.getScene();
    if (scene && this.observer) {
      scene.onBeforeRenderObservable.remove(this.observer);
    }
    this.cleanupEvents.forEach(fn => fn());
    this.cleanupEvents = [];
  }
}