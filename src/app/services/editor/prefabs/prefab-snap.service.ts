
import { Injectable } from '@angular/core';
import { AbstractMesh, Vector3, Matrix, Quaternion } from '@babylonjs/core';

@Injectable({ providedIn: 'root' })
export class PrefabSnapService {
  
  public calculateSnapPosition(
    targetMesh: AbstractMesh, 
    ghostMesh: AbstractMesh, 
    hitPoint: Vector3, 
    hitNormal: Vector3,
    rayDirection: Vector3,
    scrollOffset: number,
    isSnapping: boolean,
    userYRotation: number
  ): { position: Vector3, rotation: Quaternion | null } {
    targetMesh.computeWorldMatrix(true);
    
    let finalPos = Vector3.Zero();
    let finalRot: Quaternion | null = null;

    if (isSnapping) {
        // ==========================================
        // SNAP MODULAR PERFECTO (Hermano/Continuación con ALT o SHIFT)
        // ==========================================
        // 1. Alineamos la rotación del Ghost a la del Target
        let baseRot = targetMesh.rotationQuaternion ? targetMesh.rotationQuaternion.clone() : Quaternion.FromEulerAngles(targetMesh.rotation.x, targetMesh.rotation.y, targetMesh.rotation.z);
        
        // Aplicamos la rotación manual del usuario
        if (userYRotation !== 0) {
            baseRot = baseRot.multiply(Quaternion.RotationAxis(Vector3.Up(), userYRotation));
        }
        finalRot = baseRot;
        
        const oldRotQ = ghostMesh.rotationQuaternion ? ghostMesh.rotationQuaternion.clone() : null;
        const oldRot = ghostMesh.rotation.clone();
        
        ghostMesh.rotationQuaternion = finalRot;
        ghostMesh.computeWorldMatrix(true);

        // 2. Matriz de Alineación (Posición y Rotación del Target, Escala = 1)
        // Usamos la rotación ORIGINAL del target, para que el sistema de coordenadas local del grid sea el del target
        const targetRotOnly = targetMesh.rotationQuaternion ? targetMesh.rotationQuaternion.clone() : Quaternion.FromEulerAngles(targetMesh.rotation.x, targetMesh.rotation.y, targetMesh.rotation.z);
        const alignMatrix = Matrix.Compose(Vector3.One(), targetRotOnly, targetMesh.getAbsolutePosition());
        const invAlignMatrix = Matrix.Invert(alignMatrix);

        // 3. Normal y Centro del Target en Espacio Alineado
        const alignNormal = Vector3.TransformNormal(hitNormal, invAlignMatrix).normalize();
        const tBB = targetMesh.getBoundingInfo().boundingBox;
        const tCenterAligned = Vector3.TransformCoordinates(tBB.centerWorld, invAlignMatrix);

        // 4. Eje dominante
        const absX = Math.abs(alignNormal.x);
        const absY = Math.abs(alignNormal.y);
        const absZ = Math.abs(alignNormal.z);

        let axis: 'x' | 'y' | 'z' = 'z';
        let sign = 1;

        if (absX > absY && absX > absZ) { axis = 'x'; sign = Math.sign(alignNormal.x); }
        else if (absY > absX && absY > absZ) { axis = 'y'; sign = Math.sign(alignNormal.y); }
        else { axis = 'z'; sign = Math.sign(alignNormal.z); }

        // 5. Dimensiones reales escaladas (OBB Extents en World Space = Aligned Space)
        const tScale = targetMesh.absoluteScaling;
        const gScale = ghostMesh.absoluteScaling;
        const gBB = ghostMesh.getBoundingInfo().boundingBox;

        const tExt = tBB.extendSize[axis] * Math.abs(tScale[axis]);
        
        // Para calcular el ghostExtent correcto, tenemos que transformar el bounding box del ghost
        // al espacio alineado del target. Dado que el ghost podría estar rotado por userYRotation respecto al target,
        // necesitamos evaluar sus extents dinámicamente en este eje.
        // Pero para simplificar, usaremos extendSize local del ghost, que en rotaciones de 90° permuta X y Z.
        let gExt = 0;
        const angleMod = Math.abs(userYRotation % Math.PI);
        const isRotated90 = angleMod > 0.1 && angleMod < 3.0; // 90 grados aprox
        
        if (isRotated90 && (axis === 'x' || axis === 'z')) {
            const flippedAxis = axis === 'x' ? 'z' : 'x';
            gExt = gBB.extendSize[flippedAxis] * Math.abs(gScale[flippedAxis]);
        } else {
            gExt = gBB.extendSize[axis] * Math.abs(gScale[axis]);
        }

        // 6. Proyección del Hit en el plano de la cara
        const hitAligned = Vector3.TransformCoordinates(hitPoint, invAlignMatrix);
        hitAligned[axis] = tCenterAligned[axis] + (sign * tExt);

        // 7. Snap de los otros ejes a la grilla modular (0.5m)
        const grid = 0.5;
        if (axis !== 'x') hitAligned.x = Math.round(hitAligned.x / grid) * grid;
        if (axis !== 'y') hitAligned.y = Math.round(hitAligned.y / grid) * grid;
        if (axis !== 'z') hitAligned.z = Math.round(hitAligned.z / grid) * grid;

        // 8. Centro deseado del Ghost en espacio alineado
        const desiredGCenterAligned = hitAligned.clone();
        desiredGCenterAligned[axis] += (sign * gExt);

        // 9. Convertir a World Space y ajustar por el pivot del ghost
        const desiredGCenterWorld = Vector3.TransformCoordinates(desiredGCenterAligned, alignMatrix);
        
        // Pivot Offset = position - centerWorld
        const gCenterWorld = gBB.centerWorld;
        const pivotOffsetWorld = ghostMesh.position.subtract(gCenterWorld);

        finalPos = desiredGCenterWorld.add(pivotOffsetWorld);

        // Restaurar rotación original del ghost para no ensuciar la malla maestra
        if (oldRotQ) ghostMesh.rotationQuaternion = oldRotQ;
        else { ghostMesh.rotationQuaternion = null; ghostMesh.rotation.copyFrom(oldRot); }

    } else {
        // ==========================================
        // COLOCACIÓN LIBRE EN SUPERFICIE
        // ==========================================
        finalRot = Quaternion.RotationAxis(Vector3.Up(), userYRotation);
        
        const oldRotQ = ghostMesh.rotationQuaternion ? ghostMesh.rotationQuaternion.clone() : null;
        ghostMesh.rotationQuaternion = finalRot;
        ghostMesh.computeWorldMatrix(true);

        const gBB = ghostMesh.getBoundingInfo().boundingBox;
        const absNormal = new Vector3(Math.abs(hitNormal.x), Math.abs(hitNormal.y), Math.abs(hitNormal.z));
        
        let pushBackDist = 0;
        if (absNormal.y > 0.9) pushBackDist = gBB.extendSize.y * Math.abs(ghostMesh.absoluteScaling.y);
        else if (absNormal.x > 0.9) pushBackDist = gBB.extendSize.x * Math.abs(ghostMesh.absoluteScaling.x);
        else if (absNormal.z > 0.9) pushBackDist = gBB.extendSize.z * Math.abs(ghostMesh.absoluteScaling.z);
        else pushBackDist = Math.max(
            gBB.extendSize.x * Math.abs(ghostMesh.absoluteScaling.x), 
            gBB.extendSize.y * Math.abs(ghostMesh.absoluteScaling.y), 
            gBB.extendSize.z * Math.abs(ghostMesh.absoluteScaling.z)
        );

        const centerPos = hitPoint.add(hitNormal.scale(pushBackDist));
        const pivotOffset = ghostMesh.position.subtract(gBB.centerWorld);
        finalPos = centerPos.add(pivotOffset);

        const grid = 0.5;
        finalPos.x = Math.round(finalPos.x / grid) * grid;
        if (Math.abs(hitNormal.y) < 0.8) {
             finalPos.y = Math.round(finalPos.y / grid) * grid;
        }
        finalPos.z = Math.round(finalPos.z / grid) * grid;

        if (oldRotQ) ghostMesh.rotationQuaternion = oldRotQ;
    }

    if (scrollOffset !== 0) {
        finalPos.addInPlace(rayDirection.normalize().scale(scrollOffset));
    }

    return { position: finalPos, rotation: finalRot };
  }
}