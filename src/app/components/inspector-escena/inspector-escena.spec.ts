import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InspectorEscena } from './inspector-escena';

describe('InspectorEscena', () => {
  let component: InspectorEscena;
  let fixture: ComponentFixture<InspectorEscena>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InspectorEscena],
    }).compileComponents();

    fixture = TestBed.createComponent(InspectorEscena);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
