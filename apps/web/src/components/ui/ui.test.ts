import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, Field, Input, Select, Collapse, Checkbox, Textarea } from './index.js';

describe('Untitled UI runtime controls and form compatibility', () => {
  it('uses safe default buttons and explicit submit semantics', () => {
    expect(render(h(Button, {}, 'Action'))).toContain('type="button"');
    expect(render(h(Button, {type:'submit'}, 'Save'))).toContain('type="submit"');
    expect(render(h(Button, {disabled:true}, 'No'))).toContain('disabled=""');
    const loading = render(h(Button, {loading:true}, 'Saving'));
    expect(loading).toContain('disabled=""');
    expect(loading).toContain('aria-disabled="true"');
    expect(loading).toContain('aria-label="Saving"');
  });
  it('associates label and descriptions while preserving input attributes', () => {
    const html = render(h(Field, {id:'name',label:'Name',hint:'Required',error:'Missing',children:h(Input, {name:'name',required:true,'aria-describedby':'external'})}));
    expect(html).toContain('for="name"');
    expect(html).toContain('id="name"');
    expect(html).toContain('aria-describedby="external name-hint name-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('required=""');
  });
  it('renders a visible listbox trigger and excludes collapsed fields from keyboard navigation', () => {
    const select=render(h(Select, {defaultValue:'a','aria-label':'Choice'}, h('option', {value:'a'}, 'Alpha')));
    expect(select).toContain('aria-haspopup="listbox"');
    expect(select).toContain('ui-select-value');
    expect(select).toContain('Choice');
    expect(render(h(Collapse, {id:'panel',open:false,children:h(Input,{})}))).toContain('inert=""');
  });
  it('preserves the native checkbox field while rendering the source CheckboxBase indicator', () => {
    const checkbox=render(h(Checkbox,{id:'flag',name:'flag',value:'yes',defaultChecked:true,disabled:true}));
    expect(checkbox).toContain('type="checkbox"');
    expect(checkbox).toContain('name="flag"');
    expect(checkbox).toContain('checked=""');
    expect(checkbox).toContain('disabled=""');
    expect(checkbox).toContain('ui-checkbox-indicator');
    expect(checkbox).toContain('ui-checkbox-check');
  });
  it('retains text control form names, readonly and real textarea attributes', () => {
    const input=render(h(Input,{name:'title',readOnly:true,defaultValue:'ERD'}));
    expect(input).toContain('ui-input-group');
    expect(input).toContain('name="title"');
    expect(input).toContain('readOnly=""');
    const area=render(h(Textarea,{name:'description',rows:4,defaultValue:'Description'}));
    expect(area).toContain('<textarea');
    expect(area).toContain('rows="4"');
    expect(area).toContain('Description');
  });
});

