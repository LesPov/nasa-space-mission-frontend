

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InspectorOutliner } from './inspector-outliner';

describe('InspectorOutliner', () => {
  let component: InspectorOutliner;
  let fixture: ComponentFixture<InspectorOutliner>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InspectorOutliner],
    }).compileComponents();

    fixture = TestBed.createComponent(InspectorOutliner);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});


