
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PropLight } from './prop-light';

describe('PropLight', () => {
  let component: PropLight;
  let fixture: ComponentFixture<PropLight>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PropLight],
    }).compileComponents();

    fixture = TestBed.createComponent(PropLight);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

