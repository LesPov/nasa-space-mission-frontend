
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CinematicInspector } from './cinematic-inspector';
import { EpisodiosService } from '../../../../../../services/api/episodios';
import { of } from 'rxjs';

describe('CinematicInspector', () => {
  let component: CinematicInspector;
  let fixture: ComponentFixture<CinematicInspector>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CinematicInspector],
      providers: [
        // 🔥 FIX TEST: Mockeamos el servicio de episodios para evitar requests HTTP reales de Assets
        { provide: EpisodiosService, useValue: { obtenerAssets: () => of([]) } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CinematicInspector);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
