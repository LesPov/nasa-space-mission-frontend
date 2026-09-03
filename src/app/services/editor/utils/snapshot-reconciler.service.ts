
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SnapshotReconcilerService {
  
  /**
   * Reconcilia dos snapshots de la escena basados en el UID de los objetos.
   * Aplica adiciones, modificaciones y eliminaciones preservando el estado de lo no editado.
   * 
   * @param baseSnapshot El estado original de la escena (ej. antes de entrar a Test Live).
   * @param currentSnapshot El estado nuevo o delta (ej. estado actual del runtime al detener Test Live).
   * @returns Un nuevo objeto con el snapshot resultante (clon profundo, no muta la entrada).
   */
  public mergeSnapshots(baseSnapshot: any, currentSnapshot: any): any {
    if (!baseSnapshot) return currentSnapshot ? JSON.parse(JSON.stringify(currentSnapshot)) : {};
    if (!currentSnapshot) return JSON.parse(JSON.stringify(baseSnapshot));

    // Clon profundo para garantizar inmutabilidad y función pura
    const merged = JSON.parse(JSON.stringify(baseSnapshot));

    // 1. Normalización de estructuras legacy/delta
    if (!merged.sceneObjects) merged.sceneObjects = merged.sceneObjectsDelta || [];
    if (!merged.triggers) merged.triggers = merged.triggersDelta || [];
    if (!merged.deletedObjects) merged.deletedObjects = [];
    if (!merged.deletedTriggers) merged.deletedTriggers = [];

    // Limpiamos los deltas del base si existían
    delete merged.sceneObjectsDelta;
    delete merged.triggersDelta;

    // 2. Procesar Scene Objects (Nuevos y Modificados)
    if (currentSnapshot.sceneObjectsDelta) {
      currentSnapshot.sceneObjectsDelta.forEach((delta: any) => {
        if (delta.name === 'Jugador_Prueba') return; // Excepción específica del dominio
        
        const index = merged.sceneObjects.findIndex((o: any) => o.uid === delta.uid);
        if (index !== -1) {
          merged.sceneObjects[index] = delta; // Reemplazo in-place (mantiene orden)
        } else {
          merged.sceneObjects.push(delta); // Objeto nuevo
        }
      });
    }

    // 3. Procesar Triggers (Nuevos y Modificados)
    if (currentSnapshot.triggersDelta) {
      currentSnapshot.triggersDelta.forEach((delta: any) => {
        const index = merged.triggers.findIndex((o: any) => o.uid === delta.uid);
        if (index !== -1) {
          merged.triggers[index] = delta; // Reemplazo in-place (mantiene orden)
        } else {
          merged.triggers.push(delta); // Trigger nuevo
        }
      });
    }

    // 4. Procesar Configuraciones Globales
    if (currentSnapshot.environmentSettings) {
      merged.environmentSettings = JSON.parse(JSON.stringify(currentSnapshot.environmentSettings));
    }
    if (currentSnapshot.uiSettings) {
      merged.uiSettings = JSON.parse(JSON.stringify(currentSnapshot.uiSettings));
    }
    if (currentSnapshot.cinematicsDelta) {
      merged.cinematics = JSON.parse(JSON.stringify(currentSnapshot.cinematicsDelta));
    }

    // 5. Procesar Eliminaciones (Filtro estricto por UID)
    if (currentSnapshot.deletedObjects && currentSnapshot.deletedObjects.length > 0) {
      merged.sceneObjects = merged.sceneObjects.filter((o: any) => !currentSnapshot.deletedObjects.includes(o.uid));
      merged.deletedObjects = [...new Set([...merged.deletedObjects, ...currentSnapshot.deletedObjects])];
    }
    
    if (currentSnapshot.deletedTriggers && currentSnapshot.deletedTriggers.length > 0) {
      merged.triggers = merged.triggers.filter((o: any) => !currentSnapshot.deletedTriggers.includes(o.uid));
      merged.deletedTriggers = [...new Set([...merged.deletedTriggers, ...currentSnapshot.deletedTriggers])];
    }

    return merged;
  }
}