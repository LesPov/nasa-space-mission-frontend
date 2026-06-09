import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ToolbarEscena } from './toolbar-escena';

describe('ToolbarEscena', () => {
  let component: ToolbarEscena;
  let fixture: ComponentFixture<ToolbarEscena>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToolbarEscena],
    }).compileComponents();

    fixture = TestBed.createComponent(ToolbarEscena);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
