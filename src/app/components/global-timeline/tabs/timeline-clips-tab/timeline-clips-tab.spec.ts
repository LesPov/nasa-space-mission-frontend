import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimelineClipsTab } from './timeline-clips-tab';

describe('TimelineClipsTab', () => {
  let component: TimelineClipsTab;
  let fixture: ComponentFixture<TimelineClipsTab>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimelineClipsTab],
    }).compileComponents();

    fixture = TestBed.createComponent(TimelineClipsTab);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
