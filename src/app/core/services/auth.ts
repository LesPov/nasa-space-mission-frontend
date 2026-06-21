
import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Router } from '@angular/router';
import { tap } from 'rxjs';

export interface UserState {
  userId: number;
  username: string;
  rol: 'admin' | 'user';
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  public currentUser = signal<UserState | null>(null);

  // Derivados reactivos unificados (fuente de verdad)
  public isLoggedIn = computed(() => this.currentUser() !== null);
  public isAdmin = computed(() => this.currentUser()?.rol === 'admin');

  constructor() {
    this.checkLocalSession();
  }

  login(username: string, passwordorrandomPassword: string) {
    return this.http.post<any>(`${environment.apiUrl}/auth/user/login`, { username, passwordorrandomPassword })
      .pipe(
        tap(res => {
          localStorage.setItem('token', res.token);
          const userState: UserState = { userId: res.userId, username, rol: res.rol };
          localStorage.setItem('user', JSON.stringify(userState));
          this.currentUser.set(userState);
        })
      );
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.currentUser.set(null);
    this.router.navigate(['/login']);
  }

  private checkLocalSession() {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      this.currentUser.set(JSON.parse(userStr));
    }
  }
}