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

  ngOnInit() {
    this.cargarEpisodios();
  }

  cargarEpisodios() {
    this.cargando = true;
    this.epiApiSvc.obtenerEpisodios().subscribe({
      // 🔥 FIX: Forzamos el tipo (res: any) para que el compilador de TypeScript 
      // no crashee al buscar propiedades como .data o .episodes
      next: (res: any) => { 
        this.listaEpisodios = Array.isArray(res) ? res : (res?.data || res?.episodes || []); 
        this.cargando = false;
        this.cdr.detectChanges(); 
      },
      error: (err) => {
        console.error('Error al cargar episodios', err);
        this.cargando = false;
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