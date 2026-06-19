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

  // Valores por defecto
  public uiSettings = {
    primaryColor: '#ef4444',
    bgColor: '#0f172a',
    bgOpacity: 0.85,
    textColor: '#cbd5e1',
    loreQuote: '"La historia no la escriben los que obedecen, sino los que se atreven a cambiarla."',
    loreAuthor: 'Anónimo',
    initialSequence: '',
    objetivos: '',
    recompensas: ''
  };

  ngOnInit() {
    this.leerEstadoActual();
    
    // Escuchamos por si ocurre un deshacer (Ctrl+Z) o carga externa para refrescar los datos
    this.subs.push(
      this.editorSvc.onMapChanged.subscribe(() => {
         // No forzamos lectura aquí para no interrumpir al usuario mientras teclea,
         // el ngModel ya mantiene el estado visual en sincronía.
      })
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
      textColor: metadataUI.textColor || '#cbd5e1',
      loreQuote: metadataUI.loreQuote || '',
      loreAuthor: metadataUI.loreAuthor || '',
      initialSequence: metadataUI.initialSequence || '',
      // Extraemos los Arrays y los convertimos en texto con saltos de línea para el textarea
      objetivos: Array.isArray(metadataUI.objetivos) ? metadataUI.objetivos.join('\n') : (metadataUI.objetivos || ''),
      recompensas: Array.isArray(metadataUI.recompensas) ? metadataUI.recompensas.join('\n') : (metadataUI.recompensas || '')
    };

    this.cdr.detectChanges();
  }

  aplicarCambios() {
    const scene = this.motor3dSvc.scene;
    if (!scene) return;

    // Procesamos los textos separando por salto de línea para generar los Arrays limpios
    const objetivosArray = this.uiSettings.objetivos.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    const recompensasArray = this.uiSettings.recompensas.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    const newSettings = {
      ...this.uiSettings,
      objetivos: objetivosArray,
      recompensas: recompensasArray
    };

    // Sobrescribimos en el motor (Esto alimenta en vivo al componente ui-mission)
    scene.metadata = { 
      ...(scene.metadata || {}), 
      uiSettings: newSettings 
    };

    // Actualizamos el objeto del episodio en memoria para que el autoguardado lo envíe al Backend
    const epiData = this.editorSvc.episodioActualData();
    if (epiData) {
      epiData.uiSettings = newSettings;
    }

    this.editorSvc.triggerUpdate(); 
  }
}