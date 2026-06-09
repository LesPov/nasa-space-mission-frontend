import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth-interceptor';
 
export const appConfig: ApplicationConfig = {
  providers: [
    // 1. LA MAGIA ESTÁ AQUÍ: Activamos el modo Zoneless experimental
    // ideal para que Babylon.js corra a 60 FPS sin saturar a Angular
    provideZonelessChangeDetection(),
    
    // 2. Rutas
    provideRouter(routes),
    
    // 3. Peticiones HTTP con el interceptor de seguridad
    provideHttpClient(withInterceptors([authInterceptor])) 
  ]
};