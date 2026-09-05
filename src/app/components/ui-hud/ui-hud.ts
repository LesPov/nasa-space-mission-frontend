
import { Component, Input, OnInit, OnDestroy, inject, signal, computed, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameEventBusService } from '../../core/engine/events/game-event-bus.service';
import { GameSession } from '../../core/engine/runtime/game-session';
import { GameEntity } from '../../core/engine/entities/game.entity';
import { AbstractMesh } from '@babylonjs/core';
import { Subscription } from 'rxjs';
import { UiDialogos } from '../ui-dialogos/ui-dialogos';
import { CinematicDirectorService } from '../../core/engine/runtime/systems/cinematic-director.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { OverlayValue } from '../../core/engine/models/cinematic.model';

@Component({
  selector: 'app-ui-hud',
  standalone: true,
  imports: [CommonModule, UiDialogos],
  templateUrl: './ui-hud.html',
  styleUrls: ['./ui-hud.css']
})
export class UiHud implements OnInit, OnDestroy {
  @Input() playState = 'PLAYING';
  @Input() hideStatus = false;

  public eventBus = inject(GameEventBusService);
  public gameSession = inject(GameSession);
  public gameContext = inject(GameContextService);
  public cdr = inject(ChangeDetectorRef);
  public cinematicDirector = inject(CinematicDirectorService);

  public hudMessage = signal<string | null>(null);
  public actionAvailable = signal<boolean>(false);
  public inspectAvailable = signal<boolean>(false);
  public targetInteractuable = signal<GameEntity | null>(null);
  public hoveredMesh = signal<AbstractMesh | null>(null);

  public canEdit = computed(() => this.gameContext.authorityProfile().canEdit);
  public canSelect = computed(() => this.gameContext.authorityProfile().canSelect);
  public canViewDebug = computed(() => this.gameContext.authorityProfile().canViewDebug);

  private sub!: Subscription;
  private messageTimer: any = null;

  ngOnInit() {
    this.sub = this.eventBus.events$.subscribe(event => {
      switch (event.type) {
        case 'MessageRequested': 
          if (event.payload === null) {
              this.hudMessage.set(null);
              if (this.messageTimer) clearTimeout(this.messageTimer);
          } else {
              const text = event.payload.text;
              const duration = event.payload.durationMs || 4500;
              this.hudMessage.set(text);
              if (this.messageTimer) clearTimeout(this.messageTimer);
              this.messageTimer = setTimeout(() => {
                  this.hudMessage.set(null);
                  this.cdr.detectChanges();
              }, duration);
          }
          break;
        case 'ObjectFocused':
          this.targetInteractuable.set(event.payload.entity);
          this.hoveredMesh.set(event.payload.mesh);
          this.actionAvailable.set(event.payload.canInteract);
          this.inspectAvailable.set(event.payload.canInspect);
          break;
      }
      this.cdr.detectChanges();
    });
  }

  // 🔥 MEJORA RENDIMIENTO: ngFor trackBy identifier impide la sobrecreación de nodos en Overlays
  public trackByOverlayId(index: number, state: any): string {
     return state.id;
  }

  public getOverlayTransform(state: any): string {
     let translateX = '-50%';
     let translateY = '-50%';
     const overlay = state.value;
     
     if (overlay.anchor === 'TOP_LEFT') { translateX = '0'; translateY = '0'; }
     else if (overlay.anchor === 'TOP_CENTER') { translateX = '-50%'; translateY = '0'; }
     else if (overlay.anchor === 'TOP_RIGHT') { translateX = '-100%'; translateY = '0'; }
     else if (overlay.anchor === 'CENTER_LEFT') { translateX = '0'; translateY = '-50%'; }
     else if (overlay.anchor === 'CENTER') { translateX = '-50%'; translateY = '-50%'; }
     else if (overlay.anchor === 'CENTER_RIGHT') { translateX = '-100%'; translateY = '-50%'; }
     else if (overlay.anchor === 'BOTTOM_LEFT') { translateX = '0'; translateY = '-100%'; }
     else if (overlay.anchor === 'BOTTOM_CENTER') { translateX = '-50%'; translateY = '-100%'; }
     else if (overlay.anchor === 'BOTTOM_RIGHT') { translateX = '-100%'; translateY = '-100%'; }

     const animX = state.tx;
     const animY = state.ty;
     const scale = state.scale * (overlay.scale ?? 1);

     return `translate(calc(${translateX} + ${animX}px), calc(${translateY} + ${animY}px)) scale(${scale})`;
  }

