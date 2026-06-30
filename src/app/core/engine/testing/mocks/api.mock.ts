import { of } from 'rxjs';
import { SceneSavePayload } from '../../models/api-dto.model';

export class MockEpisodiosService {
  private memoryStore: Record<number, SceneSavePayload> = {};

  obtenerEscenaCompleta(sceneId: number) {
    if (this.memoryStore[sceneId]) {
      return of(this.memoryStore[sceneId]);
    }
    return of({
      scene: { id: sceneId, name: 'Test Platform' },
      sceneObjects: [],
      triggers: [],
      environmentSettings: {},
      cinematics: []
    });
  }

  guardarMapaEscena(sceneId: number, mapData: SceneSavePayload) {
    this.memoryStore[sceneId] = JSON.parse(JSON.stringify(mapData));
    return of({ success: true });
  }

  obtenerEpisodios() {
    return of([{ id: 1, title: 'Test Episode' }]);
  }

  obtenerPlataformasEscena(epiId: number) {
    return of([{ id: 100, name: 'Zone 1' }]);
  }
  
  cargarEstadoJugador() {
    return of({ worldState: {}, inventory: [] });
  }

  obtenerPrefabs() {
    return of([]);
  }
}