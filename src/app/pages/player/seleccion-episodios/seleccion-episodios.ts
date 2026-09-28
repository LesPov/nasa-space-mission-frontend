import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { EpisodiosService } from '../../../services/api/episodios';
import { AuthService } from '../../../core/services/auth';
import { MiniVisorEscena } from '../../../components/mini-visor-escena/mini-visor-escena';

@Component({
  selector: 'app-seleccion-episodios',
  standalone: true,
  imports: [CommonModule, MiniVisorEscena],
  templateUrl: './seleccion-episodios.html',
  styleUrls: ['./seleccion-episodios.css'],
})
export class SeleccionEpisodios implements OnInit {
  public epiApiSvc = inject(EpisodiosService);
  public authSvc = inject(AuthService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  public listaEpisodios: any[] = [];
  public hoveredEpisodio: number | null = null;
  public cargando = true;
  public errorConexion = false;
  public errorMensaje = '';

  ngOnInit() {
    this.cargarEpisodios();
  }

  cargarEpisodios() {
    this.cargando = true;
    this.errorConexion = false;
    this.errorMensaje = '';

    this.epiApiSvc.obtenerEpisodios().subscribe({
      next: (res: any) => { 
        this.listaEpisodios = Array.isArray(res) ? res : (res?.data || res?.episodes || []); 
        this.cargando = false;
        this.errorConexion = false;
        this.cdr.detectChanges(); 
      },
      error: (err) => {
        console.error('Error al cargar episodios:', err);
        this.cargando = false;
        this.errorConexion = true;
        if (err.status === 0) {
          this.errorMensaje = 'No se pudo conectar al servidor en http://localhost:4000. Verifica que el backend esté encendido.';
        } else {
          this.errorMensaje = err.error?.message || err.message || 'Error al comunicarse con la API de episodios.';
        }
        this.cdr.detectChanges();
      }
    });
  }

  jugarEpisodio(id: number) {
    this.router.navigate(['/jugador/jugar', id]);
  }

  cerrarSesion() {
    this.authSvc.logout();
  }
}