  public getContentTransform(state: any): string {
     const animX = state.contentTx || 0;
     const animY = state.contentTy || 0;
     const scale = state.contentScale !== undefined ? state.contentScale : 1;
     return `translate(${animX}px, ${animY}px) scale(${scale})`;
  }

  public getOverlayBackground(overlay: OverlayValue): string {
     if (overlay.bgType === 'SOLID' || overlay.bgType === 'TRANSPARENT') {
         return overlay.bgColor || '#000000';
     } else if (overlay.bgType === 'GRADIENT') {
         const colorA = overlay.bgColor || '#000000';
         const colorB = overlay.gradientColorB || '#000000';
         if (overlay.gradientDirection === 'RADIAL') {
             return `radial-gradient(circle at center, ${colorA} 0%, ${colorB} 100%)`;
         } else if (overlay.gradientDirection === 'LEFT_TO_RIGHT') {
             return `linear-gradient(to right, ${colorA}, ${colorB})`;
         } else if (overlay.gradientDirection === 'RIGHT_TO_LEFT') {
             return `linear-gradient(to left, ${colorA}, ${colorB})`;
         } else if (overlay.gradientDirection === 'BOTTOM_TO_TOP') {
             return `linear-gradient(to top, ${colorA}, ${colorB})`;
         } else {
             return `linear-gradient(to bottom, ${colorA}, ${colorB})`;
         }
     } else if (overlay.bgType === 'RADIAL_GRADIENT') {
         const c1Alpha = overlay.bgCenterOpacity !== undefined ? overlay.bgCenterOpacity : 0;
         const colorA = this.hexToRgba(overlay.bgColor || '#000000', c1Alpha);
         const colorB = this.hexToRgba(overlay.gradientColorB || '#000000', 1);
         const radius = overlay.bgRadius ?? 50;
         const cx = overlay.bgCenterX ?? 50;
         const cy = overlay.bgCenterY ?? 50;
         return `radial-gradient(circle at ${cx}% ${cy}%, ${colorA} 0%, ${colorB} ${radius}%, ${colorB} 100%)`;
     }
     return 'transparent';
  }

  public getOverlayBorder(overlay: OverlayValue): string {
     if (overlay.bgType === 'BORDER_ONLY') {
         return `${overlay.borderWidth || 1}px solid ${overlay.borderColor || '#ffffff'}`;
     }
     return 'none';
  }

  public getOverlayWidth(overlay: OverlayValue, type: string): string {
     if (type === 'background') return '100%';
     return overlay.width ? overlay.width + 'px' : 'auto';
  }

  public getOverlayHeight(overlay: OverlayValue, type: string): string {
     if (type === 'background') return '100%';
     return overlay.height ? overlay.height + 'px' : 'auto';
  }

  public getOverlayWidthPx(overlay: OverlayValue, type: string): number {
     return overlay.width ? overlay.width : 0;
  }

  public getOverlayHeightPx(overlay: OverlayValue, type: string): number {
     return overlay.height ? overlay.height : 0;
  }

  public getTextShadow(overlay: OverlayValue): string {
     if (!overlay.shadowEnabled) return 'none';
     return `${overlay.shadowOffsetX || 0}px ${overlay.shadowOffsetY || 2}px ${overlay.shadowBlur || 4}px ${overlay.shadowColor || 'rgba(0,0,0,0.8)'}`;
  }

  public getTextOutline(overlay: OverlayValue): string {
     if (!overlay.outlineEnabled) return 'none';
     return `${overlay.outlineWidth || 1}px ${overlay.outlineColor || '#000000'}`;
  }

  public getFontWeight(weight?: string): string {
     if (weight === 'Normal') return '400';
     if (weight === 'Medium') return '500';
     if (weight === 'Bold') return '700';
     if (weight === 'Black') return '900';
     return '600'; 
  }

  public getAlignItems(align?: string): string {
      if (align === 'left') return 'flex-start';
      if (align === 'right') return 'flex-end';
      return 'center';
  }

  private hexToRgba(hex: string, alpha: number): string {
      const cleanHex = hex.replace('#', '');
      if (cleanHex.length !== 6 && cleanHex.length !== 3) return `rgba(0,0,0,${alpha})`;
      let r, g, b;
      if (cleanHex.length === 3) {
          r = parseInt(cleanHex[0] + cleanHex[0], 16);
          g = parseInt(cleanHex[1] + cleanHex[1], 16);
          b = parseInt(cleanHex[2] + cleanHex[2], 16);
      } else {
          r = parseInt(cleanHex.substring(0, 2), 16);
          g = parseInt(cleanHex.substring(2, 4), 16);
          b = parseInt(cleanHex.substring(4, 6), 16);
      }
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
    if (this.messageTimer) clearTimeout(this.messageTimer);
  }
}