
// src/app/services/historial.service.ts

import { Injectable, inject } from '@angular/core';
import { Vector3, AbstractMesh, Quaternion, Node } from '@babylonjs/core';
import { EntityManagerService } from '../core/engine/entities/entity-manager.service';
 
export type TipoAccion = 'transform' | 'crear' | 'eliminar';

export interface EstadoTransform {
  position: Vector3;
  rotation: Vector3;
  rotationQuaternion: Quaternion | null;
  scaling: Vector3;
}

export interface AccionHistorial {
  tipo: TipoAccion;
  mesh: AbstractMesh;
  estadoAnterior?: EstadoTransform;
}

@Injectable({
  providedIn: 'root'
})
export class HistorialService {
  private entityManager = inject(EntityManagerService);
  private historial: AccionHistorial[] = [];
  private readonly MAX_HISTORIAL = 50;

  private casiIgual(a: number, b: number, epsilon = 1e-5): boolean {
    return Math.abs(a - b) <= epsilon;
  }

  private vectoresIguales(a: Vector3, b: Vector3, epsilon = 1e-5): boolean {
    return (
      this.casiIgual(a.x, b.x, epsilon) &&
      this.casiIgual(a.y, b.y, epsilon) &&
      this.casiIgual(a.z, b.z, epsilon)
    );
  }

  private quaternionsIguales(a: Quaternion, b: Quaternion, epsilon = 1e-5): boolean {
    const dot = Math.abs(Quaternion.Dot(a, b));
    return Math.abs(1 - dot) <= epsilon;
  }

  obtenerEstado(mesh: AbstractMesh): EstadoTransform {
    return {
      position: mesh.position.clone(),
      rotation: mesh.rotation.clone(),
      rotationQuaternion: mesh.rotationQuaternion ? mesh.rotationQuaternion.clone() : null,
      scaling: mesh.scaling.clone()
    };
  }

  registrarCambioTransform(mesh: AbstractMesh, mutar: () => void) {
    const estadoAnterior = this.obtenerEstado(mesh);
    mutar();
    this.registrarAccionTransform(mesh, estadoAnterior);
  }

  registrarAccionTransform(mesh: AbstractMesh, estadoAnterior: EstadoTransform) {
    const estadoNuevo = this.obtenerEstado(mesh);

    const posIgual = this.vectoresIguales(estadoAnterior.position, estadoNuevo.position);
    const escIgual = this.vectoresIguales(estadoAnterior.scaling, estadoNuevo.scaling);

    let rotIgual = false;
    if (estadoAnterior.rotationQuaternion && estadoNuevo.rotationQuaternion) {
      rotIgual = this.quaternionsIguales(estadoAnterior.rotationQuaternion, estadoNuevo.rotationQuaternion);
    } else if (!estadoAnterior.rotationQuaternion && !estadoNuevo.rotationQuaternion) {
      rotIgual = this.vectoresIguales(estadoAnterior.rotation, estadoNuevo.rotation);
    }

    if (posIgual && escIgual && rotIgual) {
      return;
    }

    console.log(`💾 [Historial] Acción registrada (Transform) en: ${mesh.name}`);
    
    this.historial.push({
      tipo: 'transform',
      mesh,
      estadoAnterior: {
        position: estadoAnterior.position.clone(),
        rotation: estadoAnterior.rotation.clone(),
        rotationQuaternion: estadoAnterior.rotationQuaternion ? estadoAnterior.rotationQuaternion.clone() : null,
        scaling: estadoAnterior.scaling.clone()
      }
    });

    this.limpiarHistorialExcedente();
  }

  registrarAccionCrear(mesh: AbstractMesh) {
    console.log(`💾 [Historial] Acción registrada (Creación) de: ${mesh.name}`);
    this.historial.push({ tipo: 'crear', mesh });
    this.limpiarHistorialExcedente();
  }

  deshacer(): boolean {
    if (this.historial.length === 0) {
      return false;
    }

    const ultimaAccion = this.historial.pop();
    if (!ultimaAccion || !ultimaAccion.mesh || ultimaAccion.mesh.isDisposed()) {
      return false;
    }

    const mesh = ultimaAccion.mesh;

    if (ultimaAccion.tipo === 'transform' && ultimaAccion.estadoAnterior) {
      console.log(`⏪ [Historial] Deshaciendo movimiento en: ${mesh.name}`);
      const estado = ultimaAccion.estadoAnterior;

      mesh.position = estado.position.clone();
      mesh.scaling = estado.scaling.clone();

      if (estado.rotationQuaternion) {
        mesh.rotationQuaternion = estado.rotationQuaternion.clone();
        mesh.rotation.set(0, 0, 0); 
      } else {
        mesh.rotationQuaternion = null;
        mesh.rotation = estado.rotation.clone();
      }

      mesh.computeWorldMatrix(true);
      return true;
    }

    if (ultimaAccion.tipo === 'crear') {
      console.log(`⏪ [Historial] Deshaciendo creación de: ${mesh.name}`);
      
      const descendientes = mesh.getDescendants(false);
      
      const entity = this.entityManager.getEntityByMesh(mesh);
      if (entity) {
          this.entityManager.removeEntity(entity.uid);
      } else {
          this.disposeCompleto(mesh);
      }

      descendientes.forEach(desc => {
          if (desc instanceof AbstractMesh) {
              const childEntity = this.entityManager.getEntityByMesh(desc);
              if (childEntity) {
                  this.entityManager.removeEntity(childEntity.uid);
              }
          }
      });

      return true;
    }

    return false;
  }

  private disposeCompleto(mesh: AbstractMesh): void {
    const descendientes = mesh.getDescendants(false);

    for (let i = descendientes.length - 1; i >= 0; i--) {
      const nodo = descendientes[i] as Node & { dispose?: (d?:boolean, dt?:boolean) => void; isDisposed?: () => boolean };

      if (nodo && typeof nodo.dispose === 'function') {
        try {
          if (!nodo.isDisposed || !nodo.isDisposed()) {
            nodo.dispose(false, false); // 🔥 FIX: previene borrar materiales compartidos
          }
        } catch {
        }
      }
    }

    try {
      if (!mesh.isDisposed()) {
        mesh.dispose(false, false); // 🔥 FIX: previene borrar materiales compartidos
      }
    } catch {
    }
  }

  private limpiarHistorialExcedente() {
    if (this.historial.length > this.MAX_HISTORIAL) {
      this.historial.shift();
    }
  }
}
