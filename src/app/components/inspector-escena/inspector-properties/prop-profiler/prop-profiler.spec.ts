import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PropProfiler } from './prop-profiler';

describe('PropProfiler', () => {
  let component: PropProfiler;
  let fixture: ComponentFixture<PropProfiler>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PropProfiler],
    }).compileComponents();

    fixture = TestBed.createComponent(PropProfiler);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
