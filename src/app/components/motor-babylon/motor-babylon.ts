
import { Component, ElementRef, OnInit, ViewChild, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Motor3dService } from '../../services/motor-3d.service';
import { GameContextService } from '../../core/engine/session/game-context.service';
import { GameMode } from '../../core/engine/session/game-context.model';
import { AuthService } from '../../core/services/auth';

@Component({
  selector: 'app-motor-babylon',
  standalone: true,
  templateUrl: './motor-babylon.html',
  styleUrl: './motor-babylon.css',
})
export class MotorBabylon implements OnInit, OnDestroy {
  @ViewChild('renderCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  
  private motor3d = inject(Motor3dService);
  private router = inject(Router);
  private gameContext = inject(GameContextService);
  private auth = inject(AuthService);

  ngOnInit(): void {
    // Fase 2: Determinamos contexto temprano (antes de iniciar motor).
    // Esto asegura que la CameraFactory asigne el rol estricto correcto de cámaras a crear.
    if (this.router.url.includes('/jugador/jugar')) {
      const isAdmin = this.auth.isAdmin();
      this.gameContext.setMode(isAdmin ? GameMode.PREVIEW_ADMIN : GameMode.FINAL_USER);
    } else {
      this.gameContext.setMode(GameMode.EDITOR);
    }

    // Iniciar motor al cargar el componente
    this.motor3d.iniciarMotor(this.canvasRef.nativeElement);
  }

  ngOnDestroy(): void {
    // Liberar memoria al salir
    this.motor3d.detenerMotor();
  }
}