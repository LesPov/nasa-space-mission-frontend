
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CinematicDirectorService } from '../../../core/engine/runtime/systems/cinematic-director.service';
 
@Component({
  selector: 'app-cinematic-overlay',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cinematic-overlay.component.html',
  styleUrls: ['./cinematic-overlay.component.css']
})
export class CinematicOverlayComponent {
  public director = inject(CinematicDirectorService);

  get overlays() {
    return this.director.activeOverlays();
  }

  getBgStyle(el: any) {
    const v = el.value;
    const isFull = v.fullscreenBg;

    let style: any = {
      'position': 'absolute',
      'opacity': el.opacity, 
      'background': this.getBackground(v),
      'pointer-events': 'none',
    };

    if (v.bgType === 'BORDER_ONLY' || v.borderColor) {
        style['border'] = `${v.borderWidth || 0}px solid ${v.borderColor || 'transparent'}`;
    }

    if (isFull) {
        style['top'] = '0';
        style['left'] = '0';
        style['width'] = '100vw';
        style['height'] = '100vh';
        style['border-radius'] = '0px';
    } else {
        style['top'] = `${(v.positionY ?? 0.5) * 100}%`;
        style['left'] = `${(v.positionX ?? 0.5) * 100}%`;
        style['width'] = v.width ? `${v.width}px` : '100%';
        style['height'] = v.height ? `${v.height}px` : '100%';
        style['border-radius'] = `${v.borderRadius || 0}px`;
        
        const anchorT = this.getAnchorTransform(v.anchor);
        style['transform'] = `translate(calc(${anchorT.x}% + ${el.tx}%), calc(${anchorT.y}% + ${el.ty}%)) scale(${el.scale})`;
    }

    if (v.shadowEnabled && v.bgType !== 'NONE') {
        style['box-shadow'] = `${v.shadowOffsetX || 0}px ${v.shadowOffsetY || 0}px ${v.shadowBlur || 0}px ${v.shadowColor || 'rgba(0,0,0,0.5)'}`;
    }

    return style;
  }

  getContentStyle(el: any) {
    const v = el.value;
    let style: any = {
      'position': 'absolute',
      'opacity': el.contentOpacity, 
      'pointer-events': 'none',
      'display': 'flex',
      'justify-content': 'center',
      'align-items': 'center',
      'top': `${(v.positionY ?? 0.5) * 100}%`,
      'left': `${(v.positionX ?? 0.5) * 100}%`,
      'width': v.width ? `${v.width}px` : '100%',
      'height': v.height ? `${v.height}px` : '100%',
      'padding': `${v.paddingY || 0}px ${v.paddingX || 0}px`
    };

    const anchorT = this.getAnchorTransform(v.anchor);
    const finalScale = el.contentScale * (v.scale ?? 1);
    style['transform'] = `translate(calc(${anchorT.x}% + ${el.contentTx}%), calc(${anchorT.y}% + ${el.contentTy}%)) scale(${finalScale})`;

    return style;
  }

  getImageStyle(v: any) {
     let fit = 'contain';
     if (v.fitMode === 'COVER') fit = 'cover';
     if (v.fitMode === 'STRETCH') fit = 'fill';

     return {
        'object-fit': fit,
        'width': v.imageWidth ? `${v.imageWidth}px` : '100%',
        'height': v.imageHeight ? `${v.imageHeight}px` : '100%',
        'max-width': v.maxWidth ? `${v.maxWidth}px` : '100%',
        'max-height': v.maxHeight ? `${v.maxHeight}px` : '100%',
        'transform': v.rotation ? `rotate(${v.rotation}deg)` : 'none'
     };
  }

  getTextStyle(v: any) {
      return {
         'font-family': v.fontFamily || 'sans-serif',
         'font-size': `${v.fontSize || 32}px`,
         'font-weight': v.fontWeight || 'normal',
         'font-style': v.fontStyle || 'normal',
         'text-align': v.textAlign || 'center',
         'text-transform': v.textTransform || 'none',
         'letter-spacing': `${v.letterSpacing || 0}px`,
         'line-height': v.lineHeight || 1.2,
         'color': v.color || '#ffffff',
         'text-shadow': v.shadowEnabled ? `${v.shadowOffsetX || 0}px ${v.shadowOffsetY || 0}px ${v.shadowBlur || 0}px ${v.shadowColor || '#000'}` : 'none',
         '-webkit-text-stroke': v.outlineEnabled ? `${v.outlineWidth || 1}px ${v.outlineColor || '#000'}` : 'none'
      };
  }

  private getBackground(v: any): string {
    if (!v.bgType || v.bgType === 'NONE' || v.bgType === 'BORDER_ONLY') return 'transparent';
    
    if (v.bgType === 'SOLID' || v.bgType === 'TRANSPARENT') {
        return v.bgColor || '#000000';
    }
    
    if (v.bgType === 'RADIAL_GRADIENT') {
        const c1Alpha = v.bgCenterOpacity !== undefined ? v.bgCenterOpacity : 0;
        const c1 = this.hexToRgba(v.bgColor || '#000000', c1Alpha);
        const c2 = this.hexToRgba(v.gradientColorB || '#000000', 1);
        const x = v.bgCenterX ?? 50;
        const y = v.bgCenterY ?? 50;
        const r = v.bgRadius ?? 50;
        return `radial-gradient(circle at ${x}% ${y}%, ${c1} 0%, ${c2} ${r}%, ${c2} 100%)`;
    }
    
    if (v.bgType === 'GRADIENT') {
        const c1 = v.bgColor || '#000000';
        const c2 = v.gradientColorB || '#000000';
        let dir = 'to bottom';
        if (v.gradientDirection === 'BOTTOM_TO_TOP') dir = 'to top';
        if (v.gradientDirection === 'LEFT_TO_RIGHT') dir = 'to right';
        if (v.gradientDirection === 'RIGHT_TO_LEFT') dir = 'to left';
        if (v.gradientDirection === 'RADIAL') {
            return `radial-gradient(circle at 50% 50%, ${c1} 0%, ${c2} 100%)`;
        }
        return `linear-gradient(${dir}, ${c1}, ${c2})`;
    }

    return 'transparent';
  }

  private hexToRgba(hex: string, alpha: number): string {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    if (c.length !== 6) return `rgba(0,0,0,${alpha})`;
    const r = parseInt(c.substring(0, 2), 16);
    const g = parseInt(c.substring(2, 4), 16);
    const b = parseInt(c.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private getAnchorTransform(anchor: string) {
    switch(anchor) {
        case 'TOP_LEFT': return {x: 0, y: 0};
        case 'TOP_CENTER': return {x: -50, y: 0};
        case 'TOP_RIGHT': return {x: -100, y: 0};
        case 'CENTER_LEFT': return {x: 0, y: -50};
        case 'CENTER': return {x: -50, y: -50};
        case 'CENTER_RIGHT': return {x: -100, y: -50};
        case 'BOTTOM_LEFT': return {x: 0, y: -100};
        case 'BOTTOM_CENTER': return {x: -50, y: -100};
        case 'BOTTOM_RIGHT': return {x: -100, y: -100};
        default: return {x: -50, y: -50};
    }
  }
}