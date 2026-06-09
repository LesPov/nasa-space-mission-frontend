import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MotorBabylon } from './motor-babylon';

describe('MotorBabylon', () => {
  let component: MotorBabylon;
  let fixture: ComponentFixture<MotorBabylon>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MotorBabylon],
    }).compileComponents();

    fixture = TestBed.createComponent(MotorBabylon);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
