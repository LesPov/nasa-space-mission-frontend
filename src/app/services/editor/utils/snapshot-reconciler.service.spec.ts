
import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotReconcilerService } from './snapshot-reconciler.service';

describe('SnapshotReconcilerService (FASE 3 - Pruebas de Algoritmo Puro)', () => {
  let reconciler: SnapshotReconcilerService;

  beforeEach(() => {
    reconciler = new SnapshotReconcilerService();
  });

  it('TEST 1: Sin cambios - El resultado debe ser estructuralmente idéntico al base', () => {
    const base = { sceneObjects: [{ uid: 'A', val: 1 }, { uid: 'B', val: 2 }] };
    const curr = { sceneObjectsDelta: [] };
    const res = reconciler.mergeSnapshots(base, curr);
    expect(res.sceneObjects.length).toBe(2);
    expect(res.sceneObjects[0].uid).toBe('A');
  });

  it('TEST 2: Objeto modificado - Debe reemplazar los campos y conservar la posición/orden', () => {
    const base = { sceneObjects: [{ uid: 'A', x: 0 }, { uid: 'B', x: 0 }] };
    const curr = { sceneObjectsDelta: [{ uid: 'A', x: 10 }] };
    const res = reconciler.mergeSnapshots(base, curr);
    
    expect(res.sceneObjects.length).toBe(2);
    expect(res.sceneObjects[0].x).toBe(10); // A fue editado y persistido
    expect(res.sceneObjects[1].x).toBe(0);  // B no cambió
  });

  it('TEST 3: Objeto nuevo - Debe agregarse al final', () => {
    const base = { sceneObjects: [{ uid: 'A' }, { uid: 'B' }] };
    const curr = { sceneObjectsDelta: [{ uid: 'C' }] };
    const res = reconciler.mergeSnapshots(base, curr);
    
    expect(res.sceneObjects.length).toBe(3);
    expect(res.sceneObjects[2].uid).toBe('C');
  });

  it('TEST 4: Objeto no modificado - NO debe duplicarse en absoluto', () => {
    const base = { sceneObjects: [{ uid: 'A' }, { uid: 'B' }, { uid: 'C' }] };
    // 'B' y 'C' vienen igual en el delta (como ocurriría al forzar un guardado completo)
    const curr = { sceneObjectsDelta: [{ uid: 'A', changed: true }, { uid: 'B' }, { uid: 'C' }] };
    const res = reconciler.mergeSnapshots(base, curr);
    
    expect(res.sceneObjects.length).toBe(3); // Ningún duplicado
    expect(res.sceneObjects[0].changed).toBe(true);
  });

  it('TEST 5: Varios objetos modificados', () => {
    const base = { sceneObjects: [{ uid: 'A', v: 1 }, { uid: 'B', v: 1 }, { uid: 'C', v: 1 }] };
    const curr = { sceneObjectsDelta: [{ uid: 'A', v: 2 }, { uid: 'B', v: 2 }] };
    const res = reconciler.mergeSnapshots(base, curr);
    
    expect(res.sceneObjects.find((o: any) => o.uid === 'A').v).toBe(2);
    expect(res.sceneObjects.find((o: any) => o.uid === 'B').v).toBe(2);
    expect(res.sceneObjects.find((o: any) => o.uid === 'C').v).toBe(1);
  });

  it('TEST 6: UID Duplicados - Se respeta comportamiento original (findIndex matchea el primero)', () => {
    const base = { sceneObjects: [{ uid: 'A', id: 1 }, { uid: 'A', id: 2 }] };
    const curr = { sceneObjectsDelta: [{ uid: 'A', data: 'new' }] };
    const res = reconciler.mergeSnapshots(base, curr);
    
    // El sistema actual reemplaza la primera coincidencia y respeta que haya dos si ya existían
    expect(res.sceneObjects.length).toBe(2);
    expect(res.sceneObjects[0].data).toBe('new');
    expect(res.sceneObjects[1].id).toBe(2);
  });

  it('TEST 7: Array vacío y nulos', () => {
    const base = { sceneObjects: [] };
    const curr = { sceneObjectsDelta: [] };
    const res = reconciler.mergeSnapshots(base, curr);
    expect(res.sceneObjects.length).toBe(0);
  });

  it('TEST 8: Objetos nuevos + modificados + eliminados', () => {
    const base = { 
        sceneObjects: [{ uid: 'A', v: 1 }, { uid: 'B' }, { uid: 'C' }],
        deletedObjects: []
    };
    const curr = { 
        sceneObjectsDelta: [{ uid: 'A', v: 99 }, { uid: 'D' }, { uid: 'E' }],
        deletedObjects: ['B']
    };
    const res = reconciler.mergeSnapshots(base, curr);
    
    expect(res.sceneObjects.length).toBe(4); // A, C, D, E
    expect(res.sceneObjects.find((o: any) => o.uid === 'A').v).toBe(99); // A persistió su cambio
    expect(res.sceneObjects.find((o: any) => o.uid === 'B')).toBeUndefined(); // B fue eliminado
    expect(res.sceneObjects.find((o: any) => o.uid === 'C')).toBeDefined(); // C conservado
    expect(res.sceneObjects.find((o: any) => o.uid === 'D')).toBeDefined(); // D añadido
    expect(res.deletedObjects).toContain('B'); // B en registro de eliminados
  });

  it('Test Especial: "Jugador_Prueba" debe ser ignorado (Comportamiento de Dominio Actual)', () => {
    const base = { sceneObjects: [{ uid: 'A' }] };
    const curr = { sceneObjectsDelta: [{ uid: 'TEMP', name: 'Jugador_Prueba' }] };
    const res = reconciler.mergeSnapshots(base, curr);
    
    expect(res.sceneObjects.length).toBe(1);
    expect(res.sceneObjects[0].uid).toBe('A');
  });
});