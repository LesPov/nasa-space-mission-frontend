

import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MissionModalService {
  // Modal: Crear Nuevo Episodio / Mapa
  public showCreateMapModal = false;
  public newMapTitle = '';
  public newMapDesc = '';

  public abrirCrearMapa(): void {
    this.newMapTitle = '';
    this.newMapDesc = '';
    this.showCreateMapModal = true;
  }

  public cerrarCrearMapa(): void {
    this.showCreateMapModal = false;
  }

  // Modal: Editar UI / Misión / Preview
  public showMissionModal = false;
  public missionModalMode: 'create' | 'edit' = 'create';
  public missionModalData: any = null;

  public abrirModalMision(esEdicion: boolean, episodioCompletoData: any, uiSettingsGlobal: any): void {
    this.missionModalMode = esEdicion ? 'edit' : 'create';
    if (esEdicion) {
      const uiSettings = uiSettingsGlobal || {};
      this.missionModalData = {
        title: episodioCompletoData?.title || '',
        description: episodioCompletoData?.description || '',
        ...uiSettings
      };
    } else {
      this.missionModalData = null;
    }
    this.showMissionModal = true;
  }

  public cerrarModalMision(): void {
    this.showMissionModal = false;
  }
}
