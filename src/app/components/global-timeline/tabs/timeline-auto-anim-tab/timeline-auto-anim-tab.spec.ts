import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimelineAutoAnimTab } from './timeline-auto-anim-tab';

describe('TimelineAutoAnimTab', () => {
  let component: TimelineAutoAnimTab;
  let fixture: ComponentFixture<TimelineAutoAnimTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimelineAutoAnimTab],
    }).compileComponents();

    fixture = TestBed.createComponent(TimelineAutoAnimTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
