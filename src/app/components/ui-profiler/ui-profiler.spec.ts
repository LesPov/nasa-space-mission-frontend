import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UiProfiler } from './ui-profiler';

describe('UiProfiler', () => {
  let component: UiProfiler;
  let fixture: ComponentFixture<UiProfiler>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiProfiler],
    }).compileComponents();

    fixture = TestBed.createComponent(UiProfiler);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
