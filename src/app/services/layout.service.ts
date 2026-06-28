

import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LayoutService {
  // Por defecto el menú es visible
  public menuVisible = signal<boolean>(true);

  ocultarMenu() {
    this.menuVisible.set(false);
  }

  mostrarMenu() {
    this.menuVisible.set(true);
  }
}

