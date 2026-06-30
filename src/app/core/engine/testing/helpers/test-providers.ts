import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { EpisodiosService } from '../../../../services/api/episodios';
import { AuthService } from '../../../services/auth';
import { MockEpisodiosService } from '../mocks/api.mock';
import { MockAuthService } from '../mocks/auth.mock';

export function getTestProviders() {
  return [
    HttpClientTestingModule,
    RouterTestingModule,
    { provide: EpisodiosService, useClass: MockEpisodiosService },
    { provide: AuthService, useClass: MockAuthService }
  ];
}