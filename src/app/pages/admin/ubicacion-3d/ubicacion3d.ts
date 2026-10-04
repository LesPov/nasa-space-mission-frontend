
// file: src/app/pages/admin/ubicacion-3d/ubicacion3d.ts
import { Component, ElementRef, OnInit, OnDestroy, ViewChild, inject, signal, NgZone } from '@angular/core';
import { Vector3, Observer, Scene, ArcRotateCamera, Camera, Animation, CubicEase, EasingFunction, Matrix } from '@babylonjs/core';
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

  public isOrtho = signal<boolean>(false);
  public widgetSize = signal<'normal' | 'large'>('normal');

  private lastAlpha = -9999;
  private lastBeta = -9999;
  private lastRadius = -9999;
  private lastCameraMode: number | null = null;

  private _transformedVec = Vector3.Zero();
  private _cachedRotMatrix = Matrix.Identity();
  
  private axes: AxisObj[] = [
    { id: 'XPos', vec: new Vector3(1,0,0), color: '#ef4444', label: 'X', targetAlpha: 0, targetBeta: Math.PI / 2 },
    { id: 'XNeg', vec: new Vector3(-1,0,0), color: '#ef4444', label: '-X', targetAlpha: Math.PI, targetBeta: Math.PI / 2 },
    { id: 'YPos', vec: new Vector3(0,1,0), color: '#4ade80', label: 'Y', targetAlpha: undefined, targetBeta: 0.01 },
    { id: 'YNeg', vec: new Vector3(0,-1,0), color: '#4ade80', label: '-Y', targetAlpha: undefined, targetBeta: Math.PI - 0.01 },
    { id: 'ZPos', vec: new Vector3(0,0,1), color: '#3b82f6', label: 'Z', targetAlpha: Math.PI / 2, targetBeta: Math.PI / 2 },
    { id: 'ZNeg', vec: new Vector3(0,0,-1), color: '#3b82f6', label: '-Z', targetAlpha: -Math.PI / 2, targetBeta: Math.PI / 2 }
  ];

  ngOnInit(): void {
    this.initializeSVG();
    const scene = this.motor3d.getScene();
    if (scene) {
      // Ejecución estricta fuera de Angular Zone sin disparar Change Detection por frame
      this.ngZone.runOutsideAngular(() => {
        this.observer = scene.onBeforeRenderObservable.add(() => this.updateOrientation());
      });
    }
  }

  private initializeSVG(): void {
    const NS = 'http://www.w3.org/2000/svg';
    this.axes.forEach(axis => {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('stroke', axis.color);
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('marker-end', `url(#arrow-${axis.id})`);
      line.setAttribute('x1', '60');
      line.setAttribute('y1', '60');
      axis.lineEl = line;

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
      axis.textEl = text;
      this.labelsGroup.nativeElement.appendChild(text);

      this.frontLines.nativeElement.appendChild(line);
      axis.currentGroup = 'front';

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

      hitLine.addEventListener('mouseenter', onEnter);
      hitLine.addEventListener('mouseleave', onLeave);
      hitLine.addEventListener('click', onClick);

      text.addEventListener('mouseenter', onEnter);
      text.addEventListener('mouseleave', onLeave);
      text.addEventListener('click', onClick);

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

  private updateOrientation(): void {
    const cam = this.ownership.getCamera() || this.motor3d.getEditorCamera();
    if (!cam) return;

    if (cam.getClassName() === 'ArcRotateCamera') {
      const arcCam = cam as ArcRotateCamera;
      const orthoState = arcCam.mode === Camera.ORTHOGRAPHIC_CAMERA;
       
      if (this.lastCameraMode !== arcCam.mode) {
        this.lastCameraMode = arcCam.mode;
        this.ngZone.run(() => this.isOrtho.set(orthoState));
      }

      if (orthoState) {
        const engine = this.motor3d.getEngine();
        const ratio = engine.getRenderWidth() / engine.getRenderHeight();
        const halfHeight = arcCam.radius * Math.tan(arcCam.fov / 2);
        arcCam.orthoTop = halfHeight;
        arcCam.orthoBottom = -halfHeight;
        arcCam.orthoLeft = -halfHeight * ratio;
        arcCam.orthoRight = halfHeight * ratio;
      }

      // Evita recalcular y re-renderizar nodos SVG si el ángulo de la cámara es prácticamente idéntico
      if (Math.abs(arcCam.alpha - this.lastAlpha) < 0.002 &&
          Math.abs(arcCam.beta - this.lastBeta) < 0.002 &&
          Math.abs(arcCam.radius - this.lastRadius) < 0.02) {
        return;
      }
      this.lastAlpha = arcCam.alpha;
      this.lastBeta = arcCam.beta;
      this.lastRadius = arcCam.radius;
    }

    cam.getViewMatrix().getRotationMatrixToRef(this._cachedRotMatrix);
    const center = 60;
    const length = 40;
    const textOffset = 18;

    for (let i = 0; i < this.axes.length; i++) {
      const axis = this.axes[i];
      Vector3.TransformCoordinatesToRef(axis.vec, this._cachedRotMatrix, this._transformedVec);
      
      const endX = center + this._transformedVec.x * length;
      const endY = center - this._transformedVec.y * length; 
      
      axis.lineEl!.setAttribute('x2', endX.toFixed(1));
      axis.lineEl!.setAttribute('y2', endY.toFixed(1));
      
      axis.hitEl!.setAttribute('x2', endX.toFixed(1));
      axis.hitEl!.setAttribute('y2', endY.toFixed(1));

      const labelX = center + this._transformedVec.x * (length + textOffset);
      const labelY = center - this._transformedVec.y * (length + textOffset);
      axis.textEl!.setAttribute('x', labelX.toFixed(1));
      axis.textEl!.setAttribute('y', (labelY + 4).toFixed(1));

      if (this._transformedVec.z > 0) {
        if (axis.currentGroup !== 'back') {
          axis.lineEl!.style.opacity = '0.35';
          axis.textEl!.style.opacity = '0.45';
          axis.currentGroup = 'back';
        }
      } else {
        if (axis.currentGroup !== 'front') {
          axis.lineEl!.style.opacity = '1.0';
          axis.textEl!.style.opacity = '1.0';
          axis.currentGroup = 'front';
        }
      }
    }
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

  private goToAxis(axis: AxisObj): void {
    const cam = this.ownership.getCamera();
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
    const frames = 25;

    const animAlpha = new Animation("camAlpha", "alpha", fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    animAlpha.setKeys([{ frame: 0, value: currentAlpha }, { frame: frames, value: finalAlpha }]);
    animAlpha.setEasingFunction(ease);

    const animBeta = new Animation("camBeta", "beta", fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    animBeta.setKeys([{ frame: 0, value: arcCam.beta }, { frame: frames, value: targetBeta }]);
    animBeta.setEasingFunction(ease);

    this.motor3d.getScene()?.beginDirectAnimation(arcCam, [animAlpha, animBeta], 0, frames, false, 1.0);
  }

  public on2DClick(): void {
    const cam = this.ownership.getCamera();
    if (!cam || this.ownership.getOwner() !== 'EDITOR') return;
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.isOrtho.set(true);
  }

  public on3DClick(): void {
    const cam = this.ownership.getCamera();
    if (!cam || this.ownership.getOwner() !== 'EDITOR') return;
    cam.mode = Camera.PERSPECTIVE_CAMERA;
    this.isOrtho.set(false);
  }

  public onSizeClick(): void {
    this.widgetSize.set(this.widgetSize() === 'normal' ? 'large' : 'normal');
  }

  ngOnDestroy(): void {
    const scene = this.motor3d.getScene();
    if (scene && this.observer) {
      scene.onBeforeRenderObservable.remove(this.observer);
    }
    this.cleanupEvents.forEach(fn => fn());
    this.cleanupEvents = [];
  }
}