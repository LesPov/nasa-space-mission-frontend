import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SeleccionEpisodios } from './seleccion-episodios';

describe('SeleccionEpisodios', () => {
  let component: SeleccionEpisodios;
  let fixture: ComponentFixture<SeleccionEpisodios>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SeleccionEpisodios],
    }).compileComponents();

    fixture = TestBed.createComponent(SeleccionEpisodios);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
