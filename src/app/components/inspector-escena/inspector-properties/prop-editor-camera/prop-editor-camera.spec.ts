import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PropEditorCamera } from './prop-editor-camera';

describe('PropEditorCamera', () => {
  let component: PropEditorCamera;
  let fixture: ComponentFixture<PropEditorCamera>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PropEditorCamera],
    }).compileComponents();

    fixture = TestBed.createComponent(PropEditorCamera);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
