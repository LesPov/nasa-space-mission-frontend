import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CinematicOverlayComponent } from './cinematic-overlay.component';

describe('CinematicOverlayComponent', () => {
  let component: CinematicOverlayComponent;
  let fixture: ComponentFixture<CinematicOverlayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CinematicOverlayComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(CinematicOverlayComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
