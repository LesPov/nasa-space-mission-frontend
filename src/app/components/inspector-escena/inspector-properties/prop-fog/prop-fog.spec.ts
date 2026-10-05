import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PropFog } from './prop-fog';

describe('PropFog', () => {
  let component: PropFog;
  let fixture: ComponentFixture<PropFog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PropFog],
    }).compileComponents();

    fixture = TestBed.createComponent(PropFog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
