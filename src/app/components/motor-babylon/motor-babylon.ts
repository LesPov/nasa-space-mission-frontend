

import { Component, ElementRef, OnInit, ViewChild, OnDestroy, inject } from '@angular/core';
import { Motor3dService } from '../../services/motor-3d.service';

@Component({
  selector: 'app-motor-babylon',
  standalone: true,
  templateUrl: './motor-babylon.html',
  styleUrl: './motor-babylon.css',
})
export class MotorBabylon implements OnInit, OnDestroy {
  @ViewChild('renderCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  
  private motor3d = inject(Motor3dService);

  ngOnInit(): void {
    // 🔥 FIX: Eliminado el hack de detección de modo por URL. 
    // Ahora el GameContextService es la única fuente de verdad y se configura 
    // en los componentes padres ANTES de que el motor inicie.
    this.motor3d.iniciarMotor(this.canvasRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.motor3d.detenerMotor();
  }
}
