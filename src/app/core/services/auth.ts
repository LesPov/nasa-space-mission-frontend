import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Router } from '@angular/router';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

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
    return this.http.post<any>(`${environment.apiUrl}/auth/user/login`, { 
      username: username.trim(), 
      passwordorrandomPassword: passwordorrandomPassword.trim() 
    }).pipe(
      tap(res => {
        if (res && res.token) {
          localStorage.setItem('token', res.token);
          const userState: UserState = { userId: res.userId, username, rol: res.rol };
          localStorage.setItem('user', JSON.stringify(userState));
          this.currentUser.set(userState);
        }
      }),
      catchError((error: HttpErrorResponse) => {
        console.error('[AuthService] Error de login:', error);
        return throwError(() => error);
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
    try {
      const userStr = localStorage.getItem('user');
      const token = localStorage.getItem('token');
      if (userStr && token) {
        this.currentUser.set(JSON.parse(userStr));
      } else {
        this.logout(); // Limpia estado inválido si falta el token
      }
    } catch (e) {
      this.logout();
    }
  }
}