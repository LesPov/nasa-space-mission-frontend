
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth';
 
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private router = inject(Router);
  private authSvc = inject(AuthService);

  // Variables vinculadas al HTML
  username = '';
  password = '';
  loading = signal(false);
  errorMsg = signal('');

  hacerLogin() {
    if (!this.username || !this.password) return;
    
    this.loading.set(true);
    this.errorMsg.set('');

    this.authSvc.login(this.username, this.password).subscribe({
      next: () => {
        this.loading.set(false);
        // Consumimos la señal centralizada
        if (this.authSvc.isAdmin()) {
          this.router.navigate(['/admin/editor-escena']);
        } else {
          this.router.navigate(['/jugador/episodios']);
        }
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMsg.set(err.error?.msg || 'Error de conexión. Verifica que el servidor Backend esté encendido.');
      }
    });
  }
}
