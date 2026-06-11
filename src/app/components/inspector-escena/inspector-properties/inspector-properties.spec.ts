import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InspectorProperties } from './inspector-properties';

describe('InspectorProperties', () => {
  let component: InspectorProperties;
  let fixture: ComponentFixture<InspectorProperties>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InspectorProperties],
    }).compileComponents();

    fixture = TestBed.createComponent(InspectorProperties);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
