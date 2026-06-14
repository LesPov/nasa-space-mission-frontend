import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GlobalTimeline } from './global-timeline';

describe('GlobalTimeline', () => {
  let component: GlobalTimeline;
  let fixture: ComponentFixture<GlobalTimeline>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GlobalTimeline],
    }).compileComponents();

    fixture = TestBed.createComponent(GlobalTimeline);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
