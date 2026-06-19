import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MissionModal } from './mission-modal';

describe('MissionModal', () => {
  let component: MissionModal;
  let fixture: ComponentFixture<MissionModal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionModal],
    }).compileComponents();

    fixture = TestBed.createComponent(MissionModal);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
