import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PropPart } from './prop-part';

describe('PropPart', () => {
  let component: PropPart;
  let fixture: ComponentFixture<PropPart>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PropPart],
    }).compileComponents();

    fixture = TestBed.createComponent(PropPart);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
