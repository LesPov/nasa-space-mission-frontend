import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';

import { EditorMapaService } from '../../../../services/editor-mapa.service';
import { Motor3dService } from '../../../../services/motor-3d.service';

@Component({
  selector: 'app-prop-mission',
  standalone: true, 
  imports: [CommonModule, FormsModule],
  templateUrl: './prop-mission.html',
  styleUrls: ['./prop-mission.css']
})
export class PropMission implements OnInit, OnDestroy {
  public editorSvc = inject(EditorMapaService);
  private motor3dSvc = inject(Motor3dService);
  private cdr = inject(ChangeDetectorRef);
  private subs: Subscription[] = [];

  public uiSettings = {
    primaryColor: '#ef4444',
    bgColor: '#0f172a',
    bgOpacity: 0.85,
    overlayColor: '#050508',
    overlayOpacity: 0.7,
    blurIntensity: 8,
    borderRadius: 12,
    textColor: '#cbd5e1',
    loreQuote: '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."',
    loreAuthor: 'Anónimo',
    initialSequence: '',
    objetivos: '',
    recompensas: ''
  };

  ngOnInit() {
    this.leerEstadoActual();
    
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => {})
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  leerEstadoActual() {
    const scene = this.motor3dSvc.scene;
    if (!scene) return;

    const metadataUI = scene.metadata?.uiSettings || {};

    this.uiSettings = {
      primaryColor: metadataUI.primaryColor || '#ef4444',
      bgColor: metadataUI.bgColor || '#0f172a',
      bgOpacity: metadataUI.bgOpacity ?? 0.85,
      overlayColor: metadataUI.overlayColor || '#050508',
      overlayOpacity: metadataUI.overlayOpacity ?? 0.7,
      blurIntensity: metadataUI.blurIntensity ?? 8,
      borderRadius: metadataUI.borderRadius ?? 12,
      textColor: metadataUI.textColor || '#cbd5e1',
      loreQuote: metadataUI.loreQuote || '',
      loreAuthor: metadataUI.loreAuthor || '',
      initialSequence: metadataUI.initialSequence || '',
      objetivos: Array.isArray(metadataUI.objetivos) ? metadataUI.objetivos.join('\n') : (metadataUI.objetivos || ''),
      recompensas: Array.isArray(metadataUI.recompensas) ? metadataUI.recompensas.join('\n') : (metadataUI.recompensas || '')
    };

    this.cdr.detectChanges();
  }

  aplicarCambios() {
    const scene = this.motor3dSvc.scene;
    if (!scene) return;

    const objStr = typeof this.uiSettings.objetivos === 'string' ? this.uiSettings.objetivos : (this.uiSettings.objetivos as any).join('\n');
    const recStr = typeof this.uiSettings.recompensas === 'string' ? this.uiSettings.recompensas : (this.uiSettings.recompensas as any).join('\n');

    const objetivosArray = objStr.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    const recompensasArray = recStr.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);

    // 🔥 FIX: Cast explícito de campos numéricos (inputs type=number) para evitar que se guarden como String 
    const newSettings = {
      ...this.uiSettings,
      bgOpacity: Number(this.uiSettings.bgOpacity),
      overlayOpacity: Number(this.uiSettings.overlayOpacity),
      blurIntensity: Number(this.uiSettings.blurIntensity),
      borderRadius: Number(this.uiSettings.borderRadius),
      objetivos: objetivosArray,
      recompensas: recompensasArray
    };

    scene.metadata = { 
      ...(scene.metadata || {}), 
      uiSettings: newSettings 
    };

    const epiData = this.editorSvc.episodioActualData();
    if (epiData) {
      epiData.uiSettings = newSettings;
    }

    this.editorSvc.triggerUpdate(); 
  }
}