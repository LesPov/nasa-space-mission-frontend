
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError, EMPTY } from 'rxjs';
import { AuthService } from '../services/auth';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('token');
  const authSvc = inject(AuthService);

  // Bypass login/register
  if (req.url.includes('/auth/user/login')) return next(req);

  // Si no hay token en una ruta protegida, desloguear y cortar flujo limpiamente
  if (!token) {
    authSvc.logout();
    return EMPTY; 
  }

  const authReq = req.clone({
    setHeaders: { 
      Authorization: `Bearer ${token}` 
    }
  });

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // 🔥 FIX 401: Interceptar la respuesta si el token expiró
      if (error.status === 401) {
        console.warn('⚠️ [AuthInterceptor] 401 Unauthorized detectado. Forzando logout silencioso.');
        authSvc.logout();
        return EMPTY; // Cortamos la cascada para que no estallen los suscriptores y no aparezcan en consola
      }
      return throwError(() => error);
    })
  );
};