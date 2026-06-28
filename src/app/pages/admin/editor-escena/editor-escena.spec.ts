

import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditorEscena } from './editor-escena';

describe('EditorEscena', () => {
  let component: EditorEscena;
  let fixture: ComponentFixture<EditorEscena>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditorEscena],
    }).compileComponents();

    fixture = TestBed.createComponent(EditorEscena);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});


