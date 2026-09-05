import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CinematicInspector } from './cinematic-inspector';

describe('CinematicInspector', () => {
  let component: CinematicInspector;
  let fixture: ComponentFixture<CinematicInspector>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CinematicInspector],
    }).compileComponents();

    fixture = TestBed.createComponent(CinematicInspector);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
