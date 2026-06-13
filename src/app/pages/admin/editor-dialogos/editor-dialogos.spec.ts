
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditorDialogos } from './editor-dialogos';

describe('EditorDialogos', () => {
  let component: EditorDialogos;
  let fixture: ComponentFixture<EditorDialogos>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditorDialogos],
    }).compileComponents();

    fixture = TestBed.createComponent(EditorDialogos);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

