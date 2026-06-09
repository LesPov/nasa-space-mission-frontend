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
    // Iniciar motor al cargar el componente
    this.motor3d.iniciarMotor(this.canvasRef.nativeElement);
  }

  ngOnDestroy(): void {
    // Liberar memoria al salir
    this.motor3d.detenerMotor();
  }
}