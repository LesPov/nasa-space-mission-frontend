
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { JuegoPantalla } from './juego-pantalla';

describe('JuegoPantalla', () => {
  let component: JuegoPantalla;
  let fixture: ComponentFixture<JuegoPantalla>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [JuegoPantalla],
    }).compileComponents();

    fixture = TestBed.createComponent(JuegoPantalla);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

