
import { vi } from 'vitest';

export function setupBrowserMocks() {
  const g = globalThis as any;
  if (typeof g !== 'undefined') {
    // 1. Mock de BroadcastChannel para WindowSyncService
    if (!g.BroadcastChannel) {
      g.BroadcastChannel = class {
        name: string;
        onmessage: any = null;
        constructor(name: string) { this.name = name; }
        postMessage(msg: any) {}
        close() {}
      } as any;
    }
    
    // 2. Mock de Audio API para PlayerTriggerService
    if (!g.Audio) {
      g.Audio = class {
        volume = 1;
        play() { return Promise.resolve(); }
        pause() {}
      } as any;
    }

    // 3. Mock de Objetos de Ventana y Documento
    if (!g.window) {
      g.window = g;
    }
    if (!g.window.open) g.window.open = vi.fn();
    if (!g.window.addEventListener) g.window.addEventListener = vi.fn();
    if (!g.window.removeEventListener) g.window.removeEventListener = vi.fn();
    if (!g.alert) g.alert = vi.fn();
    
    if (!g.document) {
      g.document = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        querySelector: vi.fn(),
        body: { style: {} }
      } as any;
    }

    // 4. Mock de Portapapeles (Clipboard)
    if (!g.navigator) {
      g.navigator = {};
    }
    if (!g.navigator.clipboard) {
      g.navigator.clipboard = {
        writeText: vi.fn().mockResolvedValue(undefined)
      } as any;
    }

    // 5. Mock de ResizeObserver
    if (!g.ResizeObserver) {
      g.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  }
}